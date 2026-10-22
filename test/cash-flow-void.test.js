import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { voidCashFlow } from '../src/cash-flow-void.js';
import { buildDrawerReport } from '../src/drawer-report.js';
import { listStoreTransactions } from '../src/admin-transactions.js';

// Bos Cyo, 2026-10-22 -- Tlekung: Arus Kas masuk Rp305.500 salah catat. Hapus = soft delete: uang laci
// tidak lagi menghitungnya, statusnya "voided", dan hapus kedua kali tidak berbuat apa-apa.

const migrationDir = new URL('../migrations/', import.meta.url);
const d1Result = result => ({ success: true, meta: { changes: Number(result?.changes || 0) } });
function d1(sqlite) {
  const prepare = sql => {
    const statement = sqlite.prepare(sql);
    return {
      bind(...args) {
        return {
          _statement: statement, _args: args,
          async first() { return statement.get(...args) || null; },
          async all() { return { results: statement.all(...args) }; },
          async run() { return d1Result(statement.run(...args)); }
        };
      }
    };
  };
  return {
    prepare,
    async batch(bound) {
      sqlite.exec('BEGIN');
      try { const results = bound.map(item => d1Result(item._statement.run(...item._args))); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  };
}

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  const store = sqlite.prepare('SELECT id FROM stores ORDER BY id LIMIT 1').get();
  const cashier = sqlite.prepare('SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1').get(store.id);
  const drawerId = `drawer_${crypto.randomUUID()}`;
  sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES (?, ?, ?, 100000, 'OPEN', '2026-10-22T02:00:00.000Z')`)
    .run(drawerId, store.id, cashier.id);
  const requestId = `approval_${crypto.randomUUID()}`;
  sqlite.prepare(`
    INSERT INTO approval_requests (id, store_id, drawer_session_id, cashier_id, request_type, approval_status, posting_status, payload_json, created_at, updated_at, posted_at)
    VALUES (?, ?, ?, ?, 'CASH_FLOW', 'pending_approval', 'unposted', ?, '2026-10-22T06:42:38.000Z', '2026-10-22T06:42:38.000Z', '2026-10-22T06:42:38.000Z')
  `).run(requestId, store.id, drawerId, cashier.id, JSON.stringify({ direction: 'IN', amount: 305500, description: 'salah input', accountingCounterpartLabel: 'Pendapatan Lainnya' }));
  sqlite.prepare(`
    INSERT INTO cash_ledger_entries (id, store_id, drawer_session_id, approval_request_id, direction, amount, description, posted_at, approved_by_role, approved_by_id)
    VALUES (?, ?, ?, ?, 'IN', 305500, 'salah input', '2026-10-22T06:42:38.000Z', 'SYSTEM', '')
  `).run(`cash_${crypto.randomUUID()}`, store.id, drawerId, requestId);
  sqlite.prepare("UPDATE approval_requests SET approval_status = 'approved', posting_status = 'posted' WHERE id = ?").run(requestId);
  return { sqlite, db: d1(sqlite), store: { id: store.id }, drawerId, requestId };
}

test('hapus Arus Kas: uang laci terkoreksi, status voided, tidak bisa dobel', async () => {
  const f = setup();
  try {
    const sebelum = (await buildDrawerReport(f.db, f.store.id, f.drawerId)).totals.expectedCash;
    const hasil = await voidCashFlow(f.db, f.store, { requestId: f.requestId, actor: { role: 'ENTITY_ADMIN', id: 'bos' }, reason: 'salah catat', reference: 'direct_test', now: '2026-10-22T10:00:00.000Z' });
    assert.equal(hasil.ok, true);
    assert.equal(hasil.duplicate, false);
    assert.equal(hasil.accounting.accountingStatus, 'NOT_REQUIRED', 'belum pernah dijurnal: tidak ada yang dibalik');
    const sesudah = (await buildDrawerReport(f.db, f.store.id, f.drawerId)).totals.expectedCash;
    assert.equal(sebelum - sesudah, 305500);
    const row = f.sqlite.prepare('SELECT voided_at, voided_by_role, void_reason FROM approval_requests WHERE id = ?').get(f.requestId);
    assert.deepEqual({ ...row }, { voided_at: '2026-10-22T10:00:00.000Z', voided_by_role: 'ENTITY_ADMIN', void_reason: 'salah catat' });
    const daftar = await listStoreTransactions(f.db, f.store.id, { filter: 'ALL', limit: 50 });
    assert.equal(daftar.transactions.find(tx => tx.id === f.requestId)?.status, 'voided');
    const lagi = await voidCashFlow(f.db, f.store, { requestId: f.requestId, actor: { role: 'ADMIN', id: 'a' }, reason: 'lagi', reference: 'direct_2' });
    assert.equal(lagi.duplicate, true);
  } finally { f.sqlite.close(); }
});

test('Arus Kas yang belum ACC/posted tidak bisa dihapus lewat jalur ini', async () => {
  const f = setup();
  try {
    f.sqlite.prepare("UPDATE approval_requests SET approval_status = 'pending_approval', posting_status = 'unposted' WHERE id = ?").run(f.requestId);
    const hasil = await voidCashFlow(f.db, f.store, { requestId: f.requestId, actor: { role: 'ADMIN', id: 'a' }, reason: 'x', reference: 'r' });
    assert.equal(hasil.ok, false);
    assert.equal(hasil.status, 409);
  } finally { f.sqlite.close(); }
});

test('UI: tombol hapus Arus Kas ada di kasir, admin Transaksi, dan Izin CS', () => {
  const kasir = readFileSync(new URL('../public/cashier-data-explorer.js', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../public/admin-transactions-ui.js', import.meta.url), 'utf8');
  const izin = readFileSync(new URL('../public/entity-izin-cs.js', import.meta.url), 'utf8');
  assert.match(kasir, /data-cashier-cf-void/);
  assert.match(kasir, /\/api\/cashier\/cash-flow-void\/permits/);
  assert.match(admin, /data-cash-flow-void/);
  assert.match(admin, /\/api\/admin\/cash-flows\//);
  assert.match(izin, /\/api\/management\/cash-flow-void-permits/);
});
