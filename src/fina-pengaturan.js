// Pengaturan Fina (agen HR) per tenant -- paket H1 (contracts/fina-hr-paket-v1.md).
//
// Semua aturan HR yang dipakai Fina (menit deteksi gerai kosong, jumlah tawaran backup serentak,
// batas tunggu, backup lintas gerai, masa berlaku & tingkatan SP, kop surat) diatur per entity dan
// bisa dioverride per gerai. Nilai KPM hanya BAWAAN di satu tempat (FINA_BAWAAN di bawah); tenant
// lain mengatur sendiri lewat Entity Admin -> Pengaturan -> Fina (HR). Tidak ada angka HR lain di kode.
//
// Urutan: gerai -> entity -> FINA_BAWAAN (NULL / '' = ikut tingkat di atasnya), pola apresiasi_settings.
// Tarif & denda TIDAK disimpan ulang: dibaca dari Dana Apresiasi (storeSettings) supaya satu sumber.

import { json, readJson } from './http.js';
import { ownerEntityContext } from './owner-entity-context.js';
import { storeSettings } from './dana-apresiasi.js';

export const FINA_BAWAAN = Object.freeze({
  deteksiKosongMenit: 10,
  tawaranSerentak: 3,
  batasTungguMenit: 30,
  backupLintasGerai: true,
  spBerlakuHari: 90,
  spTingkat: Object.freeze(['TEGURAN', 'SP1', 'SP2', 'SP3']),
  kopSurat: ''
});

// Rentang yang diterima (sama dengan CHECK di migration 0174). Dipakai validasi & kartu pengaturan.
export const FINA_RENTANG = Object.freeze({
  deteksiKosongMenit: Object.freeze([1, 240]),
  tawaranSerentak: Object.freeze([1, 20]),
  batasTungguMenit: Object.freeze([5, 720]),
  spBerlakuHari: Object.freeze([1, 730]),
  spTingkatJumlah: Object.freeze([1, 6]),
  spTingkatPanjang: 20,
  kopSuratPanjang: 500
});

const ANGKA = Object.freeze([
  ['deteksiKosongMenit', 'deteksi_kosong_menit', 'Menit deteksi gerai kosong'],
  ['tawaranSerentak', 'tawaran_serentak', 'Jumlah tawaran serentak'],
  ['batasTungguMenit', 'batas_tunggu_menit', 'Batas tunggu'],
  ['spBerlakuHari', 'sp_berlaku_hari', 'Masa berlaku SP']
]);

const kosong = value => value === null || value === undefined || value === '';

function bacaTingkat(teks) {
  if (kosong(teks)) return null;
  try {
    const nilai = JSON.parse(teks);
    return Array.isArray(nilai) && nilai.length && nilai.every(x => typeof x === 'string') ? nilai : null;
  } catch { return null; }
}

function barisKe(row) {
  if (!row) return null;
  return {
    deteksiKosongMenit: row.deteksi_kosong_menit ?? null,
    tawaranSerentak: row.tawaran_serentak ?? null,
    batasTungguMenit: row.batas_tunggu_menit ?? null,
    backupLintasGerai: row.backup_lintas_gerai == null ? null : Number(row.backup_lintas_gerai) === 1,
    spBerlakuHari: row.sp_berlaku_hari ?? null,
    spTingkat: bacaTingkat(row.sp_tingkat),
    kopSurat: row.kop_surat || '',
    updatedAt: row.updated_at || null
  };
}

/** Gabungan gerai -> entity -> bawaan. Fungsi murni (diuji tanpa DB). */
export function gabungPengaturanFina(entityRow = null, storeRow = null) {
  const pilih = key => {
    for (const row of [storeRow, entityRow]) {
      const nilai = row?.[key];
      if (key === 'kopSurat' ? Boolean(nilai) : nilai !== null && nilai !== undefined) return nilai;
    }
    return FINA_BAWAAN[key];
  };
  return {
    deteksiKosongMenit: pilih('deteksiKosongMenit'),
    tawaranSerentak: pilih('tawaranSerentak'),
    batasTungguMenit: pilih('batasTungguMenit'),
    backupLintasGerai: pilih('backupLintasGerai'),
    spBerlakuHari: pilih('spBerlakuHari'),
    spTingkat: [...pilih('spTingkat')],
    kopSurat: pilih('kopSurat')
  };
}

async function barisEntity(db, entityId) {
  const rows = (await db.prepare('SELECT * FROM hr_settings WHERE entity_id = ?').bind(entityId).all()).results ?? [];
  return new Map(rows.map(row => [row.store_id, barisKe(row)]));
}

/**
 * Pengaturan HR yang berlaku untuk satu gerai (atau entity bila storeId kosong), ditambah tarif &
 * denda yang DIBACA dari Dana Apresiasi. Dipakai alat Fina (H2/H3).
 */
export async function pengaturanFina(db, entityId, storeId = '') {
  const rows = await barisEntity(db, entityId);
  const hasil = gabungPengaturanFina(rows.get(''), storeId ? rows.get(storeId) : null);
  if (!storeId) return hasil;
  const a = await storeSettings(db, entityId, storeId);
  return {
    ...hasil,
    apresiasi: {
      aktif: a.enabled, tarifPerJamRupiah: a.ratePerHourRupiah,
      dendaAktif: a.dendaEnabled, dendaRinganRupiah: a.dendaSebagianRupiah, dendaBeratRupiah: a.dendaPenuhRupiah,
      dendaRinganMenit: a.dendaRinganMenit, dendaBeratMenit: a.dendaBeratMenit, jamBuka: a.jamBuka, jamTutup: a.jamTutup
    }
  };
}

function bersihkanAngka(value, [min, max], label) {
  if (kosong(value)) return { ok: true, nilai: null };
  const angka = Number(String(value).replace(',', '.'));
  if (!Number.isInteger(angka) || angka < min || angka > max) return { ok: false, error: `${label} harus bilangan bulat ${min}–${max}.` };
  return { ok: true, nilai: angka };
}

function bersihkanTingkat(value) {
  if (kosong(value)) return { ok: true, nilai: null };
  const daftar = (Array.isArray(value) ? value : String(value).split(/[,\n]/))
    .map(x => String(x ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase())
    .filter(Boolean);
  const [min, max] = FINA_RENTANG.spTingkatJumlah;
  if (daftar.length < min || daftar.length > max) return { ok: false, error: `Tingkatan SP diisi ${min}–${max} nama, dipisah koma, urut dari yang paling ringan.` };
  if (daftar.some(x => x.length > FINA_RENTANG.spTingkatPanjang || !/^[\p{L}\p{N}][\p{L}\p{N} .-]*$/u.test(x))) {
    return { ok: false, error: `Nama tingkatan SP maks ${FINA_RENTANG.spTingkatPanjang} huruf, memakai huruf, angka, spasi, titik atau tanda hubung.` };
  }
  if (new Set(daftar).size !== daftar.length) return { ok: false, error: 'Nama tingkatan SP tidak boleh dobel.' };
  return { ok: true, nilai: daftar };
}

function bersihkanSaklar(value) {
  if (kosong(value)) return { ok: true, nilai: null };
  if (value === true || value === 1 || value === '1' || value === 'true') return { ok: true, nilai: true };
  if (value === false || value === 0 || value === '0' || value === 'false') return { ok: true, nilai: false };
  return { ok: false, error: 'Backup lintas gerai harus ya atau tidak.' };
}

/**
 * Simpan satu tingkat (entity bila storeId '', atau satu gerai). Isian kosong = ikut tingkat di atasnya.
 * Menimpa seluruh baris tingkat itu (kartu selalu mengirim semua isian), seperti Dana Apresiasi.
 */
export async function simpanPengaturanFina(db, { entityId, storeId = '', input = {}, actor = {} }) {
  const nilai = {};
  for (const [key, , label] of ANGKA) {
    const hasil = bersihkanAngka(input[key], FINA_RENTANG[key], label);
    if (!hasil.ok) return hasil;
    nilai[key] = hasil.nilai;
  }
  const saklar = bersihkanSaklar(input.backupLintasGerai);
  if (!saklar.ok) return saklar;
  const tingkat = bersihkanTingkat(input.spTingkat);
  if (!tingkat.ok) return tingkat;
  const kop = String(input.kopSurat ?? '').replace(/\r\n?/g, '\n').trim();
  // eslint-disable-next-line no-control-regex
  if (kop.length > FINA_RENTANG.kopSuratPanjang || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(kop)) {
    return { ok: false, error: `Kop surat maks ${FINA_RENTANG.kopSuratPanjang} huruf.` };
  }
  await db.prepare(`
    INSERT INTO hr_settings (entity_id, store_id, deteksi_kosong_menit, tawaran_serentak, batas_tunggu_menit,
      backup_lintas_gerai, sp_berlaku_hari, sp_tingkat, kop_surat, updated_at, updated_by_role, updated_by_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
    ON CONFLICT (entity_id, store_id) DO UPDATE SET
      deteksi_kosong_menit = excluded.deteksi_kosong_menit, tawaran_serentak = excluded.tawaran_serentak,
      batas_tunggu_menit = excluded.batas_tunggu_menit, backup_lintas_gerai = excluded.backup_lintas_gerai,
      sp_berlaku_hari = excluded.sp_berlaku_hari, sp_tingkat = excluded.sp_tingkat, kop_surat = excluded.kop_surat,
      updated_at = CURRENT_TIMESTAMP, updated_by_role = excluded.updated_by_role, updated_by_id = excluded.updated_by_id
  `).bind(
    entityId, storeId, nilai.deteksiKosongMenit, nilai.tawaranSerentak, nilai.batasTungguMenit,
    saklar.nilai === null ? null : (saklar.nilai ? 1 : 0), nilai.spBerlakuHari,
    tingkat.nilai ? JSON.stringify(tingkat.nilai) : null, kop,
    String(actor.role ?? '').slice(0, 40), String(actor.id ?? '').slice(0, 120)
  ).run();
  return { ok: true };
}

/** Ringkasan untuk kartu Entity Admin: bawaan, entity, dan tiap gerai (override + yang berlaku). */
export async function ringkasanPengaturanFina(db, { entityId, stores }) {
  const rows = await barisEntity(db, entityId);
  const entityRow = rows.get('') || null;
  const daftar = [];
  for (const store of stores) {
    const override = rows.get(store.id) || null;
    const a = await storeSettings(db, entityId, store.id);
    daftar.push({
      storeId: store.id, storeCode: store.code, storeName: store.storeName || store.name || store.code,
      override, efektif: gabungPengaturanFina(entityRow, override),
      apresiasi: { aktif: a.enabled, tarifPerJamRupiah: a.ratePerHourRupiah, dendaAktif: a.dendaEnabled }
    });
  }
  return { bawaan: FINA_BAWAAN, rentang: FINA_RENTANG, entity: { tersimpan: entityRow, efektif: gabungPengaturanFina(entityRow, null) }, stores: daftar };
}

const BASE = '/api/entity-admin/fina/settings';

// GET = lihat (Entity Admin / Owner), PUT = simpan (Entity Admin / Owner). Gerai harus di entity sesi.
export async function handleFinaPengaturanApi(request, env, pathname) {
  if (pathname !== BASE) return null;
  if (request.method !== 'GET' && request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);
  const context = await ownerEntityContext(request, env, { allowEntityAdminOutsideSkin: true });
  if (context.response) return context.response;
  if (request.method === 'GET') return json(await ringkasanPengaturanFina(env.DB, { entityId: context.entityId, stores: context.stores }));
  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);
  const input = body.value || {};
  const storeId = String(input.storeId ?? '').trim().slice(0, 120);
  if (storeId && !context.stores.some(store => store.id === storeId)) return json({ error: 'Gerai di luar entity ini.' }, 403);
  const actor = context.entityAdmin ? { role: 'ENTITY_ADMIN', id: context.entityAdmin.id } : { role: 'OWNER', id: context.owner?.id || '' };
  const hasil = await simpanPengaturanFina(env.DB, { entityId: context.entityId, storeId, input, actor });
  if (!hasil.ok) return json({ error: hasil.error }, 400);
  return json({ ok: true, efektif: await pengaturanFina(env.DB, context.entityId, storeId) });
}
