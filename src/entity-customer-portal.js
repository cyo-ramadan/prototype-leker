import { json } from './http.js';

const ENTITY_STORES_ROUTE = /^\/api\/entity-customer\/([^/]+)\/stores\/?$/;

function entityToken(value) {
  const token = String(value ?? '').trim();
  return /^[a-zA-Z0-9_-]{1,80}$/.test(token) ? token : '';
}

function publicEntityCode(entityId) {
  const id = String(entityId ?? '');
  return id.toUpperCase().startsWith('ENT-') ? id.slice(4) : id;
}

export async function loadEntityCustomerPortal(db, token) {
  const directId = entityToken(token);
  if (!directId) return null;

  const normalizedId = directId.toUpperCase();
  const prefixedId = normalizedId.startsWith('ENT-') ? normalizedId : `ENT-${normalizedId}`;
  const entity = await db.prepare(`
    SELECT id, name
    FROM entities
    WHERE status = 'ACTIVE'
      AND (UPPER(id) = ? OR UPPER(id) = ?)
    ORDER BY CASE WHEN UPPER(id) = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(normalizedId, prefixedId, normalizedId).first();
  if (!entity) return null;

  const result = await db.prepare(`
    SELECT id, code, store_name, address
    FROM stores
    WHERE entity_id = ?
      AND is_active = 1
    ORDER BY store_name COLLATE NOCASE, code
  `).bind(entity.id).all();

  return {
    entity: {
      id: entity.id,
      code: publicEntityCode(entity.id),
      name: entity.name
    },
    stores: (result.results ?? []).map(store => ({
      id: store.id,
      code: store.code,
      storeName: store.store_name,
      address: store.address || ''
    }))
  };
}

export async function handleEntityCustomerPortalApi(request, env, pathname) {
  const match = pathname.match(ENTITY_STORES_ROUTE);
  if (!match) return null;
  if (request.method !== 'GET') {
    return json({ error: 'Method portal customer Entity tidak didukung.' }, 405);
  }

  let token = '';
  try {
    token = decodeURIComponent(match[1]);
  } catch {
    return json({ error: 'Kode Entity tidak valid.', code: 'ENTITY_NOT_FOUND' }, 404);
  }

  const portal = await loadEntityCustomerPortal(env.DB, token);
  if (!portal) {
    return json({ error: 'Entity tidak ditemukan atau sedang nonaktif.', code: 'ENTITY_NOT_FOUND' }, 404);
  }
  return json(portal);
}
