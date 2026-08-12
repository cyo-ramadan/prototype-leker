import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { resolveProductMasterReferences } from './manufacturing-master.js';

export async function handleAdminProductClassificationApi(request, env, pathname) {
  const match = pathname.match(/^\/api\/admin\/manufacturing\/products\/(\d+)$/);
  if (!match || request.method !== 'PATCH') return null;

  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const storeToken = url.searchParams.get('store') || DEFAULT_STORE_CODE;
  const store = await resolveStore(env.DB, storeToken, { includeInactive: true });
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload klasifikasi barang tidak valid.' }, 400);
  const refs = await resolveProductMasterReferences(
    env.DB,
    store.id,
    body.value?.itemTypeId,
    body.value?.baseUnitId
  );
  if (!refs.ok) return json({ error: refs.error }, 400);

  const productId = Number(match[1]);
  const result = await env.DB.prepare(`
    UPDATE products
    SET item_type_id = ?, base_unit_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND store_id = ?
  `).bind(refs.itemTypeId, refs.baseUnitId, productId, store.id).run();

  return Number(result.meta?.changes ?? 0) === 1
    ? json({ ok: true, productId, itemTypeId: refs.itemTypeId, baseUnitId: refs.baseUnitId })
    : json({ error: 'Barang tidak ditemukan di gerai ini.' }, 404);
}
