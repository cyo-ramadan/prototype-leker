import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { analyzeHpp, loadHppAuditInput } from '../src/hpp-audit.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-10-03: "una bisa beresin hpp anomali dan hitung ulang dari
// september". Angka di bawah meniru bukti produksi 2026-10-03 (lihat
// KOREKSI-HPP-2026-10-02.md): salah kemasan (qty 1 untuk 1.000 g), nominal
// salah ketik (Rp19.000.000 untuk 1.000 g), dan harga yang meracuni larutan.

const S = rupiah => Math.round(rupiah * 1_000_000);
const FROM = '2026-09-01';

const raw = (id, name, avg, unit = 'g', typeCode = 'RAW_MATERIAL') => ({ id, name, averageCostScaled: S(avg), typeCode, unit });
const line = (productId, quantity, total, date = '2026-09-26') => ({ productId, quantity, total, date });
const siblingGula = [17.5, 17.499993, 17.5, 19, 17.5].map(avg => ({ name: 'Gula', averageCostScaled: S(avg), unit: 'g' }));

test('salah kemasan dan nominal salah ketik: harga benar dari pembelian wajar, bukti menandai baris janggal', () => {
  const result = analyzeHpp({
    products: [raw(1, 'Gula', 14417.638679)],
    lines: [
      line(1, 1000, 18500), line(1, 2000, 38000), line(1, 2000, 38000), line(1, 2000, 38000), line(1, 1000, 19000),
      line(1, 1, 19000), line(1, 1000, 19000000)
    ],
    recipes: [], siblings: siblingGula, from: FROM
  });
  assert.equal(result.corrections.length, 1);
  const c = result.corrections[0];
  assert.equal(c.kind, 'BAHAN_BAKU');
  assert.equal(c.proposedRupiah, '18.9375'); // (18500+38000*3+19000) / 8000 g
  assert.equal(c.confidence, 'TINGGI');
  assert.equal(c.source, 'PEMBELIAN');
  assert.equal(c.evidence.pembelianJanggal, 2);
  const janggal = c.evidence.baris.filter(row => row.janggal);
  assert.deepEqual(janggal.map(row => row.quantity).sort((a, b) => a - b), [1, 1000]);
  assert.equal(janggal.find(row => row.quantity === 1).jumlahSeharusnya, 1003, 'Rp19.000 pada Rp18,94/g = sekitar 1.003 g, bukan 1');
  assert.deepEqual(c.command, { alat: 'hitung_ulang_hpp', parameter: { hpp_bahan: 'Gula', hpp_harga: '18.9375', hpp_dari: FROM } });
});

test('pembelian satu gerai kebanyakan salah (MANDALA): acuan lintas gerai menang atas median sendiri', () => {
  const result = analyzeHpp({
    products: [raw(1, 'Gula', 18000, 'pcs', 'FINISHED_GOOD')],
    lines: [line(1, 2000, 35000), line(1, 1, 18000), line(1, 1, 18000), line(1, 1, 18000), line(1, 1, 18000), line(1, 1000, 18000), line(1, 2, 36000)],
    recipes: [], siblings: siblingGula, from: FROM
  });
  const c = result.corrections.find(item => item.name === 'Gula');
  assert.equal(c.proposedRupiah, '17.666667', 'dua pembelian wajar: (35000+18000)/3000 g');
  assert.equal(c.evidence.pembelianJanggal, 5);
  assert.equal(c.evidence.acuanLintasGerai, '17.5');
});

test('tanpa pembelian wajar sama sekali: harga dari gerai lain, keyakinan SEDANG', () => {
  const siblingAir = [0.4227, 0.5, 0.4375, 0.3538].map(avg => ({ name: 'Air Mineral', averageCostScaled: S(avg), unit: 'ml' }));
  const result = analyzeHpp({
    products: [raw(1, 'Air Mineral', 6.295733, 'ml')],
    lines: [line(1, 2, 14000)],
    recipes: [], siblings: siblingAir, from: FROM
  });
  const c = result.corrections[0];
  assert.equal(c.source, 'GERAI_LAIN');
  assert.equal(c.confidence, 'SEDANG');
  assert.equal(c.proposedRupiah, '0.4301', 'median 4 gerai = (0.4227+0.4375)/2');
});

test('harga rata-rata sudah wajar: tidak ada koreksi; pembelian janggal hanya jadi catatan stok', () => {
  const result = analyzeHpp({
    products: [raw(1, 'Gula', 17.5)],
    lines: [line(1, 1000, 17500), line(1, 2000, 35000), line(1, 1000, 17500), line(1, 1, 17500)],
    recipes: [], siblings: siblingGula, from: FROM
  });
  assert.deepEqual(result.corrections, []);
  assert.equal(result.notes.length, 1);
  assert.match(result.notes[0].message, /opname/);
});

test('HPP nol: ada bukti -> usul harga; dipakai resep tanpa bukti -> tanya Bos Cyo', () => {
  const result = analyzeHpp({
    products: [raw(1, 'Gula', 0), raw(2, 'Bubuk Misterius', 0)],
    lines: [line(1, 1000, 17500), line(1, 2000, 35000), line(1, 1000, 17500)],
    recipes: [
      { recipeId: 'r1', outputId: 10, outputQty: 1, componentId: 1, qty: 10 },
      { recipeId: 'r1', outputId: 10, outputQty: 1, componentId: 2, qty: 5 }
    ],
    siblings: [], from: FROM
  });
  assert.equal(result.corrections.find(item => item.productId === 1).proposedRupiah, '17.5');
  assert.deepEqual(result.needsPrice.map(item => [item.productId, item.reason]), [[2, 'NOL_TANPA_BUKTI']]);
});

test('dua pembelian saling bertentangan tanpa pembanding: tidak menebak, minta keputusan', () => {
  const result = analyzeHpp({
    products: [raw(1, 'Teh Aneh', 5000, 'pcs')],
    lines: [line(1, 40, 60000), line(1, 1, 60000000)],
    recipes: [], siblings: [], from: FROM
  });
  assert.deepEqual(result.corrections, []);
  assert.equal(result.needsPrice[0].reason, 'BUKTI_BERTENTANGAN');
});

test('barang olahan dihitung dari resep x harga bahan YANG SUDAH DIKOREKSI, urut bahan dulu baru olahan', () => {
  const result = analyzeHpp({
    products: [raw(1, 'Gula', 14417.638679), raw(2, 'Air Mineral', 0.5, 'ml'), raw(3, 'Larutan Gula', 11429.89, 'ml', 'SEMI_FINISHED'), raw(4, 'Es Gula', 0, 'pcs', 'FINISHED_GOOD')],
    lines: [line(1, 1000, 18500), line(1, 2000, 38000), line(1, 2000, 38000), line(1, 1, 19000), line(1, 1000, 19000)],
    recipes: [
      { recipeId: 'rl', outputId: 3, outputQty: 160, componentId: 2, qty: 100 },
      { recipeId: 'rl', outputId: 3, outputQty: 160, componentId: 1, qty: 100 },
      { recipeId: 'rj', outputId: 4, outputQty: 1, componentId: 3, qty: 30 }
    ],
    siblings: siblingGula, from: FROM
  });
  assert.deepEqual(result.corrections.map(item => [item.order, item.kind, item.name, item.level]), [[1, 'BAHAN_BAKU', 'Gula', 0], [2, 'OLAHAN', 'Larutan Gula', 1]]);
  const larutan = result.corrections[1];
  // Gula benar = (18500+38000+38000+19000)/6000 = 18.9166667 -> 18.916667 ; (100*0.5 + 100*18.916667)/160
  assert.equal(larutan.proposedRupiah, '12.135417');
  assert.deepEqual(larutan.after, [1]);
  assert.equal(larutan.confidence, 'TINGGI_SETELAH_BAHAN_DIKOREKSI');
  assert.equal(larutan.evidence.bahan.find(item => item.name === 'Gula').dikoreksi, true);
  assert.equal(result.corrections.some(item => item.name === 'Es Gula'), false, 'barang jadi dijual tidak diaudit sebagai olahan');
});

test('olahan yang sudah sesuai resep (dalam 10%) tidak dikoreksi; bahan tanpa harga membuat olahan menunggu', () => {
  const ok = analyzeHpp({
    products: [raw(2, 'Air Mineral', 0.5, 'ml'), raw(1, 'Gula', 17.5), raw(3, 'Larutan Gula', 11.2, 'ml', 'SEMI_FINISHED')],
    lines: [],
    recipes: [
      { recipeId: 'rl', outputId: 3, outputQty: 160, componentId: 2, qty: 100 },
      { recipeId: 'rl', outputId: 3, outputQty: 160, componentId: 1, qty: 100 }
    ],
    siblings: [], from: FROM
  });
  assert.deepEqual(ok.corrections, []);

  const waiting = analyzeHpp({
    products: [raw(2, 'Air Mineral', 0.5, 'ml'), raw(1, 'Gula', 0), raw(3, 'Larutan Gula', 0.14, 'ml', 'SEMI_FINISHED')],
    lines: [],
    recipes: [
      { recipeId: 'rl', outputId: 3, outputQty: 160, componentId: 2, qty: 100 },
      { recipeId: 'rl', outputId: 3, outputQty: 160, componentId: 1, qty: 100 }
    ],
    siblings: [], from: FROM
  });
  assert.deepEqual(waiting.needsPrice.map(item => [item.name, item.reason]).sort(), [['Gula', 'NOL_TANPA_BUKTI'], ['Larutan Gula', 'BAHAN_BELUM_ADA_HARGA']]);
});

test('tipe dan satuan yang mencurigakan hanya ditandai, tidak pernah diubah', () => {
  const result = analyzeHpp({
    products: [raw(1, 'Gula', 17.5, 'pcs', 'FINISHED_GOOD'), raw(3, 'Larutan', 5, 'ml', 'SEMI_FINISHED')],
    lines: [],
    recipes: [{ recipeId: 'rl', outputId: 3, outputQty: 1, componentId: 1, qty: 1 }],
    siblings: siblingGula, from: FROM
  });
  assert.deepEqual(result.typeIssues.map(item => item.kind).sort(), ['SATUAN', 'TIPE']);
});

test('acuan lintas gerai dihitung per gerai: satu gerai yang salah catat berkali-kali tetap hanya satu suara', () => {
  // Meniru Teh Vanilla: PENDEM mencatat Rp40 tiga kali, GENENGAN dan SUGIONO benar Rp1.500.
  const siblingLines = [
    ...[1, 2, 3].map(() => ({ storeKey: 'PENDEM', name: 'Teh Vanilla', quantity: 1, total: 40 })),
    { storeKey: 'GENENGAN', name: 'Teh Vanilla', quantity: 40, total: 60000 },
    { storeKey: 'SUGIONO', name: 'Teh Vanilla', quantity: 40, total: 60000 },
    { storeKey: 'KALIURANG', name: 'Teh Vanilla', quantity: 12, total: 18000 }
  ];
  const result = analyzeHpp({
    products: [raw(1, 'Teh Vanilla', 1413.461538, 'pcs')],
    lines: [line(1, 12, 18000), line(1, 40, 60000)],
    recipes: [], siblings: [], siblingLines, from: FROM
  });
  assert.deepEqual(result.corrections, [], 'BEJI-style: HPP sudah wajar, tidak boleh diusulkan turun ke Rp40');

  const poisoned = analyzeHpp({
    products: [raw(1, 'Teh Vanilla', 0, 'pcs')],
    lines: [], recipes: [{ recipeId: 'r', outputId: 9, outputQty: 1, componentId: 1, qty: 1 }],
    siblings: [], siblingLines, from: FROM
  });
  assert.equal(poisoned.corrections[0].proposedRupiah, '1500');
  assert.equal(poisoned.corrections[0].needsConfirmation, true, 'usulan dari gerai lain butuh konfirmasi');
});

test('bukti yang berserakan jauh dan tanpa acuan (Adonan Leker DERMO): tidak menebak, tanya Bos Cyo', () => {
  const result = analyzeHpp({
    products: [raw(1, 'Adonan Leker', 97.2398, 'Rp')],
    lines: [line(1, 1, 10000), line(1, 1000000, 1000000), line(1, 1, 186000), line(1, 1, 100000), line(1, 1000, 1_000_000_000), line(1, 1000, 100_000_000)],
    recipes: [], siblings: [], from: FROM
  });
  assert.deepEqual(result.corrections, []);
  assert.equal(result.needsPrice[0].reason, 'BUKTI_BERTENTANGAN');
});

test('usulan dari pembelian sendiri yang kuat tidak butuh konfirmasi; olahan ikut butuh konfirmasi kalau bahannya belum pasti', () => {
  const result = analyzeHpp({
    products: [raw(1, 'Gula', 14417.638679), raw(2, 'Teh', 0, 'pcs'), raw(3, 'Larutan', 5000, 'ml', 'SEMI_FINISHED')],
    lines: [line(1, 1000, 18500), line(1, 2000, 38000), line(1, 2000, 38000), line(1, 1, 19000)],
    recipes: [
      { recipeId: 'rl', outputId: 3, outputQty: 10, componentId: 1, qty: 5 },
      { recipeId: 'rl', outputId: 3, outputQty: 10, componentId: 2, qty: 1 }
    ],
    siblings: siblingGula,
    siblingLines: [
      ...['A', 'B', 'C'].map(storeKey => ({ storeKey, name: 'Teh', quantity: 40, total: 60000 }))
    ],
    from: FROM
  });
  const gula = result.corrections.find(item => item.name === 'Gula');
  const teh = result.corrections.find(item => item.name === 'Teh');
  const larutan = result.corrections.find(item => item.name === 'Larutan');
  assert.equal(gula.needsConfirmation, false);
  assert.equal(teh.needsConfirmation, true);
  assert.equal(larutan.needsConfirmation, true, 'olahan bergantung pada harga Teh yang belum pasti');
});

// --- lewat database sungguhan (skema migration) dan endpoint ------------------

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() { const r = this.db.prepare(this.sql).run(...this.params); return { success: true, meta: { changes: Number(r.changes || 0) } }; }
}
class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) { return statements.map(statement => statement.run()); }
}

async function seededDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_aud', 'owner_aud', 'x', 'Owner')`).run();
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_aud', '2026-09-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('owner-aud'));
  db.prepare(`INSERT INTO units (id, store_id, code, name, symbol, decimal_scale) VALUES ('unit_aud_g', 'store_kantor', 'GRAM_UJI', 'Gram Uji', 'g', 0)`).run();
  const rawType = db.prepare(`SELECT id FROM item_types WHERE store_id = 'store_kantor' AND code = 'RAW_MATERIAL'`).get();
  db.prepare(`INSERT INTO products (id, store_id, name, price, category, base_unit_id, item_type_id, average_cost, stock_tracking_enabled) VALUES (9001, 'store_kantor', 'Gula Uji', 0, 'Uji', 'unit_aud_g', ?, ?, 0)`).run(rawType.id, 14_417_638_679);
  db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at) VALUES ('kasir_aud', 'kasir_aud', 'x', 'Kasir', 'store_kantor', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run();
  db.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES ('laci_aud', 'store_kantor', 'kasir_aud', 0, 'OPEN', CURRENT_TIMESTAMP)`).run();
  let n = 0;
  const buy = (qty, total, voided = false) => {
    n += 1;
    db.prepare(`INSERT INTO purchases (id, store_id, drawer_session_id, cashier_id, description, total_amount, created_at, voided_at) VALUES (?, 'store_kantor', 'laci_aud', 'kasir_aud', 'Uji', ?, '2026-09-26T05:00:00.000Z', ?)`).run(`pur_aud_${n}`, total, voided ? '2026-09-27T00:00:00.000Z' : null);
    db.prepare(`INSERT INTO purchase_items (id, purchase_id, store_id, product_id, product_name, unit_id, unit_symbol, quantity, line_total, unit_cost, average_cost_before, average_cost_after, created_at) VALUES (?, ?, 'store_kantor', 9001, 'Gula Uji', 'unit_aud_g', 'g', ?, ?, 0, 0, 0, '2026-09-26T05:00:00.000Z')`).run(`pi_aud_${n}`, `pur_aud_${n}`, qty, total);
  };
  buy(1000, 18500); buy(2000, 38000); buy(2000, 38000); buy(1, 19000);
  buy(1000, 19000000, true); // dibatalkan: tidak boleh dihitung sebagai bukti
  return db;
}

test('endpoint: membaca skema nyata, pembelian batal tidak jadi bukti, hasil bisa langsung dipakai hitung_ulang_hpp', async () => {
  const db = await seededDb();
  try {
    const loaded = await loadHppAuditInput(new D1Database(db), { id: 'store_kantor' });
    assert.equal(loaded.lines.length, 4, 'pembelian dibatalkan dibuang');

    const url = new URL('https://example.test/api/admin/hpp-audit');
    url.searchParams.set('store', 'KANTOR');
    url.searchParams.set('from', '2026-09-01');
    const res = await worker.fetch(new Request(url, { headers: { authorization: 'Bearer owner-aud' } }), { DB: new D1Database(db) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.contract, 'MAXI_HPP_AUDIT_V1');
    assert.equal(body.store.code, 'KANTOR');
    assert.equal(body.corrections.length, 1);
    const c = body.corrections[0];
    assert.equal(c.name, 'Gula Uji');
    assert.equal(c.proposedRupiah, '18.9');
    assert.equal(c.command.parameter.hpp_dari, '2026-09-01');
    assert.equal(c.evidence.pembelianJanggal, 1);
    assert.ok(body.howTo.length > 0);
  } finally { db.close(); }
});

test('endpoint: tanpa login ditolak dan tanggal mulai bawaan adalah awal bulan lalu', async () => {
  const db = await seededDb();
  try {
    const url = new URL('https://example.test/api/admin/hpp-audit');
    url.searchParams.set('store', 'KANTOR');
    assert.equal((await worker.fetch(new Request(url), { DB: new D1Database(db) })).status, 401);
    const res = await worker.fetch(new Request(url, { headers: { authorization: 'Bearer owner-aud' } }), { DB: new D1Database(db) });
    const body = await res.json();
    assert.match(body.from, /^\d{4}-\d{2}-01$/);
  } finally { db.close(); }
});
