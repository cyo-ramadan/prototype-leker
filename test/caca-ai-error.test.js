import test from 'node:test';
import assert from 'node:assert/strict';
import { jelaskanPenolakan, samarkan } from '../src/caca-ai-error.js';
import { callStructured } from '../src/caca-ai-client.js';

const KUNCI = 'AQ.Ab8RN6-contoh-kunci-uji-0123456789';
const isi = [{ type: 'text', text: 'halo' }];
const skema = { type: 'object', properties: { a: { type: 'string' } } };

test('kunci ditolak: pesan menyebut status, petunjuk, dan alasan dari penyedia', () => {
  const pesan = jelaskanPenolakan(401, {
    error: { message: 'API keys are not supported by this API. Expected OAuth2 access token.', status: 'UNAUTHENTICATED' }
  }, KUNCI);

  assert.match(pesan, /\(401\)/);
  assert.match(pesan, /Kunci ditolak/);
  assert.match(pesan, /Expected OAuth2 access token/, 'alasan asli penyedia harus kelihatan');
});

test('403 dan 429 punya petunjuk yang berbeda dan jelas', () => {
  assert.match(jelaskanPenolakan(403, null, KUNCI), /belum diaktifkan atau kunci dibatasi/);
  assert.match(jelaskanPenolakan(429, null, KUNCI), /Jatah pemakaian habis/);
});

// Inilah yang menjaga kompromi ini aman: alasan penyedia bisa saja mengutip
// kunci yang baru dikirim, dan pesan itu sampai ke layar.
test('kunci tidak pernah ikut tampil, walau penyedia mengutipnya', () => {
  const pesan = jelaskanPenolakan(401, {
    error: { message: `API key ${KUNCI} is invalid` }
  }, KUNCI);

  assert.equal(pesan.includes(KUNCI), false);
  assert.equal(pesan.includes('Ab8RN6'), false);
  assert.match(pesan, /\[kunci\]/);
});

test('pola kunci disamarkan juga walau bukan kunci yang sedang dipakai', () => {
  assert.equal(samarkan('kunci AIzaSyA1B2C3D4E5F6G7H8 salah', 'lain').includes('AIzaSy'), false);
  assert.equal(samarkan('kunci sk-abcdefghij1234567890 salah', 'lain').includes('sk-abc'), false);
  assert.equal(samarkan('kunci AQ.Ab8RN6abcdefghij salah', 'lain').includes('Ab8RN6'), false);
});

// Alasan penyedia untuk status di luar kredensial dan jatah bisa memuat
// potongan isi permintaan, jadi tidak diteruskan.
test('status selain 401/403/429 tetap generik, isi balasannya tidak diteruskan', () => {
  for (const status of [400, 404, 500, 503]) {
    const pesan = jelaskanPenolakan(status, { error: { message: 'rahasia isi permintaan pelanggan' } }, KUNCI);
    assert.equal(pesan, `Mesin AI menolak permintaan (${status}).`);
  }
});

test('balasan yang tidak terbaca tetap menghasilkan petunjuk', () => {
  assert.match(jelaskanPenolakan(401, null, KUNCI), /Kunci ditolak/);
  assert.match(jelaskanPenolakan(401, {}, KUNCI), /Kunci ditolak/);
  assert.match(jelaskanPenolakan(401, { error: 'bukan objek' }, KUNCI), /Kunci ditolak/);
});

test('alasan yang panjang dipotong, tidak membanjiri layar', () => {
  const pesan = jelaskanPenolakan(401, { error: { message: 'x'.repeat(2000) } }, KUNCI);
  assert.ok(pesan.length < 500);
  assert.match(pesan, /…/);
});

// --- ujung ke ujung lewat kedua penyedia -----------------------------------

function tolak(status, badan) {
  return async () => ({ ok: false, status, json: async () => badan });
}

test('Gemini: penolakan 401 sampai ke layar dengan alasan, tanpa kunci', async () => {
  const hasil = await callStructured({ GEMINI_API_KEY: KUNCI, CACA_MESIN: 'gemini' }, {
    system: 'a', content: isi, schema: skema,
    fetchImpl: tolak(401, { error: { message: `Bad credentials for ${KUNCI}`, status: 'UNAUTHENTICATED' } })
  });

  assert.equal(hasil.ok, false);
  assert.match(hasil.error, /\(401\)/);
  assert.match(hasil.error, /Bad credentials/);
  assert.equal(hasil.error.includes(KUNCI), false);
});

test('OpenAI: penolakan 429 sampai ke layar dengan petunjuk jatah', async () => {
  const hasil = await callStructured({ OPENAI_API_KEY: KUNCI, CACA_MESIN: 'openai' }, {
    system: 'a', content: isi, schema: skema,
    fetchImpl: tolak(429, { error: { message: 'Rate limit reached' } })
  });

  assert.match(hasil.error, /Jatah pemakaian habis/);
  assert.match(hasil.error, /Rate limit reached/);
});

test('penolakan dengan badan bukan JSON tidak membuat program crash', async () => {
  const hasil = await callStructured({ GEMINI_API_KEY: KUNCI, CACA_MESIN: 'gemini' }, {
    system: 'a', content: isi, schema: skema,
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => { throw new Error('bukan json'); } })
  });

  assert.equal(hasil.ok, false);
  assert.match(hasil.error, /Kunci ditolak/);
});
