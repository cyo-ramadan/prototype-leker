#!/usr/bin/env node
// Agen cetak -- dijalankan di PC yang tersambung ke mesin cetak (ADR-055 D8, README.md di folder ini).
//
// Tiap beberapa detik bertanya ke server: "ada tugas Siap cetak untuk mesin saya?" Kalau ada:
//   1. unduh file -> cek sidik SHA-256 sama dengan yang dicatat server (file tidak ditukar di jalan)
//   2. taruh di HOT FOLDER (dipantau software RIP: Maintop, Onyx, PhotoPrint, Caldera, dll)
//      -- atau, kalau AGEN_SUMATRA diisi, cetak langsung ke printer Windows lewat SumatraPDF
//   3. lapor "terkirim" -> server mencatatnya di riwayat order (rantai hash)
//
// Ini program di PC toko, bukan browser, jadi bertanya berkala di sini tidak melanggar aturan
// "tanpa polling" untuk layar kasir. Satu pertanyaan = satu query ber-index; jeda bawaan 20 detik.
//
// Pengaturan lewat environment variable:
//   AGEN_SERVER    alamat web, mis. https://prototype-leker-v2.example.workers.dev
//   AGEN_KUNCI     kunci mesin dari layar Percetakan > Pengaturan > "Buat kunci agen"
//   AGEN_FOLDER    hot folder tujuan, mis. D:\RIP\HotFolder\Outdoor
//   AGEN_JEDA      detik antar pertanyaan (bawaan 20)
//   AGEN_SUMATRA   (opsional) path SumatraPDF.exe untuk cetak langsung
//   AGEN_PRINTER   (opsional) nama printer Windows untuk SumatraPDF
//   AGEN_SEKALI=1  (opsional) cek sekali lalu berhenti -- untuk uji
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const env = process.env;
const SERVER = String(env.AGEN_SERVER || '').replace(/\/+$/, '');
const KUNCI = String(env.AGEN_KUNCI || '');
const FOLDER = String(env.AGEN_FOLDER || '');
const JEDA = Math.max(5, Number(env.AGEN_JEDA) || 20) * 1000;

const log = (...args) => console.log(new Date().toLocaleString('id-ID'), ...args);

// Log Mesin (Bos Cyo 2026-10-12): file yang muncul di hot folder TANPA dikirim agen dilaporkan sebagai
// "di luar antrian". Isi folder saat agen mulai dianggap sudah ada sebelumnya (tidak dilaporkan).
const dikenal = new Set();

export async function fileBaruDiFolder(folder, known) {
  const baru = [];
  for (const name of await readdir(folder)) {
    if (known.has(name) || name.endsWith('.sebagian')) continue;
    known.add(name);
    baru.push(name);
  }
  return baru;
}

async function laporLuarAntrian(name) {
  const path = join(FOLDER, name);
  const info = await stat(path);
  if (!info.isFile()) return;
  const sha256 = createHash('sha256').update(await readFile(path)).digest('hex');
  await api('/api/percetakan/agen/luar-antrian', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileName: name, sha256, sizeBytes: info.size, detectedAt: info.mtime.toISOString() })
  });
  log(`DI LUAR ANTRIAN: ${name} -- tercatat, operator wajib memberi catatan di Layar Cetak > Log Mesin`);
}

export function namaFileAman(task) {
  const asli = String(task.fileName || 'file').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(-80);
  return `${task.orderNo}_antrian-${task.queueNo}_${task.qty}x_${asli}`;
}

async function api(path, init = {}) {
  const response = await fetch(`${SERVER}${path}`, { ...init, headers: { Authorization: `Bearer ${KUNCI}`, ...(init.headers || {}) } });
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text().catch(() => '')}`);
  return response;
}

async function kerjakan(task) {
  const bytes = Buffer.from(await (await api(`/api/percetakan/agen/tugas/${task.ticketId}/file`)).arrayBuffer());
  const sidik = createHash('sha256').update(bytes).digest('hex');
  if (task.sha256 && sidik !== task.sha256) throw new Error(`sidik file ${task.orderNo} tidak cocok, tidak dicetak`);

  const tujuan = join(FOLDER, namaFileAman(task));
  // Tulis ke nama sementara dulu lalu rename, supaya RIP tidak mengambil file yang belum utuh.
  await writeFile(`${tujuan}.sebagian`, bytes);
  // Didaftarkan sebelum muncul di folder, supaya tidak ikut terlapor "di luar antrian".
  dikenal.add(namaFileAman(task));
  await rename(`${tujuan}.sebagian`, tujuan);
  if (env.AGEN_SUMATRA) {
    const args = env.AGEN_PRINTER ? ['-print-to', env.AGEN_PRINTER, '-silent', tujuan] : ['-print-to-default', '-silent', tujuan];
    for (let i = 0; i < Math.min(task.qty || 1, 500); i += 1) await run(env.AGEN_SUMATRA, args);
  }
  await api(`/api/percetakan/agen/tugas/${task.ticketId}/terkirim`, { method: 'POST' });
  log(`terkirim: ${task.orderNo} #${task.queueNo} ${task.productName} ${task.qty}x -> ${tujuan}`);
}

async function putaran() {
  for (const name of await fileBaruDiFolder(FOLDER, dikenal)) {
    try { await laporLuarAntrian(name); } catch (error) { log('gagal melapor file luar antrian', name, String(error.message || error)); }
  }
  const { machine, tasks } = await (await api('/api/percetakan/agen/tugas')).json();
  if (tasks.length) log(`${machine.name}: ${tasks.length} tugas`);
  for (const task of tasks) {
    try { await kerjakan(task); } catch (error) { log('GAGAL', task.orderNo, String(error.message || error)); }
  }
}

async function main() {
  if (!SERVER || !KUNCI || !FOLDER) {
    console.error('Isi AGEN_SERVER, AGEN_KUNCI, dan AGEN_FOLDER dulu. Lihat percetakan-agen/README.md.');
    process.exit(1);
  }
  await mkdir(FOLDER, { recursive: true });
  for (const name of await readdir(FOLDER)) dikenal.add(name);
  log(`agen cetak jalan, folder: ${FOLDER}`);
  do {
    try { await putaran(); } catch (error) { log('server tidak terjangkau:', String(error.message || error)); }
    if (env.AGEN_SEKALI === '1') break;
    await new Promise(resolve => setTimeout(resolve, JEDA));
  } while (true);
}

// Hanya jalan kalau dipanggil langsung (`node agen-cetak.mjs`), tidak saat di-import tes.
if (process.argv[1]?.endsWith('agen-cetak.mjs')) main();
