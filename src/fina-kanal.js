// Sambungan Fina per entity (Bos Cyo, 2026-10-22, migration 0183): WA, email, Instagram, Facebook
// milik tenant dihubungkan ke Fina dari Entity Admin -> Pengaturan -> Sambungan Fina.
//
//   GET  /api/entity-admin/fina/kanal               -> status keempat sambungan
//   PUT  /api/entity-admin/fina/kanal               -> { jenis, aktif, identitas, catatan }
//   POST /api/entity-admin/fina/kanal/WA/token      -> token gateway baru (tampil sekali, disimpan hash)
//
// WA memakai gateway lokal di laptop (wa-gateway/, perangkat tertaut -- jalur tidak resmi yang dipilih
// Bos karena WA resmi mahal). Gateway membawa token ini saat meneruskan pesan dan mengambil antrean
// pesan keluar yang sudah disetujui (tahap 2). Hanya Entity Admin / Owner.

import { json, readJson } from './http.js';
import { ownerEntityContext } from './owner-entity-context.js';
import { hashCredential } from './owner-auth.js';

const BASE = '/api/entity-admin/fina/kanal';
export const JENIS_KANAL = Object.freeze(['WA', 'EMAIL', 'IG', 'FB']);
const LABEL = Object.freeze({ WA: 'WhatsApp', EMAIL: 'Email', IG: 'Instagram', FB: 'Facebook' });
const PANJANG = Object.freeze({ identitas: 120, catatan: 300 });
// Gateway dianggap tersambung bila melapor dalam 10 menit terakhir.
const SEGAR_MS = 10 * 60 * 1000;

// eslint-disable-next-line no-control-regex
const bersih = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

/** Status yang bisa dipahami Admin, dihitung kode dari baris tersimpan (fungsi murni). */
export function statusKanal(jenis, row, sekarang = new Date()) {
  const aktif = Number(row?.aktif) === 1;
  if (jenis === 'WA') {
    if (!aktif) return { kode: 'MATI', teks: 'Mati' };
    if (!row?.token_hash) return { kode: 'PERLU_TOKEN', teks: 'Buat token gateway, lalu tempel di gateway WA laptop' };
    const lihat = row?.terakhir_terlihat ? Date.parse(row.terakhir_terlihat) : NaN;
    if (Number.isFinite(lihat) && sekarang.getTime() - lihat <= SEGAR_MS) return { kode: 'TERSAMBUNG', teks: 'Tersambung' };
    return { kode: 'MENUNGGU', teks: Number.isFinite(lihat) ? 'Gateway tidak melapor lebih dari 10 menit (laptop mati / offline?)' : 'Menunggu gateway pertama kali melapor' };
  }
  if (jenis === 'EMAIL') return aktif
    ? { kode: 'MENUNGGU', teks: 'Disimpan. Penerusan email masuk ke Fina disiapkan tahap berikutnya (butuh domain email di Cloudflare).' }
    : { kode: 'MATI', teks: 'Mati' };
  return aktif
    ? { kode: 'MANUAL', teks: 'Akun dicatat. Belum bisa otomatis (akun Meta dibatasi); Fina menyiapkan teks untuk diposting manual.' }
    : { kode: 'MATI', teks: 'Mati' };
}

function kanalKe(jenis, row, sekarang) {
  return {
    jenis, label: LABEL[jenis], aktif: Number(row?.aktif) === 1, identitas: row?.identitas || '', catatan: row?.catatan || '',
    adaToken: Boolean(row?.token_hash), tokenDibuatAt: row?.token_dibuat_at || null, terakhirTerlihat: row?.terakhir_terlihat || null,
    status: statusKanal(jenis, row, sekarang)
  };
}

async function simpanBaris(db, entityId, jenis, kolom, actor) {
  const nama = Object.keys(kolom);
  await db.prepare(`INSERT INTO hr_kanal (entity_id, jenis, ${nama.join(', ')}, updated_by_role, updated_by_id) VALUES (?, ?, ${nama.map(() => '?').join(', ')}, ?, ?)
    ON CONFLICT (entity_id, jenis) DO UPDATE SET ${nama.map(k => `${k} = excluded.${k}`).join(', ')}, updated_at = CURRENT_TIMESTAMP,
      updated_by_role = excluded.updated_by_role, updated_by_id = excluded.updated_by_id`)
    .bind(entityId, jenis, ...nama.map(k => kolom[k]), actor.role, actor.id).run();
}

/** Token gateway baru: acak 256-bit, awalan "otwa_" supaya mudah dikenali. Yang disimpan hanya hash. */
export async function buatTokenGateway() {
  const acak = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  const token = `otwa_${acak}`;
  return { token, hash: await hashCredential(token) };
}

/** Kanal WA milik token gateway (dipakai rute gateway tahap 2). null bila token tidak dikenal/mati. */
export async function kanalDariToken(db, token) {
  if (!/^otwa_[0-9a-f]{64}$/.test(String(token ?? ''))) return null;
  const row = await db.prepare(`SELECT * FROM hr_kanal WHERE jenis = 'WA' AND token_hash = ? AND aktif = 1`).bind(await hashCredential(token)).first();
  return row || null;
}

export async function handleFinaKanalApi(request, env, pathname, { now = new Date() } = {}) {
  if (pathname !== BASE && !pathname.startsWith(`${BASE}/`)) return null;
  const context = await ownerEntityContext(request, env, { allowEntityAdminOutsideSkin: true });
  if (context.response) return context.response;
  const db = env.DB;
  const actor = context.entityAdmin ? { role: 'ENTITY_ADMIN', id: context.entityAdmin.id } : { role: 'OWNER', id: context.owner?.id || '' };
  const baris = async () => new Map(((await db.prepare('SELECT * FROM hr_kanal WHERE entity_id = ?').bind(context.entityId).all()).results ?? []).map(r => [r.jenis, r]));

  if (pathname === BASE && request.method === 'GET') {
    const rows = await baris();
    return json({ kanal: JENIS_KANAL.map(j => kanalKe(j, rows.get(j), now)) });
  }
  if (pathname === BASE && request.method === 'PUT') {
    const body = await readJson(request);
    if (!body.ok || !body.value) return json({ error: 'Payload tidak valid.' }, 400);
    const v = body.value;
    const jenis = String(v.jenis ?? '').toUpperCase();
    if (!JENIS_KANAL.includes(jenis)) return json({ error: 'Jenis sambungan harus WA, EMAIL, IG, atau FB.' }, 400);
    if (typeof v.aktif !== 'boolean') return json({ error: 'Saklar sambungan harus nyala atau mati.' }, 400);
    if (String(v.identitas ?? '').trim().length > PANJANG.identitas) return json({ error: `Identitas maks ${PANJANG.identitas} huruf.` }, 400);
    if (String(v.catatan ?? '').trim().length > PANJANG.catatan) return json({ error: `Catatan maks ${PANJANG.catatan} huruf.` }, 400);
    await simpanBaris(db, context.entityId, jenis, { aktif: v.aktif ? 1 : 0, identitas: bersih(v.identitas, PANJANG.identitas), catatan: bersih(v.catatan, PANJANG.catatan) }, actor);
    const rows = await baris();
    return json({ ok: true, kanal: kanalKe(jenis, rows.get(jenis), now) });
  }
  if (pathname === `${BASE}/WA/token` && request.method === 'POST') {
    const { token, hash } = await buatTokenGateway();
    // Token lama langsung tidak berlaku: gateway yang memakainya harus diisi token baru.
    await simpanBaris(db, context.entityId, 'WA', { token_hash: hash, token_dibuat_at: now.toISOString(), terakhir_terlihat: null }, actor);
    return json({ ok: true, token, catatan: 'Salin sekarang: token hanya ditampilkan sekali. Tempel di gateway WA di laptop.' });
  }
  return json({ error: 'Rute sambungan Fina tidak ditemukan.' }, 404);
}
