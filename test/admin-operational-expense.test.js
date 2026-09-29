import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { getNetProfitReport } from '../src/net-profit-report.js';
import { hashCredential } from '../src/owner-auth.js';

// Bea Operasional dari panel Admin (Bea Gaji/Lapak/Lainnya, migration 0100),
// Bos Cyo 2026-09-17. Ini sumber Beban KEDUA setelah Pengeluaran Kasir --
// test di sini yang membuktikan pendaftarannya ke Laporan Net Profit benar,
// karena kalau lupa didaftarkan tidak ada error apa pun yang memberi tahu
// (lihat KNOWN_PITFALLS.md "Laporan Net Profit tidak otomatis ikut fitur
// Beban baru").

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

async function seedOwnerToken(db) {
  const ownerId = 'owner_bea_test';
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES (?, 'owner_bea_test', 'x', 'Test Owner')`).run(ownerId);
  const token = 'owner-bea-token';
  const tokenHash = await hashCredential(token);
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, ?, '2026-06-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(tokenHash, ownerId);
  return token;
}

function storeId(db, code) {
  return db.prepare('SELECT id FROM stores WHERE code = ?').get(code).id;
}

// Bos Cyo, 2026-09-24: Bea Gaji sekarang wajib menunjuk Karyawan nyata --
// satu karyawan per entity (semua store fixture di sini sudah satu entity,
// ENT-KPM) cukup untuk semua test yang tidak secara khusus menguji itu.
function seedEmployee(db, entityId, fullName = 'Karyawan Bea Test') {
  const id = `emp_beatest_${Math.random().toString(36).slice(2)}`;
  db.prepare(`
    INSERT INTO employees (id, entity_id, full_name, status, created_at, updated_at)
    VALUES (?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(id, entityId, fullName);
  return id;
}

function entityIdOf(db, storeCode) {
  return db.prepare('SELECT entity_id FROM stores WHERE code = ?').get(storeCode).entity_id;
}

function request(pathname, { token, store, method = 'GET', body } = {}) {
  const url = new URL(`https://example.test${pathname}`);
  if (store) url.searchParams.set('store', store);
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

const beaBody = (overrides = {}) => ({
  category: 'BEA_GAJI', description: 'Gaji Agustus', amount: 500000, businessDate: '2026-06-01', ...overrides
});

test('bea yang dicatat Admin mengurangi Net Profit di tanggal yang diisi Admin, bukan tanggal pencatatannya', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };
    const employeeId = seedEmployee(db, entityIdOf(db, 'KANTOR'));

    const createRes = await worker.fetch(request('/api/admin/operational-expenses', {
      token, store: 'KANTOR', method: 'POST', body: beaBody({ amount: 500000, businessDate: '2026-06-01', employeeId })
    }), env);
    assert.equal(createRes.status, 201);

    const { netProfitByKey } = await getNetProfitReport(env.DB, {
      storeIds: [storeId(db, 'KANTOR')], from: '2026-06-01', to: '2026-06-01', today: '2026-06-10'
    });
    assert.equal(netProfitByKey.get(`${storeId(db, 'KANTOR')}::2026-06-01`), -500000);

    // Tanggal lain di periode yang sama tidak boleh ikut kena
    const lain = await getNetProfitReport(env.DB, {
      storeIds: [storeId(db, 'KANTOR')], from: '2026-06-02', to: '2026-06-02', today: '2026-06-10'
    });
    assert.equal(lain.netProfitByKey.get(`${storeId(db, 'KANTOR')}::2026-06-02`), 0);
  } finally {
    db.close();
  }
});

test('bea yang dicatat MUNDUR ke hari yang cache-nya sudah tersimpan tetap terhitung -- cache tanggal itu dibuang', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };
    const kantor = storeId(db, 'KANTOR');
    const employeeId = seedEmployee(db, entityIdOf(db, 'KANTOR'));

    // Hari 2026-06-01 dihitung duluan dan masuk cache (nilainya 0, tanpa transaksi).
    const first = await getNetProfitReport(env.DB, { storeIds: [kantor], from: '2026-06-01', to: '2026-06-01', today: '2026-06-10' });
    assert.equal(first.netProfitByKey.get(`${kantor}::2026-06-01`), 0);
    assert.ok(
      db.prepare('SELECT 1 FROM store_daily_profit_snapshot WHERE store_id = ? AND business_date = ?').get(kantor, '2026-06-01'),
      'hari yang sudah lewat wajib masuk cache dulu supaya test ini bermakna'
    );

    // Baru kemudian Admin mencatat gaji, dibebankan MUNDUR ke tanggal itu.
    const createRes = await worker.fetch(request('/api/admin/operational-expenses', {
      token, store: 'KANTOR', method: 'POST', body: beaBody({ amount: 750000, businessDate: '2026-06-01', employeeId })
    }), env);
    assert.equal(createRes.status, 201);

    const second = await getNetProfitReport(env.DB, { storeIds: [kantor], from: '2026-06-01', to: '2026-06-01', today: '2026-06-10' });
    assert.equal(
      second.netProfitByKey.get(`${kantor}::2026-06-01`), -750000,
      'kalau ini masih 0, cache lama tidak dibuang dan bea mundur hilang senyap dari laporan'
    );
  } finally {
    db.close();
  }
});

test('bea yang dibatalkan berhenti mengurangi Net Profit, dan cache tanggalnya ikut dibuang', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };
    const kantor = storeId(db, 'KANTOR');
    const employeeId = seedEmployee(db, entityIdOf(db, 'KANTOR'));

    const createRes = await worker.fetch(request('/api/admin/operational-expenses', {
      token, store: 'KANTOR', method: 'POST', body: beaBody({ amount: 300000, businessDate: '2026-06-01', employeeId })
    }), env);
    const created = await createRes.json();

    const before = await getNetProfitReport(env.DB, { storeIds: [kantor], from: '2026-06-01', to: '2026-06-01', today: '2026-06-10' });
    assert.equal(before.netProfitByKey.get(`${kantor}::2026-06-01`), -300000);

    const voidRes = await worker.fetch(request(`/api/admin/operational-expenses/${created.id}/void`, {
      token, store: 'KANTOR', method: 'POST', body: { reason: 'salah input' }
    }), env);
    assert.equal(voidRes.status, 200);

    const after = await getNetProfitReport(env.DB, { storeIds: [kantor], from: '2026-06-01', to: '2026-06-01', today: '2026-06-10' });
    assert.equal(after.netProfitByKey.get(`${kantor}::2026-06-01`), 0);

    const second = await worker.fetch(request(`/api/admin/operational-expenses/${created.id}/void`, {
      token, store: 'KANTOR', method: 'POST', body: { reason: 'dobel' }
    }), env);
    assert.equal(second.status, 409, 'membatalkan dua kali harus ditolak');
  } finally {
    db.close();
  }
});

test('bea milik gerai lain tidak pernah ikut terhitung', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };
    const employeeId = seedEmployee(db, entityIdOf(db, 'PENDEM'));

    await worker.fetch(request('/api/admin/operational-expenses', {
      token, store: 'PENDEM', method: 'POST', body: beaBody({ amount: 999000, businessDate: '2026-06-01', employeeId })
    }), env);

    const kantor = await getNetProfitReport(env.DB, {
      storeIds: [storeId(db, 'KANTOR')], from: '2026-06-01', to: '2026-06-01', today: '2026-06-10'
    });
    assert.equal(kantor.netProfitByKey.get(`${storeId(db, 'KANTOR')}::2026-06-01`), 0);

    const pendem = await getNetProfitReport(env.DB, {
      storeIds: [storeId(db, 'PENDEM')], from: '2026-06-01', to: '2026-06-01', today: '2026-06-10'
    });
    assert.equal(pendem.netProfitByKey.get(`${storeId(db, 'PENDEM')}::2026-06-01`), -999000);
  } finally {
    db.close();
  }
});

test('tiga jenis bea diterima, jenis di luar daftar ditolak, nominal nol ditolak', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };
    const employeeId = seedEmployee(db, entityIdOf(db, 'KANTOR'));

    for (const category of ['BEA_GAJI', 'BEA_LAPAK', 'BEA_LAINNYA']) {
      const res = await worker.fetch(request('/api/admin/operational-expenses', {
        token, store: 'KANTOR', method: 'POST', body: beaBody({ category, amount: 10000, employeeId, counterpartyType: 'OTHER', counterpartyName: 'Pemilik Lapak' })
      }), env);
      assert.equal(res.status, 201, `${category} harus diterima`);
    }

    const unknown = await worker.fetch(request('/api/admin/operational-expenses', {
      token, store: 'KANTOR', method: 'POST', body: beaBody({ category: 'BEA_NGAWUR', employeeId })
    }), env);
    assert.equal(unknown.status, 400);
    assert.equal((await unknown.json()).code, 'UNKNOWN_BEA_CATEGORY');

    const zero = await worker.fetch(request('/api/admin/operational-expenses', {
      token, store: 'KANTOR', method: 'POST', body: beaBody({ amount: 0, employeeId })
    }), env);
    assert.equal(zero.status, 400);

    const listRes = await worker.fetch(request('/api/admin/operational-expenses', { token, store: 'KANTOR' }), env);
    const list = await listRes.json();
    assert.equal(list.expenses.length, 3);
    assert.deepEqual(list.categories.map(c => c.code), ['BEA_GAJI', 'BEA_LAPAK', 'BEA_LAINNYA']);
  } finally {
    db.close();
  }
});

test('Bea Gaji wajib memilih Karyawan, boleh nominal negatif (potongan); Bea Lapak/Lainnya tetap wajib positif tanpa Karyawan', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };
    const employeeId = seedEmployee(db, entityIdOf(db, 'KANTOR'));

    const noEmployee = await worker.fetch(request('/api/admin/operational-expenses', {
      token, store: 'KANTOR', method: 'POST', body: beaBody({ amount: 100000 })
    }), env);
    assert.equal(noEmployee.status, 400);
    assert.equal((await noEmployee.json()).code, 'BEA_GAJI_REQUIRES_EMPLOYEE');

    const outsideEntity = await worker.fetch(request('/api/admin/operational-expenses', {
      token, store: 'KANTOR', method: 'POST', body: beaBody({ amount: 100000, employeeId: 'emp_nonexistent' })
    }), env);
    assert.equal(outsideEntity.status, 404);
    assert.equal((await outsideEntity.json()).code, 'EMPLOYEE_OUT_OF_SCOPE');

    // Potongan gaji akibat pinalti -- Bos Cyo: "penambahan dan pengurangan
    // gaji akibat pinalti ... entry manual admin" -- nominal negatif wajib
    // diterima KHUSUS Bea Gaji.
    const potongan = await worker.fetch(request('/api/admin/operational-expenses', {
      token, store: 'KANTOR', method: 'POST',
      body: beaBody({ amount: -15000, description: 'Potongan: menghilangkan barang', employeeId })
    }), env);
    assert.equal(potongan.status, 201, JSON.stringify(await potongan.clone().json()));

    // Bea Lapak/Lainnya tetap wajib positif (bukan Bea Gaji, tidak dapat
    // pengecualian nominal negatif) dan tidak boleh menempel Karyawan.
    const lapakNegative = await worker.fetch(request('/api/admin/operational-expenses', {
      token, store: 'KANTOR', method: 'POST', body: beaBody({ category: 'BEA_LAPAK', amount: -5000 })
    }), env);
    assert.equal(lapakNegative.status, 400);

    const list = await (await worker.fetch(request('/api/admin/operational-expenses', { token, store: 'KANTOR' }), env)).json();
    const potonganRow = list.expenses.find(row => row.amount === -15000);
    assert.ok(potonganRow, 'baris potongan harus tersimpan');
    assert.equal(potonganRow.employeeId, employeeId);
    assert.ok(potonganRow.employeeName, 'nama karyawan harus ikut ditampilkan');
  } finally {
    db.close();
  }
});

test('Bea Operasional terdaftar sebagai sumber Beban di Laporan Net Profit', async () => {
  const source = readFileSync(new URL('../src/net-profit-report.js', import.meta.url), 'utf8');
  assert.match(source, /BEBAN_SOURCES = \['expenses', 'admin_operational_expenses', 'payroll_ledger_entries'\]/);
  assert.match(source, /FROM admin_operational_expenses/);
  assert.match(source, /FROM payroll_ledger_entries/);
  assert.match(source, /export async function invalidateDailyProfitSnapshot/);
});
