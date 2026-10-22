// Rekrutmen Fina -- paket H4 (contracts/fina-hr-paket-v1.md, migration 0176).
//
// Entity Admin / Owner:  /api/entity-admin/fina/lowongan (GET, POST, PATCH /:id)
//                        /api/entity-admin/fina/pelamar  (GET, PATCH /:id)
// Publik (tanpa login):  GET  /api/publik/loker/:slug   -> hanya lowongan TAYANG, tanpa data internal
//                        POST /api/publik/lamaran       -> honeypot + batas per nomor/hari + per IP/jam
// Fina (draft_loker) hanya bisa MEMBUAT lowongan DRAFT lewat POST; menayangkan, menutup, dan mengubah
// status pelamar (termasuk DITERIMA / DITOLAK) hanya tombol manusia. Nomor WA pelamar tidak pernah
// lewat jalur baca agen.

import { json, readJson } from './http.js';
import { ownerEntityContext } from './owner-entity-context.js';
import { hashCredential } from './owner-auth.js';

const BASE_LOWONGAN = '/api/entity-admin/fina/lowongan';
const BASE_PELAMAR = '/api/entity-admin/fina/pelamar';
const PUBLIK_LOKER = '/api/publik/loker/';
const PUBLIK_LAMARAN = '/api/publik/lamaran';

export const STATUS_LOWONGAN = Object.freeze(['DRAFT', 'TAYANG', 'TUTUP']);
export const STATUS_PELAMAR = Object.freeze(['BARU', 'SCREENING', 'INTERVIEW', 'DITERIMA', 'DITOLAK']);
export const SUMBER_PELAMAR = Object.freeze(['WEB', 'FB', 'IG', 'WA', 'LAIN']);
// Sumber yang boleh dipilih Admin saat input manual (0181).
export const SUMBER_PELAMAR_MANUAL = Object.freeze(['MANUAL', 'WA', 'IG', 'FB', 'EMAIL', 'WEB', 'LAIN']);
// Batas teknis anti-spam (bukan aturan HR tenant).
export const BATAS_LAMARAN = Object.freeze({ perNomorPerHari: 1, perIpPerJam: 10, maksBytes: 8 * 1024 });
const PANJANG = Object.freeze({ posisi: 80, deskripsi: 2000, syarat: 2000, jamKerja: 200, gajiTeks: 120, nama: 80, domisili: 120, pengalaman: 1000, catatan: 500 });

// eslint-disable-next-line no-control-regex
const KONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const teksBersih = (value, max) => String(value ?? '').replace(/\r\n?/g, '\n').replace(KONTROL, ' ').trim().slice(0, max);
const teksTerlalu = (value, max) => String(value ?? '').trim().length > max;

/** Nomor WA Indonesia dinormalkan ke 62xxxxxxxxx; null bila tidak wajar. */
export function normalkanNoWa(value) {
  let digit = String(value ?? '').replace(/[\s().-]/g, '');
  if (digit.startsWith('+')) digit = digit.slice(1);
  if (!/^\d+$/.test(digit)) return null;
  if (digit.startsWith('0')) digit = '62' + digit.slice(1);
  else if (digit.startsWith('8')) digit = '62' + digit;
  return /^628\d{7,12}$/.test(digit) ? digit : null;
}

export function slugLowongan(posisi, gerai = '') {
  const dasar = `${posisi} ${gerai}`.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'loker';
  const acak = Array.from(crypto.getRandomValues(new Uint8Array(3)), b => b.toString(36).padStart(2, '0')).join('').slice(0, 5);
  return `${dasar}-${acak}`;
}

function lowonganKe(row, { jumlahPelamar } = {}) {
  return {
    id: row.id, slug: row.slug, storeId: row.store_id || '', storeCode: row.store_code || '', posisi: row.posisi,
    deskripsi: row.deskripsi, syarat: row.syarat, jamKerja: row.jam_kerja, gajiTeks: row.gaji_teks, status: row.status,
    dibuatOleh: row.dibuat_oleh_role, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(jumlahPelamar ? { pelamar: jumlahPelamar } : {})
  };
}

function isianLowongan(v, { wajibPosisi }) {
  const out = {};
  if (v.posisi !== undefined || wajibPosisi) {
    if (teksTerlalu(v.posisi, PANJANG.posisi)) return { error: `Posisi maks ${PANJANG.posisi} huruf.` };
    out.posisi = teksBersih(v.posisi, PANJANG.posisi);
    if (!out.posisi) return { error: 'Posisi lowongan wajib diisi.' };
  }
  for (const [k, kolom] of [['deskripsi', 'deskripsi'], ['syarat', 'syarat'], ['jamKerja', 'jam_kerja'], ['gajiTeks', 'gaji_teks']]) {
    if (v[k] === undefined) continue;
    if (teksTerlalu(v[k], PANJANG[k])) return { error: `Isian ${k} maks ${PANJANG[k]} huruf.` };
    out[kolom] = teksBersih(v[k], PANJANG[k]);
  }
  return { out };
}

async function lowonganApi(request, env, pathname, context, actor) {
  const db = env.DB;
  const stores = new Map(context.stores.map(st => [st.id, st]));
  const byCode = new Map(context.stores.map(st => [String(st.code).toUpperCase(), st]));
  if (pathname === BASE_LOWONGAN && request.method === 'GET') {
    const rows = (await db.prepare(`SELECT l.*, s.code AS store_code FROM hr_lowongan l LEFT JOIN stores s ON s.id = l.store_id
      WHERE l.entity_id = ? ORDER BY l.created_at DESC LIMIT 200`).bind(context.entityId).all()).results ?? [];
    const hitung = (await db.prepare('SELECT lowongan_id, status, COUNT(*) AS n FROM hr_pelamar WHERE entity_id = ? GROUP BY lowongan_id, status')
      .bind(context.entityId).all()).results ?? [];
    const per = new Map();
    for (const h of hitung) per.set(h.lowongan_id, { ...(per.get(h.lowongan_id) || {}), [h.status]: Number(h.n) });
    return json({ lowongan: rows.map(r => lowonganKe(r, { jumlahPelamar: per.get(r.id) || {} })) });
  }
  if (pathname === BASE_LOWONGAN && request.method === 'POST') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);
    const v = body.value || {};
    const store = v.storeId || v.storeCode ? (stores.get(String(v.storeId || '')) || byCode.get(String(v.storeCode || '').toUpperCase())) : null;
    if ((v.storeId || v.storeCode) && !store) return json({ error: 'Gerai di luar entity ini.' }, 403);
    const isian = isianLowongan(v, { wajibPosisi: true });
    if (isian.error) return json({ error: isian.error }, 400);
    // Lowongan baru selalu DRAFT; tayang hanya lewat tombol Admin (PATCH).
    let slug = slugLowongan(isian.out.posisi, store?.code || '');
    for (let i = 0; i < 3 && await db.prepare('SELECT 1 FROM hr_lowongan WHERE slug = ?').bind(slug).first(); i += 1) slug = slugLowongan(isian.out.posisi, store?.code || '');
    const id = `lowongan_${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO hr_lowongan (id, entity_id, store_id, slug, posisi, deskripsi, syarat, jam_kerja, gaji_teks, status,
      dibuat_oleh_role, dibuat_oleh_id, diubah_oleh_role, diubah_oleh_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)`)
      .bind(id, context.entityId, store?.id || '', slug, isian.out.posisi, isian.out.deskripsi || '', isian.out.syarat || '',
        isian.out.jam_kerja || '', isian.out.gaji_teks || '', actor.role, actor.id, actor.role, actor.id).run();
    return json({ ok: true, id, slug, status: 'DRAFT' }, 201);
  }
  const m = pathname.match(/^\/api\/entity-admin\/fina\/lowongan\/([^/]+)$/);
  if (m && request.method === 'PATCH') {
    const id = decodeURIComponent(m[1]);
    const row = await db.prepare('SELECT * FROM hr_lowongan WHERE id = ? AND entity_id = ?').bind(id, context.entityId).first();
    if (!row) return json({ error: 'Lowongan tidak ditemukan.' }, 404);
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);
    const v = body.value || {};
    const isian = isianLowongan(v, { wajibPosisi: false });
    if (isian.error) return json({ error: isian.error }, 400);
    const ubah = { ...isian.out };
    if (v.status !== undefined) {
      if (!STATUS_LOWONGAN.includes(v.status)) return json({ error: 'Status lowongan harus DRAFT, TAYANG, atau TUTUP.' }, 400);
      ubah.status = v.status;
    }
    if (!Object.keys(ubah).length) return json({ error: 'Tidak ada yang diubah.' }, 400);
    const kolom = Object.keys(ubah);
    await db.prepare(`UPDATE hr_lowongan SET ${kolom.map(k => `${k} = ?`).join(', ')}, diubah_oleh_role = ?, diubah_oleh_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND entity_id = ?`).bind(...kolom.map(k => ubah[k]), actor.role, actor.id, id, context.entityId).run();
    return json({ ok: true });
  }
  return json({ error: 'Rute lowongan tidak ditemukan.' }, 404);
}

// Pelamar diinput manual oleh Admin (Karyawan -> Pelamar), atau nanti oleh Fina dari WA/email lewat
// draft + "Ya". Nomor WA yang sama di entity yang sama ditolak (409) supaya tidak dobel.
async function pelamarManual(request, db, context, actor) {
  const body = await readJson(request);
  if (!body.ok || !body.value || typeof body.value !== 'object') return json({ error: 'Payload tidak valid.' }, 400);
  const v = body.value;
  for (const [k, max] of [['nama', PANJANG.nama], ['domisili', PANJANG.domisili], ['pengalaman', PANJANG.pengalaman], ['catatan', PANJANG.catatan], ['posisi', PANJANG.posisi]]) {
    if (teksTerlalu(v[k], max)) return json({ error: `Isian ${k} maks ${max} huruf.` }, 400);
  }
  const nama = teksBersih(v.nama, PANJANG.nama);
  if (nama.length < 2) return json({ error: 'Nama pelamar wajib diisi.' }, 400);
  const noWa = normalkanNoWa(v.noWa);
  if (!noWa) return json({ error: 'Nomor WhatsApp belum benar (contoh 0812xxxxxxx).' }, 400);
  let umur = null;
  if (v.umur !== undefined && v.umur !== null && String(v.umur).trim() !== '') {
    umur = Number(v.umur);
    if (!Number.isInteger(umur) || umur < 14 || umur > 80) return json({ error: 'Umur harus 14–80 tahun.' }, 400);
  }
  const storeId = String(v.storeId ?? '').trim();
  if (storeId && !context.stores.some(st => st.id === storeId)) return json({ error: 'Gerai di luar entity ini.' }, 403);
  let lowongan = null;
  if (v.lowonganId) {
    lowongan = await db.prepare('SELECT id, posisi, store_id FROM hr_lowongan WHERE id = ? AND entity_id = ?').bind(String(v.lowonganId), context.entityId).first();
    if (!lowongan) return json({ error: 'Lowongan tidak ditemukan.' }, 404);
  }
  const sumber = SUMBER_PELAMAR_MANUAL.includes(String(v.sumber ?? '').toUpperCase()) ? String(v.sumber).toUpperCase() : 'MANUAL';
  const ada = await db.prepare(`SELECT id, nama FROM hr_pelamar WHERE entity_id = ? AND no_wa = ? AND status <> 'DITOLAK' LIMIT 1`).bind(context.entityId, noWa).first();
  if (ada) return json({ error: `Nomor ini sudah ada di data pelamar (${ada.nama}).`, code: 'PELAMAR_SUDAH_ADA', id: ada.id }, 409);
  const id = `pelamar_${crypto.randomUUID()}`;
  await db.prepare(`INSERT INTO hr_pelamar (id, lowongan_id, entity_id, nama, no_wa, domisili, umur, pengalaman, sumber, status, catatan,
    posisi, store_id, dibuat_oleh_role, dibuat_oleh_id, diubah_oleh_role, diubah_oleh_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'BARU', ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, lowongan?.id ?? null, context.entityId, nama, noWa, teksBersih(v.domisili, PANJANG.domisili), umur, teksBersih(v.pengalaman, PANJANG.pengalaman),
      sumber, teksBersih(v.catatan, PANJANG.catatan), teksBersih(v.posisi, PANJANG.posisi) || lowongan?.posisi || '', storeId || lowongan?.store_id || '',
      actor.role, actor.id, actor.role, actor.id).run();
  return json({ ok: true, id }, 201);
}

async function pelamarApi(request, env, pathname, context, actor) {
  const db = env.DB;
  if (pathname === BASE_PELAMAR && request.method === 'GET') {
    const url = new URL(request.url);
    const lowongan = url.searchParams.get('lowongan');
    const status = url.searchParams.get('status');
    const gerai = url.searchParams.get('store');
    // LEFT JOIN: pelamar yang diinput manual (0181) tidak selalu punya lowongan.
    const rows = (await db.prepare(`SELECT p.*, COALESCE(NULLIF(p.posisi, ''), l.posisi, '') AS posisi_tampil, s.code AS store_code
      FROM hr_pelamar p LEFT JOIN hr_lowongan l ON l.id = p.lowongan_id LEFT JOIN stores s ON s.id = p.store_id
      WHERE p.entity_id = ? ${lowongan ? 'AND p.lowongan_id = ?' : ''} ${status ? 'AND p.status = ?' : ''} ${gerai ? 'AND p.store_id = ?' : ''}
      ORDER BY p.created_at DESC LIMIT 300`)
      .bind(context.entityId, ...(lowongan ? [lowongan] : []), ...(status ? [status] : []), ...(gerai ? [gerai] : [])).all()).results ?? [];
    return json({ pelamar: rows.map(r => ({
      id: r.id, lowonganId: r.lowongan_id, posisi: r.posisi_tampil, storeId: r.store_id || '', storeCode: r.store_code || '',
      nama: r.nama, noWa: r.no_wa, domisili: r.domisili, umur: r.umur,
      pengalaman: r.pengalaman, sumber: r.sumber, status: r.status, catatan: r.catatan, createdAt: r.created_at, updatedAt: r.updated_at
    })) });
  }
  if (pathname === BASE_PELAMAR && request.method === 'POST') return pelamarManual(request, db, context, actor);
  const m = pathname.match(/^\/api\/entity-admin\/fina\/pelamar\/([^/]+)$/);
  if (m && request.method === 'PATCH') {
    const id = decodeURIComponent(m[1]);
    const row = await db.prepare('SELECT id FROM hr_pelamar WHERE id = ? AND entity_id = ?').bind(id, context.entityId).first();
    if (!row) return json({ error: 'Pelamar tidak ditemukan.' }, 404);
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);
    const v = body.value || {};
    const ubah = {};
    if (v.status !== undefined) {
      if (!STATUS_PELAMAR.includes(v.status)) return json({ error: `Status pelamar harus salah satu dari ${STATUS_PELAMAR.join(', ')}.` }, 400);
      ubah.status = v.status;
    }
    if (v.catatan !== undefined) {
      if (teksTerlalu(v.catatan, PANJANG.catatan)) return json({ error: `Catatan maks ${PANJANG.catatan} huruf.` }, 400);
      ubah.catatan = teksBersih(v.catatan, PANJANG.catatan);
    }
    if (!Object.keys(ubah).length) return json({ error: 'Tidak ada yang diubah.' }, 400);
    const kolom = Object.keys(ubah);
    await db.prepare(`UPDATE hr_pelamar SET ${kolom.map(k => `${k} = ?`).join(', ')}, diubah_oleh_role = ?, diubah_oleh_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND entity_id = ?`).bind(...kolom.map(k => ubah[k]), actor.role, actor.id, id, context.entityId).run();
    return json({ ok: true });
  }
  return json({ error: 'Rute pelamar tidak ditemukan.' }, 404);
}

async function lokerPublik(env, slug) {
  const row = await env.DB.prepare(`SELECT l.posisi, l.deskripsi, l.syarat, l.jam_kerja, l.gaji_teks, l.slug, s.store_name, e.name AS entity_name
    FROM hr_lowongan l JOIN entities e ON e.id = l.entity_id LEFT JOIN stores s ON s.id = l.store_id
    WHERE l.slug = ? AND l.status = 'TAYANG'`).bind(slug).first();
  if (!row) return json({ error: 'Lowongan tidak ditemukan atau sudah ditutup.' }, 404);
  // Hanya isi yang memang untuk umum: tanpa id, entity_id, store_id, pembuat, atau jumlah pelamar.
  return json({ loker: { slug: row.slug, posisi: row.posisi, usaha: row.entity_name || '', gerai: row.store_name || '', deskripsi: row.deskripsi,
    syarat: row.syarat, jamKerja: row.jam_kerja, gajiTeks: row.gaji_teks } });
}

async function lamaranPublik(request, env, now) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > BATAS_LAMARAN.maksBytes) return json({ error: 'Isian terlalu panjang.' }, 413);
  const body = await readJson(request);
  if (!body.ok || !body.value || typeof body.value !== 'object') return json({ error: 'Isian lamaran tidak terbaca.' }, 400);
  const v = body.value;
  // Honeypot: kolom tersembunyi yang hanya diisi robot. Dibalas "terkirim" supaya robot tidak belajar.
  if (String(v.website ?? '').trim()) return json({ ok: true });
  const db = env.DB;
  const row = await db.prepare(`SELECT id, entity_id, posisi, store_id FROM hr_lowongan WHERE slug = ? AND status = 'TAYANG'`).bind(String(v.slug ?? '').slice(0, 80)).first();
  if (!row) return json({ error: 'Lowongan tidak ditemukan atau sudah ditutup.' }, 404);
  for (const [k, max] of [['nama', PANJANG.nama], ['domisili', PANJANG.domisili], ['pengalaman', PANJANG.pengalaman]]) {
    if (teksTerlalu(v[k], max)) return json({ error: `Isian ${k} maks ${max} huruf.` }, 400);
  }
  const nama = teksBersih(v.nama, PANJANG.nama);
  if (nama.length < 2) return json({ error: 'Nama wajib diisi.' }, 400);
  const noWa = normalkanNoWa(v.noWa);
  if (!noWa) return json({ error: 'Nomor WhatsApp belum benar (contoh 0812xxxxxxx).' }, 400);
  let umur = null;
  if (v.umur !== undefined && v.umur !== null && String(v.umur).trim() !== '') {
    umur = Number(v.umur);
    if (!Number.isInteger(umur) || umur < 14 || umur > 80) return json({ error: 'Umur harus 14–80 tahun.' }, 400);
  }
  const sumber = SUMBER_PELAMAR.includes(String(v.sumber ?? '').toUpperCase()) ? String(v.sumber).toUpperCase() : 'WEB';
  const ipHash = (await hashCredential(`loker:${request.headers.get('cf-connecting-ip') || ''}`)).slice(0, 32);
  const jamLalu = new Date(now.getTime() - 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const hariLalu = new Date(now.getTime() - 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const perIp = await db.prepare('SELECT COUNT(*) AS n FROM hr_pelamar WHERE ip_hash = ? AND created_at > ?').bind(ipHash, jamLalu).first();
  if (Number(perIp?.n || 0) >= BATAS_LAMARAN.perIpPerJam) return json({ error: 'Terlalu banyak lamaran dari jaringan ini. Coba lagi nanti.' }, 429);
  const perNomor = await db.prepare('SELECT COUNT(*) AS n FROM hr_pelamar WHERE lowongan_id = ? AND no_wa = ? AND created_at > ?').bind(row.id, noWa, hariLalu).first();
  if (Number(perNomor?.n || 0) >= BATAS_LAMARAN.perNomorPerHari) return json({ error: 'Nomor ini sudah mengirim lamaran untuk lowongan ini hari ini.' }, 429);
  const id = `pelamar_${crypto.randomUUID()}`;
  await db.prepare(`INSERT INTO hr_pelamar (id, lowongan_id, entity_id, posisi, store_id, nama, no_wa, domisili, umur, pengalaman, jawaban, sumber, status, ip_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, 'BARU', ?, ?, ?)`).bind(id, row.id, row.entity_id, row.posisi || '', row.store_id || '', nama, noWa, teksBersih(v.domisili, PANJANG.domisili), umur,
    teksBersih(v.pengalaman, PANJANG.pengalaman), sumber, ipHash, now.toISOString().replace('T', ' ').slice(0, 19), now.toISOString().replace('T', ' ').slice(0, 19)).run();
  return json({ ok: true }, 201);
}

export async function handleFinaRekrutApi(request, env, pathname, { now = new Date() } = {}) {
  if (pathname.startsWith(PUBLIK_LOKER)) {
    if (request.method !== 'GET') return json({ error: 'Method tidak didukung.' }, 405);
    return lokerPublik(env, decodeURIComponent(pathname.slice(PUBLIK_LOKER.length)).slice(0, 80));
  }
  if (pathname === PUBLIK_LAMARAN) {
    if (request.method !== 'POST') return json({ error: 'Method tidak didukung.' }, 405);
    return lamaranPublik(request, env, now);
  }
  const lowongan = pathname === BASE_LOWONGAN || pathname.startsWith(BASE_LOWONGAN + '/');
  const pelamar = pathname === BASE_PELAMAR || pathname.startsWith(BASE_PELAMAR + '/');
  if (!lowongan && !pelamar) return null;
  const context = await ownerEntityContext(request, env, { allowEntityAdminOutsideSkin: true });
  if (context.response) return context.response;
  const actor = context.entityAdmin ? { role: 'ENTITY_ADMIN', id: context.entityAdmin.id } : { role: 'OWNER', id: context.owner?.id || '' };
  return lowongan ? lowonganApi(request, env, pathname, context, actor) : pelamarApi(request, env, pathname, context, actor);
}
