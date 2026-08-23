import { newId } from './ikan-ids.js';
import { rupiahToScaled, scaledToRupiah } from './ikan-money.js';
import { IKAN_STORE_ID } from './ikan-config.js';

// cost_payables TIDAK punya kolom paid_amount sendiri (lihat migration 0051) --
// sengaja dihitung dari SUM(cost_payable_payments) tiap kali, supaya tidak ada
// counter kedua yang bisa drift dari baris pembayaran yang sesungguhnya.
async function sumPaid(db, costPayableId) {
  const row = await db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS paid FROM ikan_cost_payable_payments WHERE cost_payable_id = ?')
    .bind(costPayableId)
    .first();
  return row.paid;
}

async function mapCostPayableRow(db, row) {
  const paid = await sumPaid(db, row.cost_payable_id);
  return {
    costPayableId: row.cost_payable_id,
    saleId: row.sale_id,
    costName: row.cost_name,
    payeeContactId: row.payee_contact_id,
    payeeNameSnapshot: row.payee_name_snapshot,
    amountRupiah: scaledToRupiah(row.amount),
    paidRupiah: scaledToRupiah(paid),
    dueRupiah: scaledToRupiah(row.amount - paid),
    transactionDate: row.transaction_date,
    createdAt: row.created_at,
  };
}

export async function getCostPayable(db, costPayableId) {
  const row = await db.prepare('SELECT * FROM ikan_cost_payables WHERE cost_payable_id = ? AND store_id = ?').bind(costPayableId, IKAN_STORE_ID).first();
  return row ? mapCostPayableRow(db, row) : null;
}

export async function listCostPayables(db, { dueOnly = false, payeeContactId } = {}) {
  const conditions = ['store_id = ?'];
  const args = [IKAN_STORE_ID];
  if (payeeContactId) {
    conditions.push('payee_contact_id = ?');
    args.push(payeeContactId);
  }
  const result = await db
    .prepare(`SELECT * FROM ikan_cost_payables WHERE ${conditions.join(' AND ')} ORDER BY transaction_date DESC, created_at DESC`)
    .bind(...args)
    .all();
  const mapped = await Promise.all((result.results ?? []).map((row) => mapCostPayableRow(db, row)));
  return dueOnly ? mapped.filter((cp) => cp.dueRupiah > 0) : mapped;
}

function validateInput(input) {
  if (!input.saleId) throw new RangeError('saleId wajib diisi');
  if (!input.costName || typeof input.costName !== 'string') throw new RangeError('costName wajib diisi');
  if (!Number.isInteger(input.amountRupiah) || input.amountRupiah <= 0) {
    throw new RangeError('amountRupiah harus bilangan bulat > 0');
  }
  if (!input.payeeName || typeof input.payeeName !== 'string') {
    throw new RangeError('payeeName wajib diisi (nama pihak ketiga, boleh sama dengan kontak master atau ketik manual)');
  }
}

// Titipan Biaya -- fitur khas Galeh (lihat CLAUDE.md): biaya yang ditalangi toko
// atas nama satu penjualan, ditagih ke customer lewat invoice yang sama. Penambahan
// payable dan sales.total_amount harus atomik supaya tagihan customer tidak drift.
export async function addCostPayable(db, input) {
  validateInput(input);
  const sale = await db.prepare('SELECT sale_id, transaction_date FROM ikan_sales WHERE sale_id = ? AND store_id = ?').bind(input.saleId, IKAN_STORE_ID).first();
  if (!sale) throw new RangeError('SALE_NOT_FOUND');

  const costPayableId = newId('TB');
  const amountScaled = rupiahToScaled(input.amountRupiah);
  await db.batch([
    db
      .prepare(
        `INSERT INTO ikan_cost_payables (cost_payable_id, store_id, sale_id, cost_name, payee_contact_id, payee_name_snapshot, amount, transaction_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(costPayableId, IKAN_STORE_ID, input.saleId, input.costName.trim(), input.payeeContactId ?? null, input.payeeName.trim(), amountScaled, sale.transaction_date),
    db
      .prepare(`UPDATE ikan_sales SET total_amount = total_amount + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE sale_id = ?`)
      .bind(amountScaled, input.saleId),
  ]);
  return getCostPayable(db, costPayableId);
}

// Settle -- cost_payable_payments + cash_ledger OUT atomik. Satu cost_payable
// HANYA lunas kalau SUM(payments) >= amount (dicek lewat sumPaid di atas);
// overpay ditolak, bukan dipotong diam-diam. Pelunasan vendor tidak mengubah
// sales.total_amount karena tagihan customer sudah dikunci saat payable dibuat.
export async function settleCostPayable(db, costPayableId, amountRupiah) {
  const row = await db.prepare('SELECT * FROM ikan_cost_payables WHERE cost_payable_id = ? AND store_id = ?').bind(costPayableId, IKAN_STORE_ID).first();
  if (!row) throw new RangeError('COST_PAYABLE_NOT_FOUND');
  const amountScaled = rupiahToScaled(amountRupiah);
  const paid = await sumPaid(db, costPayableId);
  const due = row.amount - paid;
  if (amountScaled <= 0) throw new RangeError('AMOUNT_MUST_BE_POSITIVE');
  if (amountScaled > due) throw new RangeError('AMOUNT_EXCEEDS_DUE');

  const paymentId = newId('TBP');
  const ledgerId = newId('CL');
  await db.batch([
    db.prepare('INSERT INTO ikan_cost_payable_payments (cost_payable_payment_id, cost_payable_id, amount) VALUES (?, ?, ?)').bind(paymentId, costPayableId, amountScaled),
    db.prepare(`INSERT INTO ikan_cash_ledger (cash_ledger_id, store_id, direction, amount, source_type, source_id) VALUES (?, ?, 'OUT', ?, 'COST_PAYABLE_PAYMENT', ?)`).bind(ledgerId, IKAN_STORE_ID, amountScaled, paymentId),
  ]);
  return getCostPayable(db, costPayableId);
}

// Rekap per pihak ketiga (payee) -- dulu "R. Vendor" di prototipe lama, sekarang
// dari database. Grouping dilakukan di JS (jumlah baris kecil untuk skala Galeh),
// bukan SQL GROUP BY, supaya paid/due tetap dihitung lewat sumPaid yang sama.
export async function recapByPayee(db) {
  const all = await listCostPayables(db);
  const groups = new Map();
  for (const cp of all) {
    const key = cp.payeeContactId ?? `manual:${cp.payeeNameSnapshot}`;
    if (!groups.has(key)) {
      groups.set(key, { payeeContactId: cp.payeeContactId, payeeName: cp.payeeNameSnapshot, totalRupiah: 0, paidRupiah: 0, dueRupiah: 0, items: [] });
    }
    const g = groups.get(key);
    g.totalRupiah += cp.amountRupiah;
    g.paidRupiah += cp.paidRupiah;
    g.dueRupiah += cp.dueRupiah;
    g.items.push(cp);
  }
  return [...groups.values()];
}

export async function handleTitipanBiayaApi(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ['api','ikan','cost-payables', id?, action?]
  const costPayableId = parts[3];
  const action = parts[4];

  try {
    if (request.method === 'GET' && !costPayableId && url.searchParams.get('view') === 'by-payee') {
      return Response.json(await recapByPayee(env.DB));
    }
    if (request.method === 'GET' && !costPayableId) {
      const dueOnly = url.searchParams.get('due') === '1';
      const payeeContactId = url.searchParams.get('payeeContactId') ?? undefined;
      return Response.json(await listCostPayables(env.DB, { dueOnly, payeeContactId }));
    }
    if (request.method === 'GET' && costPayableId) {
      const found = await getCostPayable(env.DB, costPayableId);
      if (!found) return Response.json({ error: 'COST_PAYABLE_NOT_FOUND' }, { status: 404 });
      return Response.json(found);
    }
    if (request.method === 'POST' && !costPayableId) {
      const body = await request.json();
      const created = await addCostPayable(env.DB, body);
      return Response.json(created, { status: 201 });
    }
    if (request.method === 'POST' && costPayableId && action === 'settle') {
      const body = await request.json();
      const updated = await settleCostPayable(env.DB, costPayableId, body.amountRupiah);
      return Response.json(updated);
    }
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  } catch (err) {
    if (err instanceof RangeError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
