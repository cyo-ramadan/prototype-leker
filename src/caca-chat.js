// Panel chat Caca — ADR-044/045, jalur web.
//
// Baca rekap tetap hanya membaca: hasilnya dikembalikan untuk dikonfirmasi
// orang, tidak disentuhkan ke tabel fakta mana pun. Alat tulis (pengeluaran,
// barang, resep, jurnal) selalu berhenti di draft; baru tersimpan lewat
// /api/caca/catat setelah orang menekan tombol, dan itu pun lewat endpoint
// yang sama dengan yang dipakai layar.

import { json, readJson } from './http.js';
import { requireManagement, ownerFromRequest, entityAdminFromRequest } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { aiConfigured, callStructured, modelAktif } from './caca-ai-client.js';
import { REKAP_SCHEMA, REKAP_SYSTEM_PROMPT, periksaRekap } from './caca-rekap-reader.js';
import { jawabPertanyaan } from './caca-agen.js';
import { siapkanDraftPengeluaran, postingPengeluaran } from './caca-tulis.js';
import { cariAksi, periksaUlangDraft, bolehDiLingkup } from './caca-aksi.js';
import { gayaJawaban, gayaSelesai, bumbui } from './caca-gaya.js';
import { periksaKesiapan, sapaanKesiapan } from './caca-kesiapan.js';
import { jelaskan } from './caca-jelaskan.js';
import { MENU_SCHEMA, MENU_SYSTEM_PROMPT, tangkapanDariMenu } from './caca-baca-menu.js';
import { bersihkanRiwayat } from './caca-riwayat.js';
import { KATALOG } from './caca-baca-katalog.js';
import { handleAdminOperationalExpenseApi } from './admin-operational-expense.js';
import { getJakartaBusinessDate } from './time.js';

const MEDIA_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGE_LENGTH = 1_500_000;

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

async function listStoreProducts(db, storeId) {
  const result = await db
    .prepare('SELECT id, name FROM products WHERE store_id = ? ORDER BY name ASC')
    .bind(storeId)
    .all();
  return result.results ?? [];
}

function validateImage(gambar) {
  if (!gambar || typeof gambar !== 'object') return 'Belum ada gambar yang dikirim.';
  if (!MEDIA_TYPES.includes(gambar.media_type)) return 'Jenis gambar ini belum bisa dibaca Una.';
  const data = String(gambar.data ?? '');
  if (!data) return 'Gambarnya kosong.';
  if (data.length > MAX_IMAGE_LENGTH) return 'Gambarnya kebesaran. Coba foto ulang dengan ukuran lebih kecil.';
  return null;
}

function promptPembaca(daftarBarang) {
  if (!daftarBarang.length) {
    return `${REKAP_SYSTEM_PROMPT}\n\nGerai ini belum punya daftar barang, jadi salin saja nama seperti tertulis.`;
  }
  // Daftar barang dikirim sebagai konteks pengenal saja. Pencocokan resminya
  // tetap dilakukan di kode terhadap master barang gerai ini — model tidak
  // dipercaya menentukan barang mana yang dimaksud.
  const nama = daftarBarang.map((barang) => `- ${barang.name}`).join('\n');
  return `${REKAP_SYSTEM_PROMPT}\n\nSebagai pengenal, barang yang dijual gerai ini:\n${nama}`;
}

async function bacaRekap(request, env) {
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;

  // Invariant #5: gerai ditentukan dari sesi login yang sudah divalidasi, tidak
  // pernah dari tulisan "Cabang" di dalam gambar.
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerainya belum ketemu nih.' }, 404);

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);

  const masalahGambar = validateImage(body.value?.gambar);
  if (masalahGambar) return json({ error: masalahGambar }, 400);

  const daftarBarang = await listStoreProducts(env.DB, store.id);

  const hasil = await callStructured(env, {
    system: promptPembaca(daftarBarang),
    content: [
      { type: 'image', mediaType: body.value.gambar.media_type, data: body.value.gambar.data },
      { type: 'text', text: 'Salin isi lembar rekap ini apa adanya.' }
    ],
    schema: REKAP_SCHEMA
  });

  if (!hasil.ok) return json({ error: hasil.error }, hasil.status);

  return json({
    store: { id: store.id, code: store.code, storeName: store.storeName },
    model: hasil.model,
    hasil: periksaRekap(hasil.value, daftarBarang),
    catatan: 'Ini baru bacaan Una, belum tersimpan sebagai transaksi.'
  });
}

// K5 ADR-045: Owner dan Entity Admin dulu. Admin Gerai dan jalur PIN lama belum
// diikutkan — menambahkannya berarti merancang jatah per orang dan jejak audit
// per penyuruh lebih dulu, dan itu belum perlu selama yang memakai baru pemilik.
const PERAN_BOLEH_TANYA = Object.freeze({ OWNER: 'Owner', ENTITY_ADMIN: 'Entity Admin' });

function konteksPenyuruh(auth, store) {
  const peran = PERAN_BOLEH_TANYA[auth.authType];
  if (!peran) return null;
  return {
    nama: auth.owner?.displayName || auth.entityAdmin?.displayName || peran,
    peran,
    storeCode: store.code,
    storeName: store.storeName,
    hariIni: getJakartaBusinessDate()
  };
}

// Pintu yang boleh dilewati Una untuk membaca master dan menulis transaksi.
// Semuanya endpoint yang sama dengan yang dipakai layar, dipanggil dengan
// kredensial si penyuruh — Una tidak punya wewenang sendiri, dan tidak ada
// jalur tulis baru ke database.
//
// Permintaannya dikirim lewat PINTU MASUK UTAMA program (handleApi di
// index.js), bukan langsung ke handler modulnya. Versi sebelumnya memanggil
// handler langsung, dan diam-diam melewati pembungkus yang dipasang di pintu
// masuk utama — termasuk jembatan Akuntansi (ADR-046): Bea yang dicatat Una
// tidak pernah dijurnal, padahal yang dicatat lewat layar dijurnal. Lewat
// pintu utama, apa pun yang dipasang di sana untuk layar ikut berlaku untuk Una.
// Entri yang diakhiri "$" hanya cocok persis (tanpa sub-path): dipakai untuk
// halaman bootstrap yang sub-path-nya justru jalur tulis lain.
// Jalur baca bebas diambil dari katalog (caca-baca-katalog.js), bukan ditulis
// dua kali: katalog yang menentukan apa yang boleh dibaca Una.
// Sengaja cocok PERSIS (atau pola untuk ":id"), bukan awalan: katalog hanya
// membuka halaman bacanya, bukan sub-path tulis di bawahnya.
const PINTU_BACA = Object.freeze([...new Set(KATALOG.map((api) => (api.path.includes(':id')
  ? `^${api.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(':id', '\\d{1,9}')}$`
  : `${api.path}$`)))]);

export const PINTU_AKSI = Object.freeze([
  ...PINTU_BACA,
  '/api/admin/accounting$',
  '/api/admin/accounting/balance-sheet',
  '/api/admin/settings/accounting$',
  '/api/admin/settings/business/payment-methods',
  '/api/entity-admin/stores',
  // Owner di panel satu gerai: daftar gerai untuk mencari gerai acuan se-entity
  // (samakan_aturan_jurnal). Hanya dibaca (GET); tidak ada alat yang menulis ke sini.
  '/api/owner/stores$',
  '/api/admin/master/products/editor',
  '/api/admin/manufacturing/bootstrap',
  '/api/admin/manufacturing/recipes',
  // Hitung Ulang HPP (alat hitung_ulang_hpp): pratinjau + terapkan, sama dengan tab-nya.
  '/api/admin/hpp-recalculation',
  '/api/admin/accounting/accounts',
  '/api/admin/accounting/journals',
  // Alat akuntan (contracts/una-akuntan-tools-v1.md): tombol Sinkron dan Aturan Jurnal.
  // Cocok PERSIS / satu sub-path: bukan pintu ke seluruh Setting Akuntansi.
  '/api/admin/accounting/bridge/sync$',
  '/api/admin/settings/accounting/journal-rules',
  // Rentang harga beli wajar (alat atur_rentang_harga_beli, migration 0135).
  '/api/admin/purchase-price-ranges$',
  '/api/admin/operational-expenses',
  '/api/admin/hutang-piutang',
  '/api/entity-admin/accounts',
  '/api/entity-admin/journals'
]);

function pintuDiizinkan(pathname, pintu) {
  return pintu.some((awalan) => {
    if (awalan.startsWith('^')) return new RegExp(awalan).test(pathname);
    return awalan.endsWith('$')
      ? pathname === awalan.slice(0, -1)
      : pathname === awalan || pathname.startsWith(`${awalan}/`);
  });
}

export function bangunJalurAksi(request, env, { storeCode = '', jalurUtama, pintu = PINTU_AKSI } = {}) {
  async function panggil(method, alamat, body) {
    // Query (mis. ?asOf=) boleh ikut, tapi izinnya dinilai dari path saja.
    const url = new URL(alamat, 'https://leker.internal');
    const pathname = url.pathname;
    if (!pintuDiizinkan(pathname, pintu)) return { ok: false, status: 500, error: 'Jalur ini tidak terdaftar untuk Una.' };
    if (!jalurUtama) return { ok: false, status: 500, error: 'Jalur utama belum tersambung.' };

    // Gerai selalu dari sesi panel, tidak pernah dari kalimat (invariant #5).
    if (storeCode) url.searchParams.set('store', storeCode);
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    if (body) headers.set('content-type', 'application/json');

    let response;
    try {
      response = await jalurUtama(new Request(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      }));
    } catch (error) {
      // Satu jalur yang meledak (mis. batas kueri per permintaan di Cloudflare)
      // tidak boleh menjatuhkan seluruh percakapan; dilaporkan sebagai gagal baca.
      return { ok: false, status: 500, error: `pembacaan gagal: ${String(error?.message ?? error).slice(0, 120)}` };
    }
    if (!response) return { ok: false, status: 502, error: 'Jalur tidak menjawab.' };
    const data = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, error: data?.error || `Ditolak (${response.status}).` };
    return { ok: true, data };
  }
  return {
    baca: (pathname) => panggil('GET', pathname),
    kirim: (method, pathname, body) => panggil(method, pathname, body),
    // Lingkup entity menjalankan satu perintah ke banyak gerai. Tiap gerai
    // tetap lewat requireManagement endpointnya sendiri, jadi gerai di luar
    // entity si penyuruh ditolak di sana, bukan dipercaya dari sini.
    jalurGerai: (kode) => bangunJalurAksi(request, env, { storeCode: kode, jalurUtama, pintu })
  };
}

// Lingkup entity (buku entity, semua gerai) hanya untuk Entity Admin: endpoint
// jurnal entity sendiri hanya menerima sesi Entity Admin, dan Owner tidak
// punya satu entity yang jelas.
async function lingkupPenyuruh(request, env) {
  const url = new URL(request.url);
  if (url.searchParams.get('lingkup') === 'entity') {
    const entityAdmin = await entityAdminFromRequest(request, env.DB);
    if (!entityAdmin) {
      return { ok: false, response: json({ error: 'Mode entity hanya untuk Entity Admin.', code: 'CACA_LINGKUP_ENTITY_DITOLAK' }, 403) };
    }
    return {
      ok: true,
      storeCode: '',
      konteks: {
        nama: entityAdmin.displayName || 'Entity Admin',
        peran: 'Entity Admin',
        lingkup: 'entity',
        namaLingkup: entityAdmin.entityName || 'Entity',
        hariIni: getJakartaBusinessDate()
      }
    };
  }

  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return { ok: false, response: auth.response };
  const store = await selectedStore(env.DB, request);
  if (!store) return { ok: false, response: json({ error: 'Gerainya belum ketemu nih.' }, 404) };
  const konteks = konteksPenyuruh(auth, store);
  if (!konteks) {
    return { ok: false, response: json({ error: 'Una baru bisa diajak ngobrol oleh Owner dan Entity Admin.', code: 'CACA_PERAN_BELUM_DIIKUTKAN' }, 403) };
  }
  return { ok: true, storeCode: store.code, store, konteks: { ...konteks, lingkup: 'gerai', namaLingkup: store.storeName } };
}

async function tanya(request, env, jalurUtama) {
  const lingkup = await lingkupPenyuruh(request, env);
  if (!lingkup.ok) return lingkup.response;

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);

  // Cukup panjang untuk daftar menu atau daftar koreksi yang ditempel sekaligus.
  // Kelebihan DITOLAK dengan jelas, bukan dipotong diam-diam: daftar yang buntung
  // di tengah membuat Una mengerjakan sebagian tanpa ada yang sadar.
  const pertanyaan = String(body.value?.pertanyaan ?? '').trim();
  if (!pertanyaan) return json({ error: 'Pertanyaannya kosong.' }, 400);
  if (pertanyaan.length > MAKS_PERTANYAAN) {
    return json({ error: `Pesannya kepanjangan (${pertanyaan.length.toLocaleString('id-ID')} huruf, maks ${MAKS_PERTANYAAN.toLocaleString('id-ID')}). Kirim per bagian, mis. satu gerai atau satu langkah sekali kirim.` }, 413);
  }

  // Riwayat dari browser = data tak tepercaya: dibersihkan, dan hanya dipakai
  // memahami rujukan. Tidak ada tindakan yang lahir darinya tanpa draft + "Ya".
  const konteks = { ...lingkup.konteks, riwayat: bersihkanRiwayat(body.value?.riwayat) };
  const hasil = await jawabPertanyaan(pertanyaan, konteks, {
    request,
    env,
    jalurAksi: bangunJalurAksi(request, env, { storeCode: lingkup.storeCode, jalurUtama }),
    // Catatan kerja dari putaran sebelumnya (mode agen berputar). Data tak
    // tepercaya seperti riwayat: dibersihkan di jawabPertanyaan.
    kerja: body.value?.kerja
  });
  if (!hasil.ok) return json({ error: hasil.error }, hasil.status);

  const gaya = gayaJawaban(hasil);
  return json({
    jawaban: gaya.jawaban,
    sapaan: gaya.sapaan,
    alat: hasil.alat,
    periode: hasil.periode ?? null,
    tabel: hasil.tabel ?? null,
    jejak: hasil.jejak ?? null,
    peringatan: hasil.peringatan ?? null,
    tawaran: hasil.tawaran ?? null,
    rencana: hasil.rencana ?? null,
    // Una balik bertanya / belum bisa: dipakai panel untuk menjeda rencana.
    belumLengkap: Boolean(hasil.belumLengkap || hasil.ditolak),
    draft: hasil.draft ?? null,
    perluKonfirmasi: Boolean(hasil.perluKonfirmasi),
    kerja: hasil.kerja ?? null,
    lanjutkan: Boolean(hasil.lanjutkan),
    lanjutSesudahYa: Boolean(hasil.lanjutSesudahYa),
    store: lingkup.store ? { code: lingkup.store.code, storeName: lingkup.store.storeName } : null
  });
}

async function catatAksi(request, env, isi, jalurUtama) {
  const lingkup = await lingkupPenyuruh(request, env);
  if (!lingkup.ok) return lingkup.response;

  const draft = isi.draft;
  const aksi = cariAksi(draft.aksi);
  if (!bolehDiLingkup(aksi, lingkup.konteks.lingkup)) {
    return json({ error: 'Draft ini dibuat untuk lingkup lain. Minta Una menyusun ulang ya.' }, 409);
  }

  const jalur = bangunJalurAksi(request, env, { storeCode: lingkup.storeCode, jalurUtama });
  const diperiksa = await periksaUlangDraft(draft, {
    ...jalur,
    hariIni: lingkup.konteks.hariIni,
    namaLingkup: lingkup.konteks.namaLingkup,
    lingkup: lingkup.konteks.lingkup,
    storeCode: lingkup.storeCode
  });
  if (!diperiksa.ok) return json({ error: diperiksa.error }, diperiksa.status);

  // Draft bertahap (isi barang massal, batalkan barang): satu baris per
  // permintaan, panel yang mengulang. Draftnya tetap diperiksa ulang utuh di
  // setiap potongan, jadi tidak ada baris yang lolos tanpa dicek.
  if (aksi.bertahap) {
    const jumlah = diperiksa.draft.muatan.daftar.length;
    const bagian = isi.bagian;
    if (!Number.isInteger(bagian) || bagian < 0 || bagian >= jumlah) {
      return json({ error: 'Urutan barisnya tidak valid. Muat ulang halaman lalu coba lagi ya.' }, 400);
    }
    const hasil = await aksi.postingBagian(diperiksa.draft, bagian, { ...jalur, lingkup: lingkup.konteks.lingkup });
    if (!hasil.ok) return json({ error: hasil.error, bagian }, hasil.status ?? 502);
    return json({ tercatat: true, bagian, jumlah, hasil: hasil.hasil, nama: hasil.nama, id: hasil.id ?? null, selesai: bagian === jumlah - 1 });
  }

  const hasil = await aksi.posting(diperiksa.draft, { ...jalur, lingkup: lingkup.konteks.lingkup });
  if (!hasil.ok) return json({ error: hasil.error }, hasil.status ?? 502);
  return json({ tercatat: true, draft: diperiksa.draft, jawaban: gayaSelesai(hasil.jawaban) });
}

// --- pendamping pengguna baru (UNA-PENDAMPING.md) ---------------------------

export const MAKS_PERTANYAAN = 8000;

// Sapaan pertama Una: kondisi gerai + kerjaan yang ditawarkan. Tanpa mesin AI.
async function kesiapan(request, env, jalurUtama) {
  const lingkup = await lingkupPenyuruh(request, env);
  if (!lingkup.ok) return lingkup.response;
  if (lingkup.konteks.lingkup === 'entity') {
    return json({ lingkup: 'entity', kesiapan: null, sapaan: null });
  }
  const jalur = bangunJalurAksi(request, env, { storeCode: lingkup.storeCode, jalurUtama });
  const hasil = await periksaKesiapan(jalur);
  return json({
    lingkup: 'gerai',
    store: { code: lingkup.store.code, storeName: lingkup.store.storeName },
    kesiapan: hasil,
    sapaan: bumbui(sapaanKesiapan(hasil, lingkup.store.storeName), hasil.siapJualan ? ['beres'] : [])
  });
}

function ctxAksi(jalur, lingkup) {
  return {
    ...jalur,
    hariIni: lingkup.konteks.hariIni,
    namaLingkup: lingkup.konteks.namaLingkup,
    lingkup: lingkup.konteks.lingkup,
    storeCode: lingkup.storeCode
  };
}

// Draft yang disusun tanpa mesin AI karena isinya sudah terstruktur di panel
// (mis. tombol "batalkan yang barusan" membawa id barang yang tadi dibuat).
// Hanya menyusun draft; menyimpan tetap lewat /api/caca/catat + periksa ulang.
const SIAPKAN_LANGSUNG = Object.freeze(['nonaktifkan_barang']);

async function siapkanLangsung(request, env, jalurUtama) {
  const lingkup = await lingkupPenyuruh(request, env);
  if (!lingkup.ok) return lingkup.response;
  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);
  const aksi = SIAPKAN_LANGSUNG.includes(body.value?.aksi) ? cariAksi(body.value.aksi) : null;
  if (!aksi) return json({ error: 'Jenis draft ini tidak bisa disusun langsung.' }, 400);
  if (!bolehDiLingkup(aksi, lingkup.konteks.lingkup)) return json({ error: 'Pilih gerainya dulu lewat tombol ▾ di atas.' }, 409);

  const tangkapan = body.value?.tangkapan && typeof body.value.tangkapan === 'object' ? body.value.tangkapan : {};
  const jalur = bangunJalurAksi(request, env, { storeCode: lingkup.storeCode, jalurUtama });
  const disiapkan = await aksi.siapkan(tangkapan, ctxAksi(jalur, lingkup));
  if (!disiapkan.ok) return json({ jawaban: bumbui(disiapkan.tanya || disiapkan.error, ['tanya']), draft: null, perluKonfirmasi: false });
  return json({ jawaban: null, draft: { ...disiapkan.draft, tangkapan }, perluKonfirmasi: true });
}

// Foto papan menu/daftar harga → draft isi barang massal.
async function bacaMenu(request, env, jalurUtama) {
  const lingkup = await lingkupPenyuruh(request, env);
  if (!lingkup.ok) return lingkup.response;
  if (lingkup.konteks.lingkup === 'entity') {
    return json({ error: 'Daftar menu diisi per gerai. Pilih gerainya dulu lewat tombol ▾ di atas.' }, 409);
  }
  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);
  const masalahGambar = validateImage(body.value?.gambar);
  if (masalahGambar) return json({ error: masalahGambar }, 400);

  const bacaan = await callStructured(env, {
    system: MENU_SYSTEM_PROMPT,
    content: [
      { type: 'image', mediaType: body.value.gambar.media_type, data: body.value.gambar.data },
      { type: 'text', text: 'Salin daftar menu/harga di foto ini apa adanya.' }
    ],
    schema: MENU_SCHEMA
  });
  if (!bacaan.ok) return json({ error: bacaan.error }, bacaan.status);

  const tangkapan = tangkapanDariMenu(bacaan.value);
  if (bacaan.value?.bukan_menu || !tangkapan.daftar_barang.length) {
    return json({
      jawaban: bumbui('Una nggak nemu daftar menu atau harga di foto itu. Coba foto lebih dekat dan lurus, atau ketik aja daftarnya.', ['tanya']),
      draft: null,
      perluKonfirmasi: false
    });
  }

  const aksi = cariAksi('buat_barang_banyak');
  const jalur = bangunJalurAksi(request, env, { storeCode: lingkup.storeCode, jalurUtama });
  const disiapkan = await aksi.siapkan(tangkapan, ctxAksi(jalur, lingkup));
  if (!disiapkan.ok) return json({ jawaban: bumbui(disiapkan.tanya || disiapkan.error, ['tanya']), draft: null, perluKonfirmasi: false });
  const hasil = { draft: { ...disiapkan.draft, tangkapan } };
  return json({
    jawaban: null,
    sapaan: gayaJawaban(hasil).sapaan,
    draft: hasil.draft,
    perluKonfirmasi: true,
    terbaca: tangkapan.daftar_barang.length
  });
}

// Konfirmasi tidak memanggil model sama sekali — orang menekan tombol, dan yang
// dicatat adalah isi draft, bukan tafsiran ulang atas kalimatnya.
//
// Draft dikirim balik oleh panel, bukan disimpan di server. Itu aman karena
// seluruh isinya diperiksa ulang di sini lewat jalur yang sama persis dengan
// waktu draft-nya pertama disusun, lalu diperiksa sekali lagi oleh endpoint
// Bea Operasional. Draft yang diutak-atik di browser tidak melewatkan satu
// pemeriksaan pun — dan orang yang mengirimnya memang berwenang mencatat
// pengeluaran lewat panel biasa, jadi tidak ada wewenang yang bertambah.
async function catat(request, env, jalurUtama) {
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;

  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerainya belum ketemu nih.' }, 404);

  const konteks = konteksPenyuruh(auth, store);
  if (!konteks) {
    return json({ error: 'Una baru bisa diajak ngobrol oleh Owner dan Entity Admin.', code: 'CACA_PERAN_BELUM_DIIKUTKAN' }, 403);
  }

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);

  const draft = body.value?.draft;
  const diperiksaUlang = siapkanDraftPengeluaran({
    keterangan: draft?.keterangan,
    nominal_tertulis: String(draft?.nominal ?? ''),
    pihak_tertulis: draft?.pihak,
    tanggal_tertulis: draft?.tanggal
  }, { hariIni: konteks.hariIni });

  if (!diperiksaUlang.ok) return json({ error: diperiksaUlang.tanya }, 400);

  const hasil = await postingPengeluaran(diperiksaUlang.draft, {
    request,
    env,
    storeCode: store.code,
    // Lewat pintu utama juga, supaya jembatan Akuntansi Bea ikut jalan.
    handler: jalurUtama ? (permintaan) => jalurUtama(permintaan) : handleAdminOperationalExpenseApi
  });
  if (!hasil.ok) return json({ error: hasil.error }, hasil.status ?? 502);

  return json({
    tercatat: true,
    draft: diperiksaUlang.draft,
    jawaban: gayaSelesai(`Sudah Una catat: ${diperiksaUlang.draft.keterangan}, hutang ke ${diperiksaUlang.draft.pihak}.`)
  });
}

/**
 * @param {object} [pilihan]
 * @param {(request: Request) => Promise<Response>} [pilihan.jalurUtama] pintu masuk
 *   utama program (handleApi di index.js) untuk semua tulisan Una.
 */
export async function handleCacaApi(request, env, pathname, { jalurUtama } = {}) {
  if (!pathname.startsWith('/api/caca/')) return null;

  if (request.method === 'GET' && pathname === '/api/caca/status') {
    // Status cuma menjawab "mesin AI sudah tersambung atau belum" — tidak
    // menyentuh data gerai mana pun, jadi tidak perlu terikat ke satu gerai.
    // Versi pertama memakai requireManagement, yang tanpa ?store= jatuh ke
    // gerai bawaan G001; Entity Admin yang entity-nya tidak memuat G001 ditolak,
    // proses panel berhenti, kotak Gerai kosong dan tombol Tanya mati.
    // Yang perlu dipastikan di sini hanya siapa yang bertanya (K5 ADR-045).
    if (!(await ownerFromRequest(request, env.DB)) && !(await entityAdminFromRequest(request, env.DB))) {
      return json({ error: 'Login Owner atau Entity Admin diperlukan.' }, 401);
    }
    return json({ siap: aiConfigured(env), model: modelAktif(env), bisaMenyimpan: false });
  }

  if (request.method === 'POST' && pathname === '/api/caca/baca-rekap') {
    return bacaRekap(request, env);
  }

  if (request.method === 'POST' && pathname === '/api/caca/tanya') {
    return tanya(request, env, jalurUtama);
  }

  if (request.method === 'POST' && pathname === '/api/caca/catat') {
    // Body dibaca sekali di sini untuk memilih jalurnya: draft aksi (barang,
    // resep, jurnal) atau draft pengeluaran yang lebih dulu ada.
    const salinan = request.clone();
    const body = await readJson(salinan);
    if (body.ok && cariAksi(body.value?.draft?.aksi)) return catatAksi(request, env, body.value, jalurUtama);
    return catat(request, env, jalurUtama);
  }

  if (request.method === 'GET' && pathname === '/api/caca/kesiapan') {
    return kesiapan(request, env, jalurUtama);
  }

  if (request.method === 'GET' && pathname === '/api/caca/jelaskan') {
    if (!(await ownerFromRequest(request, env.DB)) && !(await entityAdminFromRequest(request, env.DB))) {
      return json({ error: 'Login Owner atau Entity Admin diperlukan.' }, 401);
    }
    const hasil = jelaskan(new URL(request.url).searchParams.get('topik'));
    return json({ ...hasil, jawaban: bumbui(hasil.jawaban, hasil.dikenal ? [] : ['tanya']) });
  }

  if (request.method === 'POST' && pathname === '/api/caca/siapkan') {
    return siapkanLangsung(request, env, jalurUtama);
  }

  if (request.method === 'POST' && pathname === '/api/caca/baca-menu') {
    return bacaMenu(request, env, jalurUtama);
  }

  return json({ error: 'Route Una tidak ditemukan.' }, 404);
}
