import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleUnifiedLoginApi } from '../src/unified-login.js';
import { handleEmployeeMasterApi } from '../src/employee-master.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-09-18: "bikin penolakan juga ketika ada satu nama yang
// bekerja dalam satu waktu yang sama ... eh mending dihadang sebelum login
// aja kalo ada 1 nama coba login 2 akun, ini berlaku di entity ya. misal
// ninda cs dermo usa login, kok ada lagi akun ca pendem dengan nama ninda
// login, maka ini harus di tolak."
//
// Satu KARYAWAN (bukan satu akun) tidak boleh punya sesi aktif di lebih dari
// satu akun bersamaan, lintas gerai dalam entity yang sama. Yang ditolak
// SELALU percobaan login baru -- sesi yang sudah berjalan (Bos Cyo: "yang
// paling dipertahankan untuk tidak logout adalah akun yang lagi buka laci")
// tidak pernah dicabut oleh pagar ini.
//
// Dipertegas beda dari perbaikan 2026-09-18 sebelumnya (migration 0102,
// multi-sesi per AKUN yang sama diizinkan supaya kasir tidak gampang
// ke-logout) -- dua aturan ini tidak bertentangan: akun yang SAMA boleh
// dibuka di banyak tab/perangkat, tapi KARYAWAN yang sama tidak boleh
// merangkap aktif di akun BERBEDA pada saat bersamaan.

const migrationDir = new URL('../migrations/', import.meta.url);

function d1(sqlite) {
  function prepared(sql) {
    const statement = sqlite.prepare(sql);
    return {
      bind(...args) {
        return {
          _statement: statement,
          _args: args,
          async first() { return statement.get(...args) || null; },
          async all() { return { results: statement.all(...args) }; },
          async run() {
            const result = statement.run(...args);
            return { ...result, success: true, meta: { changes: result.changes } };
          }
        };
      }
    };
  }
  return {
    prepare: prepared,
    async batch(boundStatements) {
      sqlite.exec('BEGIN');
      try {
        const results = boundStatements.map(item => item._statement.run(...item._args));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

function request(pathname, { token, method = 'GET', body, store } = {}) {
  const url = new URL(`https://example.test${pathname}`);
  if (store) url.searchParams.set('store', store);
  return new Request(url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

const employeeCall = (env, pathname, options) => handleEmployeeMasterApi(request(pathname, options), env, pathname);

async function storeAdminToken(sqlite, adminId) {
  const token = `emp-admin-${adminId}`;
  sqlite.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, '2026-09-18T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), adminId);
  return token;
}

async function createEmployee(env, token, store, fullName) {
  const response = await employeeCall(env, '/api/admin/employees', { token, store, method: 'POST', body: { fullName } });
  return response.json();
}

async function linkEmployee(env, token, store, employeeId, accountId) {
  const response = await employeeCall(env, `/api/admin/employees/${employeeId}/links`, {
    token, store, method: 'POST', body: { accountType: 'CASHIER', accountId }
  });
  assert.equal(response.status, 201, `gagal menautkan ke ${accountId}`);
}

function staffLogin(env, username, password) {
  const req = new Request('https://example.test/api/auth/staff-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password })
  });
  return handleUnifiedLoginApi(req, env, '/api/auth/staff-login');
}

test('karyawan yang sama ditolak login di akun lain selagi masih aktif di gerai lain -- persis skenario Ninda', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const pendemAdminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const mandalaAdminToken = await storeAdminToken(sqlite, 'admin_mandala_pilot');

    const ninda = await createEmployee(env, pendemAdminToken, 'PENDEM', 'Ninda');
    await linkEmployee(env, pendemAdminToken, 'PENDEM', ninda.id, 'cashier_pendem_pilot');
    await linkEmployee(env, mandalaAdminToken, 'MANDALA', ninda.id, 'cashier_mandala_pilot');

    // Ninda login sebagai kasir Pendem -- kredensial percontohan migration 0054.
    const first = await staffLogin(env, 'kasir_pendem', 'kasir_pendem123');
    assert.equal(first.status, 200);

    // Selagi sesi itu masih aktif, akun Mandala yang JUGA tertaut ke Ninda
    // mencoba login -- ini yang harus ditolak.
    const second = await staffLogin(env, 'kasir_mandala', 'kasir_mandala123');
    assert.equal(second.status, 409);
    const body = await second.json();
    assert.equal(body.code, 'EMPLOYEE_ACTIVE_ELSEWHERE');
    assert.match(body.error, /Ninda/);
    assert.match(body.error, /PENDEM/);
    assert.equal(body.conflictStoreCode, 'PENDEM');

    // Sesi Ninda yang PERTAMA tidak boleh tersentuh sama sekali oleh
    // percobaan login yang ditolak itu.
    const stillActive = sqlite.prepare('SELECT COUNT(*) AS n FROM cashier_sessions WHERE cashier_id = ?').get('cashier_pendem_pilot');
    assert.equal(stillActive.n, 1, 'sesi yang sudah aktif tidak boleh ikut tercabut oleh login yang ditolak');
  } finally { sqlite.close(); }
});

test('begitu sesi pertama logout, akun kedua yang tertaut ke karyawan yang sama boleh login', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const pendemAdminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const mandalaAdminToken = await storeAdminToken(sqlite, 'admin_mandala_pilot');

    const ninda = await createEmployee(env, pendemAdminToken, 'PENDEM', 'Ninda');
    await linkEmployee(env, pendemAdminToken, 'PENDEM', ninda.id, 'cashier_pendem_pilot');
    await linkEmployee(env, mandalaAdminToken, 'MANDALA', ninda.id, 'cashier_mandala_pilot');

    await staffLogin(env, 'kasir_pendem', 'kasir_pendem123');
    const blocked = await staffLogin(env, 'kasir_mandala', 'kasir_mandala123');
    assert.equal(blocked.status, 409);

    // Logout -- persis yang dijaga Bos Cyo: bukan sistem yang mencabut sesi
    // Pendem, tapi Ninda sendiri yang mengakhirinya (mis. karena pindah gerai).
    sqlite.prepare(`DELETE FROM cashier_sessions WHERE cashier_id = 'cashier_pendem_pilot'`).run();

    const allowed = await staffLogin(env, 'kasir_mandala', 'kasir_mandala123');
    assert.equal(allowed.status, 200, 'sesudah sesi lama benar-benar berakhir, akun lain yang tertaut ke karyawan yang sama boleh login');
  } finally { sqlite.close(); }
});

test('akun yang sama boleh login berkali-kali (multi-sesi) tanpa kena pagar ini -- beda dari pindah akun', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const pendemAdminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const ninda = await createEmployee(env, pendemAdminToken, 'PENDEM', 'Ninda');
    await linkEmployee(env, pendemAdminToken, 'PENDEM', ninda.id, 'cashier_pendem_pilot');

    const first = await staffLogin(env, 'kasir_pendem', 'kasir_pendem123');
    assert.equal(first.status, 200);
    // Login lagi ke akun YANG SAMA (mis. tab kedua, atau tab lama ke-refresh) --
    // ini bukan "pindah akun", jadi tidak boleh kena pagar EMPLOYEE_ACTIVE_ELSEWHERE.
    const second = await staffLogin(env, 'kasir_pendem', 'kasir_pendem123');
    assert.equal(second.status, 200);

    const sessions = sqlite.prepare(`SELECT COUNT(*) AS n FROM cashier_sessions WHERE cashier_id = 'cashier_pendem_pilot'`).get();
    assert.equal(sessions.n, 2, 'dua sesi untuk akun yang sama tetap hidup berdampingan (migration 0102)');
  } finally { sqlite.close(); }
});

test('akun yang belum ditautkan ke Master Karyawan sama sekali tidak kena pagar ini', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    // cashier_pendem_pilot dan cashier_mandala_pilot TIDAK ditautkan sama
    // sekali di test ini -- sistem tidak punya cara memastikan itu orang yang
    // sama, jadi login dua-duanya harus tetap bebas seperti sebelum fitur ini.
    const first = await staffLogin(env, 'kasir_pendem', 'kasir_pendem123');
    assert.equal(first.status, 200);
    const second = await staffLogin(env, 'kasir_mandala', 'kasir_mandala123');
    assert.equal(second.status, 200, 'akun tanpa tautan Master Karyawan tidak boleh ikut ditolak');
  } finally { sqlite.close(); }
});

test('konflik dicek entity-wide -- akun kedua di gerai manapun dalam entity yang sama tetap tertangkap', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const pendemAdminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const kantorAdminToken = await storeAdminToken(sqlite, 'admin_kantor_pilot');

    const ninda = await createEmployee(env, pendemAdminToken, 'PENDEM', 'Ninda');
    await linkEmployee(env, pendemAdminToken, 'PENDEM', ninda.id, 'cashier_pendem_pilot');
    // KANTOR gerai berbeda lagi (bukan Mandala) -- membuktikan pagarnya
    // benar-benar menjangkau seluruh entity, bukan cuma dua gerai spesifik.
    await linkEmployee(env, kantorAdminToken, 'KANTOR', ninda.id, 'cashier_kantor_pilot');

    await staffLogin(env, 'kasir_pendem', 'kasir_pendem123');
    const blocked = await staffLogin(env, 'kasir_kantor', 'kasir_kantor123');
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).code, 'EMPLOYEE_ACTIVE_ELSEWHERE');
  } finally { sqlite.close(); }
});
