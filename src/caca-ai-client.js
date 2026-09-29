// Pintu tunggal modul Caca ke penyedia model (ADR-044).
//
// File ini tidak tahu apa-apa soal bentuk permintaan penyedia mana pun — itu
// urusan caca-ai-gemini.js dan caca-ai-openai.js. Tugasnya cuma menentukan
// penyedia mana yang dipakai, lalu meneruskan permintaan berbentuk netral:
//
//   content: [{ type: 'image', mediaType, data }, { type: 'text', text }]
//   schema:  skema JSON polos, bukan bentuk milik penyedia mana pun
//
// Dua penyedia disimpan berdampingan karena Bos Cyo memang berniat berpindah:
// Gemini dipakai untuk uji coba (ada jalur gratis), OpenAI GPT-6 Luna untuk
// pemakaian sungguhan (sekitar 3x lebih murah per token). Berpindah = mengganti
// satu setelan, bukan menulis ulang kode — dan itu berlaku juga untuk penyedia
// ketiga nanti, karena yang perlu ditambah cuma satu berkas penyedia baru.

import * as gemini from './caca-ai-gemini.js';
import * as openai from './caca-ai-openai.js';

const PENYEDIA = Object.freeze({ gemini, openai });
const URUTAN_BAWAAN = Object.freeze(['gemini', 'openai']);

/**
 * `CACA_MESIN` memaksa penyedia tertentu. Tanpa itu, yang dipakai adalah
 * penyedia pertama yang kuncinya terpasang — jadi memasang kunci sudah cukup
 * untuk menyalakan, tanpa setelan kedua yang gampang lupa diubah.
 */
export function pilihPenyedia(env) {
  const dipaksa = String(env?.CACA_MESIN ?? '').trim().toLowerCase();
  if (dipaksa) return PENYEDIA[dipaksa] ?? null;
  return URUTAN_BAWAAN.map((nama) => PENYEDIA[nama]).find((p) => p.terpasang(env)) ?? null;
}

export function aiConfigured(env) {
  const penyedia = pilihPenyedia(env);
  return Boolean(penyedia && penyedia.terpasang(env));
}

/** Nama model yang benar-benar akan dipakai, untuk ditampilkan di panel. */
export function modelAktif(env) {
  return pilihPenyedia(env)?.MODEL ?? null;
}

export const CACA_VISION_MODEL = gemini.MODEL;

export async function callStructured(env, permintaan = {}) {
  const penyedia = pilihPenyedia(env);
  if (!penyedia) {
    const diminta = String(env?.CACA_MESIN ?? '').trim();
    return diminta
      ? { ok: false, status: 503, error: `Mesin AI "${diminta}" belum dikenal Caca.` }
      : { ok: false, status: 503, error: 'Caca belum tersambung ke mesin AI. Kunci API belum dipasang.' };
  }
  if (!penyedia.terpasang(env)) {
    return { ok: false, status: 503, error: `Kunci ${penyedia.KUNCI_ENV} belum dipasang.` };
  }
  return penyedia.callStructured(env, permintaan);
}
