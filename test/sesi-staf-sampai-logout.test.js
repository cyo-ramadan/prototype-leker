import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { hashCredential, ownerFromRequest, storeAdminFromRequest, entityAdminFromRequest } from '../src/owner-auth.js';
import { requireCashier } from '../src/cashier-auth.js';
import { SESI_STAF_JAM, kedaluwarsaSesiStaf, perpanjangSesiStaf } from '../src/sesi-staf.js';

// Bos Cyo, 2026-10-11: "walaupun new tab new tab tetap login sampai dia logout." Dulu sesi karyawan
// mati pasti 12 jam sesudah login; CS yang membuka tab baru besok paginya dilempar ke login. Tes ini
// menjaga sesi BERGESER: selama dipakai tidak pernah habis, dan baru habis kalau logout atau lama
// tidak dipakai sama sekali.

const migrationDir = new URL('../migrations/', import.meta.url);
const JAM = 60 * 60 * 1000;

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

const iso = ms => new Date(ms).toISOString();
const request = token => new Request('https://leker.test/api/x', { headers: { Authorization: `Bearer ${token}` } });

async function seedCashierSession(db, { createdMs, expiresMs }) {
  const store = db.prepare('SELECT id FROM stores WHERE is_active = 1 LIMIT 1').get();
  const cashierId = `kasir_sesi_${Math.random().toString(36).slice(2)}`;
  db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at)
    VALUES (?, ?, 'x', 'CS Uji', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(cashierId, cashierId, store.id);
  const token = `tok_${cashierId}`;
  const tokenHash = await hashCredential(token);
  db.prepare('INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash, cashierId, iso(createdMs), iso(expiresMs));
  return { token, tokenHash };
}

test('sesi baru berlaku 30 hari, bukan 12 jam', () => {
  const now = new Date('2026-10-11T08:00:00Z');
  assert.equal(SESI_STAF_JAM, 30 * 24);
  assert.equal(Date.parse(kedaluwarsaSesiStaf(now)) - now.getTime(), 30 * 24 * JAM);
});

test('kasir/CS yang memakai aplikasi tetap login: masa berlaku sesi diperpanjang sejak pemakaian terakhir', async () => {
  const raw = migratedDatabase();
  const db = new D1Database(raw);
  // Login 11 jam lalu dengan aturan lama: sisa 1 jam lagi sebelum habis.
  const { token, tokenHash } = await seedCashierSession(raw, { createdMs: Date.now() - 11 * JAM, expiresMs: Date.now() + JAM });

  const auth = await requireCashier(request(token), db);
  assert.equal(auth.ok, true);
  const row = raw.prepare('SELECT expires_at FROM cashier_sessions WHERE token_hash = ?').get(tokenHash);
  const sisaJam = (Date.parse(row.expires_at) - Date.now()) / JAM;
  assert.ok(sisaJam > 30 * 24 - 1, `sesi harus digeser ke ~30 hari lagi, sisa sekarang ${sisaJam.toFixed(1)} jam`);
});

test('pemakaian beruntun tidak menulis database setiap permintaan', async () => {
  const raw = migratedDatabase();
  const db = new D1Database(raw);
  const baru = Date.now() + 30 * 24 * JAM - 5 * 60 * 1000; // baru saja diperpanjang 5 menit lalu
  const { token, tokenHash } = await seedCashierSession(raw, { createdMs: Date.now(), expiresMs: baru });
  await requireCashier(request(token), db);
  const row = raw.prepare('SELECT expires_at FROM cashier_sessions WHERE token_hash = ?').get(tokenHash);
  assert.equal(row.expires_at, iso(baru));
});

test('sesi yang sudah habis atau sudah logout tetap ditolak dan tidak dihidupkan lagi', async () => {
  const raw = migratedDatabase();
  const db = new D1Database(raw);
  const habis = await seedCashierSession(raw, { createdMs: Date.now() - 40 * 24 * JAM, expiresMs: Date.now() - JAM });
  assert.equal((await requireCashier(request(habis.token), db)).ok, false);
  const row = raw.prepare('SELECT expires_at FROM cashier_sessions WHERE token_hash = ?').get(habis.tokenHash);
  assert.ok(Date.parse(row.expires_at) < Date.now(), 'sesi kedaluwarsa tidak boleh diperpanjang');

  const keluar = await seedCashierSession(raw, { createdMs: Date.now(), expiresMs: Date.now() + JAM });
  raw.prepare('DELETE FROM cashier_sessions WHERE token_hash = ?').run(keluar.tokenHash); // tombol Keluar
  assert.equal((await requireCashier(request(keluar.token), db)).ok, false);
});

test('owner, admin gerai, dan entity admin memakai aturan geser yang sama', async () => {
  for (const src of ['src/owner-auth.js', 'src/cashier-auth.js', 'src/racik-kasir-pemilik.js']) {
    const text = readFileSync(new URL(`../${src}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /SESSION_HOURS\s*=\s*12/, `${src} masih memakai batas 12 jam`);
  }
  const owner = readFileSync(new URL('../src/owner-auth.js', import.meta.url), 'utf8');
  for (const tabel of ['owner_sessions', 'store_admin_sessions', 'entity_admin_sessions']) {
    assert.match(owner, new RegExp(`perpanjangSesiStaf\\(db, '${tabel}'`));
  }
  assert.equal(typeof ownerFromRequest, 'function');
  assert.equal(typeof storeAdminFromRequest, 'function');
  assert.equal(typeof entityAdminFromRequest, 'function');
});

test('perpanjangSesiStaf menolak nama tabel di luar daftar sesi karyawan', async () => {
  let dipanggil = false;
  const db = { prepare: () => { dipanggil = true; return { bind: () => ({ run: async () => {} }) }; } };
  await perpanjangSesiStaf(db, 'customer_sessions', 'hash', iso(Date.now()));
  await perpanjangSesiStaf(db, 'orders; DROP TABLE x', 'hash', iso(Date.now()));
  assert.equal(dipanggil, false);
});

test('halaman login mengecek token tersimpan ke server sebelum menawarkan "Lanjutkan"', () => {
  const login = readFileSync(new URL('../public/staff-login.js', import.meta.url), 'utf8');
  assert.match(login, /sessionStillValid\(session\)/);
  assert.match(login, /response\.status !== 401/, 'hanya 401 yang dianggap sesi habis');
  assert.match(login, /catch \{\s*return true;/, 'gangguan jaringan tidak membuang sesi');
  assert.match(login, /sudah habis\. Silakan masuk lagi/);
});
