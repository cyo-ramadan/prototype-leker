// Penyedia model ketiga untuk modul Caca: Anthropic Claude (Bos Cyo, 2026-10-21: "pingin bisa ganti
// model di sonnet dengan ijin akses suatu tenant ... untuk penanganan kasus2 yang butuh analisis").
//
// Bentuk permintaan sama dengan caca-ai-gemini.js (netral): { system, content, schema }. Yang khusus
// Claude hanya di berkas ini. Dipakai bila tenant diberi izin "Model analisis" di Owner Console dan
// pengguna menekan tombol Analisis di chat (src/caca-chat.js); pesan biasa tetap ke Gemini.
//
// Memakai SDK resmi @anthropic-ai/sdk (jalan di Cloudflare Workers lewat fetch bawaan).
// Structured output (output_config.format) punya batas resmi: maks 24 isian opsional dan 16 tipe
// gabungan per permintaan, tanpa minLength/maximum/dst. Skema pilih-alat Una jauh melebihi itu, jadi
// skema yang tidak muat dikirim sebagai instruksi di system prompt lalu jawabannya diparse dan
// diperiksa di sini (mode "instruksi"); skema kecil memakai structured output resmi.

import Anthropic from '@anthropic-ai/sdk';

export const NAMA = 'anthropic';
export const KUNCI_ENV = 'ANTHROPIC_API_KEY';
// Bos meminta Sonnet: versi Sonnet terbaru.
export const MODEL = 'claude-sonnet-5-5';
const DEFAULT_MAX_TOKENS = 16000;
// Analisis boleh berpikir lebih lama dari Gemini lite.
const DEFAULT_TIMEOUT_MS = 180000;
// Kedalaman berpikir untuk kasus yang butuh analisis (adaptive thinking bawaan Sonnet 5.5).
const DEFAULT_EFFORT = 'high';
// Batas resmi structured output (docs: build-with-claude/structured-outputs).
export const BATAS_SKEMA = Object.freeze({ opsional: 24, gabungan: 16 });
const KATA_DILARANG = new Set(['minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'maxItems', 'pattern', 'minProperties', 'maxProperties']);

// Kunci boleh datang dua cara: binding Secrets Store Cloudflare (objek dengan .get(), dipilih Bos
// 2026-10-21: "pake cara binding") atau secret Worker biasa (teks). Isinya tidak pernah dicatat.
export function terpasang(env) {
  const kunci = env?.ANTHROPIC_API_KEY;
  return typeof kunci === 'string' ? kunci.length > 0 : typeof kunci?.get === 'function';
}

export async function bacaKunci(env) {
  const kunci = env?.ANTHROPIC_API_KEY;
  if (typeof kunci === 'string') return kunci || null;
  if (typeof kunci?.get !== 'function') return null;
  try { return (await kunci.get()) || null; } catch { return null; }
}

/**
 * Skema netral -> skema yang diterima Claude: setiap objek additionalProperties:false, kata kunci
 * batasan yang tidak didukung dibuang, minItems > 1 dibuang. Mengembalikan juga hitungan isian
 * opsional & tipe gabungan untuk menentukan structured output atau mode instruksi.
 */
export function skemaUntukClaude(schema) {
  let opsional = 0;
  let gabungan = 0;
  const jalan = (node) => {
    if (Array.isArray(node)) return node.map(jalan);
    if (!node || typeof node !== 'object') return node;
    const hasil = {};
    for (const [kunci, nilai] of Object.entries(node)) {
      if (KATA_DILARANG.has(kunci)) continue;
      if (kunci === 'minItems' && Number(nilai) > 1) continue;
      if (kunci === 'additionalProperties') continue;
      hasil[kunci] = kunci === 'properties'
        ? Object.fromEntries(Object.entries(nilai || {}).map(([k, v]) => [k, jalan(v)]))
        : jalan(nilai);
    }
    if (hasil.type === 'object' || hasil.properties) {
      hasil.additionalProperties = false;
      const wajib = new Set(Array.isArray(hasil.required) ? hasil.required : []);
      opsional += Object.keys(hasil.properties || {}).filter((k) => !wajib.has(k)).length;
    }
    if (Array.isArray(hasil.anyOf) || Array.isArray(hasil.type)) gabungan += 1;
    return hasil;
  };
  const hasil = jalan(schema);
  return { schema: hasil, opsional, gabungan, muat: opsional <= BATAS_SKEMA.opsional && gabungan <= BATAS_SKEMA.gabungan };
}

function keBlokClaude(content) {
  return (Array.isArray(content) ? content : []).map((bagian) => (bagian.type === 'image'
    ? { type: 'image', source: { type: 'base64', media_type: bagian.mediaType, data: bagian.data } }
    : { type: 'text', text: String(bagian.text ?? '') }));
}

/** Objek JSON pertama dari teks (mode instruksi): pagar ```json dibuang, lalu dicari { ... } terluar. */
export function ambilJson(teks) {
  const bersih = String(teks ?? '').replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(bersih); } catch { /* cari objek di dalam teks */ }
  const awal = bersih.indexOf('{');
  const akhir = bersih.lastIndexOf('}');
  if (awal < 0 || akhir <= awal) return undefined;
  try { return JSON.parse(bersih.slice(awal, akhir + 1)); } catch { return undefined; }
}

/** Pemeriksaan ringan mode instruksi: objek, isian wajib ada, nilai enum di tingkat atas sah. */
export function cocokSkema(nilai, schema) {
  if (!nilai || typeof nilai !== 'object' || Array.isArray(nilai)) return false;
  for (const k of schema?.required ?? []) if (nilai[k] === undefined) return false;
  for (const [k, def] of Object.entries(schema?.properties ?? {})) {
    if (nilai[k] === undefined || nilai[k] === null) continue;
    if (Array.isArray(def?.enum) && !def.enum.includes(nilai[k])) return false;
  }
  return true;
}

export function buatPermintaanClaude({ system, content, schema, model = MODEL, maxTokens = DEFAULT_MAX_TOKENS, effort = DEFAULT_EFFORT }) {
  const skema = skemaUntukClaude(schema);
  const instruksi = skema.muat ? '' : [
    '',
    'FORMAT JAWABAN: balas HANYA dengan satu objek JSON yang valid menurut skema JSON berikut, tanpa teks lain dan tanpa pagar kode.',
    'Isi hanya kolom yang relevan; kolom opsional yang tidak dipakai jangan ditulis.',
    JSON.stringify(skema.schema)
  ].join('\n');
  return {
    mode: skema.muat ? 'structured' : 'instruksi',
    skema: skema.schema,
    body: {
      model,
      max_tokens: maxTokens,
      // Prefix tetap (aturan, daftar alat) di system: cache otomatis bagian terakhir yang bisa di-cache.
      cache_control: { type: 'ephemeral' },
      system: `${system ?? ''}${instruksi}`,
      messages: [{ role: 'user', content: keBlokClaude(content) }],
      output_config: { effort, ...(skema.muat ? { format: { type: 'json_schema', schema: skema.schema } } : {}) },
      // Penolakan pengaman Sonnet 5.5 dialihkan server ke model cadangan yang direkomendasikan.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default'
    }
  };
}

// Alasan dari Anthropic (mis. "fallbacks: ...") ditampilkan ringkas supaya penyebab 400 ketahuan
// tanpa membuka log. Isinya pesan validasi API, bukan data tenant atau kunci.
function alasanApi(error) {
  const pesan = error?.error?.error?.message || error?.message || 'tanpa keterangan';
  return String(pesan).replace(/sk-ant-[\w-]+/g, '[kunci]').slice(0, 240);
}

function pesanGagal(error) {
  if (error instanceof Anthropic.AuthenticationError) return { status: 502, error: 'Kunci Claude (ANTHROPIC_API_KEY) ditolak. Periksa kuncinya.' };
  if (error instanceof Anthropic.PermissionDeniedError) return { status: 502, error: 'Kunci Claude tidak punya akses ke model ini.' };
  if (error instanceof Anthropic.RateLimitError) return { status: 429, error: 'Claude sedang sibuk/kena batas pemakaian. Coba lagi sebentar lagi.' };
  if (error instanceof Anthropic.BadRequestError) return { status: 502, error: `Permintaan ke Claude ditolak (format): ${alasanApi(error)}` };
  if (error instanceof Anthropic.APIConnectionTimeoutError) return { status: 504, error: 'Analisis kelamaan, coba lagi atau persempit pertanyaannya.' };
  if (error instanceof Anthropic.APIConnectionError) return { status: 502, error: 'Tidak bisa menghubungi Claude.' };
  if (error instanceof Anthropic.APIError) return { status: 502, error: `Claude gagal menjawab (${error.status ?? '?'}).` };
  return { status: 502, error: 'Claude gagal menjawab.' };
}

/**
 * Sama dengan callStructured penyedia lain: { ok, value, usage, model } atau { ok:false, status, error }.
 * `buatKlien` hanya untuk tes (menyuntik klien palsu).
 */
export async function callStructured(env, {
  system, content, schema, model = MODEL, maxTokens = DEFAULT_MAX_TOKENS, effort = DEFAULT_EFFORT,
  timeoutMs = DEFAULT_TIMEOUT_MS, buatKlien = (opsi) => new Anthropic(opsi)
} = {}) {
  if (!terpasang(env)) return { ok: false, status: 503, error: 'Claude belum tersambung. Kunci ANTHROPIC_API_KEY belum dipasang.' };
  const { mode, skema, body } = buatPermintaanClaude({ system, content, schema, model, maxTokens, effort });
  let response;
  try {
    const apiKey = await bacaKunci(env);
    if (!apiKey) return { ok: false, status: 503, error: 'Kunci Claude di Secrets Store belum terisi atau belum boleh dipakai Worker ini.' };
    const client = buatKlien({ apiKey, timeout: timeoutMs, maxRetries: 1 });
    try {
      response = await client.beta.messages.create(body);
    } catch (error) {
      if (!(error instanceof Anthropic.BadRequestError)) throw error;
      // Fitur tambahan (fallback beta, cache otomatis) belum tentu aktif di akun/model ini: catat
      // alasannya, lalu coba sekali lagi dengan permintaan paling polos.
      console.warn('claude 400, coba ulang tanpa fitur tambahan', { alasan: alasanApi(error) });
      const { betas: _b, fallbacks: _f, cache_control: _c, ...polos } = body;
      response = await client.beta.messages.create(polos);
    }
  } catch (error) {
    console.warn('claude gagal', { status: error?.status ?? null, alasan: alasanApi(error) });
    return { ok: false, ...pesanGagal(error) };
  }
  if (response?.stop_reason === 'refusal') {
    return { ok: false, status: 422, error: 'Claude menolak memproses permintaan ini. Coba ubah kalimatnya atau pakai mode biasa.' };
  }
  if (response?.stop_reason === 'max_tokens') {
    return { ok: false, status: 502, error: 'Jawaban analisis kepanjangan untuk sekali proses. Persempit pertanyaannya.' };
  }
  const teks = (response?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const value = mode === 'structured' ? (() => { try { return JSON.parse(teks); } catch { return undefined; } })() : ambilJson(teks);
  if (value === undefined || (mode === 'instruksi' && !cocokSkema(value, skema))) {
    return { ok: false, status: 502, error: 'Hasil analisis Claude tidak berbentuk yang bisa diolah.' };
  }
  return { ok: true, value, usage: response?.usage ?? null, model: response?.model ?? model, mode };
}
