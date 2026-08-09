export const DEFAULT_STORE_CODE = 'G001';

function mapStore(row) {
  return row ? {
    id: row.id,
    code: row.code,
    storeName: row.store_name,
    address: row.address,
    logoData: row.logo_data,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : null;
}

export function normalizeStoreCode(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);
}

export async function resolveStore(db, token = DEFAULT_STORE_CODE, { includeInactive = false } = {}) {
  const normalized = String(token || DEFAULT_STORE_CODE).trim();
  const row = await db.prepare(`
    SELECT id, code, store_name, address, logo_data, is_active, created_at, updated_at
    FROM stores
    WHERE (code = ? OR id = ?) ${includeInactive ? '' : 'AND is_active = 1'}
    LIMIT 1
  `).bind(normalized.toUpperCase(), normalized).first();
  return mapStore(row);
}

export async function listStores(db, { includeInactive = false } = {}) {
  const result = await db.prepare(`
    SELECT id, code, store_name, address, logo_data, is_active, created_at, updated_at
    FROM stores
    ${includeInactive ? '' : 'WHERE is_active = 1'}
    ORDER BY code ASC
  `).all();
  return (result.results ?? []).map(mapStore);
}
