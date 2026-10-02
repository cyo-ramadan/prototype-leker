import { json } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, listStores, resolveStore } from './stores.js';

// Stok lintas gerai di Admin Entity (Bos Cyo, 2026-10-02): "bisa langsung cek
// stok semua gerai, khususnya bahan. jadi nanti aku masukin gerai2nya, lalu
// tampilan stoknya setiap stok bahan 1 baris, setiap gerai 1 kolom."
//
//   GET /api/admin/entity-stock?store=<gerai pemanggil>&stores=A,B,C&kind=BAHAN|SEMUA&q=teks
//
// Baca-saja. Satu baris per barang; barang yang sama di beberapa gerai disatukan
// lewat Kode Barang Entity (product_masters) bila ada, kalau tidak lewat nama
// (huruf kecil, spasi dirapikan) -- gerai hasil salinan template punya nama sama.
// "Bahan" = tipe barang yang bisa dikonsumsi produksi dan tidak dijual langsung
// (Bahan, Bahan Setengah Jadi, dan tipe buatan sendiri yang sifatnya sama).
//
// Pagar yang sama dengan Laporan Net Profit (invariant #5): hanya Owner / Entity
// Admin yang boleh melihat banyak gerai; Admin Gerai hanya gerainya sendiri;
// gerai di luar entity pemanggil ditolak. Hanya barang aktif; satu query untuk
// seluruh gerai terpilih (tanpa query per gerai), dengan batas baris.

const MAX_ROWS = 3000;
const text = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const normalizeName = value => text(value, 160).toLowerCase().replace(/\s+/g, ' ');

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

export async function buildEntityStockMatrix(db, stores, { kind = 'BAHAN', query = '' } = {}) {
  if (!stores.length) return { stores: [], rows: [], truncated: false };
  const storeIds = stores.map(store => store.id);
  const placeholders = storeIds.map(() => '?').join(',');
  const bahanOnly = kind !== 'SEMUA';
  const rows = await db.prepare(`
    SELECT p.id, p.store_id, p.name, p.product_master_id, p.stock_tracking_enabled,
           COALESCE(t.track_stock, 1) AS type_track_stock, t.name AS item_type_name,
           u.symbol AS unit_symbol, b.quantity,
           m.code AS master_code
    FROM products p
    LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    LEFT JOIN inventory_stock_balances b ON b.store_id = p.store_id AND b.product_id = p.id
    LEFT JOIN product_masters m ON m.id = p.product_master_id
    WHERE p.store_id IN (${placeholders}) AND p.is_active = 1
      ${bahanOnly ? 'AND COALESCE(t.can_consume, 0) = 1 AND COALESCE(t.can_sell, 1) = 0' : ''}
    ORDER BY p.name COLLATE NOCASE, p.id
    LIMIT ${MAX_ROWS + 1}
  `).bind(...storeIds).all();
  const all = rows.results ?? [];
  const truncated = all.length > MAX_ROWS;
  const filter = normalizeName(query);

  const codeByStoreId = new Map(stores.map(store => [store.id, store.code]));
  const grouped = new Map();
  for (const row of (truncated ? all.slice(0, MAX_ROWS) : all)) {
    const key = row.product_master_id ? `master:${row.product_master_id}` : `name:${normalizeName(row.name)}`;
    let entry = grouped.get(key);
    if (!entry) {
      entry = { key, name: row.name, masterCode: row.master_code || '', unitCounts: new Map(), cells: {} };
      grouped.set(key, entry);
    }
    const code = codeByStoreId.get(row.store_id);
    const tracked = Boolean(row.stock_tracking_enabled) && Boolean(row.type_track_stock);
    // Dua barang aktif sama di satu gerai: kolom yang sudah terisi dipertahankan.
    if (entry.cells[code]) continue;
    const unit = row.unit_symbol || '';
    entry.unitCounts.set(unit, (entry.unitCounts.get(unit) || 0) + 1);
    entry.cells[code] = {
      productId: Number(row.id),
      name: row.name,
      unit,
      tracked,
      quantity: tracked && row.quantity != null ? Number(row.quantity) : (tracked ? 0 : null)
    };
  }

  const result = [];
  for (const entry of grouped.values()) {
    if (filter && !normalizeName(entry.name).includes(filter) && !normalizeName(entry.masterCode).includes(filter)) continue;
    const unit = [...entry.unitCounts].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const cells = Object.values(entry.cells);
    const uniformUnit = cells.every(cell => cell.unit === unit);
    const trackedCells = cells.filter(cell => cell.tracked);
    result.push({
      key: entry.key,
      name: entry.name,
      masterCode: entry.masterCode,
      unit,
      uniformUnit,
      byStore: entry.cells,
      total: uniformUnit ? trackedCells.reduce((sum, cell) => sum + cell.quantity, 0) : null,
      storesHolding: cells.length
    });
  }
  result.sort((a, b) => a.name.localeCompare(b.name, 'id'));
  return { stores: stores.map(store => ({ code: store.code, storeName: store.storeName })), rows: result, truncated };
}

export async function handleEntityStockApi(request, env, pathname) {
  if (pathname !== '/api/admin/entity-stock' || request.method !== 'GET') return null;
  const db = env.DB;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const callerStore = await selectedStore(db, request);
  if (!callerStore) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  if (!callerStore.entityId) return json({ error: 'Gerai ini belum terhubung ke Entity mana pun.', code: 'STORE_WITHOUT_ENTITY' }, 409);

  const url = new URL(request.url);
  const entityStores = (await listStores(db, { includeInactive: true })).filter(store => store.entityId === callerStore.entityId);
  const entityWide = Boolean(auth.owner || auth.entityAdmin);
  const allowedStores = entityWide ? entityStores : entityStores.filter(store => store.id === callerStore.id);

  const requestedCodes = (url.searchParams.get('stores') || '').split(',').map(code => code.trim()).filter(Boolean);
  const codes = requestedCodes.length ? requestedCodes : allowedStores.map(store => store.code);
  const selected = [];
  for (const code of [...new Set(codes)]) {
    const store = allowedStores.find(item => item.code === code);
    if (!store) {
      return entityStores.some(item => item.code === code)
        ? json({ error: `Stok gerai ${code} hanya bisa dibuka Owner atau Admin Entity.`, code: 'STORE_OUT_OF_CALLER_SCOPE' }, 403)
        : json({ error: `Gerai ${code} bukan bagian dari entity ini.`, code: 'STORE_OUT_OF_ENTITY_SCOPE' }, 403);
    }
    selected.push(store);
  }

  const kind = text(url.searchParams.get('kind'), 10).toUpperCase() === 'SEMUA' ? 'SEMUA' : 'BAHAN';
  const matrix = await buildEntityStockMatrix(db, selected, { kind, query: url.searchParams.get('q') || '' });
  return json({ scope: entityWide ? 'ENTITY' : 'STORE', kind, ...matrix });
}
