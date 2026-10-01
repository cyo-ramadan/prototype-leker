// Profil tampilan per tenant -- Bos Cyo, 2026-10-01 (HANDOFF-UIUX-SIAP-JUAL.md):
// "bikin suatu tombol dimana kalo tombol itu on, maka ui/ux akan mengikuti
// semua perubahan ... kalo suatu tenant meng-off-kan, ui/ux tetap seperti
// yang sekarang."
//
// Tombolnya adalah saklar kebijakan tenant UI_SKIN_SIAP_JUAL_KEY
// (src/tenant-policy.js) -- diubah Owner dari panel Kebijakan tenant.
// Endpoint ini menjawab "halaman ini pakai skin apa dan merek apa" (merek
// berlaku untuk semua tenant, skin hanya untuk tenant yang saklarnya ON),
// dibaca public/ui-skin.js di setiap halaman. Sengaja publik (halaman
// pelanggan juga memakainya) dan sengaja tidak mengembalikan id tenant.
import { json } from './http.js';
import { resolveStore } from './stores.js';
import { UI_SKIN_SIAP_JUAL_KEY, getTenantPolicySetting, resolveTenantId } from './tenant-policy.js';

export const UI_SKIN_CLASSIC = 'classic';
export const UI_SKIN_SIAP_JUAL = 'siap-jual';

// Satu-satunya tempat nama merek. Berlaku untuk SEMUA tenant (T1 handoff
// UI/UX, bukan bagian dari saklar skin). Nama produk final belum diputuskan
// Bos Cyo (kandidat: OwnerTenang / PantauGerai / GeraiJujur) -- ganti
// PRODUCT_BRAND_NAME saja. Tenant jaringan Leker sendiri tetap tampil
// "MAXI Leker" (handoff T1: "merek per tenant, bukan diganti paksa").
export const PRODUCT_BRAND_NAME = 'MAXI';
export const TENANT_BRAND_NAMES = Object.freeze({
  'TEN-PROTOTYPE': 'MAXI Leker',
  'TEN-HARILIBUR': 'MAXI Leker'
});

export function brandNameForTenant(tenantId) {
  if (!tenantId) return null;
  return TENANT_BRAND_NAMES[tenantId] || PRODUCT_BRAND_NAME;
}

async function tenantIdForContext(db, { storeCode, entityId }) {
  if (storeCode) {
    const store = await resolveStore(db, storeCode);
    return store?.tenantId ?? null;
  }
  if (entityId) return resolveTenantId(db, entityId);
  return null;
}

export async function resolveUiProfile(db, context = {}) {
  const tenantId = await tenantIdForContext(db, context);
  const on = tenantId ? await getTenantPolicySetting(db, tenantId, UI_SKIN_SIAP_JUAL_KEY) : false;
  return {
    skin: on ? UI_SKIN_SIAP_JUAL : UI_SKIN_CLASSIC,
    brandName: brandNameForTenant(tenantId)
  };
}

export async function handleUiProfileApi(request, env, pathname) {
  if (pathname !== '/api/ui-profile') return null;
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const url = new URL(request.url);
  const storeCode = String(url.searchParams.get('store') || '').trim().slice(0, 64);
  const entityId = String(url.searchParams.get('entity') || '').trim().slice(0, 180);
  return json(await resolveUiProfile(env.DB, { storeCode, entityId }));
}
