// Profil tampilan per tenant -- Bos Cyo, 2026-10-01 (HANDOFF-UIUX-SIAP-JUAL.md):
// "bikin suatu tombol dimana kalo tombol itu on, maka ui/ux akan mengikuti
// semua perubahan ... kalo suatu tenant meng-off-kan, ui/ux tetap seperti
// yang sekarang."
//
// Tombolnya adalah pilihan kebijakan tenant UI_SKIN_KEY (0/A/B/C,
// src/tenant-policy.js) -- diubah Owner dari panel Kebijakan tenant.
// Endpoint ini menjawab "halaman ini pakai skin apa dan merek apa" (merek
// berlaku untuk semua tenant, skin hanya untuk tenant yang memilih A/B/C),
// dibaca public/ui-skin.js di setiap halaman. Sengaja publik (halaman
// pelanggan juga memakainya) dan sengaja tidak mengembalikan id tenant.
import { json } from './http.js';
import { resolveStore } from './stores.js';
import { UI_SKIN_KEY, getTenantPolicyChoice, resolveTenantId } from './tenant-policy.js';

export const UI_SKIN_CLASSIC = 'classic';
// Pilihan Owner (0/A/B/C) -> kode skin yang dipakai halaman (<html data-skin>
// dan file /skin-<kode>.css). 0 = tampilan sekarang, tanpa data-skin.
const SKIN_BY_CHOICE = Object.freeze({ A: 'a', B: 'b', C: 'c', D: 'd', E: 'e' });

// Satu-satunya tempat nama merek, sama untuk SEMUA tenant (Bos Cyo
// 2026-10-01: handoff UI/UX "dikerjakan buat universal", bukan khusus
// Leker). Bos Cyo 2026-10-05: "ganti merek ownertenang" -- merek final
// OwnerTenang (HANDOFF-STRATEGI-PENJUALAN.md §10). Teks bawaan HTML masih
// "MAXI" sebagai nilai awal sebelum server menjawab; public/ui-skin.js
// menggantinya. Halaman pesan pelanggan TIDAK ikut (tetap bermerek gerai).
export const PRODUCT_BRAND_NAME = 'OwnerTenang';

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
  const choice = tenantId ? await getTenantPolicyChoice(db, tenantId, UI_SKIN_KEY) : '0';
  return {
    skin: SKIN_BY_CHOICE[choice] || UI_SKIN_CLASSIC,
    brandName: PRODUCT_BRAND_NAME
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
