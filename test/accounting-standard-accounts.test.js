import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { createAccountingAccount, postAccountingJournal } from '../src/accounting-ledger.js';
import { standardizeStoreAccounts } from '../src/accounting-standardize.js';
import { hashCredential } from '../src/owner-auth.js';

// ADR-047, Bos Cyo 2026-09-27: semua gerai kecuali DERMO memakai akun standar
// yang sama. 0124 hanya mengubah konfigurasi; saldo akun buatan gerai dipindah
// oleh tombol "Samakan ke Akun Standar" lewat jurnal resmi.

const migrationDir = new URL('../migrations/', import.meta.url);
const SCALE = 1_000_000;

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
    try {
      const out = statements.map(statement => statement.run());
      this.db.exec('COMMIT');
      return out;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function migrationFiles() {
  return readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
}

const PENDEM = { id: 'store_pendem', code: 'PENDEM' };
const DERMO = { id: 'store_dermo', code: 'DERMO' };

function accountId(db, storeId, code) {
  return db.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = ? AND code = ?`).get(storeId, code)?.id;
}

function addCustom(db, storeId, id, code, name, type) {
  db.prepare(`INSERT INTO chart_of_accounts (id, store_id, code, name, type) VALUES (?, ?, ?, ?, ?)`).run(id, storeId, code, name, type);
}

async function journal(env, store, key, debitId, creditId, rupiah) {
  const result = await postAccountingJournal(env.DB, store, {
    businessDate: '2026-09-20',
    sourceSystem: 'MANUAL',
    sourceReferenceId: key,
    idempotencyKey: `MANUAL:${store.id}:${key}`,
    description: key,
    journalLines: [
      { accountId: debitId, side: 'DEBIT', amountScaled: rupiah * SCALE },
      { accountId: creditId, side: 'CREDIT', amountScaled: rupiah * SCALE }
    ]
  });
  assert.equal(result.ok, true, JSON.stringify(result));
}

// Keadaan produksi sebelum 0124 (disederhanakan dari data 2026-09-27).
async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const env = { DB: new D1Database(db) };
  const files = migrationFiles();
  const cut = files.findIndex(file => file.startsWith('0124_'));
  for (const file of files.slice(0, cut)) db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));

  const kas = accountId(db, PENDEM.id, '1101');
  addCustom(db, PENDEM.id, 'acc_pcm', 'ACC-000005', 'Piutang Poci Malang', 'ASSET');
  addCustom(db, PENDEM.id, 'acc_gaji', 'ACC-000006', 'Hutang Gaji Elma', 'LIABILITY');
  addCustom(db, PENDEM.id, 'acc_hsl', 'ACC-000001', 'Hutang Sewa Lapak', 'LIABILITY');
  addCustom(db, PENDEM.id, 'acc_hhl', 'ACC-000007', 'Hutang Hari Leker', 'LIABILITY');
  addCustom(db, PENDEM.id, 'acc_aneh', 'ACC-000008', 'Akun Aneh', 'EXPENSE');
  db.prepare(`INSERT INTO payment_methods (id, store_id, code, name, account_id) VALUES ('pm_restock', ?, 'PEMBAYARAN_RESTOCK', 'Pembayaran Restock', 'acc_pcm')`).run(PENDEM.id);
  db.prepare(`UPDATE journal_rules SET fixed_account_id = 'acc_hsl' WHERE id = 'jrule_store_pendem_admin_bea_lapak_cr'`).run();

  await journal(env, PENDEM, 'restock-via-pusat', kas, 'acc_pcm', 100000);
  await journal(env, PENDEM, 'gaji-harian-elma', accountId(db, PENDEM.id, '6102'), 'acc_gaji', 50000);
  await journal(env, PENDEM, 'sewa-bayar', 'acc_hsl', kas, 20000);
  await journal(env, PENDEM, 'sewa-hutang', kas, 'acc_hsl', 20000);
  await journal(env, PENDEM, 'akun-aneh', 'acc_aneh', kas, 5000);

  addCustom(db, DERMO.id, 'acc_dermo_hhl', 'ACC-000006', 'Hutang Hari Leker', 'LIABILITY');
  db.prepare(`INSERT INTO payment_methods (id, store_id, code, name, account_id) VALUES ('pm_dermo_harian', ?, 'PEMBAYARAN_LEKER_HARIAN', 'Pembayaran Leker Harian', 'acc_dermo_hhl')`).run(DERMO.id);

  for (const file of files.slice(cut)) db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  return { db, env };
}

async function adminToken(db) {
  const token = 'std-admin';
  db.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, 'admin_pendem_pilot', '2026-06-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token));
  return token;
}

async function api(env, token, pathname, body, method = 'POST') {
  const url = new URL(`https://example.test${pathname}`);
  url.searchParams.set('store', 'PENDEM');
  const response = await worker.fetch(new Request(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  }), env);
  return { status: response.status, payload: await response.json() };
}

function balance(db, id) {
  return Number(db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN side = 'DEBIT' THEN amount_scaled ELSE -amount_scaled END), 0) AS net
    FROM accounting_journal_lines WHERE account_id = ?
  `).get(id).net) / SCALE;
}

function account(db, id) {
  return db.prepare(`SELECT code, is_active FROM chart_of_accounts WHERE id = ?`).get(id) ?? null;
}

test('0124: akun buatan gerai tanpa jurnal dihapus, saldo nol ditutup, rujukan pindah ke akun standar; DERMO tidak disentuh', async () => {
  const { db } = await setup();
  try {
    assert.equal(account(db, 'acc_hhl'), null, 'tidak pernah dipakai -> dihapus');
    assert.equal(account(db, 'acc_hsl').is_active, 0, 'saldo nol dengan riwayat -> ditutup');
    assert.equal(account(db, 'acc_pcm').is_active, 1, 'masih bersaldo -> menunggu tombol');
    assert.equal(account(db, 'acc_gaji').is_active, 1);
    assert.equal(db.prepare(`SELECT a.code FROM payment_methods p JOIN chart_of_accounts a ON a.id = p.account_id WHERE p.id = 'pm_restock'`).get().code, '1103');
    assert.equal(db.prepare(`SELECT a.code FROM journal_rules r JOIN chart_of_accounts a ON a.id = r.fixed_account_id WHERE r.id = 'jrule_store_pendem_admin_bea_lapak_cr'`).get().code, '2101');
    assert.ok(accountId(db, PENDEM.id, '1401') && accountId(db, PENDEM.id, '6106'), 'akun standar yang kurang dibuat');

    assert.equal(account(db, 'acc_dermo_hhl').is_active, 1);
    assert.equal(db.prepare(`SELECT account_id FROM payment_methods WHERE id = 'pm_dermo_harian'`).get().account_id, 'acc_dermo_hhl');
    assert.equal(db.prepare(`SELECT custom_accounts_allowed FROM stores WHERE id = ?`).get(DERMO.id).custom_accounts_allowed, 1);
  } finally { db.close(); }
});

test('Gerai standar tidak bisa tambah/ubah akun sendiri; DERMO dan gerai yang diizinkan tetap bisa', async () => {
  const { db, env } = await setup();
  try {
    const token = await adminToken(db);
    const create = await api(env, token, '/api/admin/accounting/accounts', { accountName: 'Hutang Gaji Rani', accountType: 'LIABILITY' });
    assert.equal(create.status, 409);
    assert.equal(create.payload.code, 'STANDARD_ACCOUNTS_LOCKED');
    const rename = await api(env, token, `/api/admin/accounting/accounts/${accountId(db, PENDEM.id, '6106')}`, { accountName: 'Sewa Lapak Pendem' }, 'PATCH');
    assert.equal(rename.status, 409);
    assert.equal(rename.payload.code, 'STANDARD_ACCOUNTS_LOCKED');
    assert.throws(() => addCustom(db, PENDEM.id, 'acc_raw', 'ACC-000099', 'Lewat Belakang', 'ASSET'), /CUSTOM_ACCOUNTS_LOCKED/);

    const dermo = await createAccountingAccount(env.DB, DERMO, { accountName: 'Modal Owner Kedua', accountType: 'EQUITY' });
    assert.equal(dermo.ok, true);

    db.prepare(`INSERT INTO stores (id, code, store_name, entity_id) SELECT 'store_std_new', 'STDNEW', 'Gerai Baru', entity_id FROM stores WHERE id = ?`).run(PENDEM.id);
    assert.equal(db.prepare(`SELECT custom_accounts_allowed FROM stores WHERE id = 'store_std_new'`).get().custom_accounts_allowed, 0, 'gerai baru langsung standar');
  } finally { db.close(); }
});

test('Tombol "Samakan ke Akun Standar": saldo pindah lewat satu jurnal balance, akun lama ditutup, klik ulang tidak dobel', async () => {
  const { db, env } = await setup();
  try {
    const token = await adminToken(db);
    const before = await api(env, token, '/api/admin/accounting', null, 'GET');
    assert.equal(before.status, 200);
    assert.equal(before.payload.customAccountsAllowed, false);
    const pending = Object.fromEntries(before.payload.standardization.pending.map(row => [row.accountName, row.target?.accountCode ?? null]));
    assert.deepEqual(pending, { 'Piutang Poci Malang': '1103', 'Hutang Gaji Elma': '2102', 'Akun Aneh': null });

    const rekber = accountId(db, PENDEM.id, '1103');
    const utangGaji = accountId(db, PENDEM.id, '2102');
    const rekberBefore = balance(db, rekber);
    const gajiBefore = balance(db, utangGaji);

    const first = await api(env, token, '/api/admin/accounting/standardize-accounts', {});
    assert.equal(first.status, 200, JSON.stringify(first.payload));
    assert.ok(first.payload.journal?.journalNumber);
    assert.deepEqual(first.payload.closed.sort(), ['ACC-000005', 'ACC-000006']);
    assert.deepEqual(first.payload.unmapped.map(row => row.accountName), ['Akun Aneh']);

    assert.equal(balance(db, 'acc_pcm'), 0);
    assert.equal(balance(db, 'acc_gaji'), 0);
    assert.equal(balance(db, rekber) - rekberBefore, -100000, 'saldo kredit Piutang Poci Malang pindah utuh ke Rekening Bersama');
    assert.equal(balance(db, utangGaji) - gajiBefore, -50000, 'Hutang Gaji Elma pindah ke Utang Gaji');
    assert.equal(account(db, 'acc_pcm').is_active, 0);
    assert.equal(account(db, 'acc_gaji').is_active, 0);
    assert.equal(account(db, 'acc_aneh').is_active, 1, 'tanpa pasangan standar tidak disentuh');

    const lines = db.prepare(`
      SELECT side, SUM(amount_scaled) AS total FROM accounting_journal_lines l
      JOIN accounting_journal_headers h ON h.id = l.journal_id
      WHERE h.store_id = ? AND h.source_system = 'ACCOUNT_STANDARDIZE' GROUP BY side ORDER BY side
    `).all(PENDEM.id).map(row => Number(row.total));
    assert.deepEqual(lines, [150000 * SCALE, 150000 * SCALE], 'jurnal pemindahan balance exact');

    const again = await api(env, token, '/api/admin/accounting/standardize-accounts', {});
    assert.equal(again.status, 200);
    assert.equal(again.payload.journal, null);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM accounting_journal_headers WHERE store_id = ? AND source_system = 'ACCOUNT_STANDARDIZE'`).get(PENDEM.id).n, 1);

    const dermo = await standardizeStoreAccounts(env.DB, DERMO);
    assert.equal(dermo.ok, false);
    assert.equal(dermo.code, 'CUSTOM_ACCOUNTS_ALLOWED');
  } finally { db.close(); }
});
