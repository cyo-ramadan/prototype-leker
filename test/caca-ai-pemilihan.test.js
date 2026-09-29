import test from 'node:test';
import assert from 'node:assert/strict';
import { pilihPenyedia, aiConfigured, modelAktif, callStructured } from '../src/caca-ai-client.js';
import { toOpenAISchema, buildOpenAIRequest } from '../src/caca-ai-openai.js';
import { buildGeminiRequest } from '../src/caca-ai-gemini.js';
import { REKAP_SCHEMA } from '../src/caca-rekap-reader.js';

// Inti janjinya ke Bos Cyo: berpindah mesin = mengganti setelan, bukan koding.
test('memasang kunci saja sudah cukup untuk menyalakan mesinnya', () => {
  assert.equal(pilihPenyedia({ GEMINI_API_KEY: 'x' }).NAMA, 'gemini');
  assert.equal(pilihPenyedia({ OPENAI_API_KEY: 'x' }).NAMA, 'openai');
  assert.equal(pilihPenyedia({}), null);
});

test('setelan CACA_MESIN menang atas kunci yang kebetulan terpasang', () => {
  const env = { GEMINI_API_KEY: 'x', OPENAI_API_KEY: 'y', CACA_MESIN: 'openai' };
  assert.equal(pilihPenyedia(env).NAMA, 'openai');
  assert.equal(modelAktif(env), 'gpt-6-luna');
});

test('tanpa setelan, yang dua-duanya terpasang jatuh ke Gemini', () => {
  const env = { GEMINI_API_KEY: 'x', OPENAI_API_KEY: 'y' };
  assert.equal(pilihPenyedia(env).NAMA, 'gemini');
  assert.equal(modelAktif(env), 'gemini-3.1-flash-lite');
});

test('mesin yang tidak dikenal dilaporkan, bukan diam-diam jatuh ke yang lain', async () => {
  const env = { GEMINI_API_KEY: 'x', CACA_MESIN: 'chatgpt-luna' };
  assert.equal(pilihPenyedia(env), null);
  assert.equal(aiConfigured(env), false);

  const hasil = await callStructured(env, { system: 'a', content: [{ type: 'text', text: 'b' }], schema: REKAP_SCHEMA });
  assert.equal(hasil.ok, false);
  assert.match(hasil.error, /chatgpt-luna/);
});

test('mesin dipilih tapi kuncinya belum ada, disebut kunci mana yang kurang', async () => {
  const hasil = await callStructured({ CACA_MESIN: 'openai' }, {
    system: 'a', content: [{ type: 'text', text: 'b' }], schema: REKAP_SCHEMA
  });
  assert.equal(hasil.ok, false);
  assert.match(hasil.error, /OPENAI_API_KEY/);
});

test('permintaan diteruskan ke penyedia yang dipilih, bukan ke yang lain', async () => {
  let url = null;
  const fetchImpl = async (alamat) => {
    url = alamat;
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"a":1}' } }] }) };
  };

  const hasil = await callStructured({ OPENAI_API_KEY: 'x', CACA_MESIN: 'openai' }, {
    system: 'a', content: [{ type: 'text', text: 'b' }], schema: REKAP_SCHEMA, fetchImpl
  });

  assert.equal(hasil.ok, true);
  assert.match(url, /api\.openai\.com/);
});

// --- bentuk skema: dua penyedia menuntut hal yang berlawanan ---------------

// Gemini menolak additionalProperties; OpenAI mode strict justru mewajibkannya.
// Skema netral yang sama harus bisa melayani keduanya tanpa diubah di sumbernya.
test('skema netral yang sama melayani dua aturan yang berlawanan', () => {
  const gem = buildGeminiRequest({ system: 'a', content: [{ type: 'text', text: 'b' }], schema: REKAP_SCHEMA });
  const oai = buildOpenAIRequest({ system: 'a', content: [{ type: 'text', text: 'b' }], schema: REKAP_SCHEMA });

  assert.equal('additionalProperties' in gem.generationConfig.responseSchema, false, 'Gemini menolaknya');
  assert.equal(oai.response_format.json_schema.schema.additionalProperties, false, 'OpenAI mewajibkannya');
  assert.equal(REKAP_SCHEMA.additionalProperties, false, 'skema aslinya tidak ikut berubah');
});

test('mode strict OpenAI: semua properti masuk required, yang opsional jadi nullable', () => {
  const skema = toOpenAISchema(REKAP_SCHEMA);

  assert.deepEqual(new Set(skema.required), new Set(Object.keys(skema.properties)));
  assert.deepEqual(skema.properties.tanggal_tertulis.type, 'string', 'yang wajib tetap string biasa');
  assert.deepEqual(skema.properties.shift_tertulis.type, ['string', 'null'], 'yang opsional boleh null');
});

test('aturan strict berlaku sampai ke objek bersarang', () => {
  const barisPenjualan = toOpenAISchema(REKAP_SCHEMA).properties.penjualan.items;

  assert.equal(barisPenjualan.additionalProperties, false);
  assert.deepEqual(new Set(barisPenjualan.required), new Set(Object.keys(barisPenjualan.properties)));
  assert.deepEqual(barisPenjualan.properties.stok_awal.type, ['string', 'null']);
});

test('enum opsional ikut boleh null supaya tidak ditolak mode strict', () => {
  const skema = toOpenAISchema({
    type: 'object',
    required: ['wajib'],
    properties: {
      wajib: { type: 'string' },
      pilihan: { type: 'string', enum: ['a', 'b'] }
    }
  });

  assert.deepEqual(skema.properties.pilihan.type, ['string', 'null']);
  assert.ok(skema.properties.pilihan.enum.includes(null));
  assert.deepEqual(skema.properties.wajib.enum, undefined);
});

test('gambar dikirim sesuai bentuk masing-masing penyedia', () => {
  const isi = [{ type: 'image', mediaType: 'image/jpeg', data: 'BASE64' }, { type: 'text', text: 'baca' }];

  const gem = buildGeminiRequest({ system: 'a', content: isi, schema: REKAP_SCHEMA });
  assert.deepEqual(gem.contents[0].parts[0], { inline_data: { mime_type: 'image/jpeg', data: 'BASE64' } });

  const oai = buildOpenAIRequest({ system: 'a', content: isi, schema: REKAP_SCHEMA });
  assert.equal(oai.messages[1].content[0].type, 'image_url');
  assert.equal(oai.messages[1].content[0].image_url.url, 'data:image/jpeg;base64,BASE64');
});
