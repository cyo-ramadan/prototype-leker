import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleUnifiedLoginApi } from '../src/unified-login.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-09-18: "masalah user yang uda login gampang ke refresh ini
// bikin user jadi malas pakai pos ini. ke back ada pilihan login lagi, tab
// ketutup, terus buka lagi harus login lagi. harusnya meskipun dia buka
// program pos ini 2 tab ga masalah, yang penting di 2 tab itu ga pindah user.
// mau login juga kadang risih ada permintaan, mau pakai sesi ini, padahal
// terakhir masih login."
//
// Empat keluhan itu punya empat akar TERPISAH, dan test di bawah menjaga
// masing-masing supaya tidak diam-diam balik lagi:
//   1. token kasir cuma di sessionStorage  -> hilang begitu tab ditutup
//   2. identitas staf cuma di sessionStorage -> guard kehilangan pembanding
//   3. guard "satu tab"                    -> tab kedua diblokir walau user sama
//   4. server menolak login akun yang sama -> prompt "ambil alih sesi"
// Plus satu lagi: halaman login tertinggal di history -> tombol Back balik ke
// form login.

const readPublic = name => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
const authEntrySplit = readPublic('auth-entry-split.js');
const staffTabLock = readPublic('staff-tab-lock.js');

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

async function seedCashier(db, { username = 'kasir_sesi_test', password = 'rahasia123' } = {}) {
  const storeId = db.prepare(`SELECT id FROM stores WHERE code = 'KANTOR'`).get().id;
  const id = 'cashier_sesi_test';
  db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at)
    VALUES (?, ?, ?, 'Kasir Sesi', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
    .run(id, username, await hashCredential(password), storeId);
  return { id, username, password };
}

const loginRequest = body => new Request('https://example.test/api/auth/staff-login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

test('kasir login dua kali berturut-turut langsung sukses -- tidak ada lagi 409 "ambil alih sesi"', async () => {
  const db = migratedDatabase();
  try {
    const seed = await seedCashier(db);
    const env = { DB: new D1Database(db) };

    const first = await handleUnifiedLoginApi(loginRequest({ username: seed.username, password: seed.password }), env, '/api/auth/staff-login');
    assert.equal(first.status, 200);

    // Persis skenario Bos Cyo: tab ditutup (browser kehilangan token), lalu
    // login lagi. Server masih menyimpan sesi lama yang belum kedaluwarsa.
    const second = await handleUnifiedLoginApi(loginRequest({ username: seed.username, password: seed.password }), env, '/api/auth/staff-login');
    assert.equal(second.status, 200, 'orang yang sama login lagi TIDAK boleh ditanya apa-apa');

    const body = await second.json();
    assert.equal(body.role, 'CASHIER');
    assert.ok(body.token);

    const sessions = db.prepare('SELECT COUNT(*) AS n FROM cashier_sessions WHERE cashier_id = ?').get(seed.id);
    assert.equal(sessions.n, 2, 'dua sesi hidup berdampingan -- HP dan laptop, atau dua tab');
  } finally {
    db.close();
  }
});

test('logout di satu sesi tidak ikut mematikan sesi lain dari akun yang sama', async () => {
  const db = migratedDatabase();
  try {
    const seed = await seedCashier(db);
    const env = { DB: new D1Database(db) };

    const first = await (await handleUnifiedLoginApi(loginRequest({ username: seed.username, password: seed.password }), env, '/api/auth/staff-login')).json();
    const second = await (await handleUnifiedLoginApi(loginRequest({ username: seed.username, password: seed.password }), env, '/api/auth/staff-login')).json();

    // Logout memang per token_hash (src/cashier-auth.js) -- itu yang bikin
    // multi-sesi aman. Ditiru di sini supaya kalau nanti ada yang mengubahnya
    // jadi "hapus semua sesi milik akun ini", test ini yang gagal duluan.
    db.prepare('DELETE FROM cashier_sessions WHERE token_hash = ?').run(await hashCredential(first.token));

    const left = db.prepare('SELECT token_hash FROM cashier_sessions WHERE cashier_id = ?').all(seed.id);
    assert.equal(left.length, 1, 'sesi kedua harus selamat');
    assert.equal(left[0].token_hash, await hashCredential(second.token));
  } finally {
    db.close();
  }
});

test('sesi karyawan tidak lagi ikut hilang saat tab ditutup -- token dan identitas dua-duanya di localStorage', () => {
  assert.match(authEntrySplit, /localStorage\.setItem\(staffTokenKey\(payload\.role\), payload\.token\)/);
  assert.match(authEntrySplit, /localStorage\.setItem\('lekerStaffSessionMeta'/);
  // Titik baca di setiap halaman staf ikut pindah, bukan cuma titik tulisnya.
  for (const name of ['staff-entry-guard.js', 'staff-auth-fetch.js', 'cashier.js', 'cashier-enhancements.js']) {
    assert.match(readPublic(name), /localStorage\.getItem\('lekerCashierToken'\)/, `${name} harus membaca token kasir dari localStorage`);
    assert.doesNotMatch(readPublic(name), /sessionStorage\.getItem\('lekerCashierToken'\)/, `${name} masih membaca token kasir dari sessionStorage`);
  }
});

test('halaman login tidak tertinggal di history setelah login sukses -- tombol Back tidak balik ke form', () => {
  // Bos Cyo: "ke back ada pilihan login lagi". Penyebabnya location.href,
  // yang menambah entry baru dan menyisakan halaman login di riwayat.
  assert.match(authEntrySplit, /location\.replace\(payload\.redirect \|\| '\/'\)/);
  assert.doesNotMatch(authEntrySplit, /location\.href = payload\.redirect/, 'login sukses tidak boleh memakai location.href');
});

test('login sukses tidak lagi ditahan oleh pengecekan "sesi lain masih aktif" -- Bos Cyo, 2026-09-22: ganti user cukup lewat Logout eksplisit, bukan penolakan di submit', () => {
  // Supersedes bekas test ini (yang tadinya menuntut activeStaffLease()
  // dicek SESUDAH identitas diketahui). Bos Cyo eksplisit menolak model
  // "menghadang PINDAH USER" sama sekali: "coba cek di facebook, tiktok dsb
  // apa juga bisa seperti itu" -- sesi yang berhasil login SELALU menang,
  // titik. Yang mencegah tab lama dari user sebelumnya tetap jalan sekarang
  // murni tugas staff-tab-lock.js (heartbeat/storage event), bukan submitLogin().
  const submitBody = authEntrySplit.slice(authEntrySplit.indexOf('async function submitLogin'), authEntrySplit.indexOf('form.addEventListener'));
  assert.doesNotMatch(submitBody, /activeStaffLease\(/, 'submitLogin() tidak boleh lagi memanggil activeStaffLease()');
  assert.doesNotMatch(authEntrySplit, /function activeStaffLease/, 'activeStaffLease() wajib sudah dihapus total, bukan cuma tidak dipanggil');
  assert.doesNotMatch(authEntrySplit, /Masih ada sesi karyawan lain/);
  assert.match(submitBody, /const identity = staffIdentity\(payload\)/, 'identitas tetap perlu dibaca untuk menulis meta/lease sesi baru');
});

test('guard antar tab membandingkan siapa usernya, bukan berapa tabnya', () => {
  assert.match(staffTabLock, /function leaseIsOtherUser\(lease\)/);
  assert.match(staffTabLock, /lease\.staffId !== meta\.id \|\| lease\.role !== meta\.role/);
  assert.match(staffTabLock, /staffId: meta\.id/, 'lease wajib membawa identitas supaya bisa dibandingkan');
  // Tab kedua dengan user yang sama tidak boleh kena block(): satu-satunya
  // jalan menuju block() harus lewat leaseIsOtherUser().
  const blockCallSites = staffTabLock.match(/block\(\);/g) || [];
  assert.equal(blockCallSites.length, 3, 'block() dipanggil di tiga tempat: saat mount, heartbeat, dan storage event');
  for (const guardLine of staffTabLock.match(/if \(leaseIsFresh\([^)]*\) && leaseIsOtherUser\([^)]*\)\)/g) || []) {
    assert.match(guardLine, /leaseIsOtherUser/);
  }
  assert.equal((staffTabLock.match(/leaseIsOtherUser\(/g) || []).length, 4, 'tiga penjaga + satu definisi -- tidak ada jalur block() yang melewatkan pengecekan user');
});

test('login yang baru saja sukses di tab ini sendiri tidak ikut kena tendang gara-gara race lease dengan tab lain yang masih terbuka', () => {
  // Bos Cyo, 2026-09-22 (kasir Pendem): "berhasil login abis itu kepental
  // balik lagi ke halaman login dan status logout." Akar KEDUA, terpisah
  // dari perbaikan sesi persisten sebelumnya: tab lain yang masih terbuka
  // dari user LAMA (belum logout resmi) bisa menimpa balik lease persis di
  // jeda navigasi login yang BARU sukses, karena lease murni "siapa nulis
  // terakhir" tanpa urutan/generasi. lekerStaffHandoffId di sessionStorage
  // (tidak dibagi antar tab, beda dari localStorage) adalah bukti kuat
  // login ini terjadi DI TAB INI SENDIRI, jadi harus mengalahkan lease yang
  // racy -- bukan sebaliknya.
  const mountGuard = staffTabLock.slice(
    staffTabLock.indexOf("const freshHandoff ="),
    staffTabLock.indexOf('writeLease();\n  sessionStorage.removeItem')
  );
  assert.match(mountGuard, /sessionStorage\.getItem\('lekerStaffHandoffId'\)/, 'harus membaca handoff milik tab ini sendiri, bukan localStorage yang dibagi tab lain');
  assert.match(mountGuard, /if \(!freshHandoff && leaseIsFresh\(existing\) && leaseIsOtherUser\(existing\)\)/, 'tab yang baru saja handoff wajib dikecualikan dari block() saat mount, walau lease saat ini kelihatan "user lain"');
});

test('trigger "satu sesi per karyawan" benar-benar sudah tidak terpasang lagi di database', () => {
  // Akar terdalam dan paling tidak kelihatan: trigger migration 0011 mencabut
  // sesi lama di level DATABASE setiap ada sesi baru -- membereskan sisi
  // aplikasi saja tidak akan menyelesaikan keluhan Bos Cyo selama trigger ini
  // masih hidup. Dibuktikan lewat sqlite_schema, bukan dengan membaca file
  // migration-nya: yang menentukan itu keadaan database sesudah SEMUA
  // migration jalan, bukan isi satu file.
  const db = migratedDatabase();
  try {
    const triggers = db.prepare(
      `SELECT name FROM sqlite_schema WHERE type = 'trigger' AND name IN (?, ?, ?)`
    ).all('trg_owner_single_session', 'trg_store_admin_single_session', 'trg_cashier_single_session');
    assert.deepEqual(triggers, [], `trigger satu-sesi masih terpasang: ${triggers.map(t => t.name).join(', ')}`);
  } finally {
    db.close();
  }
});

test('sesi Owner dan Admin Gerai juga boleh lebih dari satu, bukan cuma kasir', () => {
  const db = migratedDatabase();
  try {
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
    db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('o1', 'owner_multi', 'x', 'Owner')`).run();
    for (const hash of ['hash_a', 'hash_b']) {
      db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'o1', ?, ?)`).run(hash, now, later);
    }
    const count = db.prepare(`SELECT COUNT(*) AS n FROM owner_sessions WHERE owner_id = 'o1'`).get();
    assert.equal(count.n, 2, 'Owner pun harus bisa login di HP dan laptop sekaligus tanpa saling menendang');
  } finally {
    db.close();
  }
});
