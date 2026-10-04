// Satu-satunya tempat modul Caca bicara ke penyedia model. ADR-044 mensyaratkan
// pemanggilan AI dibungkus satu lapisan supaya modelnya bisa ditukar tanpa
// membongkar modul; jangan panggil penyedia langsung dari handler.
//
// Isi permintaan dari pemanggil selalu berbentuk netral (lihat callStructured).
// Yang provider-spesifik cuma penerjemahan di file ini — penukaran dari Gemini
// ke OpenAI pada 2026-09-29 tidak menyentuh satu baris pun logika pembacaan
// lembar, penguraian nominal, atau penyusunan draft.
//
// Penyedia sekarang: OpenAI GPT-6 Luna lewat Chat Completions. Dipilih karena
// sekitar 3x lebih murah dari Gemini Flash-Lite ($0,10/$0,50 lawan $0,25/$1,50
// per juta token) — keputusan Bos Cyo 2026-09-29, diambil selagi belum ada
// pemakaian sungguhan sehingga penukarannya tidak mengorbankan apa pun.
//
// Repo ini nol-dependency dan jalan di Cloudflare Workers, jadi pemanggilan
// pakai fetch bawaan, bukan SDK npm.

import { jelaskanPenolakan } from './caca-ai-error.js';

const API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-6-luna';
const DEFAULT_MAX_TOKENS = 16000;
const DEFAULT_TIMEOUT_MS = 120000;

export const MODEL = DEFAULT_MODEL;
export const NAMA = 'openai';
export const KUNCI_ENV = 'OPENAI_API_KEY';

export function terpasang(env) {
  return Boolean(env?.OPENAI_API_KEY);
}

function toOpenAIContent(content) {
  return content.map((bagian) => (bagian.type === 'image'
    ? { type: 'image_url', image_url: { url: `data:${bagian.mediaType};base64,${bagian.data}` } }
    : { type: 'text', text: bagian.text }));
}

function jadikanNullable(skema) {
  // Field opsional di mode strict dinyatakan boleh null, bukan boleh hilang.
  // Hasilnya justru lebih jelas: "tidak disebut" datang sebagai null yang
  // eksplisit, bukan sebagai kunci yang diam-diam tidak ada.
  if (Array.isArray(skema.type) || skema.type === undefined) return skema;
  const hasil = { ...skema, type: [skema.type, 'null'] };
  if (Array.isArray(hasil.enum) && !hasil.enum.includes(null)) hasil.enum = [...hasil.enum, null];
  return hasil;
}

/**
 * Mode strict OpenAI menuntut kebalikan dari Gemini: setiap objek WAJIB punya
 * additionalProperties:false dan SEMUA propertinya masuk required. Skema netral
 * disesuaikan di sini, bukan di sumbernya, supaya penyedia berikutnya yang
 * aturannya lain lagi tetap bisa dilayani dari bentuk netral yang sama.
 */
export function toOpenAISchema(skema) {
  if (Array.isArray(skema)) return skema.map(toOpenAISchema);
  if (!skema || typeof skema !== 'object') return skema;

  const hasil = {};
  for (const [kunci, nilai] of Object.entries(skema)) {
    if (kunci === 'properties' || kunci === 'required') continue;
    hasil[kunci] = toOpenAISchema(nilai);
  }

  if (skema.properties) {
    const wajibAsli = new Set(skema.required ?? []);
    hasil.properties = {};
    for (const [nama, isi] of Object.entries(skema.properties)) {
      const diproses = toOpenAISchema(isi);
      hasil.properties[nama] = wajibAsli.has(nama) ? diproses : jadikanNullable(diproses);
    }
    hasil.required = Object.keys(skema.properties);
    hasil.additionalProperties = false;
  }

  return hasil;
}

export function buildOpenAIRequest({ system, content, schema, model = DEFAULT_MODEL, maxTokens = DEFAULT_MAX_TOKENS }) {
  return {
    model,
    max_completion_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: toOpenAIContent(content) }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'jawaban_caca', strict: true, schema: toOpenAISchema(schema) }
    }
  };
}

/**
 * Memanggil model dan memaksa jawabannya mengikuti satu skema.
 * Mengembalikan { ok, value } — value adalah objek yang sudah tervalidasi
 * skema oleh penyedia, bukan teks bebas yang harus ditebak parsingnya.
 *
 * content memakai bentuk netral:
 *   [{ type: 'image', mediaType, data }, { type: 'text', text }]
 */
export async function callStructured(env, {
  system,
  content,
  schema,
  model = DEFAULT_MODEL,
  maxTokens = DEFAULT_MAX_TOKENS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch
} = {}) {
  if (!terpasang(env)) {
    return { ok: false, status: 503, error: 'Una belum tersambung ke mesin AI. Kunci API belum dipasang.' };
  }

  let response;
  try {
    response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(buildOpenAIRequest({ system, content, schema, model, maxTokens })),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      error: timedOut ? 'Una kelamaan membaca, coba lagi ya.' : 'Una tidak bisa menghubungi mesin AI.'
    };
  }

  if (!response.ok) {
    // Alasan penyedia hanya diteruskan untuk kegagalan kredensial dan jatah
    // (lihat caca-ai-error.js); status lain tetap generik.
    const badanError = await response.json().catch(() => null);
    return { ok: false, status: 502, error: jelaskanPenolakan(response.status, badanError, env.OPENAI_API_KEY) };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, status: 502, error: 'Jawaban mesin AI tidak terbaca.' };
  }

  const pilihan = payload?.choices?.[0];
  if (pilihan?.finish_reason === 'length') {
    return { ok: false, status: 502, error: 'Kepanjangan buat sekali proses nih. Kalau foto, coba difoto per bagian; kalau pertanyaan, coba lebih spesifik (mis. sebut 1-2 barang).' };
  }
  if (pilihan?.message?.refusal) {
    return { ok: false, status: 422, error: 'Una tidak bisa memproses permintaan ini.' };
  }

  const teks = pilihan?.message?.content ?? '';
  if (!teks) {
    return { ok: false, status: 502, error: 'Una tidak berhasil membaca isinya dalam bentuk yang bisa dipakai.' };
  }

  let value;
  try {
    value = JSON.parse(teks);
  } catch {
    return { ok: false, status: 502, error: 'Hasil bacaan Una tidak berbentuk yang bisa diolah.' };
  }

  return {
    ok: true,
    value,
    usage: payload?.usage ?? null,
    model: payload?.model ?? model
  };
}
