import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import { syncPeopleFacts } from '../src/accounting-auto-sync.js';
import { createDirectSplit, processDueSchedules } from '../src/accounting-journal-schedules.js';
import { resolveStore } from '../src/stores.js';

// Bos Cyo, 2026-10-13: riwayat panel Entity, Portal Staf dan Akuntansi tidak sinkron karena aturan
// pencatatan dulu belum ketat. Keputusan: buku Akuntansi = acuan dan tidak disentuh; tombol
// "Sinkronisasi Akuntansi" menambah satu baris di riwayat Portal/Entity sebesar selisihnya, baris itu
// TIDAK masuk Akuntansi; pratinjau dengan centang, sekali simpan, aman diklik berkali-kali.

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

// Jurnal langsung di buku (data lama): mirror = jurnal otomatis fakta setoran, MANUAL = jurnal akuntan.
// named=false -> baris jurnal tanpa label atas nama (data sebelum nama diwajibkan).
function seedJournal(db, { id, sourceSystem, accountCode, side, rupiah, businessDate = '2026-09-20', named = true }) {
  const accountId = db.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = 'store_pendem' AND code = ?`).get(accountCode)?.id || `acc_${accountCode}`;
  db.exec('PRAGMA foreign_keys = OFF;');
  db.prepare(`
    INSERT INTO accounting_journal_headers (id, store_id, journal_number, business_date, occurred_at, source_system, source_reference_id, correlation_id, idempotency_key, description, journal_status, posted_at, entity_id)
    VALUES (?, 'store_pendem', ?, ?, ?, ?, ?, ?, ?, 'Data lama', 'POSTED', ?, 'ENT-KPM')
  `).run(id, `JL-${id}`, businessDate, `${businessDate}T03:00:00.000Z`, sourceSystem, id, id, `test:${id}`, `${businessDate}T03:00:00.000Z`);
  db.prepare(`
    INSERT INTO accounting_journal_lines (id, store_id, journal_id, line_number, account_id, side, amount_scaled, description)
    VALUES (?, 'store_pendem', ?, 1, ?, ?, ?, 'Data lama')
  `).run(`line_${id}`, id, accountId, side, rupiah * 1_000_000);
  if (!named) { db.exec('PRAGMA foreign_keys = ON;'); return; }
  db.prepare(`
    INSERT INTO accounting_party_entries (id, store_id, entity_id, journal_id, journal_line_id, account_id, account_code, party_type, employee_id, party_name, side, amount_scaled, business_date, description)
    VALUES (?, 'store_pendem', 'ENT-KPM', ?, ?, ?, ?, 'EMPLOYEE', 'emp_sari', 'Sari', ?, ?, ?, 'Data lama')
  `).run(`pe_${id}`, id, `line_${id}`, accountId, accountCode, side, rupiah * 1_000_000, businessDate);
  db.exec('PRAGMA foreign_keys = ON;');
}

async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  db.prepare(`INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active) VALUES ('ea_kpm', 'ENT-KPM', 'ea.kpm', 'x', 'EA KPM', 1)`).run();
  db.prepare(`INSERT INTO entity_admin_sessions (token_hash, entity_admin_id, created_at, expires_at) VALUES (?, 'ea_kpm', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('ea-kpm'));
  db.prepare(`INSERT INTO employees (id, entity_id, home_store_id, full_name, status) VALUES ('emp_sari', 'ENT-KPM', 'store_pendem', 'Sari', 'ACTIVE')`).run();
  db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at) VALUES ('kasir_sari', 'sari.pendem', 'x', 'Sari', 'store_pendem', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run();
  db.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, 'kasir_sari', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('kasir-sari'));
  db.prepare(`INSERT INTO employee_account_links (id, employee_id, entity_id, account_type, account_id, store_id, effective_from) VALUES ('link_sari', 'emp_sari', 'ENT-KPM', 'CASHIER', 'kasir_sari', 'store_pendem', '2026-09-01T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES ('drawer_sari', 'store_pendem', 'kasir_sari', 0, 'CLOSED', '2026-10-04T01:00:00.000Z')`).run();
  // Setoran laci biasa: fakta + jurnal otomatisnya (disambungkan syncPeopleFacts) -> tidak selisih.
  db.prepare(`
    INSERT INTO operational_receivables_payables (id, store_id, entity_id, source_type, balance_type, source_id, counterparty_id, counterparty_name_snapshot, counterparty_type, description, original_amount, transaction_date, created_at)
    VALUES ('orp_sari', 'store_pendem', 'ENT-KPM', 'EMPLOYEE_DEPOSIT', 'RECEIVABLE', 'drawer_sari', 'emp_sari', 'Sari', 'EMPLOYEE', 'Setoran laci', 100000000000, '2026-10-04', '2026-10-04T10:00:00.000Z')
  `).run();
  // Data lama: jurnal setoran otomatis 25.000 di buku tanpa fakta di Portal -> selisih +25.000.
  seedJournal(db, { id: 'jl_lama', sourceSystem: 'EMPLOYEE_DEPOSIT', accountCode: '1202', side: 'DEBIT', rupiah: 25000 });
  // Jurnal akuntan 10.000: tampil di Portal sebagai penyesuaian DAN ada di buku -> bukan selisih.
  seedJournal(db, { id: 'jl_manual', sourceSystem: 'MANUAL', accountCode: '1202', side: 'DEBIT', rupiah: 10000 });
  // Gaji presensi 3 jam x 10.000 yang tampil di riwayat tapi tidak pernah masuk buku -> selisih -30.000.
  db.prepare(`INSERT INTO account_job_details (account_type, account_id, hourly_wage_scaled, job_type, payment_type, updated_at) VALUES ('CASHIER', 'kasir_sari', 10000000000, '', 'JAM', CURRENT_TIMESTAMP)`).run();
  db.prepare(`
    INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status, check_out_at)
    VALUES ('att_lama', 'kasir_sari', 'store_pendem', 'in', x'00', 'image/jpeg', '2026-10-07T01:00:00.000Z', 'CLOSED', '2026-10-07T04:00:00.000Z')
  `).run();
  return { db, env: { DB: new D1Database(db) } };
}

const call = (env, method, path, body, token = 'ea-kpm') => worker.fetch(new Request(`https://example.test${path}`, {
  method,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined
}), env);
const getJson = async (env, path, token) => (await call(env, 'GET', path, null, token)).json();
const preview = env => getJson(env, '/api/entity-admin/employees/emp_sari/sync-preview');
const ledger = (env, kind) => getJson(env, `/api/entity-admin/employees/emp_sari/ledger?kind=${kind}`);
const bookCounts = db => db.prepare(`SELECT (SELECT COUNT(*) FROM accounting_journal_headers) AS journals, (SELECT COUNT(*) FROM accounting_party_entries) AS parties`).get();
const postedSum = data => data.entries.filter(entry => entry.status === 'POSTED').reduce((sum, entry) => sum + entry.amountRupiah, 0);

test('Sinkronisasi Akuntansi: pratinjau selisih -> simpan -> riwayat = buku, buku tidak berubah', async () => {
  const { db, env } = await setup();
  try {
    const before = await preview(env);
    const items = before.items.map(item => [item.kind, item.storeCode, item.selisihRupiah]).sort();
    assert.deepEqual(items, [['gaji', 'PENDEM', -30000], ['setoran', 'PENDEM', 25000]], 'jurnal manual bukan selisih');
    const setoran = before.items.find(item => item.kind === 'setoran');
    assert.equal(setoran.bookRupiah, 135000, '100.000 laci + 25.000 lama + 10.000 jurnal akuntan');
    assert.equal(setoran.displayedRupiah, 110000);
    assert.notEqual(postedSum(await ledger(env, 'setoran')), (await ledger(env, 'setoran')).balanceRupiah, 'sebelum sinkron riwayat != saldo buku');

    await syncPeopleFacts(env.DB, ['store_pendem']);
    const book = bookCounts(db);
    const saved = await (await call(env, 'POST', '/api/entity-admin/employees/emp_sari/sync', {
      items: before.items.map(item => ({ kind: item.kind, storeId: item.storeId, selisihRupiah: item.selisihRupiah }))
    })).json();
    assert.deepEqual(saved.results.map(result => result.status), ['TERSINKRON', 'TERSINKRON']);

    // Buku Akuntansi tidak disentuh, juga setelah penyambung otomatis jalan lagi.
    await syncPeopleFacts(env.DB, ['store_pendem']);
    assert.deepEqual(bookCounts(db), book);

    for (const kind of ['setoran', 'gaji']) {
      const data = await ledger(env, kind);
      assert.equal(postedSum(data), data.balanceRupiah, `${kind}: jumlah riwayat = saldo buku`);
      assert.equal(data.belumMasukBukuRupiah, 0, `${kind}: tidak ada lagi "belum masuk pembukuan"`);
      assert.equal(data.entries.filter(entry => entry.kind === 'SINKRONISASI').length, 1);
    }
    assert.deepEqual((await preview(env)).items, [], 'setelah sinkron tidak ada selisih');

    // Klik ulang dengan pratinjau lama: tidak dobel.
    const again = await (await call(env, 'POST', '/api/entity-admin/employees/emp_sari/sync', {
      items: before.items.map(item => ({ kind: item.kind, storeId: item.storeId, selisihRupiah: item.selisihRupiah }))
    })).json();
    assert.deepEqual(again.results.map(result => result.status), ['SUDAH_SAMA', 'SUDAH_SAMA']);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM people_balance_syncs').get().n, 2);

    // Portal Staf melihat baris yang sama.
    const deposits = await getJson(env, '/api/cashier/employee-deposits', 'kasir-sari');
    assert.deepEqual(deposits.syncEntries.map(entry => entry.amountRupiah), [25000]);
    assert.equal(deposits.saldoBukuRupiah, 135000);
    assert.equal(deposits.belumMasukBukuRupiah, 0);
    const portal = await getJson(env, '/api/staff/portal', 'kasir-sari');
    assert.deepEqual(portal.payrollSyncEntries.map(entry => entry.amountRupiah), [-30000]);
  } finally { db.close(); }
});

test('Sinkronisasi Akuntansi: angka basi ditolak, bisa dibatalkan, butuh Entity Admin', async () => {
  const { db, env } = await setup();
  try {
    const { items } = await preview(env);
    const setoran = items.find(item => item.kind === 'setoran');
    const stale = await (await call(env, 'POST', '/api/entity-admin/employees/emp_sari/sync', {
      items: [{ kind: 'setoran', storeId: setoran.storeId, selisihRupiah: 99999 }]
    })).json();
    assert.equal(stale.results[0].status, 'BERUBAH');
    assert.equal(stale.results[0].selisihRupiah, 25000);

    const saved = await (await call(env, 'POST', '/api/entity-admin/employees/emp_sari/sync', {
      items: [{ kind: 'setoran', storeId: setoran.storeId, selisihRupiah: setoran.selisihRupiah }]
    })).json();
    const syncId = saved.results[0].syncId;
    assert.equal((await preview(env)).items.filter(item => item.kind === 'setoran').length, 0);
    assert.equal((await call(env, 'POST', `/api/entity-admin/balance-syncs/${syncId}/void`, { reason: '' })).status, 400, 'alasan wajib');
    assert.equal((await call(env, 'POST', `/api/entity-admin/balance-syncs/${syncId}/void`, { reason: 'Salah sinkron' })).status, 200);
    assert.equal((await preview(env)).items.find(item => item.kind === 'setoran').selisihRupiah, 25000, 'batal -> selisih kembali');
    assert.ok(!(await ledger(env, 'setoran')).entries.some(entry => entry.kind === 'SINKRONISASI'));

    assert.equal((await call(env, 'GET', '/api/entity-admin/employees/emp_sari/sync-preview', null, 'salah')).status, 401);
    assert.equal((await call(env, 'GET', '/api/entity-admin/employees/emp_sari/sync-preview', null, 'kasir-sari')).status, 401, 'kasir tidak boleh');
  } finally { db.close(); }
});

test('Sinkronisasi Akuntansi: tombol, pratinjau bercentang, dan tidak ada jalur ke Akuntansi', () => {
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const html = read('public/entity-admin.html');
  assert.match(html, /id="entityEmployeeSyncBtn"/);
  assert.match(html, /<script src="\/entity-sinkron-akuntansi\.js\?v=[^"]+"><\/script>/);
  const ui = read('public/entity-sinkron-akuntansi.js');
  assert.match(ui, /data-sinkron-row/);
  assert.match(ui, /data-sinkron-all/);
  assert.match(ui, /Array\.from\(\{ length: 4 \}, worker\)/);
  assert.match(read('public/entity-admin.js'), /data-sync-void/);
  // Tabel sinkronisasi tidak boleh dibaca jembatan Akuntansi mana pun.
  for (const file of readdirSync(new URL('../src/', import.meta.url)).filter(name => name.endsWith('.js'))) {
    if (!/^accounting-/.test(file)) continue;
    assert.doesNotMatch(read(`src/${file}`), /people_balance_syncs/, `${file} tidak boleh menyentuh people_balance_syncs`);
  }
});

// Bos Cyo, 2026-10-13: "tetap kolom lama yang disusun jadi buku saja" -- Buku Pembantu Hutang Piutang di
// panel Akuntansi. Saldo buku besar = jumlah semua nama + belum bernama; angka per karyawan = acuan
// tombol Sinkronisasi; "Beri nama" hanya menambah label, jurnal tidak berubah.
const AGENT = 'agent-buku-pembantu-token-uji-0123456789';
const admin = (env, method, path, body) => worker.fetch(new Request(`https://example.test${path}${path.includes('?') ? '&' : '?'}store=PENDEM`, {
  method,
  headers: { Authorization: `Bearer ${AGENT}`, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined
}), { ...env, AGENT_ADMIN_TOKEN: AGENT });

test('Buku Pembantu: per nama dari label lama, sama dengan acuan Sinkronisasi, Beri nama tanpa mengubah jurnal', async () => {
  const { db, env } = await setup();
  try {
    seedJournal(db, { id: 'jl_tanpa_nama', sourceSystem: 'MANUAL', accountCode: '1202', side: 'DEBIT', rupiah: 5000, named: false });
    await syncPeopleFacts(env.DB, ['store_pendem']);
    const summary = await (await admin(env, 'GET', '/api/admin/accounting/buku-pembantu')).json();
    const piutang = summary.accounts.find(account => account.code === '1202');
    const sari = piutang.people.find(person => person.name === 'Sari');
    assert.equal(sari.balanceRupiah, 135000, '100.000 laci + 25.000 lama + 10.000 jurnal akuntan');
    assert.equal(piutang.unnamedRupiah, 5000);
    assert.equal(piutang.unnamedCount, 1);
    const namedTotal = piutang.people.reduce((sum, person) => sum + person.balanceRupiah, 0);
    assert.equal(piutang.glRupiah, namedTotal + piutang.unnamedRupiah, 'saldo buku besar = jumlah nama + belum bernama');
    assert.equal((await preview(env)).items.find(item => item.kind === 'setoran').bookRupiah, sari.balanceRupiah, 'angka buku pembantu = acuan Sinkronisasi');

    const mutasi = await (await admin(env, 'GET', `/api/admin/accounting/buku-pembantu/mutasi?account=1202&key=${encodeURIComponent(sari.key)}`)).json();
    assert.equal(mutasi.balanceRupiah, 135000);
    assert.equal(mutasi.lines[0].balanceRupiah, 135000, 'terbaru di atas, saldo berjalan');

    const journalsBefore = bookCounts(db).journals;
    const unnamed = await (await admin(env, 'GET', '/api/admin/accounting/buku-pembantu/mutasi?account=1202&key=__belum_bernama__')).json();
    assert.deepEqual(unnamed.lines.map(line => line.lineId), ['line_jl_tanpa_nama']);
    assert.equal((await admin(env, 'POST', '/api/admin/accounting/journal-lines/line_jl_tanpa_nama/party', { party: {} })).status, 400, 'nama wajib');
    assert.equal((await admin(env, 'POST', '/api/admin/accounting/journal-lines/line_jl_tanpa_nama/party', { party: { employeeId: 'emp_sari' } })).status, 200);
    assert.equal((await admin(env, 'POST', '/api/admin/accounting/journal-lines/line_jl_tanpa_nama/party', { party: { employeeId: 'emp_sari' } })).status, 409, 'sudah bernama');
    assert.equal(bookCounts(db).journals, journalsBefore, 'tidak ada jurnal baru');
    assert.deepEqual({ ...db.prepare(`SELECT side, amount_scaled FROM accounting_journal_lines WHERE id = 'line_jl_tanpa_nama'`).get() }, { side: 'DEBIT', amount_scaled: 5000000000 });

    const after = (await (await admin(env, 'GET', '/api/admin/accounting/buku-pembantu')).json()).accounts.find(account => account.code === '1202');
    assert.equal(after.unnamedCount, 0);
    assert.equal(after.people.find(person => person.name === 'Sari').balanceRupiah, 140000);
    assert.equal((await preview(env)).items.find(item => item.kind === 'setoran').bookRupiah, 140000, 'acuan Sinkronisasi ikut');
  } finally { db.close(); }
});

test('Buku Pembantu: menu di panel Akuntansi dan versi skrip dibump', () => {
  const ui = readFileSync(new URL('../public/admin-accounting-workspace.js', import.meta.url), 'utf8');
  assert.match(ui, /navButton\('buku-pembantu','Buku Pembantu'\)/);
  assert.match(ui, /\/api\/admin\/accounting\/buku-pembantu/);
  assert.match(ui, /\/api\/admin\/accounting\/journal-lines\/\$\{encodeURIComponent\(cell\.dataset\.bpLine\)\}\/party/);
  assert.match(readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8'), /admin-accounting-workspace\.js\?v=20261013-jurnal-split-v1/);
});

// Bos Cyo, 2026-10-13: "entry baru tapi di split langsung ... ini untuk semua akun" -- Jurnal Split baru
// tanpa jurnal sumber. Akun hutang/piutang per orang wajib atas nama dan tiap jurnal hariannya bernama
// (masuk saldo orang itu di Buku Pembantu, bukan "belum bernama").
const accountId = (db, code) => db.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = 'store_pendem' AND code = ?`).get(code).id;
const splitJournals = (db, scheduleId) => db.prepare(`
  SELECT h.business_date, l.side, l.amount_scaled FROM accounting_journal_headers h
  JOIN accounting_journal_lines l ON l.journal_id = h.id
  WHERE h.correlation_id = ? AND l.side = 'DEBIT' ORDER BY h.business_date
`).all(scheduleId);

test('Jurnal Split: sewa lapak 1,5 jt 23 Okt-20 Nov dibagi rata, hari yang tiba langsung diposting', async () => {
  const { db, env } = await setup();
  try {
    const store = await resolveStore(env.DB, 'PENDEM', { includeInactive: true });
    const result = await createDirectSplit(env.DB, store, {
      name: 'Sewa lapak Okt-Nov', debitAccountId: accountId(db, '6106'), creditAccountId: accountId(db, '1401'),
      totalAmount: 1500000, startDate: '2026-10-23', endDate: '2026-11-20'
    }, { today: '2026-10-25' });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.totalDays, 29);
    assert.equal(result.perDayAmountScaled, 51724 * 1_000_000);
    assert.equal(result.lastDayAmountScaled, 51728 * 1_000_000, 'sisa pembulatan ke hari terakhir');
    assert.deepEqual([result.postedNow, result.waiting], [3, 26]);
    assert.deepEqual(splitJournals(db, result.scheduleId).map(row => row.business_date), ['2026-10-23', '2026-10-24', '2026-10-25']);

    await processDueSchedules(env.DB, store, { today: '2026-12-01' });
    const all = splitJournals(db, result.scheduleId);
    assert.equal(all.length, 29);
    assert.equal(all.at(-1).business_date, '2026-11-20');
    assert.equal(all.reduce((sum, row) => sum + Number(row.amount_scaled), 0), 1500000 * 1_000_000, 'total tepat 1,5 jt');
  } finally { db.close(); }
});

test('Jurnal Split: akun piutang per orang wajib atas nama, tiap jurnal harian masuk saldo orangnya', async () => {
  const { db, env } = await setup();
  try {
    const store = await resolveStore(env.DB, 'PENDEM', { includeInactive: true });
    const input = { name: 'Kasbon Sari dicicil', debitAccountId: accountId(db, '1202'), creditAccountId: accountId(db, '1101'), totalAmount: 300000, startDate: '2026-10-01', endDate: '2026-10-03' };
    const tanpaNama = await createDirectSplit(env.DB, store, input, { today: '2026-10-13' });
    assert.equal(tanpaNama.ok, false);
    assert.equal(tanpaNama.code, 'PARTY_REQUIRED');

    const before = (await (await admin(env, 'GET', '/api/admin/accounting/buku-pembantu')).json()).accounts.find(account => account.code === '1202');
    const result = await createDirectSplit(env.DB, store, { ...input, debitParty: { employeeId: 'emp_sari' } }, { today: '2026-10-13' });
    assert.equal(result.postedNow, 3);
    const named = db.prepare(`SELECT COUNT(*) AS n FROM accounting_party_entries p JOIN accounting_journal_headers h ON h.id = p.journal_id WHERE h.correlation_id = ? AND p.employee_id = 'emp_sari'`).get(result.scheduleId).n;
    assert.equal(named, 3, 'tiap jurnal harian bernama Sari');
    const after = (await (await admin(env, 'GET', '/api/admin/accounting/buku-pembantu')).json()).accounts.find(account => account.code === '1202');
    const saldo = account => account.people.find(person => person.name === 'Sari')?.balanceRupiah || 0;
    assert.equal(saldo(after) - saldo(before), 300000);
    assert.equal(after.unnamedRupiah, before.unnamedRupiah, 'tidak menambah belum bernama');

    assert.equal((await admin(env, 'POST', '/api/admin/accounting/journal-splits', { ...input, name: 'Akun sama', creditAccountId: input.debitAccountId, debitParty: { employeeId: 'emp_sari' } })).status, 400);
  } finally { db.close(); }
});

test('Jurnal Split: menu di panel Akuntansi', () => {
  const ui = readFileSync(new URL('../public/admin-accounting-workspace.js', import.meta.url), 'utf8');
  assert.match(ui, /navButton\('journal-split','Jurnal Split'\)/);
  assert.match(ui, /\/api\/admin\/accounting\/journal-splits/);
  assert.match(ui, /data-split-party/);
});
