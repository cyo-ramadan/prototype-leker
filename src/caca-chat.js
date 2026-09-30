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
import { cariAksi, periksaUlangDraft } from './caca-aksi.js';
import { handleAdminOperationalExpenseApi } from './admin-operational-expense.js';
import { handleProductMasterApi } from './product-master.js';
import { handleManufacturingMasterApi } from './manufacturing-master.js';
import { handleEntityAccountingApi } from './entity-accounting.js';
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
  if (!MEDIA_TYPES.includes(gambar.media_type)) return 'Jenis gambar ini belum bisa dibaca Caca.';
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
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

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
    catatan: 'Ini baru bacaan Caca, belum tersimpan sebagai transaksi.'
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

// Pintu yang boleh dilewati alat tulis Caca. Semuanya endpoint yang sama
// dengan yang dipakai layar, dipanggil dengan kredensial si penyuruh — Caca
// tidak punya wewenang sendiri, dan tidak ada jalur tulis baru ke database.
export const PINTU_AKSI = Object.freeze([
  ['/api/admin/master/products/editor', handleProductMasterApi],
  ['/api/admin/manufacturing/', handleManufacturingMasterApi],
  ['/api/entity-admin/', handleEntityAccountingApi]
]);

export function bangunJalurAksi(request, env, { storeCode = '', pintu = PINTU_AKSI } = {}) {
  async function panggil(method, pathname, body) {
    const handler = pintu.find(([awalan]) => pathname.startsWith(awalan))?.[1];
    if (!handler) return { ok: false, status: 500, error: 'Jalur ini tidak terdaftar untuk Caca.' };

    const url = new URL(pathname, 'https://leker.internal');
    // Gerai selalu dari sesi panel, tidak pernah dari kalimat (invariant #5).
    if (storeCode) url.searchParams.set('store', storeCode);
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    if (body) headers.set('content-type', 'application/json');

    const response = await handler(new Request(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    }), env, pathname);
    if (!response) return { ok: false, status: 502, error: 'Jalur tidak menjawab.' };
    const data = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, error: data?.error || `Ditolak (${response.status}).` };
    return { ok: true, data };
  }
  return {
    baca: (pathname) => panggil('GET', pathname),
    kirim: (method, pathname, body) => panggil(method, pathname, body)
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
  if (!store) return { ok: false, response: json({ error: 'Gerai tidak ditemukan.' }, 404) };
  const konteks = konteksPenyuruh(auth, store);
  if (!konteks) {
    return { ok: false, response: json({ error: 'Caca baru bisa diajak ngobrol oleh Owner dan Entity Admin.', code: 'CACA_PERAN_BELUM_DIIKUTKAN' }, 403) };
  }
  return { ok: true, storeCode: store.code, store, konteks: { ...konteks, lingkup: 'gerai', namaLingkup: store.storeName } };
}

async function tanya(request, env) {
  const lingkup = await lingkupPenyuruh(request, env);
  if (!lingkup.ok) return lingkup.response;

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);

  const pertanyaan = String(body.value?.pertanyaan ?? '').trim().slice(0, 500);
  if (!pertanyaan) return json({ error: 'Pertanyaannya kosong.' }, 400);

  const hasil = await jawabPertanyaan(pertanyaan, lingkup.konteks, {
    request,
    env,
    jalurAksi: bangunJalurAksi(request, env, { storeCode: lingkup.storeCode })
  });
  if (!hasil.ok) return json({ error: hasil.error }, hasil.status);

  return json({
    jawaban: hasil.jawaban ?? null,
    alat: hasil.alat,
    periode: hasil.periode ?? null,
    draft: hasil.draft ?? null,
    perluKonfirmasi: Boolean(hasil.perluKonfirmasi),
    store: lingkup.store ? { code: lingkup.store.code, storeName: lingkup.store.storeName } : null
  });
}

async function catatAksi(request, env, draft) {
  const lingkup = await lingkupPenyuruh(request, env);
  if (!lingkup.ok) return lingkup.response;

  const aksi = cariAksi(draft.aksi);
  if (aksi.lingkup !== lingkup.konteks.lingkup) {
    return json({ error: 'Draft ini dibuat untuk lingkup lain. Minta Caca menyusun ulang ya.' }, 409);
  }

  const jalur = bangunJalurAksi(request, env, { storeCode: lingkup.storeCode });
  const diperiksa = await periksaUlangDraft(draft, {
    ...jalur,
    hariIni: lingkup.konteks.hariIni,
    namaLingkup: lingkup.konteks.namaLingkup
  });
  if (!diperiksa.ok) return json({ error: diperiksa.error }, diperiksa.status);

  const hasil = await aksi.posting(diperiksa.draft, jalur);
  if (!hasil.ok) return json({ error: hasil.error }, hasil.status ?? 502);
  return json({ tercatat: true, draft: diperiksa.draft, jawaban: hasil.jawaban });
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
async function catat(request, env) {
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;

  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  const konteks = konteksPenyuruh(auth, store);
  if (!konteks) {
    return json({ error: 'Caca baru bisa diajak ngobrol oleh Owner dan Entity Admin.', code: 'CACA_PERAN_BELUM_DIIKUTKAN' }, 403);
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
    handler: handleAdminOperationalExpenseApi
  });
  if (!hasil.ok) return json({ error: hasil.error }, hasil.status ?? 502);

  return json({
    tercatat: true,
    draft: diperiksaUlang.draft,
    jawaban: `Sudah Caca catat: ${diperiksaUlang.draft.keterangan}, hutang ke ${diperiksaUlang.draft.pihak}.`
  });
}

export async function handleCacaApi(request, env, pathname) {
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
    return tanya(request, env);
  }

  if (request.method === 'POST' && pathname === '/api/caca/catat') {
    // Body dibaca sekali di sini untuk memilih jalurnya: draft aksi (barang,
    // resep, jurnal) atau draft pengeluaran yang lebih dulu ada.
    const salinan = request.clone();
    const body = await readJson(salinan);
    if (body.ok && cariAksi(body.value?.draft?.aksi)) return catatAksi(request, env, body.value.draft);
    return catat(request, env);
  }

  return json({ error: 'Route Caca tidak ditemukan.' }, 404);
}
