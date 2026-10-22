import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { executeTransactionCorrection } from '../src/transaction-correction-executor.js';
import { purchaseItemStatements, scaledUnitCost } from '../src/cashier-purchase.js';
import {
  dalamJamSepi, hitungPutarUlang, rataRataSesudahBeli, terapkanPutarUlangIzin, STATUS_MENUNGGU, STATUS_SELESAI, STATUS_TERTAHAN
} from '../src/hpp-putar-ulang.js';
import { cariAksi } from '../src/caca-aksi.js';
import { PINTU_AKSI } from '../src/caca-chat.js';

// Bos Cyo, 2026-10-21 -- Air Mineral Kaliurang: pembelian Rp19.000 salah ketik, input ulang Rp12.996,
// ACC hapus tertahan (HOLD) karena ada pembelian sesudahnya, dan laci tetap salah. Tes ini memutar
// ulang kejadian itu dengan angka aslinya.

const migrationDir = new URL('../migrations/', import.meta.url);
const d1Result = result => ({ success: true, meta: { changes: Number(result?.changes || 0) } });
function d1(sqlite) {
  const prepare = sql => {
    const statement = sqlite.prepare(sql);
    return {
      bind(...args) {
        return {
          _statement: statement,
          _args: args,
          async first() { return statement.get(...args) || null; },
          async all() { return { results: statement.all(...args) }; },
          async run() { return d1Result(statement.run(...args)); }
        };
      }
    };
  };
  return {
    prepare,
    async batch(bound) {
      sqlite.exec('BEGIN');
      try {
        const results = bound.map(item => d1Result(item._statement.run(...item._args)));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  const db = d1(sqlite);
  const store = sqlite.prepare('SELECT id FROM stores ORDER BY id LIMIT 1').get();
  const cashier = sqlite.prepare('SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1').get(store.id);
  const product = sqlite.prepare(`
    SELECT p.id, p.name, p.base_unit_id, u.symbol FROM products p JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    WHERE p.store_id = ? ORDER BY p.id LIMIT 1
  `).get(store.id);
  sqlite.prepare('UPDATE products SET item_type_id = NULL, stock_tracking_enabled = 1, average_cost = 363500 WHERE id = ?').run(product.id);
  sqlite.prepare(`INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at) VALUES (?, ?, 24000, '2026-10-21T00:00:00.000Z')`).run(store.id, product.id);
  const drawerId = `drawer_${crypto.randomUUID()}`;
  sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES (?, ?, ?, 100000, 'OPEN', '2026-10-21T02:00:00.000Z')`)
    .run(drawerId, store.id, cashier.id);
  return { sqlite, db, store: { id: store.id }, storeId: store.id, cashierId: cashier.id, product, drawerId };
}

async function beli(f, lineTotal, quantity, at) {
  const id = `purchase_${crypto.randomUUID()}`;
  f.sqlite.prepare(`
    INSERT INTO purchases (id, store_id, drawer_session_id, cashier_id, description, total_amount, note, created_at, payment_method)
    VALUES (?, ?, ?, ?, 'Pembelian Air Mineral', ?, '', ?, 'CASH')
  `).run(id, f.storeId, f.drawerId, f.cashierId, lineTotal, at);
  await f.db.batch(purchaseItemStatements(f.db, {
    purchaseId: id, storeId: f.storeId, drawerId: f.drawerId, cashierId: f.cashierId, now: at,
    item: { productId: f.product.id, productName: f.product.name, unitId: f.product.base_unit_id, unitSymbol: f.product.symbol, quantity, lineTotal, unitCostScaled: scaledUnitCost(lineTotal, quantity) }
  }));
  return id;
}

function pakai(f, quantity, at) {
  f.sqlite.prepare(`
    INSERT INTO stock_movements (id, source_key, store_id, product_id, product_name, unit_id, unit_symbol, direction, quantity, source_type, source_id, note, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'OUT', ?, 'PRODUCTION_INPUT', ?, '', ?)
  `).run(`stock_move_${crypto.randomUUID()}`, `PROD:${crypto.randomUUID()}`, f.storeId, f.product.id, f.product.name, f.product.base_unit_id, f.product.symbol, quantity, `production_${crypto.randomUUID()}`, at);
  f.sqlite.prepare('UPDATE inventory_stock_balances SET quantity = quantity - ? WHERE store_id = ? AND product_id = ?').run(quantity, f.storeId, f.product.id);
}

function izin(f, purchaseId, { kind = 'VOID', lines = [] } = {}) {
  const id = `permit_${crypto.randomUUID()}`;
  f.sqlite.prepare(`
    INSERT INTO approval_permits (id, store_id, drawer_session_id, cashier_id, permit_type, subject_type, subject_id, subject_snapshot_json, reason,
      approval_status, execution_status, requested_at, updated_at, decided_at, approved_by_role, approved_by_id, correction_kind, requested_lines_json)
    VALUES (?, ?, ?, ?, 'TRANSACTION_VOID', 'PURCHASE', ?, '{}', 'salah masukkan nomor', 'approved', 'NOT_ATTEMPTED', ?, ?, ?, 'ENTITY_ADMIN', 'bos', ?, ?)
  `).run(id, f.storeId, f.drawerId, f.cashierId, purchaseId, '2026-10-21T11:41:00.000Z', '2026-10-21T11:41:00.000Z', '2026-10-21T11:50:00.000Z', kind, lines.length ? JSON.stringify(lines) : '');
  return { id, subjectType: 'PURCHASE', subjectId: purchaseId, reason: 'salah masukkan nomor', correctionKind: kind, requestedLines: lines };
}

const kondisi = f => f.sqlite.prepare(`
  SELECT p.average_cost, b.quantity FROM products p JOIN inventory_stock_balances b ON b.product_id = p.id AND b.store_id = p.store_id WHERE p.id = ?
`).get(f.product.id);
const tandaiMenunggu = (f, permitId, replacementId = null) => f.sqlite.prepare(`UPDATE approval_permits SET execution_status = 'EXECUTED', hpp_replay_status = ?, replacement_subject_id = ? WHERE id = ?`).run(STATUS_MENUNGGU, replacementId, permitId);
const izinUntukPutar = (f, permit, replacementId = null, status = STATUS_MENUNGGU) => ({ id: permit.id, storeId: f.storeId, subjectId: permit.subjectId, replacementSubjectId: replacementId, hppReplayStatus: status });
const MALAM = '2026-10-21T17:30:00.000Z'; // 00.30 WIB

test('jam sepi 23.00–07.00 WIB', () => {
  assert.equal(dalamJamSepi(new Date('2026-10-21T15:59:00Z')), false); // 22.59
  assert.equal(dalamJamSepi(new Date('2026-10-21T16:00:00Z')), true);  // 23.00
  assert.equal(dalamJamSepi(new Date('2026-10-21T23:59:00Z')), true);  // 06.59
  assert.equal(dalamJamSepi(new Date('2026-10-22T00:00:00Z')), false); // 07.00
  assert.equal(dalamJamSepi(new Date('2026-10-21T05:00:00Z')), false); // 12.00
});

test('rumus sama dengan kasir: kasus Air Mineral Kaliurang', () => {
  assert.equal(rataRataSesudahBeli(24000, 363500, { quantity: 38000, lineTotal: 19000, unitCost: 500000 }), 447161);
  assert.equal(rataRataSesudahBeli(62000, 447161, { quantity: 38000, lineTotal: 12996, unitCost: 342000 }), 407200);
  assert.equal(rataRataSesudahBeli(0, 999, { quantity: 5, lineTotal: 10, unitCost: 2000000 }), 2000000);
});

test('Kaliurang: ACC hapus TIDAK lagi tertahan; laci & stok beres sekarang, HPP diputar ulang di jam sepi', async () => {
  const f = setup();
  try {
    const salah = await beli(f, 19000, 38000, '2026-10-21T10:46:42.175Z');
    await beli(f, 12996, 38000, '2026-10-21T11:44:34.672Z');
    pakai(f, 2000, '2026-10-21T13:11:49.054Z');
    assert.deepEqual({ ...kondisi(f) }, { average_cost: 407200, quantity: 98000 });

    const permit = izin(f, salah);
    const hasil = await executeTransactionCorrection(f.db, f.store, permit, { role: 'ENTITY_ADMIN', id: 'bos' }, '2026-10-21T11:50:17.371Z');
    assert.equal(hasil.ok, true);
    assert.equal(hasil.hppMenunggu, true);
    assert.ok(f.sqlite.prepare('SELECT voided_at FROM purchases WHERE id = ?').get(salah).voided_at, 'pembelian salah hilang dari laci');
    assert.deepEqual({ ...kondisi(f) }, { average_cost: 407200, quantity: 60000 }, 'stok dibalik sekarang, HPP menunggu');

    tandaiMenunggu(f, permit.id);
    const siang = await terapkanPutarUlangIzin(f.db, izinUntukPutar(f, permit), '2026-10-21T12:00:00.000Z');
    assert.equal(siang.diLuarJam, true, 'di luar jam sepi ditolak');
    assert.equal(kondisi(f).average_cost, 407200);

    const malam = await terapkanPutarUlangIzin(f.db, izinUntukPutar(f, permit), MALAM);
    assert.equal(malam.ok, true, malam.alasan);
    assert.equal(kondisi(f).average_cost, 350323, 'sama dengan hitungan manual 21 Okt');
    assert.equal(malam.bahan[0].pemakaian, 1);
    assert.ok(malam.bahan[0].selisihHppRupiah > 0, 'pemakaian 2.000 ml sempat memakai HPP terlalu tinggi');
    const row = f.sqlite.prepare('SELECT hpp_replay_status FROM approval_permits WHERE id = ?').get(permit.id);
    assert.equal(row.hpp_replay_status, STATUS_SELESAI);
    const snap = f.sqlite.prepare(`SELECT source_type FROM product_average_cost_snapshots WHERE source_id = ?`).get(permit.id);
    assert.equal(snap.source_type, 'CORRECTION');
  } finally { f.sqlite.close(); }
});

test('tanpa mutasi sesudahnya tetap dibalik persis seperti dulu (tanpa menunggu malam)', async () => {
  const f = setup();
  try {
    const salah = await beli(f, 19000, 38000, '2026-10-21T10:46:42.175Z');
    const hasil = await executeTransactionCorrection(f.db, f.store, izin(f, salah), { role: 'ADMIN', id: 'a' }, '2026-10-21T10:50:00.000Z');
    assert.equal(hasil.ok, true);
    assert.equal(hasil.hppMenunggu, false);
    assert.deepEqual({ ...kondisi(f) }, { average_cost: 363500, quantity: 24000 });
  } finally { f.sqlite.close(); }
});

test('HOLD hanya kalau stok sekarang lebih kecil dari qty yang dibatalkan, pesannya jelas', async () => {
  const f = setup();
  try {
    const salah = await beli(f, 19000, 38000, '2026-10-21T10:46:42.175Z');
    pakai(f, 40000, '2026-10-21T11:00:00.000Z');
    const hasil = await executeTransactionCorrection(f.db, f.store, izin(f, salah), { role: 'ADMIN', id: 'a' }, '2026-10-21T11:50:00.000Z');
    assert.equal(hasil.ok, false);
    assert.equal(hasil.status, 'HOLD');
    assert.equal(hasil.code, 'PURCHASE_STOCK_NOT_REVERSIBLE');
    assert.match(hasil.detail, /tinggal 22000/);
    assert.equal(f.sqlite.prepare('SELECT voided_at FROM purchases WHERE id = ?').get(salah).voided_at, null);
  } finally { f.sqlite.close(); }
});

test('putar ulang berhenti (TERTAHAN) kalau riwayat tidak cocok, tanpa mengubah HPP', async () => {
  const f = setup();
  try {
    const salah = await beli(f, 19000, 38000, '2026-10-21T10:46:42.175Z');
    await beli(f, 12996, 38000, '2026-10-21T11:44:34.672Z');
    const permit = izin(f, salah);
    await executeTransactionCorrection(f.db, f.store, permit, { role: 'ADMIN', id: 'a' }, '2026-10-21T11:50:00.000Z');
    tandaiMenunggu(f, permit.id);
    // Stok berubah tanpa mutasi (mis. diedit langsung) -> riwayat tidak bisa direkonstruksi.
    f.sqlite.prepare('UPDATE inventory_stock_balances SET quantity = quantity + 5 WHERE product_id = ?').run(f.product.id);
    const hasil = await terapkanPutarUlangIzin(f.db, izinUntukPutar(f, permit), MALAM);
    assert.equal(hasil.ok, false);
    assert.equal(hasil.tertahan, true);
    assert.equal(kondisi(f).average_cost, 407200);
    assert.equal(f.sqlite.prepare('SELECT hpp_replay_status FROM approval_permits WHERE id = ?').get(permit.id).hpp_replay_status, STATUS_TERTAHAN);
  } finally { f.sqlite.close(); }
});

test('ganti nominal tanpa mutasi sesudahnya: pembelian pengganti Rp12.000, qty sama, HPP langsung benar', async () => {
  const f = setup();
  try {
    const salah = await beli(f, 19000, 38000, '2026-10-21T10:46:42.175Z');
    const permit = izin(f, salah, { kind: 'AMOUNT', lines: [{ productId: f.product.id, lineTotal: 12000 }] });
    const hasil = await executeTransactionCorrection(f.db, f.store, permit, { role: 'ADMIN', id: 'a' }, '2026-10-21T10:50:00.000Z');
    assert.equal(hasil.ok, true, hasil.detail);
    assert.equal(hasil.hppMenunggu, false);
    const pengganti = f.sqlite.prepare('SELECT total_amount, created_at, drawer_session_id, voided_at FROM purchases WHERE id = ?').get(hasil.replacementId);
    assert.deepEqual({ ...pengganti }, { total_amount: 12000, created_at: '2026-10-21T10:46:42.175Z', drawer_session_id: f.drawerId, voided_at: null });
    const benar = rataRataSesudahBeli(24000, 363500, { quantity: 38000, lineTotal: 12000, unitCost: scaledUnitCost(12000, 38000) });
    assert.deepEqual({ ...kondisi(f) }, { average_cost: benar, quantity: 62000 });
  } finally { f.sqlite.close(); }
});

test('ganti nominal sesudah bahan terpakai: pengganti diletakkan di tempat pembelian asal saat diputar ulang', async () => {
  const f = setup();
  try {
    const salah = await beli(f, 19000, 38000, '2026-10-21T10:46:42.175Z');
    pakai(f, 2000, '2026-10-21T11:00:00.000Z');
    await beli(f, 12996, 38000, '2026-10-21T11:44:34.672Z');
    const permit = izin(f, salah, { kind: 'AMOUNT', lines: [{ productId: f.product.id, lineTotal: 12000 }] });
    const hasil = await executeTransactionCorrection(f.db, f.store, permit, { role: 'ADMIN', id: 'a' }, '2026-10-21T12:00:00.000Z');
    assert.equal(hasil.ok, true, hasil.detail);
    assert.equal(hasil.hppMenunggu, true);
    assert.equal(kondisi(f).quantity, 98000);
    tandaiMenunggu(f, permit.id, hasil.replacementId);
    const malam = await terapkanPutarUlangIzin(f.db, izinUntukPutar(f, permit, hasil.replacementId), MALAM);
    assert.equal(malam.ok, true, malam.alasan);
    // Seharusnya: 24.000 @363.500 + 38.000 @Rp12.000 -> pakai 2.000 -> + 38.000 @Rp12.996.
    const a1 = rataRataSesudahBeli(24000, 363500, { quantity: 38000, lineTotal: 12000, unitCost: scaledUnitCost(12000, 38000) });
    const a2 = rataRataSesudahBeli(60000, a1, { quantity: 38000, lineTotal: 12996, unitCost: scaledUnitCost(12996, 38000) });
    assert.equal(kondisi(f).average_cost, a2);
  } finally { f.sqlite.close(); }
});

test('hitungPutarUlang hanya membaca', async () => {
  const f = setup();
  try {
    const salah = await beli(f, 19000, 38000, '2026-10-21T10:46:42.175Z');
    await beli(f, 12996, 38000, '2026-10-21T11:44:34.672Z');
    const sebelum = { ...kondisi(f) };
    const hasil = await hitungPutarUlang(f.db, f.storeId, f.product.id, { pembelianSalahId: salah });
    assert.equal(hasil.ok, true, hasil.alasan);
    assert.deepEqual({ ...kondisi(f) }, sebelum);
  } finally { f.sqlite.close(); }
});

test('Una: alat bereskan_hpp_pembelian_batal terdaftar, jalurnya diizinkan, menolak di luar jam sepi', async () => {
  const aksi = cariAksi('bereskan_hpp_pembelian_batal');
  assert.ok(aksi);
  assert.equal(aksi.lingkup, 'gerai');
  assert.ok(PINTU_AKSI.includes('/api/management/transaction-void-permits/hpp-putar-ulang$'));
  const ctx = {
    baca: async () => ({ ok: true, data: { jamSepi: false, pesanJam: 'Hanya jam sepi.', items: [{ permit: { id: 'p1' }, pratinjau: { ok: true, bahan: [] } }] } }),
    kirim: async () => { throw new Error('tidak boleh mengirim'); }
  };
  const hasil = await aksi.siapkan({}, ctx);
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /Hanya jam sepi\..*nanti malam sistem membereskannya sendiri/);
});

test('Una: di jam sepi menyusun draft dan memposting per izin', async () => {
  const aksi = cariAksi('bereskan_hpp_pembelian_batal');
  const terkirim = [];
  const bahan = [{ nama: 'Air Mineral', hppTercatat: 407200, hppBenar: 350323, selisihHppRupiah: 146 }];
  const ctx = {
    baca: async () => ({ ok: true, data: { jamSepi: true, pesanJam: '', items: [
      { permit: { id: 'p1', subject: { description: 'Pembelian Air Mineral', amount: 19000 } }, pratinjau: { ok: true, bahan } },
      { permit: { id: 'p2', subject: { description: 'Pembelian Gula', amount: 35000 } }, pratinjau: { ok: false, alasan: 'riwayat tidak cocok' } }
    ] } }),
    kirim: async (method, path) => { terkirim.push(`${method} ${path}`); return { ok: true, data: { bahan } }; }
  };
  const hasil = await aksi.siapkan({}, ctx);
  assert.equal(hasil.ok, true);
  assert.deepEqual(hasil.draft.muatan.permitIds, ['p1']);
  assert.match(hasil.draft.dampak.join(' '), /riwayat tidak cocok/);
  const posting = await aksi.posting(hasil.draft, ctx);
  assert.equal(posting.ok, true);
  assert.deepEqual(terkirim, ['POST /api/management/transaction-void-permits/p1/hpp-putar-ulang']);
});

test('Tlekung: stok bahan sudah terpakai -> pengganti (cara bayar beda) masuk dulu, pembelian salah dibalik tanpa stok minus', async () => {
  const f = setup();
  try {
    const salah = await beli(f, 19000, 38000, '2026-10-21T10:46:42.175Z');
    pakai(f, 40000, '2026-10-21T11:00:00.000Z');
    assert.equal(kondisi(f).quantity, 22000, 'stok lebih kecil dari qty pembelian salah');
    const permit = { ...izin(f, salah, { kind: 'AMOUNT', lines: [{ productId: f.product.id, quantity: 38000, lineTotal: 12000 }] }), requestedPaymentMethod: 'QRIS' };
    const hasil = await executeTransactionCorrection(f.db, f.store, permit, { role: 'ADMIN', id: 'a' }, '2026-10-21T12:00:00.000Z');
    assert.equal(hasil.ok, true, hasil.detail);
    assert.equal(hasil.hppMenunggu, true);
    assert.equal(kondisi(f).quantity, 22000, 'pengganti masuk lalu yang salah dibalik: stok tetap');
    const pengganti = f.sqlite.prepare('SELECT total_amount, payment_method FROM purchases WHERE id = ?').get(hasil.replacementId);
    assert.deepEqual({ ...pengganti }, { total_amount: 12000, payment_method: 'QRIS' });
    assert.ok(f.sqlite.prepare('SELECT voided_at FROM purchases WHERE id = ?').get(salah).voided_at);
    tandaiMenunggu(f, permit.id, hasil.replacementId);
    const malam = await terapkanPutarUlangIzin(f.db, izinUntukPutar(f, permit, hasil.replacementId), MALAM);
    assert.equal(malam.ok, true, malam.alasan);
    assert.equal(kondisi(f).average_cost, rataRataSesudahBeli(24000, 363500, { quantity: 38000, lineTotal: 12000, unitCost: scaledUnitCost(12000, 38000) }));
  } finally { f.sqlite.close(); }
});

test('ganti pembelian dengan qty berbeda: stok mengikuti qty yang benar', async () => {
  const f = setup();
  try {
    const salah = await beli(f, 19000, 38000, '2026-10-21T10:46:42.175Z');
    const permit = izin(f, salah, { kind: 'AMOUNT', lines: [{ productId: f.product.id, quantity: 30000, lineTotal: 15000 }] });
    const hasil = await executeTransactionCorrection(f.db, f.store, permit, { role: 'ADMIN', id: 'a' }, '2026-10-21T10:50:00.000Z');
    assert.equal(hasil.ok, true, hasil.detail);
    assert.equal(kondisi(f).quantity, 54000);
  } finally { f.sqlite.close(); }
});
