import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import { createDirectSplit, createSplitPlan, cancelSplit, postSplitNow, listSplitSchedules } from '../src/accounting-journal-schedules.js';
import { postAccountingJournal } from '../src/accounting-ledger.js';

// Bos Cyo, 2026-10-14: satu Jurnal Split = satu kesatuan. Hapus split -> semua jurnal hariannya batal
// sekaligus (pembalik bertanggal sama), termasuk split yang dibuat sebelum fitur ini. Hari yang belum tiba
// bisa "Posting sekarang".

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
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_sp', 'owner_sp', 'x', 'Bos')`).run();
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_sp', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('owner-sp'));
  const acc = code => db.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = 'store_pendem' AND code = ?`).get(code).id;
  const store = db.prepare(`SELECT id, code, entity_id AS entityId FROM stores WHERE code = 'PENDEM'`).get();
  return { db, env: { DB: new D1Database(db) }, acc, store: { ...store } };
}

const call = (env, path, body) => worker.fetch(new Request(`https://example.test${path}?store=PENDEM`, {
  method: body ? 'POST' : 'GET',
  headers: { Authorization: 'Bearer owner-sp', ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined
}), env);

// Saldo akun per tanggal transaksi (Debit - Kredit), rupiah.
const netPerDate = (db, accountId) => Object.fromEntries(db.prepare(`
  SELECT h.business_date AS d, SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount_scaled ELSE -l.amount_scaled END) AS n
  FROM accounting_journal_lines l JOIN accounting_journal_headers h ON h.id = l.journal_id
  WHERE l.account_id = ? GROUP BY h.business_date ORDER BY h.business_date
`).all(accountId).map(row => [row.d, Number(row.n) / 1_000_000]));

test('Posting sekarang memposting hari yang belum tiba dengan tanggalnya; Hapus split membalik semuanya per tanggal', async () => {
  const { db, env, acc, store } = await setup();
  try {
    const split = await createDirectSplit(env.DB, store, {
      name: 'Sewa lapak Okt', debitAccountId: acc('6106'), creditAccountId: acc('2101'), totalAmount: 700_000,
      startDate: '2026-10-12', endDate: '2026-10-18', creditParty: { name: 'Spbu Beji' }
    }, { today: '2026-10-14' });
    assert.equal(split.ok, true, JSON.stringify(split));
    assert.deepEqual([split.postedNow, split.waiting], [3, 4]);

    const now = await postSplitNow(env.DB, store, split.scheduleId);
    assert.deepEqual([now.ok, now.posted, now.remaining], [true, 4, 0]);
    assert.deepEqual(Object.keys(netPerDate(db, acc('6106'))), ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);

    const res = await call(env, `/api/admin/accounting/journal-splits/${split.scheduleId}/cancel`, { reason: 'salah nominal' });
    assert.equal(res.status, 200, await res.clone().text());
    assert.deepEqual(await res.json(), { ok: true, scheduleId: split.scheduleId, reversed: 7, remaining: 0 });
    assert.ok(Object.values(netPerDate(db, acc('6106'))).every(value => value === 0), 'tiap tanggal kembali nol');
    const named = db.prepare(`SELECT COALESCE(SUM(CASE WHEN side='CREDIT' THEN amount_scaled ELSE -amount_scaled END),0) n FROM accounting_party_entries WHERE party_name = 'Spbu Beji'`).get().n;
    assert.equal(Number(named), 0, 'pembalik mewarisi atas nama');

    const again = await cancelSplit(env.DB, store, split.scheduleId);
    assert.deepEqual([again.reversed, again.remaining], [0, 0], 'diulang tidak membuat pembalik dobel');
    assert.equal((await postSplitNow(env.DB, store, split.scheduleId)).code, 'SPLIT_CANCELLED');

    const [listed] = (await (await call(env, '/api/admin/accounting/journal-splits')).json()).splits;
    assert.equal(listed.cancelReason, 'salah nominal');
    assert.deepEqual([listed.postedCount, listed.reversedCount, listed.plannedCount], [7, 7, 0]);
    assert.equal(listed.creditPartyName, 'Spbu Beji');
  } finally { db.close(); }
});

test('Hapus split sebelum semua hari tiba: yang belum diposting dilewati, tidak akan diposting lagi', async () => {
  const { db, env, acc, store } = await setup();
  try {
    const split = await createDirectSplit(env.DB, store, {
      name: 'Iklan', debitAccountId: acc('6106'), creditAccountId: acc('1401'), totalAmount: 50_000, startDate: '2026-10-13', endDate: '2026-10-17'
    }, { today: '2026-10-14' });
    const result = await cancelSplit(env.DB, store, split.scheduleId, { actor: { role: 'OWNER', id: 'owner_sp' } });
    assert.deepEqual([result.reversed, result.remaining], [2, 0]);
    const statuses = db.prepare(`SELECT status, COUNT(*) n FROM accounting_journal_schedule_occurrences WHERE schedule_id = ? GROUP BY status ORDER BY status`).all(split.scheduleId).map(row => [row.status, row.n]);
    assert.deepEqual(statuses, [['POSTED', 2], ['SKIPPED', 3]]);
    const creator = db.prepare(`SELECT created_by_role, created_by_note FROM accounting_journal_headers WHERE source_system = 'ACCOUNTING_SCHEDULE_VOID' LIMIT 1`).get();
    assert.deepEqual({ ...creator }, { created_by_role: 'OWNER', created_by_note: 'Hapus Jurnal Split' });
  } finally { db.close(); }
});

test('split lama (dari jurnal sumber, dibuat sebelum fitur hapus) tetap bisa dihapus', async () => {
  const { db, env, acc, store } = await setup();
  try {
    const source = await postAccountingJournal(env.DB, store, {
      businessDate: '2026-10-01', sourceSystem: 'MANUAL', sourceReferenceId: 'm1', idempotencyKey: 'MANUAL:m1', description: 'Deposit lapak',
      journalLines: [{ accountId: acc('1401'), side: 'DEBIT', amountScaled: 300_000_000_000 }, { accountId: acc('1101'), side: 'CREDIT', amountScaled: 300_000_000_000 }]
    });
    const plan = await createSplitPlan(env.DB, store, { sourceJournalId: source.journal.journalId, startDate: '2026-10-01', endDate: '2026-10-03', expenseAccountId: acc('6106') });
    assert.equal(plan.ok, true, JSON.stringify(plan));
    await postSplitNow(env.DB, store, plan.scheduleId);
    const result = await cancelSplit(env.DB, store, plan.scheduleId);
    assert.deepEqual([result.reversed, result.remaining], [3, 0]);
    assert.ok(Object.values(netPerDate(db, acc('6106'))).every(value => value === 0));
    assert.equal(netPerDate(db, acc('1401'))['2026-10-01'], 300_000, 'jurnal sumber tidak disentuh');
    assert.equal((await listSplitSchedules(env.DB, store.id))[0].reversedCount, 3);
  } finally { db.close(); }
});

test('UI: daftar Jurnal Split punya Posting sekarang dan Hapus split', () => {
  const ui = readFileSync(new URL('../public/admin-accounting-workspace.js', import.meta.url), 'utf8');
  assert.match(ui, /journal-splits\/\$\{encodeURIComponent\(split\.scheduleId\)\}\/post-now/);
  assert.match(ui, /journal-splits\/\$\{encodeURIComponent\(split\.scheduleId\)\}\/cancel/);
  assert.match(ui, /Hapus split/);
});
