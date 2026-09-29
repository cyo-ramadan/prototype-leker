import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { listOrders } from '../src/db-multistore.js';

// Bos Cyo, 2026-09-22: kasir gerai Pendem tidak bisa masuk sama sekali,
// dan Entity Admin yang cuma "intip kasir" pun ikut terlempar ke halaman
// login. Tiga perbaikan sebelumnya (sesi persisten, race lease, fallback
// crypto.randomUUID) semuanya salah sasaran -- masalahnya bukan di login.
//
// Akar sebenarnya: D1 menolak statement dengan LEBIH DARI 100 bind
// variable ("too many SQL variables"). Dibuktikan langsung ke D1 produksi:
// 100 parameter lolos, 101 ditolak. listOrders() mengambil 100 pesanan
// terakhir, lalu rincian itemnya diambil sekaligus dengan bind
// (storeId + 100 order id) = 101 variable -- tepat lewat satu.
//
// Pendem punya 101 pesanan, satu-satunya gerai yang tembus 100 (Dermo 64,
// Beji 21). Jadi ini bukan keanehan Pendem, tapi bom waktu untuk SETIAP
// gerai begitu pesanannya menumpuk.

const migrationDir = new URL('../migrations/', import.meta.url);

// Batas bind variable D1 yang ditiru di sini. node:sqlite sendiri jauh lebih
// longgar, jadi kalau tidak dipaksa, test ini tidak akan pernah menangkap
// bug aslinya -- wrapper di bawah yang membuatnya berperilaku seperti D1.
const D1_MAX_BIND_VARIABLES = 100;

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) {
    if (params.length > D1_MAX_BIND_VARIABLES) {
      throw new Error('too many SQL variables: SQLITE_ERROR');
    }
    return new D1Statement(this.db, this.sql, params);
  }
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

function seedOrders(db, storeId, count) {
  const productId = db.prepare('SELECT id FROM products WHERE store_id = ? LIMIT 1').get(storeId)?.id;
  assert.ok(productId, 'butuh minimal satu barang di gerai untuk bikin order item');
  for (let index = 0; index < count; index += 1) {
    const orderId = `order_limit_${index}`;
    db.prepare(`
      INSERT INTO orders (id, store_id, business_date, order_no, customer_name, table_label, total_amount, status, created_at, updated_at)
      VALUES (?, ?, '2026-09-22', ?, 'Uji Batas Bind', '', 1000, 'COMPLETED', ?, ?)
    `).run(orderId, storeId, `UJI-${String(index).padStart(3, '0')}`, new Date(Date.now() + index * 1000).toISOString(), new Date().toISOString());
    db.prepare(`
      INSERT INTO order_items (order_id, store_id, product_id, product_name, unit_price, line_total, quantity, created_at)
      VALUES (?, ?, ?, 'Barang Uji', 1000, 1000, 1, ?)
    `).run(orderId, storeId, productId, new Date().toISOString());
  }
}

test('daftar pesanan tetap bisa dimuat walau pesanan gerai sudah tembus 100 -- batas bind variable D1 tidak boleh dilewati', async () => {
  const db = migratedDatabase();
  try {
    const storeId = db.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get().id;
    // 120 pesanan: listOrders membatasi ke 100 terakhir, dan justru 100 itu
    // yang dulu bikin bind jadi 101 (storeId + 100 order id) lalu meledak.
    seedOrders(db, storeId, 120);

    const orders = await listOrders(new D1Database(db), storeId);

    assert.equal(orders.length, 100, 'listOrders tetap membatasi 100 pesanan terakhir');
    // Yang paling penting: rincian itemnya benar-benar ikut termuat. Kalau
    // pemecahan per batch dicabut, baris di atas sudah melempar duluan.
    const withItems = orders.filter(order => order.items.length > 0);
    assert.equal(withItems.length, 100, 'setiap pesanan wajib membawa itemnya, tidak ada yang hilang gara-gara dipecah per batch');
    for (const order of orders) {
      assert.equal(order.items.length, 1);
      assert.equal(order.items[0].name, 'Barang Uji');
    }
  } finally {
    db.close();
  }
});

test('gerai yang pesanannya masih sedikit tidak ikut berubah perilakunya', async () => {
  const db = migratedDatabase();
  try {
    const storeId = db.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get().id;
    seedOrders(db, storeId, 3);

    const orders = await listOrders(new D1Database(db), storeId);

    assert.equal(orders.length, 3);
    for (const order of orders) assert.equal(order.items.length, 1);
  } finally {
    db.close();
  }
});

test('halaman kasir tidak menghapus sesi karyawan gara-gara gagal memuat data -- hanya penolakan identitas (401) yang mencabut sesi', () => {
  // Ini yang bikin bug di atas kelihatan seperti "tidak bisa login" dan
  // menyeret Entity Admin yang cuma mengintip halaman kasir ikut keluar:
  // dulu SEMUA error ditangkap `catch { clearSession(); }` tanpa dibedakan,
  // dan clearSession() menghapus seluruh token karyawan di browser.
  const cashierJs = readFileSync(new URL('../public/cashier.js', import.meta.url), 'utf8');
  const rawInitBody = cashierJs.slice(cashierJs.indexOf('async function init()'), cashierJs.indexOf('function persistStaffSessionAndReload'));
  // Komentar di fungsi ini sengaja mengutip bentuk kode LAMA sebagai catatan
  // sejarah, jadi baris komentar harus dibuang dulu -- kalau tidak, kutipan
  // itu sendiri yang kebaca dan bikin pemeriksaan di bawah salah menilai.
  const initBody = rawInitBody.replace(/^\s*\/\/.*$/gm, '');
  assert.match(initBody, /catch \(error\)/, 'error-nya wajib ditangkap dengan nama, bukan catch kosong yang menelan sebabnya');
  assert.match(initBody, /error\?\.status === 401/, 'sesi cuma boleh dicabut kalau server memang menolak identitasnya');
  assert.doesNotMatch(initBody, /\} catch \{\s*clearSession\(\);/, 'catch tanpa pembeda sebab tidak boleh balik lagi');
  const clearAt = initBody.indexOf('clearSession();');
  const guardAt = initBody.indexOf('error?.status === 401');
  assert.ok(guardAt > -1 && clearAt > guardAt, 'clearSession() wajib berada di dalam cabang 401, bukan di jalur error umum');
});
