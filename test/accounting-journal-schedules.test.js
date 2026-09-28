import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { getAccountingJournal, postAccountingJournal } from '../src/accounting-ledger.js';
import { createSplitPlan, processDueSchedules } from '../src/accounting-journal-schedules.js';
import { hashCredential } from '../src/owner-auth.js';
import { getJakartaBusinessDate } from '../src/time.js';

// ADR-049, Bos Cyo 2026-09-28: "Pembuat & Split Jurnal Beban" -- mengganti pekerjaan
// akuntan manusia. Test ini menguji satu mesin jadwal (accounting_journal_schedules
// + _occurrences) untuk dua fitur: Beban Rutin (auto atau menunggu konfirmasi) dan
// Split Beban (pembagian exact, pelacakan balik ke jurnal sumber).

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

function accountId(db, storeId, code) {
  return db.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = ? AND code = ?`).get(storeId, code)?.id;
}

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of migrationFiles()) db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  const env = { DB: new D1Database(db) };
  return { db, env };
}

async function adminToken(db) {
  const token = 'sched-admin';
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

// Jurnal sumber "Deposit Lapak Rp1.500.000": Dr Uang Muka / Cr Kas.
async function makeDepositJournal(env, rupiah, key = `deposit_${rupiah}`) {
  const db = env.DB.db;
  const uangMuka = accountId(db, PENDEM.id, '1401');
  const kas = accountId(db, PENDEM.id, '1101');
  const result = await postAccountingJournal(env.DB, PENDEM, {
    businessDate: '2025-01-01',
    sourceSystem: 'MANUAL',
    sourceReferenceId: key,
    idempotencyKey: `MANUAL:${PENDEM.id}:${key}`,
    description: 'Deposit Lapak',
    journalLines: [
      { accountId: uangMuka, side: 'DEBIT', amountScaled: rupiah * SCALE },
      { accountId: kas, side: 'CREDIT', amountScaled: rupiah * SCALE }
    ]
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.journal;
}

function journalSum(db, journalId) {
  const rows = db.prepare(`SELECT side, SUM(amount_scaled) AS total FROM accounting_journal_lines WHERE journal_id = ? GROUP BY side`).all(journalId);
  return Object.fromEntries(rows.map(row => [row.side, Number(row.total)]));
}

test('Split Beban: 1.500.000/30 hari pas, total occurrence PERSIS sama, jurnal sumber tidak berubah', async () => {
  const { db, env } = setup();
  try {
    const source = await makeDepositJournal(env, 1_500_000);
    const before = await getAccountingJournal(env.DB, PENDEM.id, source.journalId);

    const beban = accountId(db, PENDEM.id, '6106');
    const result = await createSplitPlan(env.DB, PENDEM, {
      sourceJournalId: source.journalId,
      expenseAccountId: beban,
      startDate: '2025-01-07',
      endDate: '2025-02-05' // 30 hari
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.totalDays, 30);
    assert.equal(result.perDayAmountScaled, 50_000 * SCALE);
    assert.equal(result.lastDayAmountScaled, 50_000 * SCALE);

    const occurrences = db.prepare(`SELECT amount_scaled FROM accounting_journal_schedule_occurrences WHERE schedule_id = ? ORDER BY occurrence_date`).all(result.scheduleId);
    assert.equal(occurrences.length, 30);
    const total = occurrences.reduce((sum, row) => sum + Number(row.amount_scaled), 0);
    assert.equal(total, 1_500_000 * SCALE, 'total occurrence harus PERSIS sama dengan jurnal sumber');

    const run = await processDueSchedules(env.DB, PENDEM, { today: '2025-02-10' });
    assert.equal(run.posted.length, 30);
    assert.equal(run.failed.length, 0);

    const postedJournals = db.prepare(`
      SELECT h.id, h.business_date, SUM(CASE WHEN l.side='DEBIT' THEN l.amount_scaled ELSE 0 END) AS debit
      FROM accounting_journal_headers h JOIN accounting_journal_lines l ON l.journal_id = h.id
      WHERE h.store_id = ? AND h.correlation_id = ? GROUP BY h.id
    `).all(PENDEM.id, result.scheduleId);
    assert.equal(postedJournals.length, 30);
    const debitSum = postedJournals.reduce((sum, row) => sum + Number(row.debit), 0);
    assert.equal(debitSum, 1_500_000 * SCALE, 'jumlah 30 jurnal harian harus PERSIS sama dengan nominal sumber');

    // Jurnal sumber tidak pernah diubah (invariant #2).
    const after = await getAccountingJournal(env.DB, PENDEM.id, source.journalId);
    assert.deepEqual(after, before, 'jurnal sumber wajib identik sebelum/sesudah split diposting');

    // Schedule otomatis nonaktif begitu semua occurrence selesai.
    const schedule = db.prepare(`SELECT is_active, occurrences_generated FROM accounting_journal_schedules WHERE id = ?`).get(result.scheduleId);
    assert.equal(schedule.is_active, 0);
    assert.equal(schedule.occurrences_generated, 30);
  } finally { db.close(); }
});

test('Split Beban: pembagian yang tidak habis dibagi -- sisa masuk ke hari terakhir, total tetap PERSIS', async () => {
  const { db, env } = setup();
  try {
    const source = await makeDepositJournal(env, 1_000_000, 'deposit_1jt');
    const beban = accountId(db, PENDEM.id, '6106');
    const result = await createSplitPlan(env.DB, PENDEM, {
      sourceJournalId: source.journalId,
      expenseAccountId: beban,
      startDate: '2025-03-01',
      endDate: '2025-03-30' // 30 hari
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.notEqual(result.perDayAmountScaled, result.lastDayAmountScaled, 'kasus ini sengaja tidak habis dibagi rata');

    const occurrences = db.prepare(`SELECT occurrence_date, amount_scaled FROM accounting_journal_schedule_occurrences WHERE schedule_id = ? ORDER BY occurrence_date`).all(result.scheduleId);
    const total = occurrences.reduce((sum, row) => sum + Number(row.amount_scaled), 0);
    assert.equal(total, 1_000_000 * SCALE, 'total tetap PERSIS sama walau tidak habis dibagi rata');
    assert.equal(occurrences.at(-1).amount_scaled, result.lastDayAmountScaled);
    for (const row of occurrences.slice(0, -1)) assert.equal(Number(row.amount_scaled), result.perDayAmountScaled);
  } finally { db.close(); }
});

test('Split Beban ditolak untuk jurnal yang bentuknya tidak sesuai (bukan 2 baris / tanpa sisi ASSET)', async () => {
  const { db, env } = setup();
  try {
    const beban = accountId(db, PENDEM.id, '6106');
    const kas = accountId(db, PENDEM.id, '1101');
    const utang = accountId(db, PENDEM.id, '2101');

    // Bukan deposit -- Dr Beban / Cr Kas, tidak ada sisi ASSET yang didebit.
    const notEligible = await postAccountingJournal(env.DB, PENDEM, {
      businessDate: '2025-01-01', sourceSystem: 'MANUAL', sourceReferenceId: 'beban_langsung',
      idempotencyKey: `MANUAL:${PENDEM.id}:beban_langsung`, description: 'Beban langsung',
      journalLines: [
        { accountId: beban, side: 'DEBIT', amountScaled: 100_000 * SCALE },
        { accountId: kas, side: 'CREDIT', amountScaled: 100_000 * SCALE }
      ]
    });
    const rejected = await createSplitPlan(env.DB, PENDEM, {
      sourceJournalId: notEligible.journal.journalId, expenseAccountId: beban, startDate: '2025-02-01', endDate: '2025-02-05'
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, 'SOURCE_JOURNAL_NOT_ELIGIBLE');

    // 3 baris -- ditolak walau salah satu sisinya ASSET.
    const uangMuka = accountId(db, PENDEM.id, '1401');
    const threeLine = await postAccountingJournal(env.DB, PENDEM, {
      businessDate: '2025-01-01', sourceSystem: 'MANUAL', sourceReferenceId: 'tiga_baris',
      idempotencyKey: `MANUAL:${PENDEM.id}:tiga_baris`, description: 'Tiga baris',
      journalLines: [
        { accountId: uangMuka, side: 'DEBIT', amountScaled: 60_000 * SCALE },
        { accountId: kas, side: 'CREDIT', amountScaled: 30_000 * SCALE },
        { accountId: utang, side: 'CREDIT', amountScaled: 30_000 * SCALE }
      ]
    });
    const rejectedThreeLine = await createSplitPlan(env.DB, PENDEM, {
      sourceJournalId: threeLine.journal.journalId, expenseAccountId: beban, startDate: '2025-02-01', endDate: '2025-02-05'
    });
    assert.equal(rejectedThreeLine.ok, false);
    assert.equal(rejectedThreeLine.code, 'SOURCE_JOURNAL_NOT_ELIGIBLE');
  } finally { db.close(); }
});

test('Split Beban tidak bisa dibuat dua kali dari jurnal sumber yang sama', async () => {
  const { db, env } = setup();
  try {
    const source = await makeDepositJournal(env, 300_000, 'deposit_dua_kali');
    const beban = accountId(db, PENDEM.id, '6106');
    const first = await createSplitPlan(env.DB, PENDEM, { sourceJournalId: source.journalId, expenseAccountId: beban, startDate: '2025-01-07', endDate: '2025-01-16' });
    assert.equal(first.ok, true);
    const second = await createSplitPlan(env.DB, PENDEM, { sourceJournalId: source.journalId, expenseAccountId: beban, startDate: '2025-01-07', endDate: '2025-01-16' });
    assert.equal(second.ok, false);
    assert.equal(second.code, 'SOURCE_JOURNAL_ALREADY_SPLIT');
  } finally { db.close(); }
});

test('GET jurnal: splitEligibility sebelum di-split, dan pelacakan balik sesudahnya', async () => {
  const { db, env } = setup();
  try {
    const token = await adminToken(db);
    const source = await makeDepositJournal(env, 200_000, 'deposit_lacak');
    const beban = accountId(db, PENDEM.id, '6106');

    const before = await api(env, token, `/api/admin/accounting/journals/${source.journalId}`, null, 'GET');
    assert.equal(before.status, 200);
    assert.equal(before.payload.split, null);
    assert.equal(before.payload.splitEligibility.eligible, true);

    const create = await api(env, token, `/api/admin/accounting/journals/${source.journalId}/split`, {
      expenseAccountId: beban, startDate: '2025-01-07', endDate: '2025-01-16'
    });
    assert.equal(create.status, 201, JSON.stringify(create.payload));

    const after = await api(env, token, `/api/admin/accounting/journals/${source.journalId}`, null, 'GET');
    assert.equal(after.status, 200);
    assert.equal(after.payload.split.occurrences.length, 10);
    assert.equal(after.payload.splitEligibility, null);
  } finally { db.close(); }
});

test('Beban Rutin auto_create=1: otomatis terposting saat bootstrap dibuka, idempotent dipanggil ulang', async () => {
  const { db, env } = setup();
  try {
    const token = await adminToken(db);
    const today = getJakartaBusinessDate();
    const beban = accountId(db, PENDEM.id, '6106');
    const utang = accountId(db, PENDEM.id, '2101');

    const create = await api(env, token, '/api/admin/accounting/expense-schedules', {
      name: 'Beban Lapak', amount: 500_000, debitAccountId: beban, creditAccountId: utang,
      startDate: today, recurrenceType: 'DAILY', autoCreate: true
    });
    assert.equal(create.status, 201, JSON.stringify(create.payload));
    const scheduleId = create.payload.scheduleId;

    const first = await api(env, token, '/api/admin/accounting', null, 'GET');
    assert.equal(first.status, 200);
    assert.equal(first.payload.scheduleRun.posted.length, 1);
    assert.equal(first.payload.pendingOccurrences.length, 0);

    const journals = db.prepare(`SELECT COUNT(*) AS n FROM accounting_journal_headers WHERE correlation_id = ?`).get(scheduleId);
    assert.equal(journals.n, 1);
    assert.equal(journalSum(db, db.prepare(`SELECT id FROM accounting_journal_headers WHERE correlation_id = ?`).get(scheduleId).id).DEBIT, 500_000 * SCALE);

    const second = await api(env, token, '/api/admin/accounting', null, 'GET');
    assert.equal(second.payload.scheduleRun.posted.length, 0, 'belum jatuh tempo lagi hari ini -- tidak boleh dobel posting');
    const journalsAfter = db.prepare(`SELECT COUNT(*) AS n FROM accounting_journal_headers WHERE correlation_id = ?`).get(scheduleId);
    assert.equal(journalsAfter.n, 1, 'idempotent: dipanggil dua kali tidak dobel');
  } finally { db.close(); }
});

test('Beban Rutin auto_create=0: menunggu konfirmasi, "Buat Sekarang" dan "Lewati" bekerja', async () => {
  const { db, env } = setup();
  try {
    const token = await adminToken(db);
    const today = getJakartaBusinessDate();
    const beban = accountId(db, PENDEM.id, '6106');
    const utang = accountId(db, PENDEM.id, '2101');

    const create = await api(env, token, '/api/admin/accounting/expense-schedules', {
      name: 'Beban WiFi', amount: 300_000, debitAccountId: beban, creditAccountId: utang,
      startDate: today, recurrenceType: 'DAILY', autoCreate: false
    });
    assert.equal(create.status, 201, JSON.stringify(create.payload));
    const scheduleId = create.payload.scheduleId;

    const bootstrap = await api(env, token, '/api/admin/accounting', null, 'GET');
    assert.equal(bootstrap.payload.scheduleRun.posted.length, 0, 'auto_create=0 tidak boleh langsung terposting');
    assert.equal(bootstrap.payload.pendingOccurrences.length, 1);
    assert.equal(bootstrap.payload.pendingOccurrences[0].scheduleName, 'Beban WiFi');
    const occurrenceId = bootstrap.payload.pendingOccurrences[0].occurrenceId;

    const noJournalYet = db.prepare(`SELECT COUNT(*) AS n FROM accounting_journal_headers WHERE correlation_id = ?`).get(scheduleId);
    assert.equal(noJournalYet.n, 0);

    const posted = await api(env, token, `/api/admin/accounting/expense-schedules/occurrences/${occurrenceId}/post`, {});
    assert.equal(posted.status, 200, JSON.stringify(posted.payload));
    const journalNow = db.prepare(`SELECT COUNT(*) AS n FROM accounting_journal_headers WHERE correlation_id = ?`).get(scheduleId);
    assert.equal(journalNow.n, 1);

    // Skenario Lewati: schedule kedua, occurrence-nya di-skip, tidak boleh ada jurnal.
    const create2 = await api(env, token, '/api/admin/accounting/expense-schedules', {
      name: 'Beban Listrik', amount: 400_000, debitAccountId: beban, creditAccountId: utang,
      startDate: today, recurrenceType: 'DAILY', autoCreate: false
    });
    const bootstrap2 = await api(env, token, '/api/admin/accounting', null, 'GET');
    const pendingListrik = bootstrap2.payload.pendingOccurrences.find(row => row.scheduleName === 'Beban Listrik');
    assert.ok(pendingListrik);
    const skipped = await api(env, token, `/api/admin/accounting/expense-schedules/occurrences/${pendingListrik.occurrenceId}/skip`, {});
    assert.equal(skipped.status, 200, JSON.stringify(skipped.payload));
    const bootstrap3 = await api(env, token, '/api/admin/accounting', null, 'GET');
    assert.ok(!bootstrap3.payload.pendingOccurrences.some(row => row.scheduleName === 'Beban Listrik'), 'sudah di-skip, tidak boleh muncul lagi');
    const journalListrik = db.prepare(`SELECT COUNT(*) AS n FROM accounting_journal_headers WHERE correlation_id = ?`).get(create2.payload.scheduleId);
    assert.equal(journalListrik.n, 0, 'di-skip tidak boleh membuat jurnal apa pun');
  } finally { db.close(); }
});
