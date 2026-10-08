import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import { addOperationalPayment } from '../src/operational-receivables-payables.js';

// Bos Cyo, 2026-10-07: "kasih tombol di admin dan entity admin untuk cek/acc-an dari setor uang nya
// cs ... kalo dari sisi entity ketika tombol di klik maka keluarin semua list yang perlu di acc.
// yang akan di cek admin adalah jumlah nominal transfer, waktu persisnya jam:menit, dan foto".

const migrationDir = new URL('../migrations/', import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

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
  db.prepare(`INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active) VALUES ('ea_kpm', 'ENT-KPM', 'ea_kpm', 'x', 'Admin KPM', 1)`).run();
  db.prepare(`INSERT INTO entity_admin_sessions (token_hash, entity_admin_id, created_at, expires_at) VALUES (?, 'ea_kpm', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('ea-kpm'));
  return { db, env: { DB: new D1Database(db) } };
}

function seedSetoran(db, { id, storeId, entityId, name, amountRupiah }) {
  db.prepare(`
    INSERT INTO operational_receivables_payables (id, store_id, entity_id, source_type, balance_type, source_id, counterparty_id, counterparty_name_snapshot, counterparty_type, description, original_amount, transaction_date)
    VALUES (?, ?, ?, 'EMPLOYEE_DEPOSIT', 'RECEIVABLE', ?, ?, ?, 'EMPLOYEE', 'Setoran laci', ?, '2026-10-06')
  `).run(id, storeId, entityId, `drawer_${id}`, `cashier:c_${id}`, name, amountRupiah * 1_000_000);
}

const asEntityAdmin = (env, path, { method = 'GET', body, token = 'ea-kpm' } = {}) => worker.fetch(new Request(`https://example.test${path}`, {
  method,
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined
}), env);

async function seedQueue(db, env) {
  seedSetoran(db, { id: 'orp_mandala', storeId: 'store_mandala', entityId: 'ENT-KPM', name: 'Anida', amountRupiah: 150000 });
  seedSetoran(db, { id: 'orp_pendem', storeId: 'store_pendem', entityId: 'ENT-KPM', name: 'Sari', amountRupiah: 90000 });
  seedSetoran(db, { id: 'orp_luar', storeId: 'store_001', entityId: 'ENT-G001', name: 'Orang Lain', amountRupiah: 70000 });
  const mandala = await addOperationalPayment(env.DB, 'orp_mandala', { amountRupiah: 150000, proofReference: 'Foto bukti transfer', submittedBy: 'c1' }, { storeId: 'store_mandala' });
  const pendem = await addOperationalPayment(env.DB, 'orp_pendem', { amountRupiah: 90000, proofReference: 'Foto bukti transfer', submittedBy: 'c2' }, { storeId: 'store_pendem' });
  const luar = await addOperationalPayment(env.DB, 'orp_luar', { amountRupiah: 70000, proofReference: 'Foto bukti transfer', submittedBy: 'c3' }, { storeId: 'store_001' });
  return { mandala: mandala.payment.id, pendem: pendem.payment.id, luar: luar.payment.id };
}

test('Entity Admin melihat semua setoran menunggu ACC di seluruh gerai entity-nya, bukan entity lain', async () => {
  const { db, env } = await setup();
  try {
    const ids = await seedQueue(db, env);
    const res = await asEntityAdmin(env, '/api/entity-admin/employee-deposits/pending');
    assert.equal(res.status, 200, await res.clone().text());
    const { payments } = await res.json();
    assert.deepEqual(payments.map(row => row.id).sort(), [ids.mandala, ids.pendem].sort());
    const anida = payments.find(row => row.id === ids.mandala);
    assert.equal(anida.storeCode, 'MANDALA');
    assert.equal(anida.employeeName, 'Anida');
    assert.equal(anida.amountRupiah, 150000);
    // Waktu persis (ISO UTC, ditampilkan WIB di layar) dan penanda foto ikut, untuk dicocokkan dengan mutasi bank.
    assert.match(anida.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    assert.equal(anida.hasPhoto, false);
  } finally { db.close(); }
});

test('antrean ACC Entity Admin butuh login Entity Admin', async () => {
  const { db, env } = await setup();
  try {
    assert.equal((await asEntityAdmin(env, '/api/entity-admin/employee-deposits/pending', { token: '' })).status, 401);
    assert.equal((await asEntityAdmin(env, '/api/entity-admin/employee-deposits/pending', { token: 'salah' })).status, 401);
  } finally { db.close(); }
});

test('Entity Admin bisa ACC dan Tolak dari antrean entity; gerai entity lain ditolak', async () => {
  const { db, env } = await setup();
  try {
    const ids = await seedQueue(db, env);
    const acc = await asEntityAdmin(env, `/api/admin/employee-deposits/payments/${ids.mandala}?store=MANDALA`, { method: 'PATCH', body: { action: 'APPROVE' } });
    assert.equal(acc.status, 200, await acc.clone().text());
    assert.equal(db.prepare(`SELECT approval_status, reviewed_by FROM operational_receivable_payable_payments WHERE id = ?`).get(ids.mandala).approval_status, 'approved');

    const tolakTanpaAlasan = await asEntityAdmin(env, `/api/admin/employee-deposits/payments/${ids.pendem}?store=PENDEM`, { method: 'PATCH', body: { action: 'REJECT' } });
    assert.equal(tolakTanpaAlasan.status, 400);
    const tolak = await asEntityAdmin(env, `/api/admin/employee-deposits/payments/${ids.pendem}?store=PENDEM`, { method: 'PATCH', body: { action: 'REJECT', rejectionReason: 'Nominal beda dengan mutasi' } });
    assert.equal(tolak.status, 200);
    assert.equal(db.prepare(`SELECT approval_status FROM operational_receivable_payable_payments WHERE id = ?`).get(ids.pendem).approval_status, 'rejected');

    const luar = await asEntityAdmin(env, `/api/admin/employee-deposits/payments/${ids.luar}?store=G001`, { method: 'PATCH', body: { action: 'APPROVE' } });
    assert.equal(luar.status, 403, 'gerai di luar entity tidak boleh di-ACC');
    assert.equal(db.prepare(`SELECT approval_status FROM operational_receivable_payable_payments WHERE id = ?`).get(ids.luar).approval_status, 'pending_approval');

    const sisa = await (await asEntityAdmin(env, '/api/entity-admin/employee-deposits/pending')).json();
    assert.equal(sisa.payments.length, 0, 'yang sudah diputuskan hilang dari antrean');
  } finally { db.close(); }
});

test('layar ACC menampilkan nominal, jam:menit WIB, dan foto, di Entity Admin maupun Admin Gerai', () => {
  const entity = read('public/entity-setoran-cs.js');
  assert.match(entity, /hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia\/Jakarta'/);
  assert.match(entity, /WIB/);
  assert.match(entity, /data-deposit-photo/);
  assert.match(entity, /\/api\/entity-admin\/employee-deposits\/pending/);
  assert.match(entity, /data-approve=/);
  assert.match(entity, /data-reject=/);
  // Tidak ada timer berulang (invariant #6).
  assert.doesNotMatch(entity, /setInterval/);
  const admin = read('public/admin-employee-deposits.js');
  assert.match(admin, /hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia\/Jakarta'/);
  assert.match(admin, /data-deposit-photo/);
  assert.match(admin, /Setoran CS\$\{count \? ` \$\{count\}` : ''\}/);
});

test('tab Setoran CS terdaftar di Entity Admin, menu pengelompokan, dan script di-bump', () => {
  const html = read('public/entity-admin.html');
  assert.match(html, /data-entity-tab="setorancs"/);
  assert.match(html, /id="entityTab-setorancs"/);
  assert.match(html, /<script src="\/entity-setoran-cs\.js\?v=[^"]+"><\/script>/);
  assert.match(html, /entity-admin\.js\?v=20261007-setoran-cs-v1/);
  assert.match(html, /nav-groups\.js\?v=20261007-setoran-cs-v1/);
  assert.match(read('public/entity-admin.js'), /name === 'setorancs'/);
  assert.match(read('public/nav-groups.js'), /items: \['ledger', 'sharedaccounts', 'setorancs'\]/);
  assert.match(read('public/branch-admin.html'), /admin-employee-deposits\.js\?v=20261008-bukti-transfer-v1/);
});
