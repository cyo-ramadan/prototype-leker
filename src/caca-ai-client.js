// Satu-satunya tempat modul Caca bicara ke penyedia model. ADR-044 mensyaratkan
// pemanggilan AI dibungkus satu lapisan supaya modelnya bisa ditukar tanpa
// membongkar modul; jangan panggil penyedia langsung dari handler.
//
// Repo ini nol-dependency dan dijalankan di Cloudflare Workers, jadi pemanggilan
// pakai fetch bawaan — bukan SDK npm, yang akan jadi paket pertama di repo dan
// mengubah pipeline deploy Git Integration yang sedang melayani production.

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-opus-5';
const DEFAULT_MAX_TOKENS = 16000;
const DEFAULT_TIMEOUT_MS = 120000;

export const CACA_VISION_MODEL = DEFAULT_MODEL;

export function aiConfigured(env) {
  return Boolean(env?.ANTHROPIC_API_KEY);
}

function firstToolInput(content, toolName) {
  if (!Array.isArray(content)) return null;
  const block = content.find((item) => item?.type === 'tool_use' && item?.name === toolName);
  return block?.input ?? null;
}

/**
 * Memanggil model dan memaksa jawabannya lewat satu alat berskema ketat.
 * Mengembalikan { ok, value } — value adalah input alat yang sudah tervalidasi
 * skema oleh penyedia, bukan teks bebas yang harus ditebak parsingnya.
 */
export async function callStructured(env, {
  system,
  content,
  tool,
  model = DEFAULT_MODEL,
  maxTokens = DEFAULT_MAX_TOKENS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch
} = {}) {
  if (!aiConfigured(env)) {
    return { ok: false, status: 503, error: 'Caca belum tersambung ke mesin AI. Kunci API belum dipasang.' };
  }

  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
    tools: [{ ...tool, strict: true }],
    tool_choice: { type: 'auto' }
  };

  let response;
  try {
    response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': API_VERSION,
        'x-api-key': env.ANTHROPIC_API_KEY
      },
      body: JSON.stringify(body),
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

  if (payload?.stop_reason === 'refusal') {
    return { ok: false, status: 422, error: 'Caca menolak memproses gambar ini.' };
  }

  const value = firstToolInput(payload?.content, tool.name);
  if (!value) {
    return { ok: false, status: 502, error: 'Caca tidak berhasil membaca isinya dalam bentuk yang bisa dipakai.' };
  }

  return { ok: true, value, usage: payload?.usage ?? null, model: payload?.model ?? model };
}
