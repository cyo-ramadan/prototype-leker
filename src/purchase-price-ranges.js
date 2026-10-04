import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { parseRupiahAmountToScaled } from './accounting-ledger.js';

// Rentang harga beli wajar per barang (Bos Cyo, 2026-10-04; migration 0135).
//
// Pembelian kasir yang harga per satuannya di luar rentang DITOLAK sebelum apa pun
// ditulis: penyebab HPP kacau selama ini adalah salah ketik qty/harga ("1 pcs" untuk
// 1 kg gula, titik/koma tertukar), dan sekali masuk, harga rata-rata ikut rusak.
// Barang tanpa rentang tidak dibatasi. Admin/Owner/Entity Admin (atau Una lewat
// atur_rentang_harga_beli) mengisi rentangnya.
//
//   GET  /api/admin/purchase-price-ranges?store=<gerai>
//   POST /api/admin/purchase-price-ranges?store=<gerai>
//        { items: [{ productId, min, max, basis? }] }   -- angka desimal sebagai teks
//        min DAN max kosong = rentang barang itu dihapus (barang kembali tanpa batas).
//
// Satu tempat simpan, dua pintu (Bos Cyo, 2026-10-04: "di settingan manusia udah ada,
// yang aku minta agar si una bisa kerjakan itu"): isian "Harga beli wajar" di Master
// Barang dan alat Una atur_rentang_harga_beli sama-sama menulis lewat endpoint ini.
//
// Uang = integer skala 1.000.000 per satuan dasar (invariant #1).

export const SCALE = 1_000_000n;
export const MAKS_RENTANG_SEKALI = 100;
const text = (value, max = 120) => String(value ?? '').trim().slice(0, max);

/** 17666667 -> "Rp17,666667"; 18000000000 -> "Rp18.000" (tampilan kasir: titik ribuan, koma desimal). */
export function rupiahSkala(scaled) {
  const n = BigInt(scaled);
  const bulat = (n / SCALE).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const pecahan = (n % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return `Rp${bulat}${pecahan ? `,${pecahan}` : ''}`;
}

/** Rentang per productId untuk satu gerai. Tabel belum ada = tanpa rentang (pembelian tetap jalan). */
export async function loadPurchasePriceRanges(db, storeId) {
  try {
    const rows = await db.prepare(`
      SELECT product_id, min_unit_cost_scaled, max_unit_cost_scaled, basis_unit_cost_scaled
      FROM product_purchase_price_ranges WHERE store_id = ?
    `).bind(storeId).all();
    return new Map((rows.results ?? []).map(row => [Number(row.product_id), {
      minScaled: BigInt(row.min_unit_cost_scaled),
      maxScaled: BigInt(row.max_unit_cost_scaled),
      basisScaled: row.basis_unit_cost_scaled == null ? null : BigInt(row.basis_unit_cost_scaled)
    }]));
  } catch (error) {
    if (/no such table/i.test(String(error?.message ?? error))) return new Map();
    throw error;
  }
}

/**
 * null kalau harga per satuan di dalam rentang (atau barang tanpa rentang);
 * selain itu pesan penolakan untuk kasir.
 */
export function purchaseRangeViolation({ productName, unitSymbol, unitCostScaled, quantity, lineTotal }, range) {
  if (!range) return null;
  const harga = BigInt(unitCostScaled);
  if (harga >= range.minScaled && harga <= range.maxScaled) return null;
  const satuan = unitSymbol || 'satuan';
  const arah = harga < range.minScaled ? 'terlalu murah' : 'terlalu mahal';
  return `Harga beli ${productName} ${rupiahSkala(harga)} per ${satuan} ${arah} (wajar ${rupiahSkala(range.minScaled)}–${rupiahSkala(range.maxScaled)} per ${satuan}). `
    + `Yang diketik: qty ${quantity} ${satuan}, total Rp${String(lineTotal).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}. `
    + 'Cek lagi qty (dalam satuan dasar, mis. gram/ml) dan total belanjanya. Kalau harganya memang berubah, minta Admin mengubah rentang harga beli barang ini.';
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

function actorFrom(auth) {
  if (auth.owner) return { role: 'OWNER', id: auth.owner.id || '' };
  if (auth.entityAdmin) return { role: 'ENTITY_ADMIN', id: auth.entityAdmin.id || '' };
  if (auth.admin) return { role: 'ADMIN', id: auth.admin.id || '' };
  if (auth.agent) return { role: 'AGENT', id: '' };
  return { role: 'LEGACY_PIN', id: '' };
}

const scaledOrNull = (value) => {
  const raw = text(value, 40);
  if (!raw) return null;
  const scaled = parseRupiahAmountToScaled(raw);
  return Number.isSafeInteger(scaled) && scaled > 0 ? scaled : NaN;
};

export async function handlePurchasePriceRangesApi(request, env, pathname) {
  if (pathname !== '/api/admin/purchase-price-ranges') return null;
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Metode tidak didukung.' }, 405);
  const db = env.DB;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (request.method === 'GET') {
    const ranges = await loadPurchasePriceRanges(db, store.id);
    const products = await db.prepare(`
      SELECT p.id, p.name, u.symbol AS unit_symbol FROM products p
      LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
      WHERE p.store_id = ? AND p.is_active = 1 ORDER BY p.name COLLATE NOCASE
    `).bind(store.id).all();
    const items = (products.results ?? []).filter(row => ranges.has(Number(row.id))).map(row => {
      const r = ranges.get(Number(row.id));
      return {
        productId: Number(row.id), name: row.name, unit: row.unit_symbol || '',
        minScaled: String(r.minScaled), maxScaled: String(r.maxScaled), basisScaled: r.basisScaled == null ? null : String(r.basisScaled),
        min: rupiahSkala(r.minScaled), max: rupiahSkala(r.maxScaled)
      };
    });
    return json({ store: { code: store.code, storeName: store.storeName }, items });
  }

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload rentang harga beli tidak valid.' }, 400);
  const raw = Array.isArray(body.value?.items) ? body.value.items : [];
  if (!raw.length || raw.length > MAKS_RENTANG_SEKALI) return json({ error: `Isi 1–${MAKS_RENTANG_SEKALI} barang sekali simpan.` }, 400);

  const ids = [...new Set(raw.map(item => Number(item?.productId)))];
  if (ids.some(id => !Number.isInteger(id) || id <= 0) || ids.length !== raw.length) return json({ error: 'Barang tidak valid atau disebut dua kali.' }, 400);
  const found = await db.prepare(`SELECT id, name FROM products WHERE store_id = ? AND id IN (${ids.map(() => '?').join(',')})`).bind(store.id, ...ids).all();
  const names = new Map((found.results ?? []).map(row => [Number(row.id), row.name]));
  if (names.size !== ids.length) return json({ error: 'Ada barang yang bukan milik gerai ini.' }, 400);

  const now = new Date().toISOString();
  const actor = actorFrom(auth);
  const statements = [];
  let removed = 0;
  for (const item of raw) {
    const productId = Number(item.productId);
    if (!text(item.min, 40) && !text(item.max, 40)) {
      statements.push(db.prepare('DELETE FROM product_purchase_price_ranges WHERE store_id = ? AND product_id = ?').bind(store.id, productId));
      removed += 1;
      continue;
    }
    const min = scaledOrNull(item.min);
    const max = scaledOrNull(item.max);
    const basis = scaledOrNull(item.basis);
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) return json({ error: `${names.get(productId)}: batas bawah dan atas wajib angka lebih dari 0.` }, 400);
    if (max < min) return json({ error: `${names.get(productId)}: batas atas lebih kecil dari batas bawah.` }, 400);
    if (Number.isNaN(basis)) return json({ error: `${names.get(productId)}: harga acuan tidak valid.` }, 400);
    statements.push(db.prepare(`
      INSERT INTO product_purchase_price_ranges (store_id, product_id, min_unit_cost_scaled, max_unit_cost_scaled, basis_unit_cost_scaled, updated_by_role, updated_by_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(store_id, product_id) DO UPDATE SET
        min_unit_cost_scaled = excluded.min_unit_cost_scaled, max_unit_cost_scaled = excluded.max_unit_cost_scaled,
        basis_unit_cost_scaled = excluded.basis_unit_cost_scaled, updated_by_role = excluded.updated_by_role,
        updated_by_id = excluded.updated_by_id, updated_at = excluded.updated_at
    `).bind(store.id, productId, min, max, basis ?? null, actor.role, actor.id, now));
  }
  await db.batch(statements);
  return json({ ok: true, saved: statements.length - removed, removed });
}
