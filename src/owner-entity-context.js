import { json } from './http.js';
import { ownerFromRequest, entityAdminFromRequest } from './owner-auth.js';
import { resolveStore, listStores } from './stores.js';
import { resolveTenantId, getTenantPolicyChoice, UI_SKIN_KEY } from './tenant-policy.js';

// Satu pagar akses untuk seluruh fitur portal Owner/Admin Entity skin H.
// Route lama boleh dipakai Owner hanya saat entity aktif, tenant masih sama,
// dan skin yang sedang berlaku benar-benar H. Dengan begitu mengganti skin
// langsung mematikan semua kemampuan khusus, bukan hanya menyembunyikan UI.
export async function ownerEntityContext(request, env, { allowEntityAdminOutsideSkin = false } = {}) {
  const owner = await ownerFromRequest(request, env.DB);
  const entityAdmin = owner ? null : await entityAdminFromRequest(request, env.DB);
  if (!owner && !entityAdmin) {
    return { response: json({ error: 'Login pemilik atau Admin Entity diperlukan.' }, 401) };
  }

  const url = new URL(request.url);
  const anchorToken = url.searchParams.get('store');
  const anchor = anchorToken ? await resolveStore(env.DB, anchorToken) : null;
  if (anchorToken && !anchor) return { response: json({ error: 'Gerai tidak ditemukan.' }, 404) };

  const entityId = url.searchParams.get('entity') || anchor?.entityId || entityAdmin?.entityId;
  if (!entityId || (anchor && anchor.entityId !== entityId) || (entityAdmin && entityAdmin.entityId !== entityId)) {
    return { response: json({ error: 'Entity di luar kewenangan akun ini.' }, 403) };
  }

  const entity = await env.DB.prepare('SELECT id, name, status FROM entities WHERE id = ?').bind(entityId).first();
  if (!entity || entity.status !== 'ACTIVE') return { response: json({ error: 'Entity tidak aktif.' }, 404) };

  const tenantId = await resolveTenantId(env.DB, entityId);
  if (await getTenantPolicyChoice(env.DB, tenantId, UI_SKIN_KEY) !== 'H' && !(entityAdmin && allowEntityAdminOutsideSkin)) {
    return { response: json({ error: 'Portal khusus ini hanya tersedia pada skin H.', code: 'OWNER_ENTITY_SKIN_REQUIRED' }, 403) };
  }

  const stores = (await listStores(env.DB)).filter(store => store.entityId === entityId && store.tenantId === tenantId);
  return { owner, entityAdmin, entity, entityId, tenantId, stores };
}
