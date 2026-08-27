export const DEFAULT_STORE_CODE = 'G001';

function mapStore(row) {
  return row ? {
    id: row.id,
    code: row.code,
    storeName: row.store_name,
    address: row.address,
    logoData: row.logo_data,
    isActive: Boolean(row.is_active),
    entityId: row.entity_id ?? null,
    entityName: row.entity_name ?? null,
    tenantId: row.tenant_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : null;
}

const currentEntityContextJoin = `
  LEFT JOIN entities e ON e.id = s.entity_id
  LEFT JOIN entity_tenancy et
    ON et.entity_id = s.entity_id
   AND et.effective_to IS NULL
`;

export function normalizeStoreCode(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);
}

export async function resolveStore(db, token = DEFAULT_STORE_CODE, { includeInactive = false } = {}) {
  const normalized = String(token || DEFAULT_STORE_CODE).trim();
  const row = await db.prepare(`
    SELECT s.id, s.code, s.store_name, s.address, s.logo_data, s.is_active,
           s.entity_id, e.name AS entity_name, et.tenant_id,
           s.created_at, s.updated_at
    FROM stores s
    ${currentEntityContextJoin}
    WHERE (s.code = ? OR s.id = ?) ${includeInactive ? '' : 'AND s.is_active = 1'}
    LIMIT 1
  `).bind(normalized.toUpperCase(), normalized).first();
  return mapStore(row);
}

export async function listStores(db, { includeInactive = false } = {}) {
  const result = await db.prepare(`
    SELECT s.id, s.code, s.store_name, s.address, s.logo_data, s.is_active,
           s.entity_id, e.name AS entity_name, et.tenant_id,
           s.created_at, s.updated_at
    FROM stores s
    ${currentEntityContextJoin}
    ${includeInactive ? '' : 'WHERE s.is_active = 1'}
    ORDER BY s.code ASC
  `).all();
  return (result.results ?? []).map(mapStore);
}

export async function resolveAuthorizedEntityIds(db, tenantId) {
  const normalizedTenantId = String(tenantId ?? '').trim();
  if (!normalizedTenantId) return [];

  const result = await db.prepare(`
    SELECT entity_id
    FROM entity_tenancy
    WHERE tenant_id = ?
      AND effective_to IS NULL
    ORDER BY entity_id ASC
  `).bind(normalizedTenantId).all();

  return (result.results ?? []).map(row => row.entity_id).filter(Boolean);
}
