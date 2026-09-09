import { json } from './http.js';
import { isTenantModuleEnabled } from './platform-module-registry.js';

export const GAME_MODULE_CODE = 'GAME';

function mapCampaign(row) {
  return {
    id: row.id,
    gameTypeCode: row.game_type_code,
    displayName: row.display_name,
    version: Number(row.version),
    storeId: row.store_id,
    entityId: row.entity_id ?? null,
    clientEntry: row.client_entry || '',
    configJson: row.config_json || '{}'
  };
}

async function activeCampaigns(db, storeId) {
  if (!storeId) return [];
  const rows = await db.prepare(`
    SELECT id, store_id, entity_id, game_type_code, display_name,
           version, client_entry, config_json
    FROM game_campaigns
    WHERE store_id = ? AND is_active = 1
    ORDER BY game_type_code, version DESC, id
  `).bind(storeId).all();
  return (rows.results ?? []).map(mapCampaign);
}

export async function handleGameApi(request, ctx) {
  const pathname = ctx?.pathname || new URL(request.url).pathname;
  if (!pathname.startsWith('/api/game/')) return null;

  const db = ctx?.DB;
  const store = ctx?.store ?? null;
  const tenantId = store?.tenantId ?? ctx?.tenantId ?? null;
  if (!db) return json({ error: 'Game context tidak lengkap.', code: 'GAME_CONTEXT_MISSING' }, 500);

  const enabled = await isTenantModuleEnabled(db, tenantId, GAME_MODULE_CODE);

  // Manifest sengaja tetap bisa dibaca saat GAME tidak terpasang. Client loader
  // memakai response kecil ini untuk memutuskan apakah bundle/aset Game perlu
  // dipanggil sama sekali.
  if (request.method === 'GET' && pathname === '/api/game/manifest') {
    return json({
      module: GAME_MODULE_CODE,
      enabled,
      tenantId,
      storeId: store?.id ?? null,
      games: enabled ? await activeCampaigns(db, store?.id) : []
    });
  }

  if (!enabled) {
    return json({
      error: 'Modul Game tidak terpasang pada tenant ini.',
      code: 'MODULE_NOT_INSTALLED',
      module: GAME_MODULE_CODE
    }, 403);
  }

  return json({ error: 'Route Game belum tersedia.', code: 'GAME_ROUTE_NOT_FOUND' }, 404);
}
