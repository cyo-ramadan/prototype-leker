import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handlePermitReportApi } from '../src/permit-report.js';

// Bos Cyo, 2026-10-01: laporan permit lintas jenis (presensi, hapus penjualan,
// uang kas, arus barang, aset, tutup laci), bisa dipilih kategorinya dan
// difilter per karyawan pengaju.

const migrationDir = new URL('../migrations/', import.meta.url);
const AGENT_TOKEN = 'd'.repeat(40);

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
  batch(statements) { return statements.map(statement => statement.run()); }
}

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}

const now = new Date();
const iso = offsetDays => new Date(now.getTime() + offsetDays * 86_400_000).toISOString();
const sqlTime = offsetDays => iso(offsetDays).slice(0, 19).replace('T', ' ');

function seedCashier(db, storeId, username, name) {
  const id = `cashier_pr_${username}`;
  db.prepare(`
    INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at)
    VALUES (?, ?, 'x', ?, ?, 1, '2026-09-24T00:00:00.000Z', '2026-09-24T00:00:00.000Z')
  `).run(id, username, name, storeId);
  return id;
}

function seedDrawer(db, storeId, cashierId, id, status) {
  db.prepare(`
    INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at, closing_amount, closed_at)
    VALUES (?, ?, ?, 0, ?, '2026-09-30T00:00:00.000Z', ?, ?)
  `).run(id, storeId, cashierId, status, status === 'CLOSED' ? 0 : null, status === 'CLOSED' ? '2026-09-30T08:00:00.000Z' : null);
}

function seedAll() {
  const sqlite = migratedDatabase();
  const g001 = sqlite.prepare("SELECT id FROM stores WHERE code = 'G001'").get().id;
  const other = sqlite.prepare("SELECT id FROM stores WHERE code <> 'G001' LIMIT 1").get().id;
  const rina = seedCashier(sqlite, g001, 'rina', 'Rina');
  const bimo = seedCashier(sqlite, g001, 'bimo', 'Bimo');
  const asing = seedCashier(sqlite, other, 'asing', 'Orang Gerai Lain');
  for (const [id, store, owner, status] of [['drawer_pr_1', g001, rina, 'OPEN'], ['drawer_pr_2', g001, bimo, 'CLOSED'], ['drawer_pr_3', g001, rina, 'CLOSED'], ['drawer_pr_4', other, asing, 'OPEN']]) seedDrawer(sqlite, store, owner, id, status);

  sqlite.prepare(`INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status) VALUES ('att_pr_1', ?, ?, 'in', x'01', 'image/jpeg', ?, 'OPEN')`).run(rina, g001, '2026-09-30T06:05:00.000Z');
  sqlite.prepare(`
    INSERT INTO attendance_correction_permits (id, store_id, attendance_id, requested_by_cashier_id, original_check_in_at, requested_check_in_at, reason, status, created_at)
    VALUES ('acp_1', ?, 'att_pr_1', ?, '2026-09-30T06:05:00.000Z', '2026-09-30T02:00:00.000Z', 'Web presensi error', 'EXPIRED', ?)
  `).run(g001, rina, sqlTime(-1));

  const voidPermit = (id, cashier, drawer, status, subject, snapshot, requestedAt, store = g001) => sqlite.prepare(`
    INSERT INTO approval_permits (id, store_id, drawer_session_id, cashier_id, permit_type, subject_type, subject_id, subject_snapshot_json, reason, approval_status, decision_note, approved_by_role, requested_at, updated_at, decided_at)
    VALUES (?, ?, ?, ?, 'TRANSACTION_VOID', ?, ?, ?, 'Salah input', ?, 'oke', 'ADMIN', ?, ?, ?)
  `).run(id, store, drawer, cashier, subject, `${subject}_${id}`, JSON.stringify(snapshot), status, requestedAt, requestedAt, requestedAt);
  voidPermit('void_1', bimo, 'drawer_pr_2', 'approved', 'SALE', { description: 'Penjualan Budi', amount: 25000 }, iso(-2));
  voidPermit('void_2', rina, 'drawer_pr_1', 'rejected', 'EXPENSE', { description: 'Beli es', amount: 5000 }, iso(-3));
  voidPermit('void_asing', asing, 'drawer_pr_4', 'approved', 'SALE', {}, iso(-1), other);
  voidPermit('void_lama', rina, 'drawer_pr_1', 'approved', 'SALE', {}, iso(-90));

  const request = (id, cashier, drawer, type, status, payload) => sqlite.prepare(`
    INSERT INTO approval_requests (id, store_id, drawer_session_id, cashier_id, request_type, approval_status, payload_json, decision_note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)
  `).run(id, g001, drawer, cashier, type, status, JSON.stringify(payload), iso(-1), iso(-1));
  request('req_cash', rina, 'drawer_pr_1', 'CASH_FLOW', 'pending_approval', { direction: 'IN', amount: 100000, description: 'Tambah modal kas', note: 'dari owner' });
  request('req_goods', bimo, 'drawer_pr_2', 'GOODS_FLOW', 'approved', { purpose: 'STOCK_ADJUSTMENT', productName: 'Tepung', reason: 'opname' });

  sqlite.prepare(`
    INSERT INTO drawer_close_permits (id, store_id, drawer_session_id, target_cashier_id, requested_by_cashier_id, closing_amount, deposit_amount, reason, status, decided_by_role, created_at)
    VALUES ('dcp_1', ?, 'drawer_pr_3', ?, ?, 150000, 50000, 'Gantian jaga', 'REJECTED', 'SYSTEM', ?)
  `).run(g001, rina, bimo, sqlTime(-5));
  return { sqlite, g001 };
}

function report(sqlite, query = '', store = 'G001') {
  const url = new URL(`https://example.test/api/admin/permit-report?store=${store}${query ? `&${query}` : ''}`);
  return handlePermitReportApi(new Request(url, { headers: { authorization: `Bearer ${AGENT_TOKEN}` } }), { DB: new D1Database(sqlite), AGENT_ADMIN_TOKEN: AGENT_TOKEN }, url.pathname);
}

test('semua kategori digabung: status dinormalkan, ringkasan per kategori dan status benar, gerai lain dan di luar periode tidak ikut', async () => {
  const { sqlite } = seedAll();
  try {
    const payload = await (await report(sqlite)).json();
    const ids = payload.rows.map(row => row.id).sort();
    assert.deepEqual(ids, ['acp_1', 'dcp_1', 'req_cash', 'req_goods', 'void_1', 'void_2'].sort());
    const byId = Object.fromEntries(payload.rows.map(row => [row.id, row]));
    assert.equal(byId.acp_1.status, 'EXPIRED');
    assert.equal(byId.dcp_1.status, 'EXPIRED', 'ditolak sistem pada permit laci = kadaluarsa');
    assert.equal(byId.req_cash.status, 'PENDING');
    assert.equal(byId.req_goods.status, 'APPROVED');
    assert.equal(byId.void_1.status, 'APPROVED');
    assert.equal(byId.void_2.status, 'REJECTED');

    assert.match(byId.acp_1.summary, /Jam masuk 13:05 diminta jadi 09:00/);
    assert.match(byId.void_1.summary, /Hapus penjualan · Penjualan Budi · Rp25\.000/);
    assert.match(byId.req_cash.summary, /Kas masuk · Rp100\.000 · Tambah modal kas/);
    assert.equal(byId.req_cash.reason, 'dari owner');
    assert.match(byId.dcp_1.summary, /Tutup laci Rina · saldo Rp150\.000 · setoran Rp50\.000/);
    assert.equal(byId.void_1.decidedByRole, 'ADMIN');

    assert.equal(payload.summary.total, 6);
    assert.deepEqual(payload.summary.byStatus, { PENDING: 1, APPROVED: 2, REJECTED: 1, EXPIRED: 2 });
    assert.equal(payload.summary.byCategory.TRANSACTION_VOID.APPROVED, 1);
    assert.deepEqual(payload.categories.map(item => item.code), ['ATTENDANCE_CORRECTION', 'ATTENDANCE_GPS', 'TRANSACTION_VOID', 'CASH_FLOW', 'GOODS_FLOW', 'ASSET', 'DRAWER_CLOSE']);
    assert.ok(payload.requesters.some(item => item.name === 'Rina'));
    assert.ok(!payload.requesters.some(item => item.name === 'Orang Gerai Lain'), 'karyawan gerai lain tidak muncul di filter');
    // Terbaru di atas.
    assert.ok(payload.rows.every((row, index) => index === 0 || payload.rows[index - 1].createdAt >= row.createdAt));
  } finally { sqlite.close(); }
});

test('filter kategori hanya mengembalikan kategori itu, dan kategori tidak dikenal ditolak', async () => {
  const { sqlite } = seedAll();
  try {
    const attendance = await (await report(sqlite, 'category=ATTENDANCE_CORRECTION')).json();
    assert.deepEqual(attendance.rows.map(row => row.id), ['acp_1']);
    const voids = await (await report(sqlite, 'category=TRANSACTION_VOID')).json();
    assert.deepEqual(voids.rows.map(row => row.id).sort(), ['void_1', 'void_2']);
    const cash = await (await report(sqlite, 'category=CASH_FLOW')).json();
    assert.deepEqual(cash.rows.map(row => row.id), ['req_cash']);
    const bad = await report(sqlite, 'category=BUKAN_KATEGORI');
    assert.equal(bad.status, 400);
  } finally { sqlite.close(); }
});

test('filter karyawan pengaju bekerja lintas kategori', async () => {
  const { sqlite } = seedAll();
  try {
    const rina = await (await report(sqlite, 'requester=cashier_pr_rina')).json();
    assert.deepEqual(rina.rows.map(row => row.id).sort(), ['acp_1', 'req_cash', 'void_2'].sort());
    assert.ok(rina.rows.every(row => row.requesterName === 'Rina'));
    const bimo = await (await report(sqlite, 'requester=cashier_pr_bimo')).json();
    assert.deepEqual(bimo.rows.map(row => row.id).sort(), ['dcp_1', 'req_goods', 'void_1'].sort(), 'pengaju tutup laci = yang meminta, bukan pemilik laci');
    const both = await (await report(sqlite, 'requester=cashier_pr_rina&category=TRANSACTION_VOID')).json();
    assert.deepEqual(both.rows.map(row => row.id), ['void_2']);
  } finally { sqlite.close(); }
});

test('filter status dan rentang tanggal', async () => {
  const { sqlite } = seedAll();
  try {
    const expired = await (await report(sqlite, 'status=EXPIRED')).json();
    assert.deepEqual(expired.rows.map(row => row.id).sort(), ['acp_1', 'dcp_1']);
    assert.equal(expired.summary.total, 6, 'ringkasan tetap menunjukkan sebaran semua status');
    assert.equal((await report(sqlite, 'status=ANEH')).status, 400);

    const wide = await (await report(sqlite, 'from=2020-01-01')).json();
    assert.ok(wide.rows.some(row => row.id === 'void_lama'), 'rentang lebih lebar memuat permit lama');
    assert.equal(wide.rows.some(row => row.id === 'void_asing'), false, 'gerai lain tetap tidak ikut');
    assert.equal((await report(sqlite, 'from=2026-12-31&to=2026-01-01')).status, 400);
  } finally { sqlite.close(); }
});

test('tanpa login Admin ditolak', async () => {
  const { sqlite } = seedAll();
  try {
    const url = new URL('https://example.test/api/admin/permit-report?store=G001');
    const response = await handlePermitReportApi(new Request(url), { DB: new D1Database(sqlite) }, url.pathname);
    assert.ok(response.status === 401 || response.status === 403);
    assert.equal(await handlePermitReportApi(new Request(url, { method: 'POST' }), { DB: new D1Database(sqlite) }, url.pathname), null);
  } finally { sqlite.close(); }
});

test('tampilan: tab Laporan Permit punya filter kategori, karyawan, status, tanggal dan terpasang di halaman admin', () => {
  const ui = readFileSync(new URL('../public/admin-permit-report.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
  for (const id of ['permitReportCategory', 'permitReportRequester', 'permitReportStatus', 'permitReportFrom', 'permitReportTo']) assert.match(ui, new RegExp(id));
  assert.match(ui, /\/api\/admin\/permit-report/);
  assert.match(ui, /Laporan Permit/);
  assert.match(html, /admin-permit-report\.js\?v=20261001-laporan-permit-v1/);
});
