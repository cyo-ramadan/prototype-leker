import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCashierPurchaseApi } from '../src/cashier-purchase.js';
import { handlePurchasePriceRangesApi, purchaseRangeViolation, rupiahSkala } from '../src/purchase-price-ranges.js';
import { hashCredential } from '../src/owner-auth.js';
import { cariAksi } from '../src/caca-aksi.js';
import { alatPasti } from '../src/caca-agen.js';
import { bangunJalurAksi } from '../src/caca-chat.js';
import { uraiDaftarRentang } from '../src/caca-aksi-rentang.js';

// Bos Cyo, 2026-10-04: rentang harga beli wajar per barang (harga benar ±25%).
// Pembelian kasir di luar rentang DITOLAK sebelum harga rata-rata ikut rusak.

const migrationDir = new URL('../migrations/', import.meta.url);
class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() { const result = this.db.prepare(this.sql).run(...this.params); return { success: true, meta: { changes: Number(result.changes || 0) } }; }
}
class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) {
    this.db.exec('BEGIN');
    try { const out = statements.map((s) => s.run()); this.db.exec('COMMIT'); return out; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  const pendem = db.prepare(`SELECT id FROM stores WHERE code = 'PENDEM'`).get();
  db.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, 'admin_pendem_pilot', '2026-06-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('rg-admin'));
  db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at) VALUES ('kasir_rg', 'rgkasir', 'x', 'Kasir RG', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(pendem.id);
  db.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, 'kasir_rg', '2026-09-24T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('rg-kasir'));
  db.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES ('drawer_rg', ?, 'kasir_rg', 0, 'OPEN', '2026-10-04T00:00:00.000Z')`).run(pendem.id);
  return { db, env: { DB: new D1Database(db) }, pendem };
}

const kasir = (env, pathname, body) => handleCashierPurchaseApi(new Request(`https://example.test${pathname}`, {
  method: body ? 'POST' : 'GET',
  headers: { Authorization: 'Bearer rg-kasir', ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined
}), env, pathname);

const admin = (env, method, body) => handlePurchasePriceRangesApi(new Request('https://example.test/api/admin/purchase-price-ranges?store=PENDEM', {
  method,
  headers: { Authorization: 'Bearer rg-admin', ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined
}), env, '/api/admin/purchase-price-ranges');

test('rupiahSkala dan pesan penolakan: titik ribuan, koma desimal, menyebut rentang dan yang diketik', () => {
  assert.equal(rupiahSkala(17_666_667n), 'Rp17,666667');
  assert.equal(rupiahSkala(18_000_000_000n), 'Rp18.000');
  const range = { minScaled: 13_250_000n, maxScaled: 22_083_334n };
  assert.equal(purchaseRangeViolation({ productName: 'Gula', unitSymbol: 'g', unitCostScaled: 17_500_000, quantity: 2000, lineTotal: 35000 }, range), null);
  const pesan = purchaseRangeViolation({ productName: 'Gula', unitSymbol: 'g', unitCostScaled: 18_000_000_000, quantity: 1, lineTotal: 18000 }, range);
  assert.match(pesan, /Gula Rp18\.000 per g terlalu mahal/);
  assert.match(pesan, /wajar Rp13,25–Rp22,083334 per g/);
  assert.match(pesan, /qty 1 g, total Rp18\.000/);
  assert.equal(purchaseRangeViolation({ productName: 'X', unitCostScaled: 1 }, undefined), null, 'tanpa rentang tidak dibatasi');
});

test('kasir: pembelian di luar rentang ditolak tanpa menulis apa pun; di dalam rentang tersimpan; barang lain bebas', async () => {
  const { db, env, pendem } = await setup();
  try {
    const options = await (await kasir(env, '/api/cashier/purchases/options')).json();
    const [gula, lain] = options.products;
    const simpan = await admin(env, 'POST', { items: [{ productId: gula.productId, min: '13.25', max: '22.083334', basis: '17.666667' }] });
    assert.equal(simpan.status, 200, JSON.stringify(await simpan.clone().json()));

    const optionsLagi = await (await kasir(env, '/api/cashier/purchases/options')).json();
    assert.deepEqual(optionsLagi.products.find((p) => p.productId === gula.productId).priceRange, { min: 'Rp13,25', max: 'Rp22,083334' }, 'kasir melihat rentangnya sebelum menyimpan');

    const sebelum = db.prepare('SELECT COUNT(*) AS n FROM purchases WHERE store_id = ?').get(pendem.id).n;
    const salah = await kasir(env, '/api/cashier/purchases', { paymentMethod: 'CASH', items: [{ productId: gula.productId, quantity: 1, lineTotal: 18000 }] });
    assert.equal(salah.status, 400);
    const body = await salah.json();
    assert.equal(body.code, 'PURCHASE_PRICE_OUT_OF_RANGE');
    assert.match(body.error, /terlalu mahal/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM purchases WHERE store_id = ?').get(pendem.id).n, sebelum, 'tidak ada pembelian yang tertulis');

    const murah = await kasir(env, '/api/cashier/purchases', { paymentMethod: 'CASH', items: [{ productId: gula.productId, quantity: 2000, lineTotal: 2000 }] });
    assert.equal(murah.status, 400);
    assert.match((await murah.json()).error, /terlalu murah/);

    const benar = await kasir(env, '/api/cashier/purchases', { paymentMethod: 'CASH', items: [{ productId: gula.productId, quantity: 2000, lineTotal: 35000 }] });
    assert.equal(benar.status, 201, JSON.stringify(await benar.clone().json()));

    const bebas = await kasir(env, '/api/cashier/purchases', { paymentMethod: 'CASH', items: [{ productId: lain.productId, quantity: 1, lineTotal: 999999 }] });
    assert.equal(bebas.status, 201, 'barang tanpa rentang tidak dibatasi');
  } finally { db.close(); }
});

test('admin: GET menampilkan rentang; POST menolak batas terbalik, barang gerai lain, dan tanpa login', async () => {
  const { db, env } = await setup();
  try {
    const options = await (await kasir(env, '/api/cashier/purchases/options')).json();
    const id = options.products[0].productId;
    assert.equal((await admin(env, 'POST', { items: [{ productId: id, min: '20', max: '10' }] })).status, 400);
    const dermoProduct = db.prepare(`SELECT p.id FROM products p JOIN stores s ON s.id = p.store_id WHERE s.code = 'DERMO' LIMIT 1`).get();
    if (dermoProduct) assert.equal((await admin(env, 'POST', { items: [{ productId: dermoProduct.id, min: '1', max: '2' }] })).status, 400);
    await admin(env, 'POST', { items: [{ productId: id, min: '1125', max: '1875', basis: '1500' }] });
    const list = await (await admin(env, 'GET')).json();
    assert.deepEqual(list.items.map((i) => [i.productId, i.min, i.max]), [[id, 'Rp1.125', 'Rp1.875']]);
    const tanpaLogin = await handlePurchasePriceRangesApi(new Request('https://example.test/api/admin/purchase-price-ranges?store=PENDEM'), env, '/api/admin/purchase-price-ranges');
    assert.equal(tanpaLogin.status, 401);
  } finally { db.close(); }
});

test('admin: batas bawah DAN atas kosong = rentang barang itu dihapus (barang kembali tanpa batas)', async () => {
  const { db, env } = await setup();
  try {
    const options = await (await kasir(env, '/api/cashier/purchases/options')).json();
    const [a, b] = options.products.map((p) => p.productId);
    await admin(env, 'POST', { items: [{ productId: a, min: '1', max: '2' }, { productId: b, min: '3', max: '4' }] });
    const hapus = await (await admin(env, 'POST', { items: [{ productId: a, min: '', max: '' }] })).json();
    assert.deepEqual([hapus.saved, hapus.removed], [0, 1]);
    const list = await (await admin(env, 'GET')).json();
    assert.deepEqual(list.items.map((i) => i.productId), [b], 'hanya barang yang dikosongkan yang hilang rentangnya');
    assert.equal((await admin(env, 'POST', { items: [{ productId: b, min: '3', max: '' }] })).status, 400, 'satu sisi kosong tetap ditolak, bukan dianggap hapus');
  } finally { db.close(); }
});

// Bos Cyo, 2026-10-04: "di settingan manusia udah ada, yang aku minta agar si una bisa
// kerjakan itu". Versi Karen (min/max di kolom products, 2 Sep) tidak pernah digabung ke
// main; yang live adalah satu tempat simpan dengan dua pintu: isian Master Barang + Una.
test('Master Barang punya isian harga beli wajar yang menulis ke tempat simpan yang sama dengan alat Una', () => {
  const ui = readFileSync(new URL('../public/admin-product-policy.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
  const una = readFileSync(new URL('../src/caca-aksi-rentang.js', import.meta.url), 'utf8');
  assert.match(ui, /id="productRangeMin"/);
  assert.match(ui, /id="productRangeMax"/);
  assert.match(ui, /api\('\/api\/admin\/purchase-price-ranges', \{\s*method: 'POST'/, 'isian manusia menyimpan lewat endpoint rentang');
  assert.match(una, /const JALUR = '\/api\/admin\/purchase-price-ranges'/, 'alat Una memakai endpoint yang sama');
  assert.match(ui, /MAXIAngka\?\.pasang\(input, \{ desimal: true/, 'aturan isian sama dengan kasir: titik tidak bisa diketik, koma desimal');
  assert.match(ui, /\(hpp \* BigInt\(angka\) \+ 50n\) \/ 100n/, '±25% dari HPP dihitung integer skala, bukan float');
  const angka = html.indexOf('/angka-input.js');
  const policy = html.indexOf('/admin-product-policy.js?v=20261005-range-pagar-v1');
  assert.ok(angka > -1 && policy > angka, 'angka-input.js dimuat sebelum admin-product-policy.js (dan versinya dibump)');
  assert.doesNotMatch(ui, /min_purchase_price_scaled|minPurchasePrice/, 'tidak memakai kolom versi Karen yang tidak pernah live');
});

// ---- Alat Una -----------------------------------------------------------------

const BLOK = `Una, atur rentang harga beli MANDALA, boleh selisih 25% dari harga benar:
1. Gula = 17,666667 per pcs
2. Teh Vanilla = 1500 per pcs
3. Air Mineral = 0,4375 per ml`;

function ctxUna(terkirim = []) {
  const products = [
    { id: 1, name: 'Gula', isActive: true, unitSymbol: 'pcs' },
    { id: 2, name: 'Teh Vanilla', isActive: true, unitSymbol: 'pcs' },
    { id: 3, name: 'Air Mineral', isActive: true, unitSymbol: 'ml' }
  ];
  return {
    lingkup: 'gerai', namaLingkup: 'Mandala', hariIni: '2026-10-04', pesan: BLOK,
    baca: async () => ({ ok: true, data: { products } }),
    kirim: async (method, path, body) => { terkirim.push({ method, path, body }); return { ok: true, data: { ok: true } }; }
  };
}

test('Una: blok rentang dikenali kode, ±25% dihitung integer skala (half-up), satu POST', async () => {
  assert.equal(alatPasti(BLOK), 'atur_rentang_harga_beli');
  assert.equal(uraiDaftarRentang(BLOK).persen, 25);
  const aksi = cariAksi('atur_rentang_harga_beli');
  const terkirim = [];
  const ctx = ctxUna(terkirim);
  const { ok, draft } = await aksi.siapkan({}, ctx);
  assert.equal(ok, true);
  assert.deepEqual(draft.muatan.daftar.map((b) => [b.name, b.minScaled, b.maxScaled, b.basisScaled]), [
    ['Gula', '13250000', '22083334', '17666667'],
    ['Teh Vanilla', '1125000000', '1875000000', '1500000000'],
    ['Air Mineral', '328125', '546875', '437500']
  ]);
  assert.deepEqual(draft.tabel.isi[0], ['Gula', 'Rp17,666667/pcs', 'Rp13,25/pcs', 'Rp22,083334/pcs']);
  const hasil = await aksi.posting(draft, ctx);
  assert.equal(hasil.ok, true);
  assert.equal(terkirim.length, 1);
  assert.equal(terkirim[0].path, '/api/admin/purchase-price-ranges');
  assert.deepEqual(terkirim[0].body.items[0], { productId: 1, min: '13.25', max: '22.083334', basis: '17.666667' });
});

test('Una: rentang ditulis langsung dan persen lain', async () => {
  const aksi = cariAksi('atur_rentang_harga_beli');
  const ctx = { ...ctxUna(), pesan: 'Una, atur rentang harga beli:\nGula = 15 - 20 per pcs\nTeh Vanilla = 1.400 - 1.600' };
  const { draft } = await aksi.siapkan({}, ctx);
  assert.deepEqual(draft.muatan.daftar.map((b) => [b.minScaled, b.maxScaled, b.basisScaled]), [['15000000', '20000000', null], ['1400000000', '1600000000', null]]);
  const sepuluh = await aksi.siapkan({}, { ...ctxUna(), pesan: 'Una, atur rentang harga beli, toleransi 10%:\nGula = 20' });
  assert.deepEqual([sepuluh.draft.muatan.daftar[0].minScaled, sepuluh.draft.muatan.daftar[0].maxScaled], ['18000000', '22000000']);
});

test('jalur Una sungguhan mengizinkan endpoint rentang', async () => {
  const jalur = bangunJalurAksi(new Request('https://example.test/api/caca/catat'), {}, {
    storeCode: 'MANDALA',
    jalurUtama: async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  });
  assert.equal((await jalur.kirim('POST', '/api/admin/purchase-price-ranges', { items: [] })).ok, true);
});

test('semua blok di INSTRUKSI-UNA-RENTANG-HARGA-BELI.md dikenali kode: alat, persen 25, dan semua baris', () => {
  const doc = readFileSync(new URL('../INSTRUKSI-UNA-RENTANG-HARGA-BELI.md', import.meta.url), 'utf8');
  const blok = [...doc.matchAll(/```\n(Una, atur rentang harga beli [\s\S]*?)\n```/g)].map((m) => m[1]);
  assert.ok(blok.length >= 5, `blok ditemukan: ${blok.length}`);
  for (const isi of blok) {
    assert.equal(alatPasti(isi), 'atur_rentang_harga_beli', isi.split('\n')[0]);
    const { daftar, persen } = uraiDaftarRentang(isi);
    assert.equal(persen, 25);
    assert.equal(daftar.length, isi.split('\n').filter((b) => /^\d+\. /.test(b)).length, isi.split('\n')[0]);
    assert.ok(daftar.every((b) => b.harga && !b.min), 'blok memakai harga acuan, bukan rentang langsung');
  }
});

// Mandala, 5 Okt 2026: akun admin mengetik batas atas Gula Rp40.000 per gram (harga wajar sekitar Rp18),
// pembelian salah ketik "2 g Rp36.000" lolos, HPP melonjak 1.000x dan SO+ membuat untung palsu ±Rp36 juta.
test('admin: batas yang menjauh lebih dari 3x dari acuan/HPP ditolak 409 RANGE_TOO_WIDE kecuali dikonfirmasi; tanpa penulisan', async () => {
  const { db, env } = await setup();
  try {
    const options = await (await kasir(env, '/api/cashier/purchases/options')).json();
    const id = options.products[0].productId;
    const pendem = db.prepare(`SELECT id FROM stores WHERE code = 'PENDEM'`).get();
    const jumlah = () => db.prepare('SELECT COUNT(*) AS n FROM product_purchase_price_ranges WHERE store_id = ?').get(pendem.id).n;

    // dengan acuan: batas atas 40.000 untuk acuan 17,5 => ditolak
    const longgar = await admin(env, 'POST', { items: [{ productId: id, min: '13.25', max: '40000', basis: '17.5' }] });
    assert.equal(longgar.status, 409);
    const body = await longgar.json();
    assert.equal(body.code, 'RANGE_TOO_WIDE');
    assert.match(body.error, /jauh dari harga acuan/);
    assert.equal(jumlah(), 0, 'ditolak sebelum menulis apa pun');

    // tanpa acuan, memakai HPP sekarang (barang punya HPP 18)
    db.prepare('UPDATE products SET average_cost = 18000000 WHERE id = ?').run(id);
    assert.equal((await admin(env, 'POST', { items: [{ productId: id, min: '13.25', max: '40000' }] })).status, 409);
    assert.equal((await admin(env, 'POST', { items: [{ productId: id, min: '1', max: '30' }] })).status, 409, 'batas bawah di bawah sepertiga acuan juga ditolak');

    // ±25% (cara Una) dan batas wajar lolos tanpa konfirmasi
    assert.equal((await admin(env, 'POST', { items: [{ productId: id, min: '13.5', max: '22.5' }] })).status, 200);

    // konfirmasi eksplisit membolehkan
    assert.equal((await admin(env, 'POST', { items: [{ productId: id, min: '13.5', max: '40000' }], confirmWide: true })).status, 200);
    assert.equal(jumlah(), 1);
  } finally { db.close(); }
});

test('Master Barang menanyakan konfirmasi saat server menjawab RANGE_TOO_WIDE (tidak diam-diam)', () => {
  const ui = readFileSync(new URL('../public/admin-product-policy.js', import.meta.url), 'utf8');
  assert.match(ui, /error\.code !== 'RANGE_TOO_WIDE' \|\| !window\.confirm\(/);
  assert.match(ui, /confirmWide: true/);
});

// Penahan lonjakan HPP (5 Okt 2026): barang tanpa rentang ditolak kalau harga per satuan >3x atau <1/3x HPP sekarang.
test('kasir: barang tanpa rentang ditolak PURCHASE_PRICE_JUMP kalau harga per satuan menjauh >3x dari HPP; rentang Admin didahulukan', async () => {
  const { db, env, pendem } = await setup();
  try {
    const options = await (await kasir(env, '/api/cashier/purchases/options')).json();
    const gula = options.products[0];
    db.prepare('UPDATE products SET average_cost = 18000000 WHERE id = ?').run(gula.productId);
    const sebelum = db.prepare('SELECT COUNT(*) AS n FROM purchases WHERE store_id = ?').get(pendem.id).n;

    const salahKetik = await kasir(env, '/api/cashier/purchases', { paymentMethod: 'CASH', items: [{ productId: gula.productId, quantity: 2, lineTotal: 36000 }] });
    assert.equal(salahKetik.status, 400);
    const body = await salahKetik.json();
    assert.equal(body.code, 'PURCHASE_PRICE_JUMP');
    assert.match(body.error, /jauh dari HPP sekarang Rp18 per/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM purchases WHERE store_id = ?').get(pendem.id).n, sebelum, 'tidak ada yang tertulis');

    const benar = await kasir(env, '/api/cashier/purchases', { paymentMethod: 'CASH', items: [{ productId: gula.productId, quantity: 2000, lineTotal: 36000 }] });
    assert.equal(benar.status, 201, JSON.stringify(await benar.clone().json()));

    // Rentang dari Admin yang (dengan sengaja, dikonfirmasi) lebar menang atas penahan HPP.
    await admin(env, 'POST', { items: [{ productId: gula.productId, min: '13', max: '20000' }], confirmWide: true });
    const lewatRentang = await kasir(env, '/api/cashier/purchases', { paymentMethod: 'CASH', items: [{ productId: gula.productId, quantity: 1, lineTotal: 19000 }] });
    assert.equal(lewatRentang.status, 201);
  } finally { db.close(); }
});
