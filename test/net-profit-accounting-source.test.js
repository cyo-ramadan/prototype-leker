import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { getNetProfitReport } from '../src/net-profit-report.js';
import { postAccountingJournal } from '../src/accounting-ledger.js';
import { countPendingAdminFacts, dispatchAdminAccountingFact } from '../src/accounting-admin-bridge.js';
import { hashCredential } from '../src/owner-auth.js';

// ADR-051, Bos Cyo 2026-10-02: "akuntansinya dikonekin ... yang bener harusnya
// dikurangin dari beban2 akuntansi ... perhitungan rugi laba dsb mulai dari
// akuntansi." Gerai ACCOUNTING membaca Untung Rugi dari jurnal; gerai
// LITE/FLEXIBLE tetap dari fakta POS.

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
    try { const out = statements.map(statement => statement.run()); this.db.exec('COMMIT'); return out; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  return db;
}

const storeOf = (db, code) => db.prepare('SELECT id FROM stores WHERE code = ?').get(code).id;
const accountId = (db, storeId, code) => db.prepare('SELECT id FROM chart_of_accounts WHERE store_id = ? AND code = ?').get(storeId, code).id;

async function journal(d1, db, storeId, businessDate, key, lines) {
  const result = await postAccountingJournal(d1, { id: storeId }, {
    businessDate, occurredAt: `${businessDate}T05:00:00.000Z`, sourceSystem: 'TEST', sourceReferenceId: key,
    correlationId: key, idempotencyKey: `TEST:${key}`, description: key,
    journalLines: lines.map(([code, side, rupiah]) => ({ accountId: accountId(db, storeId, code), side, amountScaled: rupiah * SCALE, description: key }))
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

async function ownerToken(db) {
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_acc', 'owner_acc', 'x', 'Owner Uji')`).run();
  const token = 'owner-acc-token';
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_acc', '2026-09-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential(token));
  return token;
}

test('gerai ACCOUNTING: beban yang hanya dibuat di Akuntansi (jurnal manual) ikut mengurangi Untung Bersih, dirinci per nama akun', async () => {
  const db = migratedDatabase();
  try {
    const d1 = new D1Database(db);
    const kantor = storeOf(db, 'KANTOR');
    await journal(d1, db, kantor, '2026-09-10', 'jual', [['1101', 'DEBIT', 100000], ['4101', 'CREDIT', 100000]]);
    await journal(d1, db, kantor, '2026-09-10', 'hpp', [['5101', 'DEBIT', 30000], ['1301', 'CREDIT', 30000]]);
    await journal(d1, db, kantor, '2026-09-10', 'beban-manual', [['6104', 'DEBIT', 50000], ['1101', 'CREDIT', 50000]]);

    const report = await getNetProfitReport(d1, { storeIds: [kantor], from: '2026-09-10', to: '2026-09-10', today: '2026-10-01' });
    const day = report.breakdownByKey.get(`${kantor}::2026-09-10`);
    assert.equal(report.sourceByStore[kantor], 'ACCOUNTING');
    assert.equal(day.revenue, 100000);
    assert.equal(day.hpp, 30000);
    assert.equal(day.totalBeban, 50000);
    assert.equal(day.netProfit, 20000);
    assert.deepEqual(day.bebanAccounts.map(account => [account.code, account.amount]), [['6104', 50000]]);
    assert.equal(report.netProfitByKey.get(`${kantor}::2026-09-10`), 20000);
  } finally { db.close(); }
});

test('jurnal pembalik membuat transaksi yang dibatalkan netral di laporan; hari tanpa jurnal bernilai nol', async () => {
  const db = migratedDatabase();
  try {
    const d1 = new D1Database(db);
    const kantor = storeOf(db, 'KANTOR');
    await journal(d1, db, kantor, '2026-09-10', 'jual', [['1101', 'DEBIT', 80000], ['4101', 'CREDIT', 80000]]);
    await journal(d1, db, kantor, '2026-09-10', 'jual-balik', [['4101', 'DEBIT', 80000], ['1101', 'CREDIT', 80000]]);
    const report = await getNetProfitReport(d1, { storeIds: [kantor], from: '2026-09-10', to: '2026-09-11', today: '2026-10-01' });
    assert.equal(report.netProfitByKey.get(`${kantor}::2026-09-10`), 0);
    assert.equal(report.netProfitByKey.get(`${kantor}::2026-09-11`), 0);
  } finally { db.close(); }
});

test('gerai LITE/FLEXIBLE tetap dihitung dari fakta POS, bukan jurnal (POS berdiri sendiri)', async () => {
  const db = migratedDatabase();
  try {
    const d1 = new D1Database(db);
    const kantor = storeOf(db, 'KANTOR');
    await journal(d1, db, kantor, '2026-09-10', 'jual', [['1101', 'DEBIT', 100000], ['4101', 'CREDIT', 100000]]);
    db.prepare("UPDATE stores SET edition = 'FLEXIBLE' WHERE id = ?").run(kantor);
    const report = await getNetProfitReport(d1, { storeIds: [kantor], from: '2026-09-10', to: '2026-09-10', today: '2026-10-01' });
    assert.equal(report.sourceByStore[kantor], 'POS');
    assert.equal(report.netProfitByKey.get(`${kantor}::2026-09-10`), 0, 'jurnal tidak dibaca; tidak ada fakta kasir');
  } finally { db.close(); }
});

test('Bea admin yang tertinggal (belum punya jurnal) ikut masuk pembukuan lewat tombol sinkron, lalu mengurangi laporan; sinkron ulang tidak menggandakan', async () => {
  const db = migratedDatabase();
  try {
    const d1 = new D1Database(db);
    const kantor = storeOf(db, 'KANTOR');
    db.prepare(`INSERT INTO admin_operational_expenses (id, store_id, category, description, amount, business_date, created_by_role, created_by_id, settlement, counterparty_name)
      VALUES ('bea_tertinggal', ?, 'BEA_LAINNYA', 'bayar parkir', 2000, '2026-09-30', 'ENTITY_ADMIN', 'x', 'HUTANG', 'rekening bersama')`).run(kantor);
    assert.equal(await countPendingAdminFacts(d1, kantor), 1);

    const token = await ownerToken(db);
    const env = { DB: d1 };
    const sync = () => worker.fetch(new Request('https://example.test/api/admin/accounting/bridge/sync?store=KANTOR', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}'
    }), env);
    const first = await (await sync()).json();
    assert.equal(first.posted, 1);
    assert.equal(await countPendingAdminFacts(d1, kantor), 0);

    const report = await getNetProfitReport(d1, { storeIds: [kantor], from: '2026-09-30', to: '2026-09-30', today: '2026-10-01' });
    assert.equal(report.netProfitByKey.get(`${kantor}::2026-09-30`), -2000);
    assert.deepEqual(report.breakdownByKey.get(`${kantor}::2026-09-30`).bebanAccounts.map(account => account.amount), [2000]);

    const second = await (await sync()).json();
    assert.equal(second.attempted, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounting_journal_headers WHERE store_id = ? AND source_reference_id = 'BEA:bea_tertinggal'").get(kantor).n, 1);
    assert.equal((await dispatchAdminAccountingFact(d1, 'BEA', 'bea_tertinggal')).duplicate, true);
  } finally { db.close(); }
});

test('endpoint laporan: sumber, transaksi belum masuk pembukuan, dan beban per akun ikut terkirim; grafik Entity memakai batang satu arah', async () => {
  const db = migratedDatabase();
  try {
    const d1 = new D1Database(db);
    const kantor = storeOf(db, 'KANTOR');
    await journal(d1, db, kantor, '2026-09-10', 'beban-manual', [['6104', 'DEBIT', 7000], ['1101', 'CREDIT', 7000]]);
    // Satu penjualan kasir yang belum pernah masuk jurnal.
    db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at) VALUES ('c1', 'c1', 'x', 'K', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(kantor);
    db.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES ('d1', ?, 'c1', 0, 'OPEN', CURRENT_TIMESTAMP)`).run(kantor);
    db.prepare(`INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, total_amount, created_at) VALUES ('s1', ?, 'd1', 'c1', 9000, '2026-09-10T05:00:00.000Z')`).run(kantor);

    const token = await ownerToken(db);
    const res = await worker.fetch(new Request('https://example.test/api/admin/reports/net-profit?store=KANTOR&from=2026-09-10&to=2026-09-10&stores=KANTOR', { headers: { authorization: `Bearer ${token}` } }), { DB: d1 });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.source, 'ACCOUNTING');
    assert.equal(body.breakdownTotals.totalBeban, 7000);
    assert.equal(body.breakdownTotals.bebanAccounts[0].name, 'Beban Lainnya');
    assert.equal(body.storeTotals[0].source, 'ACCOUNTING');
    assert.equal(body.unposted.KANTOR.count >= 1, true);
  } finally { db.close(); }
});

test('grafik Entity: semua batang tumbuh ke kanan dari satu garis dasar; untung/rugi hanya dibedakan warna', () => {
  const js = readFileSync(new URL('../public/entity-admin.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/entity-report-chart.css', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /const zero = /);
  assert.doesNotMatch(js, /left:\$\{left\}%/);
  assert.match(css, /\.ent-viz-bar \{[^}]*left: 0/);
  assert.match(css, /\.ent-viz-bar\.neg \{ border-radius: 0 4px 4px 0/);
});
