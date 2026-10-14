import { json } from './http.js';
import { UI_SKIN_KEY, normalizePolicyValue } from './tenant-policy.js';
import { uiProfileFromChoice } from './ui-profile.js';
const KEY = 'una_nama_asisten';
export function namaAsistenValid(value) {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  const nama = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return /^[\p{L}][\p{L}\p{M} .'-]{0,31}$/u.test(nama) ? nama : null;
}
// One bounded server-side lookup for current tenancy, policy skin and display
// name. The entity comes from validated auth/store scope, never a client field.
export async function bacaKonteksAsisten(db, entityId) {
  const row = entityId ? await db.prepare(`SELECT et.tenant_id,e.id AS entity_id,t.status AS tenant_status,e.status AS entity_status,
    (SELECT CASE WHEN length(p.setting_value)=1 THEN p.setting_value ELSE '0' END FROM tenant_policy_settings p WHERE p.tenant_id=et.tenant_id AND p.setting_key=? LIMIT 1) AS ui_skin,
    (SELECT CASE WHEN length(p.setting_value)<=32 THEN p.setting_value ELSE '' END FROM tenant_policy_settings p WHERE p.tenant_id=et.tenant_id AND p.setting_key=? LIMIT 1) AS nama_asisten
    FROM entity_tenancy et JOIN entities e ON e.id=et.entity_id JOIN tenants t ON t.id=et.tenant_id
    WHERE et.entity_id=? AND et.effective_to IS NULL LIMIT 1`).bind(UI_SKIN_KEY,KEY,entityId).first() : null;
  return {
    tenantId: row?.tenant_id ?? null,
    aktif: row?.tenant_status === 'ACTIVE' && row?.entity_status === 'ACTIVE',
    namaAsisten: namaAsistenValid(row?.nama_asisten) || 'Una',
    profil: uiProfileFromChoice(normalizePolicyValue(UI_SKIN_KEY,row?.ui_skin ?? '0'))
  };
}
export async function bacaPengaturanAsisten(db, tenantId) {
  if (!tenantId) return { namaAsisten: 'Una' };
  const row = await db.prepare('SELECT setting_value FROM tenant_policy_settings WHERE tenant_id = ? AND setting_key = ?').bind(tenantId, KEY).first();
  return { namaAsisten: namaAsistenValid(row?.setting_value) || 'Una' };
}
export function sesuaikanNamaBalasan(hasil, nama = 'Una') {
  if (!hasil || nama === 'Una') return hasil;
  const ganti = teks => typeof teks === 'string' ? teks.replace(/\b(?:Una|Maimunah)\b/g, () => nama) : teks;
  // Jangan ubah isi draft, tangkapan, rahasia, tabel, atau pesan asli Bos.
  return { ...hasil, jawaban: ganti(hasil.jawaban), sapaan: ganti(hasil.sapaan), peringatan: ganti(hasil.peringatan), tawaran: hasil.tawaran?.map(t => ({ ...t, label: ganti(t.label) })) ?? hasil.tawaran };
}
export async function handlePengaturanAsisten(request, env, bangunLingkup) {
  const url = new URL(request.url);
  // Tanpa lingkup eksplisit, jangan jatuh ke gerai bawaan yang kebetulan milik pengguna.
  if (!url.searchParams.get('store') && url.searchParams.get('lingkup') !== 'entity') return json({ error: 'Pilih gerai atau lingkup entity terlebih dahulu.' },400);
  const lingkup = await bangunLingkup(request, env);
  if (!lingkup.ok) return lingkup.response;
  if (!lingkup.tenantId || !lingkup.principal?.id || lingkup.store?.isActive === false) return json({ error: 'Tenant atau gerai aktif belum tersedia.' },409);
  if (!lingkup.asistenAktif) return json({ error: 'Tenant atau entity tidak aktif.' },403);
  if (request.method === 'GET') return json({ namaAsisten: lingkup.konteks.namaAsisten, ruangSuara: `${lingkup.tenantId}:${lingkup.principal.role}:${lingkup.principal.id}`, skin: lingkup.konteks.skin });
  if (request.method !== 'PATCH') return json({ error: 'Method not allowed' },405);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: 'Pengaturan belum dikirim.' },400);
  const parts = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1024) { await reader.cancel(); return json({ error: 'Isian pengaturan terlalu panjang.' },413); } parts.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part,offset); offset += part.length; }
  let body; try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ error: 'Pengaturan tidak valid.' },400); }
  const nama = namaAsistenValid(body?.namaAsisten);
  if (!nama) return json({ error: 'Nama asisten harus 1–32 karakter, memakai huruf, spasi, titik, apostrof atau tanda hubung.' },400);
  await env.DB.prepare(`INSERT INTO tenant_policy_settings (tenant_id,setting_key,setting_value,updated_by_role,updated_by_id) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=CURRENT_TIMESTAMP,updated_by_role=excluded.updated_by_role,updated_by_id=excluded.updated_by_id`).bind(lingkup.tenantId,KEY,nama,lingkup.principal.role,lingkup.principal.id).run();
  return json({ namaAsisten: nama });
}
