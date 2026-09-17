// Panel chat Caca — ADR-044 Tahap 1, jalur web.
//
// Tahap ini sengaja TIDAK punya alat tulis: hasil bacaan dikembalikan untuk
// dikonfirmasi orang, tidak disentuhkan ke sales/expenses/tabel fakta mana pun.
// Yang sedang diuji di sini cuma satu hal — apakah Caca benar-benar mengerti
// lembar rekap yang dipakai sehari-hari.

import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { aiConfigured, callStructured, CACA_VISION_MODEL } from './caca-ai-client.js';
import { REKAP_TOOL, REKAP_SYSTEM_PROMPT, periksaRekap } from './caca-rekap-reader.js';

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
      { type: 'image', source: { type: 'base64', media_type: body.value.gambar.media_type, data: body.value.gambar.data } },
      { type: 'text', text: 'Salin isi lembar rekap ini apa adanya lewat alat catat_isi_lembar.' }
    ],
    tool: REKAP_TOOL
  });

  if (!hasil.ok) return json({ error: hasil.error }, hasil.status);

  return json({
    store: { id: store.id, code: store.code, storeName: store.storeName },
    model: hasil.model,
    hasil: periksaRekap(hasil.value, daftarBarang),
    catatan: 'Ini baru bacaan Caca, belum tersimpan sebagai transaksi.'
  });
}

export async function handleCacaApi(request, env, pathname) {
  if (!pathname.startsWith('/api/caca/')) return null;

  if (request.method === 'GET' && pathname === '/api/caca/status') {
    const auth = await requireManagement(request, env.DB);
    if (!auth.ok) return auth.response;
    return json({ siap: aiConfigured(env), model: CACA_VISION_MODEL, bisaMenyimpan: false });
  }

  if (request.method === 'POST' && pathname === '/api/caca/baca-rekap') {
    return bacaRekap(request, env);
  }

  return json({ error: 'Route Caca tidak ditemukan.' }, 404);
}
