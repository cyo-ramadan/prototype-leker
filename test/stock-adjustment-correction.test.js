import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import { dispatchAdminAccountingFact } from '../src/accounting-admin-bridge.js';

// Koreksi Nilai SO (Bos Cyo, 2026-10-05): "cara perbaikan kita disini tidak ikut aturan akuntansi ...
// kalo kita jual program kita apa akan laku". Kejadian Mandala: SO+ Gula 1.998 g dinilai dengan HPP
// rusak Rp18.000/g -> Rp35.964.000 masuk Pendapatan Koreksi Stok. Koreksi harus lewat program:
// catatan koreksi baru + jurnal pembalik selisih, SO aslinya dan jurnalnya tidak diubah.

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}
class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) {
    this.db.exec('BEGIN');
    try { const out = statements.map(s => s.run()); this.db.exec('COMMIT'); return out; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_so', 'owner_so', 'x', 'Bos')`).run();
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_so', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('owner-so'));
  db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at) VALUES ('kasir_so', 'kasirso', 'x', 'Kasir SO', 'store_pendem', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run();
  db.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES ('drawer_so', 'store_pendem', 'kasir_so', 0, 'OPEN', '2026-10-05T00:00:00.000Z')`).run();
  const gula = db.prepare(`SELECT id FROM products WHERE store_id = 'store_pendem' ORDER BY id LIMIT 1`).get();
  return { db, env: { DB: new D1Database(db) }, productId: gula.id };
}

function seedSo(db, { id, productId, direction = 'IN', quantity = 1998, unitCostScaled = 18_000_000_000 }) {
  const payload = {
    purpose: 'STOCK_ADJUSTMENT', productId, productName: 'Gula', unitSymbol: 'g', direction, quantity,
    currentQuantitySnapshot: 2, targetQuantity: 2000, unitCostSnapshotScaled: unitCostScaled,
    totalCostSnapshotScaled: quantity * unitCostScaled, sessionId: `session_${id}`
  };
  db.prepare(`
    INSERT INTO approval_requests (id, store_id, drawer_session_id, cashier_id, request_type, approval_status, posting_status, payload_json, created_at, updated_at, approved_at, posted_at)
    VALUES (?, 'store_pendem', 'drawer_so', 'kasir_so', 'GOODS_FLOW', 'approved', 'posted', ?, '2026-10-05T08:10:58.000Z', '2026-10-05T08:10:58.000Z', '2026-10-05T08:10:58.000Z', '2026-10-05T08:10:58.000Z')
  `).run(id, JSON.stringify(payload));
}

const call = (env, path, body) => worker.fetch(new Request(`https://example.test${path}${path.includes('?') ? '&' : '?'}store=PENDEM`, {
  method: body ? 'POST' : 'GET',
  headers: { Authorization: 'Bearer owner-so', ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined
}), env);

function accountTotals(db, journalId) {
  return db.prepare(`
    SELECT a.code, l.side, l.amount_scaled FROM accounting_journal_lines l JOIN chart_of_accounts a ON a.id = l.account_id
    WHERE l.journal_id = ? ORDER BY a.code, l.side
  `).all(journalId).map(row => [row.code, row.side, Number(row.amount_scaled)]);
}

test('SO+ yang dinilai HPP rusak dikoreksi lewat jurnal pembalik selisih; SO dan jurnal aslinya tidak berubah', async () => {
  const { db, env, productId } = await setup();
  try {
    seedSo(db, { id: 'approval_so_gula', productId });
    const original = await dispatchAdminAccountingFact(env.DB, 'STOCK_ADJUSTMENT', 'approval_so_gula');
    const delivery = db.prepare(`SELECT status, journal_id FROM accounting_bridge_deliveries WHERE fact_type = 'STOCK_ADJUSTMENT' AND fact_id = 'approval_so_gula'`).get();
    assert.equal(delivery?.status, 'POSTED', JSON.stringify(original));
    const before = accountTotals(db, delivery.journal_id);
    assert.deepEqual(before.map(([code, side]) => [code, side]), [['1301', 'DEBIT'], ['4201', 'CREDIT']]);
    const payloadBefore = db.prepare(`SELECT payload_json FROM approval_requests WHERE id = 'approval_so_gula'`).get().payload_json;

    const preview = await (await call(env, '/api/admin/stock-adjustments/approval_so_gula/value-correction/preview', { unitCost: '18' })).json();
    assert.equal(preview.preview.originalValue, 'Rp35.964.000');
    assert.equal(preview.preview.correctedValue, 'Rp35.964');
    assert.equal(preview.preview.delta, '-Rp35.928.036');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stock_adjustment_value_corrections').get().n, 0, 'pratinjau tidak menulis');

    assert.equal((await call(env, '/api/admin/stock-adjustments/approval_so_gula/value-correction', { unitCost: '18' })).status, 400, 'alasan wajib');
    const applied = await call(env, '/api/admin/stock-adjustments/approval_so_gula/value-correction', { unitCost: '18', reason: 'HPP Gula rusak karena salah ketik qty pembelian' });
    assert.equal(applied.status, 201, await applied.clone().text());
    const body = await applied.json();
    assert.equal(body.journal.status, 'POSTED');

    // Jurnal koreksi: arah DIBALIK dari jurnal asli, sebesar selisih, tanggal sama.
    assert.deepEqual(accountTotals(db, body.journal.journalId), [['1301', 'CREDIT', 35_928_036_000_000], ['4201', 'DEBIT', 35_928_036_000_000]]);
    const header = db.prepare('SELECT business_date, source_system FROM accounting_journal_headers WHERE id = ?').get(body.journal.journalId);
    assert.deepEqual([header.business_date, header.source_system], ['2026-10-05', 'LEKER_SO_KOREKSI']);

    // Asli tidak berubah.
    assert.deepEqual(accountTotals(db, delivery.journal_id), before);
    assert.equal(db.prepare(`SELECT payload_json FROM approval_requests WHERE id = 'approval_so_gula'`).get().payload_json, payloadBefore);

    // Net Pendapatan Koreksi Stok = nilai benar.
    const net = db.prepare(`
      SELECT SUM(CASE WHEN l.side = 'CREDIT' THEN l.amount_scaled ELSE -l.amount_scaled END) AS n
      FROM accounting_journal_lines l JOIN chart_of_accounts a ON a.id = l.account_id
      WHERE a.code = '4201' AND l.journal_id IN (?, ?)
    `).get(delivery.journal_id, body.journal.journalId).n;
    assert.equal(Number(net), 35_964_000_000);

    // Sekali saja.
    const again = await call(env, '/api/admin/stock-adjustments/approval_so_gula/value-correction', { unitCost: '18', reason: 'ulang lagi coba' });
    assert.equal(again.status, 409);

    const list = await (await call(env, '/api/admin/stock-adjustments/value-corrections')).json();
    assert.equal(list.corrections.length, 1);
    assert.equal(list.corrections[0].journalStatus, 'POSTED');
  } finally { db.close(); }
});

test('SO- yang nilainya terlalu besar: jurnal koreksi mengembalikan persediaan dan mengurangi beban susut', async () => {
  const { db, env, productId } = await setup();
  try {
    seedSo(db, { id: 'approval_so_larutan', productId, direction: 'OUT', quantity: 172, unitCostScaled: 11_250_876_765 });
    await dispatchAdminAccountingFact(env.DB, 'STOCK_ADJUSTMENT', 'approval_so_larutan');
    const res = await call(env, '/api/admin/stock-adjustments/approval_so_larutan/value-correction', { unitCost: '11.501589', reason: 'HPP Larutan Gula ikut rusak dari Gula' });
    assert.equal(res.status, 201, await res.clone().text());
    const body = await res.json();
    const selisih = 172 * 11_250_876_765 - 172 * 11_501_589;
    assert.deepEqual(accountTotals(db, body.journal.journalId), [['1301', 'DEBIT', selisih], ['6103', 'CREDIT', selisih]]);
  } finally { db.close(); }
});

test('ditolak: jurnal SO asli belum masuk Akuntansi, nilai sama, bukan penyesuaian stok, tanpa login', async () => {
  const { db, env, productId } = await setup();
  try {
    seedSo(db, { id: 'approval_so_belum', productId });
    const belum = await call(env, '/api/admin/stock-adjustments/approval_so_belum/value-correction', { unitCost: '18', reason: 'jurnal asli belum ada' });
    assert.equal(belum.status, 409);
    assert.equal((await belum.json()).code, 'ORIGINAL_SO_NOT_POSTED');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stock_adjustment_value_corrections').get().n, 0);

    await dispatchAdminAccountingFact(env.DB, 'STOCK_ADJUSTMENT', 'approval_so_belum');
    assert.equal((await call(env, '/api/admin/stock-adjustments/approval_so_belum/value-correction', { unitCost: '18000', reason: 'nilai sama persis' })).status, 409);
    assert.equal((await call(env, '/api/admin/stock-adjustments/tidak_ada/value-correction', { unitCost: '18', reason: 'tidak ada barangnya' })).status, 404);
    const tanpaLogin = await worker.fetch(new Request('https://example.test/api/admin/stock-adjustments/value-corrections?store=PENDEM'), env);
    assert.equal(tanpaLogin.status, 401);
  } finally { db.close(); }
});

test('Laporan Untung Rugi non-Akuntansi membaca nilai terkoreksi, Detail Admin punya tombol Koreksi nilai', () => {
  const report = readFileSync(new URL('../src/net-profit-report.js', import.meta.url), 'utf8');
  assert.match(report, /COALESCE\(c\.corrected_value_scaled, json_extract\(a\.payload_json, '\$\.totalCostSnapshotScaled'\)\)/);
  assert.match(report, /LEFT JOIN stock_adjustment_value_corrections c ON c\.approval_request_id = a\.id/);
  const ui = readFileSync(new URL('../public/admin-transactions-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /data-so-correct=/);
  assert.match(ui, /\/value-correction\/preview/);
});
