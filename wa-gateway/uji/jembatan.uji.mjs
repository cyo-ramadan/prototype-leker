import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Archive, normalizeMessage } from '../store.mjs';
import { Jembatan, bacaKonfigurasi, nomorPengirim } from '../jembatan.mjs';

// Jembatan gateway -> server Fina (Eskor, 2026-10-22).

const TOKEN = 'otwa_' + 'a'.repeat(64);
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wa-jembatan-'));
  const archive = new Archive(root, 'tenant-a');
  t.after(() => { archive.close(); rmSync(root, { recursive: true, force: true }); });
  return archive;
}
const simpan = (archive, raw) => archive.insert(normalizeMessage(raw), JSON.stringify(raw));
const raw = (id, remoteJid, extra = {}) => ({ key: { id, remoteJid, fromMe: false, ...extra }, message: { conversation: `halo ${id}` }, messageTimestamp: 1761100000, pushName: 'Sari' });
function serverPalsu(keluar = []) {
  const catat = [];
  const fetchImpl = async (url, opsi) => {
    catat.push({ url, method: opsi.method || 'GET', body: opsi.body ? JSON.parse(opsi.body) : null, auth: opsi.headers.authorization });
    const path = new URL(url).pathname;
    const isi = path.endsWith('/keluar') ? { pesan: keluar.splice(0) } : { ok: true };
    return { ok: true, status: 200, json: async () => isi };
  };
  return { catat, fetchImpl };
}

test('konfigurasi: wajib https + token Sambungan Fina; tanpa itu jembatan mati', t => {
  const archive = fixture(t);
  assert.equal(bacaKonfigurasi(archive, {}).aktif, false);
  writeFileSync(join(archive.dir, 'fina.token'), TOKEN);
  assert.equal(bacaKonfigurasi(archive, { WA_SERVER: 'http://contoh.test' }).aktif, false, 'http ditolak');
  assert.deepEqual(bacaKonfigurasi(archive, { WA_SERVER: 'https://contoh.test/' }), { aktif: true, server: 'https://contoh.test', token: TOKEN });
  writeFileSync(join(archive.dir, 'fina.token'), 'salah');
  assert.equal(bacaKonfigurasi(archive, { WA_SERVER: 'https://contoh.test' }).aktif, false);
});

test('nomor pengirim dari jid nomor HP atau remoteJidAlt saat jid berupa LID', () => {
  assert.equal(nomorPengirim('628123456789@s.whatsapp.net', null), '628123456789');
  assert.equal(nomorPengirim('12345678901234@lid', { key: { remoteJidAlt: '628111222333@s.whatsapp.net' } }), '628111222333');
  assert.equal(nomorPengirim('12345678901234@lid', { key: {} }), '');
});

test('meneruskan pesan masuk sekali (posisi tersimpan), dengan token di header', async t => {
  const archive = fixture(t);
  simpan(archive, raw('A', '628123456789@s.whatsapp.net'));
  simpan(archive, raw('B', '99887766554433@lid', { remoteJidAlt: '628555444333@s.whatsapp.net' }));
  const { catat, fetchImpl } = serverPalsu();
  const j = new Jembatan({ archive, connection: { state: 'STOPPED' }, server: 'https://contoh.test', token: TOKEN, fetchImpl });
  await j.putaran();
  const masuk = catat.filter(c => c.url.endsWith('/api/fina/wa/gateway/masuk'));
  assert.equal(masuk.length, 1);
  assert.equal(masuk[0].auth, `Bearer ${TOKEN}`);
  assert.deepEqual(masuk[0].body.pesan.map(p => [p.waId, p.noWa, p.teks]), [['A', '628123456789', 'halo A'], ['B', '628555444333', 'halo B']]);
  assert.equal(catat.some(c => c.url.endsWith('/keluar')), false, 'tidak tersambung WA: tidak mengambil antrean kirim');
  await j.putaran();
  assert.equal(catat.filter(c => c.url.endsWith('/masuk')).length, 1, 'tidak meneruskan ulang');
});

test('mengirim hanya pesan dari antrean server lalu melaporkan hasil; nomor tidak valid gagal', async t => {
  const archive = fixture(t);
  const terkirim = [];
  const socket = { sendMessage: async (jid, isi) => { terkirim.push([jid, isi.text]); } };
  const { catat, fetchImpl } = serverPalsu([{ id: 'k1', noWa: '628123456789', teks: 'Undangan interview' }, { id: 'k2', noWa: '12', teks: 'x' }]);
  const j = new Jembatan({ archive, connection: { state: 'CONNECTED', socket }, server: 'https://contoh.test', token: TOKEN, fetchImpl });
  await j.putaran();
  assert.deepEqual(terkirim, [['628123456789@s.whatsapp.net', 'Undangan interview']]);
  const hasil = catat.filter(c => c.url.includes('/hasil'));
  assert.deepEqual(hasil.map(h => [h.url.split('/').at(-2), h.body.ok]), [['k1', true], ['k2', false]]);
});
