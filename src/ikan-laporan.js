import { scaledToRupiah } from './ikan-money.js';
import { IKAN_STORE_ID } from './ikan-config.js';

// Semua penjumlahan di sini INTEGER (unit berskala) sampai detik terakhir --
// dikonversi ke rupiah cuma sekali, pas mau dikirim keluar sebagai response.
// Tidak ada Number()/float di tengah jalan seperti prototipe lama.

// scaledToRupiah menolak input negatif (lihat money.js) -- cash_in dan cash_out
// masing-masing selalu >= 0, tapi selisihnya (posisi kas) boleh negatif (invariant
// #8 CLAUDE.md: saldo negatif bukan bug). Makanya konversi dilakukan terpisah per
// sisi dulu, baru dikurangi di JS -- bukan scaledToRupiah(cash_in - cash_out).
export async function getCashPosition(db) {
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE 0 END), 0) AS cash_in,
         COALESCE(SUM(CASE WHEN direction = 'OUT' THEN amount ELSE 0 END), 0) AS cash_out
       FROM ikan_cash_ledger WHERE store_id = ?`
    )
    .bind(IKAN_STORE_ID)
    .first();
  return scaledToRupiah(row.cash_in) - scaledToRupiah(row.cash_out);
}

export async function getPiutangUtangSummary(db) {
  const piutangRow = await db
    .prepare(`SELECT COALESCE(SUM(total_amount - paid_amount), 0) AS due FROM ikan_sales WHERE store_id = ? AND sale_status = 'INVOICE' AND total_amount > paid_amount`)
    .bind(IKAN_STORE_ID)
    .first();
  const utangPetaniRow = await db
    .prepare(`SELECT COALESCE(SUM(total_amount - paid_amount), 0) AS due FROM ikan_purchases WHERE store_id = ? AND total_amount > paid_amount`)
    .bind(IKAN_STORE_ID)
    .first();
  const cpRows = await db
    .prepare(
      `SELECT cp.amount AS amount, COALESCE((SELECT SUM(amount) FROM ikan_cost_payable_payments p WHERE p.cost_payable_id = cp.cost_payable_id), 0) AS paid
       FROM ikan_cost_payables cp WHERE cp.store_id = ?`
    )
    .bind(IKAN_STORE_ID)
    .all();
  const utangTitipanBiayaScaled = (cpRows.results ?? []).reduce((sum, r) => sum + Math.max(r.amount - r.paid, 0), 0);

  const piutangRupiah = scaledToRupiah(piutangRow.due);
  const utangPetaniRupiah = scaledToRupiah(utangPetaniRow.due);
  const utangTitipanBiayaRupiah = scaledToRupiah(utangTitipanBiayaScaled);
  return {
    piutangRupiah,
    utangPetaniRupiah,
    utangTitipanBiayaRupiah,
    totalUtangRupiah: utangPetaniRupiah + utangTitipanBiayaRupiah,
    cashRupiah: await getCashPosition(db),
  };
}

function getPeriodKey(dateStr, period) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (period === 'yearly') return `${y}`;
  if (period === 'monthly') return `${y}-${String(m).padStart(2, '0')}`;
  if (period === 'daily') return dateStr;
  if (period === 'weekly') {
    const date = new Date(Date.UTC(y, m - 1, d));
    const day = date.getUTCDay() || 7; // Senin=1 ... Minggu=7
    date.setUTCDate(date.getUTCDate() - day + 1); // mundur ke Senin minggu itu
    return date.toISOString().slice(0, 10);
  }
  throw new RangeError('PERIOD_INVALID');
}

// Rugi-laba per periode. Biaya titipan (Titipan Biaya) SENGAJA tidak masuk omzet
// maupun beban di sini -- itu talangan yang ditagih balik dan diselesaikan lewat
// jalur Titipan Biaya sendiri, bukan pendapatan/beban toko (sama seperti catatan
// di prototipe lama, tapi sekarang benar dari desain, bukan asumsi UI).
export async function getProfitLossReport(db, { period = 'monthly', startDate, endDate } = {}) {
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(period)) throw new RangeError('PERIOD_INVALID');

  const conditions = [`sales.store_id = ?`, `sales.sale_status = 'INVOICE'`];
  const args = [IKAN_STORE_ID];
  if (startDate) {
    conditions.push('sales.transaction_date >= ?');
    args.push(startDate);
  }
  if (endDate) {
    conditions.push('sales.transaction_date <= ?');
    args.push(endDate);
  }

  const rows = await db
    .prepare(
      `SELECT sales.transaction_date AS transaction_date, sales.merchandise_amount AS merchandise_amount,
              sales.discount_amount AS discount_amount, sale_items.quantity AS quantity,
              sale_items.purchase_price_at_time AS purchase_price_at_time
       FROM ikan_sales sales
       JOIN ikan_sale_items sale_items ON sale_items.sale_id = sales.sale_id
       WHERE ${conditions.join(' AND ')}`
    )
    .bind(...args)
    .all();

  const buckets = new Map();

  // merchandise_amount/discount_amount dihitung SEKALI per sale (bukan per item)
  // walau query-nya join ke sale_items -- makanya perlu dedup per sale_id+date.
  const saleTotalsRows = await db
    .prepare(`SELECT sale_id, transaction_date, merchandise_amount, discount_amount FROM ikan_sales sales WHERE ${conditions.join(' AND ')}`)
    .bind(...args)
    .all();

  for (const row of saleTotalsRows.results ?? []) {
    const key = getPeriodKey(row.transaction_date, period);
    if (!buckets.has(key)) buckets.set(key, { key, omzetScaled: 0, discountScaled: 0, hppScaled: 0 });
    const b = buckets.get(key);
    b.omzetScaled += row.merchandise_amount;
    b.discountScaled += row.discount_amount;
  }

  for (const row of rows.results ?? []) {
    const key = getPeriodKey(row.transaction_date, period);
    if (!buckets.has(key)) buckets.set(key, { key, omzetScaled: 0, discountScaled: 0, hppScaled: 0 });
    const b = buckets.get(key);
    const lineHpp = row.quantity * row.purchase_price_at_time;
    if (lineHpp % 1000 !== 0) throw new RangeError('HPP_NOT_EXACT');
    b.hppScaled += lineHpp / 1000;
  }

  const sortedBuckets = [...buckets.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  const withRupiah = sortedBuckets.map((b) => {
    const omzetRupiah = scaledToRupiah(b.omzetScaled);
    const discountRupiah = scaledToRupiah(b.discountScaled);
    const hppRupiah = scaledToRupiah(b.hppScaled);
    const netSalesRupiah = omzetRupiah - discountRupiah;
    return { period: b.key, omzetRupiah, discountRupiah, netSalesRupiah, hppRupiah, grossProfitRupiah: netSalesRupiah - hppRupiah };
  });

  const totals = withRupiah.reduce(
    (acc, b) => ({
      omzetRupiah: acc.omzetRupiah + b.omzetRupiah,
      discountRupiah: acc.discountRupiah + b.discountRupiah,
      netSalesRupiah: acc.netSalesRupiah + b.netSalesRupiah,
      hppRupiah: acc.hppRupiah + b.hppRupiah,
      grossProfitRupiah: acc.grossProfitRupiah + b.grossProfitRupiah,
    }),
    { omzetRupiah: 0, discountRupiah: 0, netSalesRupiah: 0, hppRupiah: 0, grossProfitRupiah: 0 }
  );

  return { period, buckets: withRupiah, totals };
}

export async function handleLaporanApi(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ['api','ikan','laporan', section]
  const section = parts[3];

  try {
    if (request.method === 'GET' && section === 'summary') {
      return Response.json(await getPiutangUtangSummary(env.DB));
    }
    if (request.method === 'GET' && section === 'profit-loss') {
      const period = url.searchParams.get('period') ?? 'monthly';
      const startDate = url.searchParams.get('start') ?? undefined;
      const endDate = url.searchParams.get('end') ?? undefined;
      return Response.json(await getProfitLossReport(env.DB, { period, startDate, endDate }));
    }
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  } catch (err) {
    if (err instanceof RangeError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
