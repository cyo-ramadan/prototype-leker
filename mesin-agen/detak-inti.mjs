// Detak (heartbeat) Mesin Agen untuk MAXI Agent Office (HANDOFF-AI-AGENT-MONITORING.md).
//
// Mesin menulis satu file status lokal setiap kali keadaannya berubah. Agent Office (atau
// `node mesin-agen/status.mjs`) cukup MEMBACA file itu -- tidak ada yang dikirim ke internet,
// sesuai prinsip handoff: lokal dulu, read-only, tanpa isi percakapan/kode.
//
// Status mengikuti kamus handoff: IDLE, WORKING, WAITING_APPROVAL, BLOCKED, ERROR, DONE.
// UNRESPONSIVE dan STALLED tidak ditulis mesin -- disimpulkan pembaca dari umur detak terakhir.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const BATAS_DIAM_MS = 10 * 60 * 1000;   // WORKING tanpa detak 10 menit -> STALLED
export const BATAS_HILANG_MS = 30 * 60 * 1000;  // tidak ada detak 30 menit -> UNRESPONSIVE

export function lokasiStatus(env = process.env) {
  return env.MESIN_STATUS_FILE || join(homedir(), '.maxi-mesin', 'status.json');
}

// Peta event OpenCode -> status Agent Office. null = event tidak mengubah status.
export function statusDariEvent(event) {
  const type = event?.type;
  const props = event?.properties || {};
  if (type === 'session.status') {
    const jenis = props.status?.type;
    if (jenis === 'busy') return { status: 'WORKING' };
    if (jenis === 'retry') return { status: 'WORKING', catatan: 'mencoba ulang ke model' };
    if (jenis === 'idle') return { status: 'IDLE' };
    return null;
  }
  if (type === 'session.idle') return { status: 'IDLE' };
  if (type === 'session.error') {
    const pesan = props.error?.data?.message || props.error?.name || 'error';
    return { status: 'ERROR', catatan: String(pesan).slice(0, 200) };
  }
  if (type === 'permission.asked' || type === 'permission.updated') return { status: 'WAITING_APPROVAL' };
  if (type === 'permission.replied') return { status: 'WORKING' };
  return null;
}

export function tulisStatus(perubahan, { env = process.env, now = new Date() } = {}) {
  const file = lokasiStatus(env);
  let lama = {};
  try { lama = JSON.parse(readFileSync(file, 'utf8')); } catch { /* belum ada */ }
  const baru = {
    agen: env.MESIN_NAMA || 'mesin',
    pid: process.pid,
    ...lama,
    ...perubahan,
    diperbarui: now.toISOString()
  };
  if (perubahan.status && perubahan.status !== lama.status) baru.sejak = baru.diperbarui;
  if (!('catatan' in perubahan) && perubahan.status) delete baru.catatan;
  mkdirSync(join(file, '..'), { recursive: true });
  const sementara = `${file}.${process.pid}.tmp`;
  writeFileSync(sementara, JSON.stringify(baru, null, 2));
  renameSync(sementara, file);
  return baru;
}

// Untuk pembaca (Agent Office / status.mjs): status yang tampil, termasuk STALLED/UNRESPONSIVE.
export function statusTampil(data, now = Date.now()) {
  if (!data?.diperbarui) return 'TIDAK_ADA_DATA';
  const umur = now - Date.parse(data.diperbarui);
  if (umur > BATAS_HILANG_MS) return 'UNRESPONSIVE';
  if (data.status === 'WORKING' && umur > BATAS_DIAM_MS) return 'STALLED';
  return data.status;
}
