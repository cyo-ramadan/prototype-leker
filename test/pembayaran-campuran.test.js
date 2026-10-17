import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCashierTrackedSaleApi } from '../src/cashier-sales-tracking.js';
import { hashCredential } from '../src/owner-auth.js';
import { buildDrawerReport } from '../src/drawer-report.js';
import { loadPosAccountingFact, resolvePosFactToJournalCommand } from '../src/accounting-pos-bridge.js';
import { ACCOUNTING_AMOUNT_SCALE, postAccountingJournal } from '../src/accounting-ledger.js';
import { tautkanOtomatis } from '../src/qris-otomatis.js';

// Pembayaran campuran (Bos Cyo, 2026-10-17): "ada yang beli 12 ribu, qris 5000 cash 7000". Satu nota,
// beberapa cara bayar. Yang dijaga: jurnal tetap seimbang dan mendebit akun tiap cara bayar sesuai
// bagiannya, uang laci hanya bertambah bagian tunainya, QRIS ditautkan sebesar bagian QRIS-nya, dan
// penjualan biasa tidak berubah sama sekali.

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(result.changes || 0) } };
  }
}

class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) {
    this.db.exec('BEGIN');
    try { const out = statements.map(statement => statement.run()); this.db.exec('COMMIT'); return out; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}

async function fixture() {
  const sqlite = migratedDatabase();
  const env = { DB: new D1Database(sqlite) };
  const store = sqlite.prepare(`SELECT id, code, entity_id FROM stores WHERE code = 'G001' LIMIT 1`).get();
  const product = sqlite.prepare(`
    SELECT p.id, p.name, p.price FROM products p JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    WHERE p.store_id = ? AND p.base_unit_id IS NOT NULL AND t.can_sell = 1 AND p.is_active = 1 ORDER BY p.id LIMIT 1
  `).get(store.id);
  const cashier = sqlite.prepare(`SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1`).get(store.id);
  const rekber = sqlite.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = ? AND code = '1103'`).get(store.id);
  assert.ok(store && product && cashier && rekber, 'fixture gerai/barang/kasir/akun 1103 dari migration');
  sqlite.prepare(`INSERT INTO payment_methods (id, store_id, code, name, account_id, is_active, is_default, creates_payable) VALUES ('pm_qris_g001', ?, 'QRIS', 'QRIS', ?, 1, 0, 0)`).run(store.id, rekber.id);
  const token = `campuran_${crypto.randomUUID()}`;
  sqlite.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .run(await hashCredential(token), cashier.id, new Date().toISOString(), new Date(Date.now() + 3600_000).toISOString());
  const drawerId = `drawer_campuran_${crypto.randomUUID()}`;
  sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES (?, ?, ?, 50000, 'OPEN', ?)`)
    .run(drawerId, store.id, cashier.id, new Date().toISOString());
  return { sqlite, env, store, product: { id: Number(product.id), name: product.name, price: Number(product.price) }, token, drawerId };
}

let orderSeq = 0;
function seedOrder(fx, quantity = 2) {
  const orderId = `order_campuran_${++orderSeq}`;
  const unitPrice = 6000; // harga wajar; harga barang bawaan fixture terlalu besar untuk skala jurnal
  const lineTotal = unitPrice * quantity;
  const now = new Date().toISOString();
  fx.sqlite.prepare(`
    INSERT INTO orders (id, store_id, customer_id, business_date, order_no, customer_name, table_label, general_note,
      total_amount, status, created_at, updated_at, ready_at, completed_at, cancelled_at, source, drawer_session_id)
    VALUES (?, ?, NULL, '2026-10-17', ?, 'Walk-in', '', '', ?, 'COMPLETED', ?, ?, NULL, ?, NULL, 'customer', ?)
  `).run(orderId, fx.store.id, orderId, lineTotal, now, now, now, fx.drawerId);
  fx.sqlite.prepare(`INSERT INTO order_items (id, store_id, order_id, product_id, product_name, unit_price, quantity, note, line_total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)`)
    .run(`${orderId}_item`, fx.store.id, orderId, fx.product.id, fx.product.name, unitPrice, quantity, lineTotal, now);
  return { orderId, quantity, total: lineTotal };
}

async function jual(fx, order, body) {
  const response = await handleCashierTrackedSaleApi(new Request('https://leker.test/api/cashier/sales', {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceOrderId: order.orderId, items: [{ productId: fx.product.id, quantity: order.quantity }], ...body })
  }), fx.env, '/api/cashier/sales');
  return { status: response.status, body: await response.json() };
}

test('penjualan campuran tersimpan dengan rinciannya; jumlah harus sama dengan total; hutang & saklar mati ditolak', async () => {
  const fx = await fixture();
  const order = seedOrder(fx);
  const tunai = Math.floor(order.total / 3);
  const qris = order.total - tunai;

  const salah = await jual(fx, order, { payments: [{ paymentMethod: 'QRIS', amount: qris }, { paymentMethod: 'CASH', amount: tunai + 1 }] });
  assert.equal(salah.status, 400);
  assert.equal(salah.body.code, 'SPLIT_TOTAL_MISMATCH');
  const hutang = await jual(fx, order, { payments: [{ paymentMethod: 'QRIS', amount: qris }, { paymentMethod: 'PAYABLE', amount: tunai }] });
  assert.equal(hutang.status, 400);
  assert.equal(fx.sqlite.prepare(`SELECT COUNT(*) AS n FROM sales`).get().n, 0, 'penolakan tidak meninggalkan penjualan');

  const ok = await jual(fx, order, { payments: [{ paymentMethod: 'QRIS', amount: qris }, { paymentMethod: 'CASH', amount: tunai }] });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.sale.paymentMethod, 'CAMPURAN');
  const sale = fx.sqlite.prepare(`SELECT id, payment_method, total_amount FROM sales WHERE id = ?`).get(ok.body.sale.id);
  assert.equal(sale.payment_method, 'CAMPURAN');
  assert.equal(sale.total_amount, order.total);
  const parts = fx.sqlite.prepare(`SELECT payment_method_code AS code, amount FROM sale_payments WHERE sale_id = ? ORDER BY code`).all(sale.id).map(row => ({ ...row }));
  assert.deepEqual(parts, [{ code: 'CASH', amount: tunai }, { code: 'QRIS', amount: qris }]);

  // Saklar tenant mati -> ditolak.
  const tenant = fx.sqlite.prepare(`SELECT tenant_id FROM entity_tenancy WHERE entity_id = ? AND effective_to IS NULL`).get(fx.store.entity_id);
  fx.sqlite.prepare(`INSERT INTO tenant_policy_settings (tenant_id, setting_key, setting_value, updated_at) VALUES (?, 'pembayaran_campuran', '0', '2026-10-17T00:00:00Z')`).run(tenant.tenant_id);
  const order2 = seedOrder(fx);
  const mati = await jual(fx, order2, { payments: [{ paymentMethod: 'QRIS', amount: order2.total - 1 }, { paymentMethod: 'CASH', amount: 1 }] });
  assert.equal(mati.status, 403);
  // Penjualan biasa tetap seperti dulu: tanpa rincian.
  const biasa = await jual(fx, order2, { paymentMethod: 'CASH' });
  assert.equal(biasa.status, 201);
  assert.equal(fx.sqlite.prepare(`SELECT COUNT(*) AS n FROM sale_payments WHERE sale_id = ?`).get(biasa.body.sale.id).n, 0);
});

test('jurnal campuran: debit Kas sebesar tunai + debit Rekening Bersama sebesar QRIS, seimbang dengan pendapatan', async () => {
  const fx = await fixture();
  const order = seedOrder(fx);
  const tunai = 7000 <= order.total ? Math.min(7000, order.total - 1) : 1;
  const qris = order.total - tunai;
  const ok = await jual(fx, order, { payments: [{ paymentMethod: 'QRIS', amount: qris }, { paymentMethod: 'CASH', amount: tunai }] });
  assert.equal(ok.status, 201);
  const fact = await loadPosAccountingFact(fx.env.DB, fx.store.id, 'SALE', ok.body.sale.id);
  assert.equal(fact.paymentMethodCode, 'CAMPURAN');
  assert.deepEqual(fact.paymentParts.map(part => [part.code, part.amountMinor]).sort(), [['CASH', tunai], ['QRIS', qris]]);
  const store = { id: fx.store.id, code: fx.store.code, storeName: fx.store.code };
  const outcome = await resolvePosFactToJournalCommand(fx.env.DB, store, fact);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  const akun = code => fx.sqlite.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = ? AND code = ?`).get(fx.store.id, code).id;
  const debit = outcome.command.journalLines.filter(line => line.side === 'DEBIT');
  assert.deepEqual(
    debit.filter(line => line.accountId === akun('1101') || line.accountId === akun('1103')).map(line => [line.accountId, line.amountScaled]).sort(),
    [[akun('1101'), tunai * ACCOUNTING_AMOUNT_SCALE], [akun('1103'), qris * ACCOUNTING_AMOUNT_SCALE]].sort()
  );
  const totalDebit = outcome.command.journalLines.filter(l => l.side === 'DEBIT').reduce((s, l) => s + l.amountScaled, 0);
  const totalKredit = outcome.command.journalLines.filter(l => l.side === 'CREDIT').reduce((s, l) => s + l.amountScaled, 0);
  assert.equal(totalDebit, totalKredit);
  const posted = await postAccountingJournal(fx.env.DB, store, outcome.command);
  assert.equal(posted.ok, true, JSON.stringify(posted));

  // Rincian dirusak (jumlah != total) -> jembatan menolak, tidak menebak.
  const rusak = await resolvePosFactToJournalCommand(fx.env.DB, store, { ...fact, factId: 'x', paymentParts: [{ code: 'CASH', amountMinor: 1 }, { code: 'QRIS', amountMinor: 1 }] });
  assert.equal(rusak.ok, false);
  assert.equal(rusak.code, 'BUSINESS_FACT_PAYMENT_SPLIT_MISMATCH');
});

test('laci: uang seharusnya hanya bertambah bagian tunai; QRIS menaut sebesar bagian QRIS', async () => {
  const fx = await fixture();
  const order = seedOrder(fx);
  const tunai = 1000 < order.total ? 1000 : 1;
  const qris = order.total - tunai;
  const ok = await jual(fx, order, { payments: [{ paymentMethod: 'QRIS', amount: qris }, { paymentMethod: 'CASH', amount: tunai }] });
  assert.equal(ok.status, 201);

  const report = await buildDrawerReport(fx.env.DB, fx.store.id, fx.drawerId);
  assert.equal(report.totals.cashSales, tunai);
  assert.equal(report.totals.nonCashSales, order.total - tunai);
  assert.equal(report.totals.expectedCash, 50000 + tunai);
  assert.equal(report.totals.cashSalesItems, 0, 'baris penyesuaian tidak menambah jumlah item');
  assert.deepEqual(report.totals.nonCashSalesByMethod.map(row => [row.method, row.amount]), [['QRIS', qris]]);

  // Uang QRIS masuk sebesar bagian QRIS -> tertaut otomatis ke penjualan campuran itu.
  fx.sqlite.prepare(`INSERT INTO qris_masuk (id, entity_id, store_id, amount, source, received_at, business_date, created_at) VALUES ('qm_campuran', ?, ?, ?, 'MANUAL', ?, '2026-10-17', ?)`)
    .run(fx.store.entity_id, fx.store.id, qris, new Date().toISOString(), new Date().toISOString());
  assert.equal(await tautkanOtomatis(fx.env.DB, fx.store.id), 1);
  assert.equal(fx.sqlite.prepare(`SELECT sale_id FROM qris_masuk WHERE id = 'qm_campuran'`).get().sale_id, ok.body.sale.id);
});
