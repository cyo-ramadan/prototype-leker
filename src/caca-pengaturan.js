import { json } from './http.js';
const KEY = 'una_nama_asisten';
export function namaAsistenValid(value) {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  const nama = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return /^[\p{L}][\p{L}\p{M} .'-]{0,31}$/u.test(nama) ? nama : null;
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
  const aktif = await env.DB.prepare("SELECT t.id FROM tenants t JOIN entity_tenancy et ON et.tenant_id=t.id AND et.effective_to IS NULL JOIN entities e ON e.id=et.entity_id WHERE t.id=? AND e.id=? AND t.status='ACTIVE' AND e.status='ACTIVE'").bind(lingkup.tenantId, lingkup.store?.entityId || lingkup.entityId).first();
  if (!aktif) return json({ error: 'Tenant atau entity tidak aktif.' },403);
  if (request.method === 'GET') return json({ ...await bacaPengaturanAsisten(env.DB,lingkup.tenantId), ruangSuara: `${lingkup.tenantId}:${lingkup.principal.role}:${lingkup.principal.id}`, skin: lingkup.konteks.skin });
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
