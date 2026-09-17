// Satu-satunya tempat modul Caca bicara ke penyedia model. ADR-044 mensyaratkan
// pemanggilan AI dibungkus satu lapisan supaya modelnya bisa ditukar tanpa
// membongkar modul; jangan panggil penyedia langsung dari handler.
//
// Isi permintaan dari pemanggil selalu berbentuk netral (lihat callStructured).
// Yang provider-spesifik cuma penerjemahan di file ini, jadi mengganti penyedia
// berikutnya tidak menyentuh logika pembacaan lembar sama sekali.
//
// Penyedia sekarang: Google Gemini. Dipilih karena murah selama tahap uji —
// keputusan Bos Cyo 2026-09-17. Repo ini nol-dependency dan jalan di Cloudflare
// Workers, jadi pemanggilan pakai fetch bawaan, bukan SDK npm.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_MAX_TOKENS = 16000;
const DEFAULT_TIMEOUT_MS = 120000;

export const CACA_VISION_MODEL = DEFAULT_MODEL;

export function aiConfigured(env) {
  return Boolean(env?.GEMINI_API_KEY);
}

function toGeminiParts(content) {
  return content.map((bagian) => (bagian.type === 'image'
    ? { inline_data: { mime_type: bagian.mediaType, data: bagian.data } }
    : { text: bagian.text }));
}

// responseSchema Gemini memakai subset OpenAPI 3.0, yang tidak mengenal
// additionalProperties. Skema netral dipangkas di sini, bukan di sumbernya,
// supaya penyedia lain yang justru mewajibkannya tetap bisa dilayani.
function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;

  const hasil = {};
  for (const [kunci, nilai] of Object.entries(schema)) {
    if (kunci === 'additionalProperties') continue;
    hasil[kunci] = toGeminiSchema(nilai);
  }
  return hasil;
}

export function buildGeminiRequest({ system, content, schema, maxTokens = DEFAULT_MAX_TOKENS }) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: toGeminiParts(content) }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(schema),
      maxOutputTokens: maxTokens
    }
  };
}

function textFromCandidate(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((bagian) => bagian?.text ?? '').join('');
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
  if (!aiConfigured(env)) {
    return { ok: false, status: 503, error: 'Caca belum tersambung ke mesin AI. Kunci API belum dipasang.' };
  }

  let response;
  try {
    response = await fetchImpl(`${API_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY
      },
      body: JSON.stringify(buildGeminiRequest({ system, content, schema, maxTokens })),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      error: timedOut ? 'Caca kelamaan membaca, coba lagi ya.' : 'Caca tidak bisa menghubungi mesin AI.'
    };
  }

  if (!response.ok) {
    // Badan error penyedia bisa memuat potongan permintaan; jangan diteruskan ke klien.
    return { ok: false, status: 502, error: `Mesin AI menolak permintaan (${response.status}).` };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, status: 502, error: 'Jawaban mesin AI tidak terbaca.' };
  }

  const finishReason = payload?.candidates?.[0]?.finishReason;
  if (finishReason === 'MAX_TOKENS') {
    return { ok: false, status: 502, error: 'Lembarnya terlalu panjang buat sekali baca. Coba difoto per bagian.' };
  }
  if (finishReason && finishReason !== 'STOP') {
    return { ok: false, status: 422, error: 'Caca tidak bisa memproses gambar ini.' };
  }

  const teks = textFromCandidate(payload);
  if (!teks) {
    return { ok: false, status: 502, error: 'Caca tidak berhasil membaca isinya dalam bentuk yang bisa dipakai.' };
  }

  let value;
  try {
    value = JSON.parse(teks);
  } catch {
    return { ok: false, status: 502, error: 'Hasil bacaan Caca tidak berbentuk yang bisa diolah.' };
  }

  return {
    ok: true,
    value,
    usage: payload?.usageMetadata ?? null,
    model: payload?.modelVersion ?? model
  };
}
