// Jembatan gateway WA lokal <-> server OwnerTenang (Eskor, 2026-10-22, untuk Fina).
//
// Server tidak bisa memanggil laptop (panel hanya 127.0.0.1), jadi jembatan yang menghubungi server:
//   1. Pesan personal yang sudah tersimpan di arsip diteruskan ke POST /api/fina/wa/gateway/masuk
//      (urut seq, posisi terakhir disimpan di arsip; dedup juga dijaga server per id pesan).
//   2. Pesan keluar yang SUDAH DISETUJUI Admin di server diambil dari GET /api/fina/wa/gateway/keluar,
//      dikirim lewat sesi WA ini, lalu hasilnya dilaporkan. Panel lokal tetap tanpa tombol kirim.
// Token = token Sambungan Fina (otwa_...) yang dibuat Admin di Entity Admin -> Pengaturan -> Sambungan
// Fina, ditempel ke data/<tenant>/fina.token. Alamat server dari WA_SERVER (wajib https).
// Batas kirim (per jam / per nomor) ditegakkan server. Tidak ada broadcast atau kirim ke grup.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TOKEN = /^otwa_[0-9a-f]{64}$/;
const SELANG_MS = 15000;
const PESAN_SEKALI = 50;

export function bacaKonfigurasi(archive, env = process.env) {
  const server = String(env.WA_SERVER || '').trim().replace(/\/+$/, '');
  const tokenPath = join(archive.dir, 'fina.token');
  const token = existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : '';
  if (!server || !token) return { aktif: false, alasan: 'WA_SERVER atau data/<tenant>/fina.token belum diisi' };
  let url;
  try { url = new URL(server); } catch { return { aktif: false, alasan: 'WA_SERVER bukan alamat yang benar' }; }
  if (url.protocol !== 'https:') return { aktif: false, alasan: 'WA_SERVER wajib https' };
  if (!TOKEN.test(token)) return { aktif: false, alasan: 'fina.token bukan token Sambungan Fina (otwa_...)' };
  return { aktif: true, server: url.origin, token };
}

/** Nomor HP pengirim: dari jid PN, atau remoteJidAlt saat jid berupa LID (Baileys 7). */
export function nomorPengirim(jid, raw) {
  const dari = j => (typeof j === 'string' && j.endsWith('@s.whatsapp.net') ? j.split('@')[0] : '');
  return dari(jid) || dari(raw?.key?.remoteJidAlt) || '';
}

export class Jembatan {
  constructor({ archive, connection, server, token, fetchImpl = fetch, lib = null, selangMs = SELANG_MS, log = () => {} }) {
    Object.assign(this, { archive, connection, server, token, fetchImpl, lib, selangMs, log });
    this.archive.db.exec('CREATE TABLE IF NOT EXISTS jembatan (kunci TEXT PRIMARY KEY, nilai TEXT NOT NULL)');
    this.berjalan = false; this.sibuk = false; this.timer = null; this.galatTerakhir = null;
  }
  posisi() { return Number(this.archive.db.prepare("SELECT nilai FROM jembatan WHERE kunci='seq'").get()?.nilai || 0); }
  simpanPosisi(seq) { this.archive.db.prepare("INSERT INTO jembatan VALUES ('seq', ?) ON CONFLICT(kunci) DO UPDATE SET nilai=excluded.nilai").run(String(seq)); }
  async panggil(path, opsi = {}) {
    const res = await this.fetchImpl(`${this.server}${path}`, { ...opsi, headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', ...(opsi.headers || {}) }, signal: AbortSignal.timeout(20000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status} ${data.error || ''}`.trim());
    return data;
  }
  async teruskanMasuk() {
    const dari = this.posisi();
    const rows = this.archive.db.prepare('SELECT seq, id, jid, name, body, timestamp, media_type, raw FROM messages WHERE seq > ? ORDER BY seq LIMIT ?').all(dari, PESAN_SEKALI);
    if (!rows.length) return 0;
    const reviver = (this.lib || this.connection.lib)?.BufferJSON?.reviver;
    const pesan = rows.map(r => {
      let raw = null;
      try { raw = JSON.parse(this.archive.open(r.raw), reviver); } catch { raw = null; }
      return { waId: r.id, jid: r.jid, noWa: nomorPengirim(r.jid, raw), nama: r.name, teks: r.body, waktu: r.timestamp, jenisMedia: r.media_type || '' };
    });
    await this.panggil('/api/fina/wa/gateway/masuk', { method: 'POST', body: JSON.stringify({ pesan }) });
    this.simpanPosisi(rows[rows.length - 1].seq);
    return rows.length;
  }
  async kirimKeluar() {
    const socket = this.connection.socket;
    if (this.connection.state !== 'CONNECTED' || !socket) return 0;
    const { pesan = [] } = await this.panggil('/api/fina/wa/gateway/keluar');
    let terkirim = 0;
    for (const m of pesan) {
      let ok = false; let alasan = '';
      try {
        if (!/^628\d{7,12}$/.test(String(m.noWa)) || !String(m.teks || '').trim()) throw new Error('Isi pesan tidak valid');
        await socket.sendMessage(`${m.noWa}@s.whatsapp.net`, { text: String(m.teks) });
        ok = true; terkirim += 1;
      } catch (error) { alasan = String(error?.message || 'gagal').slice(0, 200); }
      await this.panggil(`/api/fina/wa/gateway/keluar/${encodeURIComponent(m.id)}/hasil`, { method: 'POST', body: JSON.stringify({ ok, alasan }) });
    }
    return terkirim;
  }
  async putaran() {
    if (this.sibuk) return;
    this.sibuk = true;
    try {
      await this.teruskanMasuk();
      await this.kirimKeluar();
      this.galatTerakhir = null;
    } catch (error) {
      this.galatTerakhir = String(error?.message || error).slice(0, 200);
      this.log(`Jembatan Fina: ${this.galatTerakhir}`);
    } finally { this.sibuk = false; }
  }
  mulai() {
    if (this.berjalan) return;
    this.berjalan = true;
    const ulang = async () => { if (!this.berjalan) return; await this.putaran(); if (this.berjalan) this.timer = setTimeout(ulang, this.selangMs); };
    void ulang();
  }
  berhenti() { this.berjalan = false; clearTimeout(this.timer); }
}
