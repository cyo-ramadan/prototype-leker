#!/usr/bin/env node
// Pengulang skenario Una ke mesin AI SUNGGUHAN (Gemini di Worker produksi),
// di gerai uji TESTINGUNA. Cara "melatih" Una di repo ini bukan fine-tuning,
// tapi: tulis skenario dari kejadian nyata -> jalankan ini -> perbaiki kerangka
// (contoh, alat, pembaca kalimat, tugas tertunda) -> jalankan lagi.
// Panduan lengkap: UNA-MESIN-DAN-LATIHAN.md.
//
// Pemakaian:
//   LEKER_HANA_ADMIN_USER=... LEKER_HANA_ADMIN_PASS=... node scripts/uji-una.mjs [berkas.json ...]
//   (tanpa argumen = semua di una-latih/skenario/)
// Opsi env: UNA_STORE (bawaan TESTINGUNA), UNA_BASE (bawaan Worker produksi), UNA_ULANG (berapa kali tiap skenario, bawaan 1).
//
// Aman: draft TIDAK PERNAH disetujui — tidak ada yang tersimpan. Menirukan panel:
// riwayat, catatan kerja, tugas tertunda, draft terbuka (revisi), satu langkah per permintaan.
//
// Bentuk skenario (JSON):
//   { "nama": "...", "pesan": ["pesan 1", "pesan 2"],
//     "harapan": { "alat": "buat_barang", "draft": { "name": "cup jumbo", "purchasePrice": 100 },
//                  "jawabanMemuat": "teks", "jawabanTidakMemuat": "teks", "tanpaDraft": true } }
// Harapan dinilai pada balasan pesan TERAKHIR.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.UNA_BASE || 'https://prototype-leker-v2.daily-napkin.workers.dev';
const STORE = process.env.UNA_STORE || 'TESTINGUNA';
const ULANG = Math.max(1, Number(process.env.UNA_ULANG || 1));
const DIR = new URL('../una-latih/skenario/', import.meta.url);

async function masuk() {
  const { LEKER_HANA_ADMIN_USER: username, LEKER_HANA_ADMIN_PASS: password } = process.env;
  if (!username || !password) throw new Error('Set LEKER_HANA_ADMIN_USER dan LEKER_HANA_ADMIN_PASS (akun Entity Admin, jangan ditulis di repo).');
  const r = await fetch(`${BASE}/api/entity-admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`Login gagal: ${j.error}`);
  return j.token;
}

async function obrolan(token, pesanDaftar) {
  const H = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  const kirim = async (isi) => {
    const r = await fetch(`${BASE}/api/caca/tanya?store=${STORE}`, { method: 'POST', headers: H, body: JSON.stringify({ ...isi, satuLangkah: true }) });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  const riwayat = [];
  let tertunda = null;
  let kerja = null;
  let p = null;
  const jejak = [];
  for (const pesan of pesanDaftar) {
    p = await kirim({ pertanyaan: pesan, riwayat: [...riwayat], kerja, tertunda });
    for (let i = 0; i < 11 && p.lanjutkan && p.kerja; i += 1) p = await kirim({ pertanyaan: pesan, riwayat: [...riwayat], kerja: p.kerja, tertunda: null });
    jejak.push({ pesan, alat: p.alat, jawaban: p.jawaban, draft: p.draft?.muatan ?? null, error: p.error });
    riwayat.push({ dari: 'saya', teks: pesan });
    riwayat.push({ dari: 'una', teks: p.draft ? `Una menyusun draft dan menunggu persetujuan. ${p.draft.judul || ''}` : (p.jawaban || p.error || '') });
    kerja = p.belumLengkap && p.kerja ? p.kerja : null;
    tertunda = p.tertunda
      || (p.perluKonfirmasi && p.draft?.aksi && p.draft.tangkapan ? { alat: p.draft.aksi, tangkapan: p.draft.tangkapan, revisi: true } : null);
  }
  return { akhir: p, jejak };
}

function nilai(harapan, akhir) {
  const salah = [];
  if (akhir.error) salah.push(`error: ${akhir.error}`);
  if (harapan.alat && akhir.alat !== harapan.alat) salah.push(`alat ${akhir.alat} ≠ ${harapan.alat}`);
  for (const [k, v] of Object.entries(harapan.draft ?? {})) {
    const nyata = akhir.draft?.muatan?.[k];
    if (JSON.stringify(nyata) !== JSON.stringify(v)) salah.push(`draft.${k} ${JSON.stringify(nyata)} ≠ ${JSON.stringify(v)}`);
  }
  if (harapan.tanpaDraft && akhir.draft) salah.push(`ada draft padahal seharusnya bertanya dulu: ${JSON.stringify(akhir.draft.muatan)}`);
  if (harapan.jawabanMemuat && !String(akhir.jawaban ?? '').toLowerCase().includes(harapan.jawabanMemuat.toLowerCase())) salah.push(`jawaban tidak memuat "${harapan.jawabanMemuat}"`);
  if (harapan.jawabanTidakMemuat && String(akhir.jawaban ?? '').toLowerCase().includes(harapan.jawabanTidakMemuat.toLowerCase())) salah.push(`jawaban memuat "${harapan.jawabanTidakMemuat}"`);
  return salah;
}

const berkas = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(DIR).filter((n) => n.endsWith('.json')).sort().map((n) => path.join(DIR.pathname, n));
const token = await masuk();
let lulus = 0;
let total = 0;
for (const f of berkas) {
  const s = JSON.parse(readFileSync(f, 'utf8'));
  for (let u = 0; u < ULANG; u += 1) {
    total += 1;
    const { akhir, jejak } = await obrolan(token, s.pesan);
    const salah = nilai(s.harapan ?? {}, akhir);
    if (!salah.length) lulus += 1;
    console.log(`${salah.length ? '✗' : '✓'} ${s.nama}${ULANG > 1 ? ` (#${u + 1})` : ''}`);
    if (salah.length) {
      for (const j of jejak) console.log(`    Bos: ${j.pesan}\n    Una [${j.alat}]: ${j.jawaban ?? ''}${j.draft ? ` DRAFT ${JSON.stringify(j.draft)}` : ''}${j.error ? ` ERROR ${j.error}` : ''}`);
      for (const x of salah) console.log(`    -> ${x}`);
    }
  }
}
console.log(`\n${lulus}/${total} lulus`);
process.exitCode = lulus === total ? 0 : 1;
