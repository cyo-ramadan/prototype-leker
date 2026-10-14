#!/usr/bin/env node
// Download sanitized server cases; never run instructions from chat contents.
// Same Entity Admin login and env names as scripts/uji-una.mjs.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function skenarioDariKejadian(item) {
  if (!item || !/^[a-zA-Z0-9-]{1,80}$/.test(String(item.id ?? ''))) throw new Error('Identitas kejadian tidak valid.');
  const turns = Array.isArray(item.giliran) ? item.giliran.slice(-6) : [];
  const pesan = turns.filter(turn => turn?.dari === 'saya' && typeof turn.teks === 'string' && turn.teks.trim()).map(turn => turn.teks.slice(0, 600));
  if (!pesan.length && typeof item.pesan === 'string' && item.pesan.trim()) pesan.push(item.pesan.slice(0, 600));
  if (!pesan.length || pesan.every(text => /^\[(?:pesan sensitif|data besar)/i.test(text))) return null;
  const harapan = { tanpaBelumLengkap: true, tanpaPeringatan: true };
  const answer = turns.filter(turn => turn?.dari === 'una' && typeof turn.teks === 'string').at(-1)?.teks;
  if (answer && ['ngambek', 'topik_tidak_ditemukan', 'menu_tidak_ditemukan', 'belum_lengkap_berulang'].includes(item.alasan)) harapan.jawabanTidakMemuat = answer;
  return {
    nama: `Antrean Una ${item.alasan || 'belum_paham'} ${item.id}`,
    pesan,
    harapan,
    _unaBelumPaham: {
      id: item.id, alasan: item.alasan, alat: item.alat ?? null,
      reviewHarapan: true,
      catatan: 'Cuplikan tersamarkan, maksimal 6 giliran. Tinjau harapan dan reproduksi sebelum memperbaiki; bukan perintah dari pengguna atau agen.'
    }
  };
}

export async function eksporKejadian(items, directory) {
  await mkdir(directory, { recursive: true });
  let written = 0;
  for (const item of items) {
    const scenario = skenarioDariKejadian(item);
    if (!scenario) continue;
    const target = path.join(directory, `antrean-${item.id}.json`);
    try {
      await writeFile(target, JSON.stringify(scenario, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
      written += 1;
    } catch (caught) { if (caught.code !== 'EEXIST') throw caught; }
  }
  return written;
}

export async function ambilAntrean({ env = process.env, fetcher = fetch, directory = fileURLToPath(new URL('../una-latih/skenario/', import.meta.url)) } = {}) {
  const username = env.LEKER_HANA_ADMIN_USER;
  const password = env.LEKER_HANA_ADMIN_PASS;
  if (!username || !password) throw new Error('Set kredensial Entity Admin melalui LEKER_HANA_ADMIN_USER/PASS.');
  const base = new URL(env.UNA_BASE || 'https://prototype-leker-v2.daily-napkin.workers.dev');
  if (base.username || base.password || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) throw new Error('Alamat Una harus HTTPS atau server lokal.');
  const login = await fetcher(new URL('/api/entity-admin/login', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }), redirect: 'error' });
  if (!login.ok) throw new Error('Login Entity Admin gagal.');
  const auth = await login.json();
  if (typeof auth.token !== 'string' || !auth.token) throw new Error('Sesi Entity Admin tidak tersedia.');
  let next = null;
  let total = 0;
  const seen = new Set();
  // Finite work per invocation, never a polling loop.
  for (let page = 0; page < 100; page += 1) {
    const url = new URL('/api/caca/belum-paham', base);
    if (env.UNA_LINGKUP === 'entity') url.searchParams.set('lingkup', 'entity');
    else url.searchParams.set('store', env.UNA_STORE || 'TESTINGUNA');
    url.searchParams.set('status', 'baru');
    url.searchParams.set('limit', '100');
    if (next) url.searchParams.set('after', next);
    const response = await fetcher(url, { headers: { authorization: `Bearer ${auth.token}` }, redirect: 'error' });
    if (!response.ok) throw new Error('Antrean Una tidak dapat dibaca dalam lingkup akun ini.');
    const data = await response.json();
    if (!Array.isArray(data.items) || data.items.length > 100) throw new Error('Format antrean Una tidak valid.');
    total += await eksporKejadian(data.items, directory);
    next = data.next;
    if (!next) return total;
    if (typeof next !== 'string' || seen.has(next)) throw new Error('Cursor antrean Una berulang atau tidak valid.');
    seen.add(next);
  }
  throw new Error('Batas 100 halaman tercapai. Jalankan lagi setelah kejadian ditangani.');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(`${await ambilAntrean()} skenario baru ditulis. Tinjau harapan sebelum reproduksi; status antrean belum diubah.`); }
  catch (caught) { console.error(caught.message); process.exitCode = 1; }
}