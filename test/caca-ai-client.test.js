import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeminiRequest, callStructured, aiConfigured } from '../src/caca-ai-client.js';
import { REKAP_SCHEMA } from '../src/caca-rekap-reader.js';

const env = { GEMINI_API_KEY: 'kunci-uji' };

const contohIsi = [
  { type: 'image', mediaType: 'image/jpeg', data: 'BASE64' },
  { type: 'text', text: 'Salin isi lembar ini.' }
];

test('gambar dikirim sebagai inline_data, bukan teks', () => {
  const body = buildGeminiRequest({ system: 'halo', content: contohIsi, schema: REKAP_SCHEMA });
  const parts = body.contents[0].parts;

  assert.deepEqual(parts[0], { inline_data: { mime_type: 'image/jpeg', data: 'BASE64' } });
  assert.deepEqual(parts[1], { text: 'Salin isi lembar ini.' });
  assert.equal(body.contents[0].role, 'user');
  assert.equal(body.systemInstruction.parts[0].text, 'halo');
});

test('jawaban dipaksa berbentuk JSON berskema', () => {
  const body = buildGeminiRequest({ system: 'halo', content: contohIsi, schema: REKAP_SCHEMA });
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.responseSchema.type, 'object');
});

// responseSchema Gemini memakai subset OpenAPI 3.0 yang menolak additionalProperties.
// Kalau ini lolos terkirim, seluruh permintaan ditolak dengan 400.
test('additionalProperties dipangkas sampai ke skema bersarang', () => {
  const body = buildGeminiRequest({ system: 'halo', content: contohIsi, schema: REKAP_SCHEMA });
  const skema = body.generationConfig.responseSchema;

  assert.equal('additionalProperties' in skema, false);
  assert.equal('additionalProperties' in skema.properties.penjualan.items, false);
  assert.equal('additionalProperties' in skema.properties.ringkasan_tertulis, false);
});

test('skema asli tidak ikut berubah saat dipangkas', () => {
  buildGeminiRequest({ system: 'halo', content: contohIsi, schema: REKAP_SCHEMA });
  assert.equal(REKAP_SCHEMA.additionalProperties, false);
});

test('tanpa kunci API, Caca bilang belum tersambung dan tidak memanggil apa pun', async () => {
  let dipanggil = false;
  const hasil = await callStructured({}, {
    system: 'x',
    content: contohIsi,
    schema: REKAP_SCHEMA,
    fetchImpl: () => { dipanggil = true; }
  });

  assert.equal(hasil.ok, false);
  assert.equal(hasil.status, 503);
  assert.equal(dipanggil, false);
  assert.equal(aiConfigured({}), false);
});

function fetchPalsu(payload, { ok = true, status = 200 } = {}) {
  const tercatat = {};
  const impl = async (url, options) => {
    tercatat.url = url;
    tercatat.options = options;
    return { ok, status, json: async () => payload };
  };
  return { impl, tercatat };
}

test('kunci API dikirim sebagai header, tidak pernah menempel di URL', async () => {
  const { impl, tercatat } = fetchPalsu({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"a":1}' }] } }]
  });

  const hasil = await callStructured(env, { system: 'x', content: contohIsi, schema: REKAP_SCHEMA, fetchImpl: impl });

  assert.equal(hasil.ok, true);
  assert.deepEqual(hasil.value, { a: 1 });
  assert.equal(tercatat.options.headers['x-goog-api-key'], 'kunci-uji');
  assert.equal(tercatat.url.includes('kunci-uji'), false, 'kunci tidak boleh bocor ke URL');
  assert.ok(tercatat.url.endsWith('/gemini-3.1-flash-lite:generateContent'));
});

test('jawaban terpotong dilaporkan sebagai lembar kepanjangan, bukan hasil kosong', async () => {
  const { impl } = fetchPalsu({
    candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"a":' }] } }]
  });

  const hasil = await callStructured(env, { system: 'x', content: contohIsi, schema: REKAP_SCHEMA, fetchImpl: impl });
  assert.equal(hasil.ok, false);
  assert.match(hasil.error, /kepanjangan|per bagian/i);
});

// Badan error penyedia bisa memuat potongan permintaan; jangan diteruskan ke klien.
test('error penyedia tidak membocorkan isi balasannya', async () => {
  const { impl } = fetchPalsu({ error: { message: 'API key invalid: kunci-uji' } }, { ok: false, status: 400 });

  const hasil = await callStructured(env, { system: 'x', content: contohIsi, schema: REKAP_SCHEMA, fetchImpl: impl });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.error.includes('kunci-uji'), false);
});

test('jawaban yang bukan JSON dilaporkan, bukan dilempar sebagai crash', async () => {
  const { impl } = fetchPalsu({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'bukan json' }] } }]
  });

  const hasil = await callStructured(env, { system: 'x', content: contohIsi, schema: REKAP_SCHEMA, fetchImpl: impl });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.status, 502);
});
