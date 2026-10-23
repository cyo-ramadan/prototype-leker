// WA Fina lewat gateway lokal di laptop (Bos Cyo, 2026-10-22; migration 0184, Sambungan Fina 0183).
//
// Gateway (wa-gateway/jembatan.mjs) memakai token Sambungan Fina (Bearer otwa_...):
//   POST /api/fina/wa/gateway/masuk            -> meneruskan pesan personal masuk (dedup per id pesan)
//   GET  /api/fina/wa/gateway/keluar           -> mengambil pesan DISETUJUI (dibatasi per jam & per nomor)
//   POST /api/fina/wa/gateway/keluar/:id/hasil -> { ok, alasan } -> DIKIRIM / GAGAL
// Entity Admin / Owner:
//   GET   /api/entity-admin/fina/wa/masuk       PATCH /api/entity-admin/fina/wa/masuk/:id
//   GET   /api/entity-admin/fina/wa/keluar      POST  /api/entity-admin/fina/wa/keluar
//   POST  /api/entity-admin/fina/wa/keluar/:id/setujui|batal
//   GET   /api/entity-admin/fina/wa/kontak-cs?store=   (CS gerai yang punya nomor; nomor TIDAK dikirim)
//
// Pengaman: pesan keluar hanya DISETUJUI manusia (tombol Setujui atau "Ya" pada draft Fina), tanpa
// broadcast; batas kirim per entity per jam & per nomor per hari (jalur WA tidak resmi rawan blokir).
// Alat Fina menyebut pelamarId / employeeId; nomor dicari di server, tidak pernah lewat model.

import { json, readJson } from './http.js';
import { ownerEntityContext } from './owner-entity-context.js';
import { kanalDariToken } from './fina-kanal.js';
import { normalkanNoWa } from './fina-rekrut.js';

export const BATAS_WA = Object.freeze({ kirimPerJam: 20, kirimPerNomorPerHari: 3, ambilSekali: 5, pesanSekali: 50, maksBytes: 256 * 1024, teksMaks: 2000, diambilKadaluarsaMenit: 10 });
const ISI_MAKS = 4000;
// eslint-disable-next-line no-control-regex
const bersih = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, max);
const sqlWaktu = d => d.toISOString().replace('T', ' ').slice(0, 19);

/** Nomor tersamar untuk tampilan/draft: 6281234567890 -> 0812****7890. */
export function samarkanNomor(no) {
  const n = String(no ?? '');
  if (n.length < 8) return '****';
  const lokal = n.startsWith('62') ? `0${n.slice(2)}` : n;
  return `${lokal.slice(0, 4)}****${lokal.slice(-4)}`;
}

async function kenaliPengirim(db, entityId, noWa) {
  if (!noWa) return { pengirim: 'ASING' };
  const pelamar = await db.prepare(`SELECT id FROM hr_pelamar WHERE entity_id = ? AND no_wa = ? ORDER BY created_at DESC LIMIT 1`).bind(entityId, noWa).first();
  if (pelamar) return { pengirim: 'PELAMAR', pelamarId: pelamar.id };
  const karyawan = (await db.prepare(`SELECT id, phone FROM employees WHERE entity_id = ? AND phone IS NOT NULL AND phone <> '' LIMIT 3000`).bind(entityId).all()).results ?? [];
  const cocok = karyawan.find(e => normalkanNoWa(e.phone) === noWa);
  return cocok ? { pengirim: 'KARYAWAN', employeeId: cocok.id } : { pengirim: 'ASING' };
}

async function tandaiTerlihat(db, kanal, now) {
  await db.prepare(`UPDATE hr_kanal SET terakhir_terlihat = ? WHERE entity_id = ? AND jenis = 'WA'`).bind(now.toISOString(), kanal.entity_id).run();
}

async function gatewayApi(request, env, pathname, now) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const kanal = await kanalDariToken(env.DB, token);
  if (!kanal) return json({ error: 'Token gateway tidak dikenal atau sambungan WA dimatikan.' }, 401);
  const db = env.DB;
  await tandaiTerlihat(db, kanal, now);

  if (pathname === '/api/fina/wa/gateway/masuk' && request.method === 'POST') {
    if (Number(request.headers.get('content-length') || 0) > BATAS_WA.maksBytes) return json({ error: 'Kiriman terlalu besar.' }, 413);
    const body = await readJson(request);
    const daftar = Array.isArray(body.ok ? body.value?.pesan : null) ? body.value.pesan.slice(0, BATAS_WA.pesanSekali) : null;
    if (!daftar) return json({ error: 'Isi kiriman harus { pesan: [...] }.' }, 400);
    let baru = 0;
    for (const p of daftar) {
      const waId = bersih(p?.waId, 200);
      const jid = bersih(p?.jid, 120);
      if (!waId || !/^[0-9]+@(s\.whatsapp\.net|lid)$/.test(jid)) continue;
      const noWa = normalkanNoWa(p?.noWa) || normalkanNoWa(jid.endsWith('@s.whatsapp.net') ? jid.split('@')[0] : '') || '';
      const dikenal = await kenaliPengirim(db, kanal.entity_id, noWa);
      const waktu = Number(p?.waktu) > 0 ? new Date(Number(p.waktu) * 1000) : null;
      const hasil = await db.prepare(`INSERT OR IGNORE INTO hr_wa_masuk (id, entity_id, wa_id, jid, no_wa, nama_wa, teks, jenis_media, dikirim_at, diterima_at, pengirim, pelamar_id, employee_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(`wamasuk_${crypto.randomUUID()}`, kanal.entity_id, waId, jid, noWa, bersih(p?.nama, 150), bersih(p?.teks, ISI_MAKS),
        bersih(p?.jenisMedia, 40), waktu && !Number.isNaN(waktu.getTime()) ? waktu.toISOString() : null, sqlWaktu(now), dikenal.pengirim, dikenal.pelamarId ?? null, dikenal.employeeId ?? null).run();
      baru += Number(hasil?.meta?.changes || 0);
    }
    return json({ ok: true, diterima: daftar.length, baru });
  }

  if (pathname === '/api/fina/wa/gateway/keluar' && request.method === 'GET') {
    // Pesan yang diambil tapi tidak dilaporkan (gateway mati) ditawarkan lagi setelah 10 menit.
    const kadaluarsa = sqlWaktu(new Date(now.getTime() - BATAS_WA.diambilKadaluarsaMenit * 60000));
    await db.prepare(`UPDATE hr_wa_keluar SET status = 'DISETUJUI', diambil_at = NULL WHERE entity_id = ? AND status = 'DIAMBIL' AND diambil_at < ?`).bind(kanal.entity_id, kadaluarsa).run();
    const jamLalu = sqlWaktu(new Date(now.getTime() - 3600000));
    const hariLalu = sqlWaktu(new Date(now.getTime() - 86400000));
    const terkirimJam = Number((await db.prepare(`SELECT COUNT(*) AS n FROM hr_wa_keluar WHERE entity_id = ? AND status IN ('DIKIRIM', 'DIAMBIL') AND COALESCE(dikirim_at, diambil_at) > ?`).bind(kanal.entity_id, jamLalu).first())?.n || 0);
    const sisa = Math.max(0, Math.min(BATAS_WA.ambilSekali, BATAS_WA.kirimPerJam - terkirimJam));
    if (!sisa) return json({ pesan: [], catatan: 'Batas kirim per jam tercapai.' });
    const calon = (await db.prepare(`SELECT id, no_wa, teks FROM hr_wa_keluar WHERE entity_id = ? AND status = 'DISETUJUI' ORDER BY disetujui_at LIMIT 20`).bind(kanal.entity_id).all()).results ?? [];
    const keluar = [];
    for (const m of calon) {
      if (keluar.length >= sisa) break;
      const perNomor = Number((await db.prepare(`SELECT COUNT(*) AS n FROM hr_wa_keluar WHERE entity_id = ? AND no_wa = ? AND status IN ('DIKIRIM', 'DIAMBIL') AND COALESCE(dikirim_at, diambil_at) > ?`).bind(kanal.entity_id, m.no_wa, hariLalu).first())?.n || 0);
      if (perNomor >= BATAS_WA.kirimPerNomorPerHari) continue;
      const ambil = await db.prepare(`UPDATE hr_wa_keluar SET status = 'DIAMBIL', diambil_at = ? WHERE id = ? AND status = 'DISETUJUI'`).bind(sqlWaktu(now), m.id).run();
      if (Number(ambil?.meta?.changes || 0)) keluar.push({ id: m.id, noWa: m.no_wa, teks: m.teks });
    }
    return json({ pesan: keluar });
  }

  const hasil = pathname.match(/^\/api\/fina\/wa\/gateway\/keluar\/([^/]+)\/hasil$/);
  if (hasil && request.method === 'POST') {
    const body = await readJson(request);
    if (!body.ok || typeof body.value?.ok !== 'boolean') return json({ error: 'Isi hasil harus { ok: true|false, alasan }.' }, 400);
    const id = decodeURIComponent(hasil[1]);
    const ubah = body.value.ok
      ? await db.prepare(`UPDATE hr_wa_keluar SET status = 'DIKIRIM', dikirim_at = ? WHERE id = ? AND entity_id = ? AND status = 'DIAMBIL'`).bind(sqlWaktu(now), id, kanal.entity_id).run()
      : await db.prepare(`UPDATE hr_wa_keluar SET status = 'GAGAL', gagal_alasan = ? WHERE id = ? AND entity_id = ? AND status = 'DIAMBIL'`).bind(bersih(body.value.alasan, 200), id, kanal.entity_id).run();
    return Number(ubah?.meta?.changes || 0) ? json({ ok: true }) : json({ error: 'Pesan tidak sedang diambil gateway ini.' }, 409);
  }
  return json({ error: 'Rute gateway WA tidak ditemukan.' }, 404);
}

async function tujuanDari(db, entityId, v) {
  if (v.pelamarId) {
    const p = await db.prepare('SELECT id, nama, no_wa FROM hr_pelamar WHERE id = ? AND entity_id = ?').bind(String(v.pelamarId), entityId).first();
    return p ? { noWa: p.no_wa, nama: p.nama, jenis: 'PELAMAR', ref: p.id } : { error: 'Pelamar tidak ditemukan.' };
  }
  if (v.employeeId) {
    const e = await db.prepare('SELECT id, full_name, phone FROM employees WHERE id = ? AND entity_id = ?').bind(String(v.employeeId), entityId).first();
    const noWa = normalkanNoWa(e?.phone);
    if (!e) return { error: 'Karyawan tidak ditemukan.' };
    return noWa ? { noWa, nama: e.full_name, jenis: 'KARYAWAN', ref: e.id } : { error: `Nomor HP ${e.full_name} belum diisi di data karyawan.` };
  }
  const noWa = normalkanNoWa(v.noWa);
  return noWa ? { noWa, nama: bersih(v.namaTujuan, 80), jenis: 'LAIN', ref: null } : { error: 'Nomor WhatsApp tujuan belum benar.' };
}

async function adminApi(request, env, pathname, now) {
  const context = await ownerEntityContext(request, env, { allowEntityAdminOutsideSkin: true });
  if (context.response) return context.response;
  const db = env.DB;
  const actor = context.entityAdmin ? { role: 'ENTITY_ADMIN', id: context.entityAdmin.id } : { role: 'OWNER', id: context.owner?.id || '' };
  const url = new URL(request.url);

  if (pathname === '/api/entity-admin/fina/wa/masuk' && request.method === 'GET') {
    const pengirim = url.searchParams.get('pengirim');
    const status = url.searchParams.get('status');
    const rows = (await db.prepare(`SELECT m.*, p.nama AS nama_pelamar, e.full_name AS nama_karyawan FROM hr_wa_masuk m
      LEFT JOIN hr_pelamar p ON p.id = m.pelamar_id LEFT JOIN employees e ON e.id = m.employee_id
      WHERE m.entity_id = ? ${pengirim ? 'AND m.pengirim = ?' : ''} ${status ? 'AND m.status = ?' : ''} ORDER BY m.diterima_at DESC LIMIT 200`)
      .bind(context.entityId, ...(pengirim ? [pengirim] : []), ...(status ? [status] : [])).all()).results ?? [];
    return json({ masuk: rows.map(r => ({ id: r.id, noWa: r.no_wa, nama: r.nama_pelamar || r.nama_karyawan || r.nama_wa, namaWa: r.nama_wa, teks: r.teks,
      jenisMedia: r.jenis_media, pengirim: r.pengirim, pelamarId: r.pelamar_id, employeeId: r.employee_id, status: r.status, waktu: r.dikirim_at || r.diterima_at })) });
  }
  const masuk = pathname.match(/^\/api\/entity-admin\/fina\/wa\/masuk\/([^/]+)$/);
  if (masuk && request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body.ok || !['BARU', 'DIBACA', 'DIPROSES'].includes(body.value?.status)) return json({ error: 'Status harus BARU, DIBACA, atau DIPROSES.' }, 400);
    const ubah = await db.prepare('UPDATE hr_wa_masuk SET status = ? WHERE id = ? AND entity_id = ?').bind(body.value.status, decodeURIComponent(masuk[1]), context.entityId).run();
    return Number(ubah?.meta?.changes || 0) ? json({ ok: true }) : json({ error: 'Pesan tidak ditemukan.' }, 404);
  }

  if (pathname === '/api/entity-admin/fina/wa/keluar' && request.method === 'GET') {
    const status = url.searchParams.get('status');
    const rows = (await db.prepare(`SELECT * FROM hr_wa_keluar WHERE entity_id = ? ${status ? 'AND status = ?' : ''} ORDER BY created_at DESC LIMIT 200`)
      .bind(context.entityId, ...(status ? [status] : [])).all()).results ?? [];
    return json({ keluar: rows.map(r => ({ id: r.id, noWa: r.no_wa, namaTujuan: r.nama_tujuan, tujuanJenis: r.tujuan_jenis, teks: r.teks, keperluan: r.keperluan,
      status: r.status, gagalAlasan: r.gagal_alasan, dibuatOleh: r.dibuat_oleh_role, disetujuiAt: r.disetujui_at, dikirimAt: r.dikirim_at, createdAt: r.created_at })) });
  }
  if (pathname === '/api/entity-admin/fina/wa/keluar' && request.method === 'POST') {
    const body = await readJson(request);
    if (!body.ok || !body.value) return json({ error: 'Payload tidak valid.' }, 400);
    const v = body.value;
    const teks = String(v.teks ?? '').replace(/\r\n?/g, '\n').trim();
    if (!teks || teks.length > BATAS_WA.teksMaks) return json({ error: `Isi pesan wajib, maks ${BATAS_WA.teksMaks} huruf.` }, 400);
    const tujuan = await tujuanDari(db, context.entityId, v);
    if (tujuan.error) return json({ error: tujuan.error }, 400);
    // setujui:true = pembuat sendiri sudah menyetujui (tombol "Ya" pada draft Fina / Admin menulis langsung).
    const setujui = v.setujui === true;
    const id = `wakeluar_${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO hr_wa_keluar (id, entity_id, no_wa, nama_tujuan, tujuan_jenis, ref_id, teks, keperluan, status, dibuat_oleh_role, dibuat_oleh_id,
      disetujui_oleh_role, disetujui_oleh_id, disetujui_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, context.entityId, tujuan.noWa, tujuan.nama, tujuan.jenis, tujuan.ref, teks, bersih(v.keperluan, 80), setujui ? 'DISETUJUI' : 'DRAFT', actor.role, actor.id,
        setujui ? actor.role : '', setujui ? actor.id : '', setujui ? sqlWaktu(now) : null).run();
    const kanal = await db.prepare(`SELECT aktif, token_hash FROM hr_kanal WHERE entity_id = ? AND jenis = 'WA'`).bind(context.entityId).first();
    return json({ ok: true, id, status: setujui ? 'DISETUJUI' : 'DRAFT', tujuan: { nama: tujuan.nama, nomor: samarkanNomor(tujuan.noWa) },
      catatan: Number(kanal?.aktif) === 1 && kanal?.token_hash ? null : 'Sambungan WA belum aktif: pesan menunggu sampai gateway tersambung.' }, 201);
  }
  const keluar = pathname.match(/^\/api\/entity-admin\/fina\/wa\/keluar\/([^/]+)\/(setujui|batal)$/);
  if (keluar && request.method === 'POST') {
    const id = decodeURIComponent(keluar[1]);
    const ubah = keluar[2] === 'setujui'
      ? await db.prepare(`UPDATE hr_wa_keluar SET status = 'DISETUJUI', disetujui_oleh_role = ?, disetujui_oleh_id = ?, disetujui_at = ? WHERE id = ? AND entity_id = ? AND status = 'DRAFT'`).bind(actor.role, actor.id, sqlWaktu(now), id, context.entityId).run()
      : await db.prepare(`UPDATE hr_wa_keluar SET status = 'BATAL' WHERE id = ? AND entity_id = ? AND status IN ('DRAFT', 'DISETUJUI', 'GAGAL')`).bind(id, context.entityId).run();
    return Number(ubah?.meta?.changes || 0) ? json({ ok: true }) : json({ error: 'Pesan tidak bisa diubah (mungkin sudah dikirim).' }, 409);
  }

  // --- Rute untuk alat Fina: tanpa nomor lengkap (nomor dicari server saat menyimpan/mengirim). ---
  if (pathname === '/api/entity-admin/fina/wa/calon-pelamar' && request.method === 'GET') {
    // Pengirim asing 30 hari terakhir yang belum diproses, satu baris per nomor. Isi pesan TIDAK
    // ikut (pesan orang asing tidak boleh sampai ke model); Admin membacanya di Kotak masuk WA.
    const batas = sqlWaktu(new Date(now.getTime() - 30 * 86400000));
    const rows = (await db.prepare(`SELECT no_wa, MAX(nama_wa) AS nama_wa, COUNT(*) AS jumlah, MAX(diterima_at) AS terakhir, MAX(id) AS kunci FROM hr_wa_masuk
      WHERE entity_id = ? AND pengirim = 'ASING' AND status <> 'DIPROSES' AND no_wa <> '' AND diterima_at > ? GROUP BY no_wa ORDER BY terakhir DESC LIMIT 50`)
      .bind(context.entityId, batas).all()).results ?? [];
    return json({ calon: rows.map(r => ({ kunci: r.kunci, namaWa: r.nama_wa || 'Tanpa nama', nomorSamar: samarkanNomor(r.no_wa), jumlahPesan: Number(r.jumlah), terakhir: r.terakhir })) });
  }
  if (pathname === '/api/entity-admin/fina/wa/jadikan-pelamar' && request.method === 'POST') {
    const body = await readJson(request);
    const daftar = Array.isArray(body.ok ? body.value?.daftar : null) ? body.value.daftar.slice(0, 30) : null;
    if (!daftar?.length) return json({ error: 'Daftar calon pelamar kosong.' }, 400);
    const store = body.value.storeCode ? context.stores.find(s => String(s.code).toUpperCase() === String(body.value.storeCode).toUpperCase()) : null;
    if (body.value.storeCode && !store) return json({ error: 'Gerai di luar entity ini.' }, 403);
    const posisi = bersih(body.value.posisi, 80);
    let dibuat = 0; const dilewati = [];
    for (const item of daftar) {
      const m = await db.prepare(`SELECT * FROM hr_wa_masuk WHERE id = ? AND entity_id = ?`).bind(String(item?.kunci ?? ''), context.entityId).first();
      if (!m || !m.no_wa) { dilewati.push(String(item?.nama ?? '?')); continue; }
      const ada = await db.prepare(`SELECT id FROM hr_pelamar WHERE entity_id = ? AND no_wa = ? AND status <> 'DITOLAK' LIMIT 1`).bind(context.entityId, m.no_wa).first();
      if (ada) { dilewati.push(bersih(item?.nama, 80) || m.nama_wa); continue; }
      const pesan = (await db.prepare(`SELECT teks FROM hr_wa_masuk WHERE entity_id = ? AND no_wa = ? ORDER BY diterima_at LIMIT 3`).bind(context.entityId, m.no_wa).all()).results ?? [];
      const id = `pelamar_${crypto.randomUUID()}`;
      await db.prepare(`INSERT INTO hr_pelamar (id, entity_id, nama, no_wa, sumber, status, catatan, posisi, store_id, dibuat_oleh_role, dibuat_oleh_id, diubah_oleh_role, diubah_oleh_id)
        VALUES (?, ?, ?, ?, 'WA', 'BARU', ?, ?, ?, ?, ?, ?, ?)`).bind(id, context.entityId, bersih(item?.nama, 80) || m.nama_wa || 'Tanpa nama', m.no_wa,
        bersih(`Pesan WA: ${pesan.map(p => p.teks).filter(Boolean).join(' / ')}`, 500), posisi, store?.id || '', actor.role, actor.id, actor.role, actor.id).run();
      await db.prepare(`UPDATE hr_wa_masuk SET status = 'DIPROSES', pengirim = 'PELAMAR', pelamar_id = ? WHERE entity_id = ? AND no_wa = ?`).bind(id, context.entityId, m.no_wa).run();
      dibuat += 1;
    }
    return json({ ok: true, dibuat, dilewati });
  }
  if (pathname === '/api/entity-admin/fina/wa/pelamar-ringkas' && request.method === 'GET') {
    const rows = (await db.prepare(`SELECT p.id, p.nama, p.posisi, p.status, p.no_wa, s.code AS store_code FROM hr_pelamar p LEFT JOIN stores s ON s.id = p.store_id
      WHERE p.entity_id = ? AND p.status <> 'DITOLAK' ORDER BY p.created_at DESC LIMIT 300`).bind(context.entityId).all()).results ?? [];
    return json({ pelamar: rows.map(r => ({ id: r.id, nama: r.nama, posisi: r.posisi, status: r.status, storeCode: r.store_code || '', nomorSamar: samarkanNomor(r.no_wa) })) });
  }

  if (pathname === '/api/entity-admin/fina/wa/kontak-cs' && request.method === 'GET') {
    const store = context.stores.find(s => s.id === url.searchParams.get('store') || String(s.code).toUpperCase() === String(url.searchParams.get('store') || '').toUpperCase());
    if (!store) return json({ error: 'Gerai di luar entity ini.' }, 403);
    const rows = (await db.prepare(`SELECT DISTINCT e.id, e.full_name, e.phone FROM employee_account_links l JOIN employees e ON e.id = l.employee_id
      JOIN cashiers c ON c.id = l.account_id WHERE l.account_type = 'CASHIER' AND l.effective_to IS NULL AND c.store_id = ? AND c.is_active = 1 AND e.entity_id = ?`)
      .bind(store.id, context.entityId).all()).results ?? [];
    // Nomor tidak dikirim: cukup tanda punya nomor atau belum.
    return json({ store: { id: store.id, code: store.code }, cs: rows.map(r => ({ employeeId: r.id, nama: r.full_name, adaNomor: Boolean(normalkanNoWa(r.phone)) })) });
  }
  return json({ error: 'Rute WA Fina tidak ditemukan.' }, 404);
}

export async function handleFinaWaApi(request, env, pathname, { now = new Date() } = {}) {
  if (pathname.startsWith('/api/fina/wa/gateway/')) return gatewayApi(request, env, pathname, now);
  if (pathname.startsWith('/api/entity-admin/fina/wa/')) return adminApi(request, env, pathname, now);
  return null;
}
