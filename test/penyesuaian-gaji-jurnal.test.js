import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import { syncStoreAccounting } from '../src/accounting-auto-sync.js';
import { buildEmployeeLedger } from '../src/employee-ledger-view.js';

// Bos Cyo, 2026-10-16: "akuntan bilang kalo dia entry di penyesuaian gaji tapi engga muncul di
// riwayat maupun jurnal". Penyesuaian Gaji (Akun Kasir -> Gaji) sekarang dijurnal seperti Bea Gaji,
// atas nama pemilik akun; dibatalkan = dibalik; penyesuaian lama ikut lewat sinkron; saldo ikut.

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
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_pg', 'owner_pg', 'x', 'Bos')`).run();
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_pg', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('owner-pg'));
  const entityId = db.prepare(`SELECT entity_id FROM stores WHERE id = 'store_pendem'`).get().entity_id;
  db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id) VALUES ('c_rani', 'rani', 'x', 'Rani', 'store_pendem')`).run();
  db.prepare(`INSERT INTO employees (id, entity_id, full_name) VALUES ('emp_rani', ?, 'Rani')`).run(entityId);
  db.prepare(`INSERT INTO employee_account_links (id, employee_id, entity_id, account_type, account_id, store_id, effective_from) VALUES ('lnk_rani', 'emp_rani', ?, 'CASHIER', 'c_rani', 'store_pendem', '2026-01-01')`).run(entityId);
  return { db, env: { DB: new D1Database(db) }, entityId };
}

const call = (env, path, body) => worker.fetch(new Request(`https://example.test${path}?store=PENDEM`, {
  method: 'POST', headers: { Authorization: 'Bearer owner-pg', 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}), env);

// Saldo Utang Gaji atas nama Rani menurut buku (Kredit - Debit), rupiah.
const bukuRani = db => Number(db.prepare(`
  SELECT COALESCE(SUM(CASE WHEN side = 'CREDIT' THEN amount_scaled ELSE -amount_scaled END), 0) AS n
  FROM accounting_party_entries WHERE account_code = '2102' AND employee_id = 'emp_rani'
`).get().n) / 1_000_000;

test('Penyesuaian Gaji dijurnal atas nama karyawan, dibatalkan = dibalik, saldo riwayat ikut', async () => {
  const { db, env, entityId } = await setup();
  const res = await call(env, '/api/admin/cashiers/c_rani/payroll', { businessDate: '2026-10-15', amountRupiah: 11000, reason: 'insentif Rani 15 Okt' });
  assert.equal(res.status, 201, await res.clone().text());
  const body = await res.json();
  assert.equal(body.accounting.deliveries[0].bridgeStatus, 'POSTED');
  assert.equal(bukuRani(db), 11000);
  const journal = db.prepare(`SELECT business_date, description FROM accounting_journal_headers WHERE source_system = 'LEKER_ADMIN' AND source_reference_id = ?`).get(`PENYESUAIAN_GAJI:${body.id}`);
  assert.equal(journal.business_date, '2026-10-15');
  assert.match(journal.description, /^Penyesuaian Gaji · Rani · insentif Rani 15 Okt/);

  const potong = await (await call(env, '/api/admin/cashiers/c_rani/payroll', { businessDate: '2026-10-14', amountRupiah: -3000, reason: 'potongan' })).json();
  assert.equal(bukuRani(db), 8000);
  const ledger = await buildEmployeeLedger(env.DB, { employeeId: 'emp_rani', entityId, kind: 'gaji' });
  assert.equal(ledger.balanceRupiah, 8000);
  assert.equal(ledger.belumMasukBukuRupiah, 0);

  const voided = await call(env, `/api/admin/cashiers/c_rani/payroll-adjustments/${potong.id}/void`, { reason: 'salah input' });
  assert.equal(voided.status, 200, await voided.clone().text());
  assert.equal(bukuRani(db), 11000);
  const reversal = db.prepare(`SELECT business_date FROM accounting_journal_headers WHERE source_reference_id = ?`).get(`VOID:PENYESUAIAN_GAJI:${potong.id}`);
  assert.equal(reversal.business_date, '2026-10-14');
});

test('penyesuaian lama yang belum dijurnal ikut disinkronkan', async () => {
  const { db, env } = await setup();
  db.prepare(`INSERT INTO payroll_adjustments (id, account_type, account_id, store_id, business_date, amount_rupiah, reason, created_by_role, created_by_id, created_at)
    VALUES ('payroll_adj_lama', 'CASHIER', 'c_rani', 'store_pendem', '2026-10-05', 25000, 'masuk 12.00-22.00', 'ENTITY_ADMIN', 'x', '2026-10-15T03:58:35.726Z')`).run();
  await syncStoreAccounting(env.DB, { id: 'store_pendem', code: 'PENDEM' });
  assert.equal(bukuRani(db), 25000);
  await syncStoreAccounting(env.DB, { id: 'store_pendem', code: 'PENDEM' });
  assert.equal(bukuRani(db), 25000, 'tidak dobel');
});

test('PENJAGA D1: tidak ada query di jembatan admin dengan lebih dari 5 SELECT dalam satu UNION', () => {
  // D1 produksi menolak "too many terms in compound SELECT" (SQLite lokal tidak) -- 2026-10-16 laporan error.
  const source = readFileSync(new URL('../src/accounting-admin-bridge.js', import.meta.url), 'utf8');
  for (const segment of source.split('`')) assert.ok((segment.match(/UNION ALL/g) || []).length <= 4, segment.slice(0, 120));
});
