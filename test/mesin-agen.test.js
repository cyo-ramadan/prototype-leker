import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BATAS_DIAM_MS, BATAS_HILANG_MS, statusDariEvent, statusTampil, tulisStatus } from '../mesin-agen/detak-inti.mjs';

// Mesin Agen (Bos Cyo 2026-10-08): kerangka agen dengan model non-Anthropic yang turun ke model
// cadangan saat limit dan kembali ke yang pintar sesudah limit pulih. Uji router sungguhan (LiteLLM +
// server tiruan) ada di mesin-agen/README.md; tes ini menjaga konfigurasinya tetap utuh dan aman.

const baca = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const router = baca('mesin-agen/router.yaml');
const opencode = JSON.parse(baca('mesin-agen/opencode/opencode.json'));

function namaModelRouter() {
  return [...router.matchAll(/^\s+- model_name:\s*(\S+)/gm)].map(m => m[1]);
}

test('router: "mesin" adalah urutan pertama dan semua cadangan ada di daftar model', () => {
  const nama = namaModelRouter();
  assert.equal(nama[0], 'mesin');
  const fallback = router.match(/-\s*mesin:\s*\[([^\]]+)\]/);
  assert.ok(fallback, 'router harus punya rantai cadangan untuk "mesin"');
  const rantai = fallback[1].split(',').map(s => s.trim());
  assert.ok(rantai.length >= 2);
  for (const cadangan of rantai) assert.ok(nama.includes(cadangan), `${cadangan} tidak ada di model_list`);
  assert.deepEqual(rantai, nama.slice(1), 'urutan cadangan harus sama dengan urutan model_list');
});

test('router: model yang kena limit diistirahatkan lalu dicoba lagi (kembali ke yang pintar)', () => {
  const cooldown = Number(router.match(/cooldown_time:\s*(\d+)/)?.[1]);
  assert.ok(cooldown >= 60 && cooldown <= 3600, 'masa istirahat 1-60 menit');
  assert.match(router, /num_retries:\s*0/, 'tidak mengulang ke model yang sama, langsung ke cadangan');
});

test('kunci API tidak pernah ditulis di file konfigurasi', () => {
  for (const baris of router.split('\n').filter(b => /api_key:|master_key:/.test(b))) {
    assert.match(baris, /os\.environ\//, `kunci harus dari .env: ${baris.trim()}`);
  }
  const teks = JSON.stringify(opencode);
  assert.doesNotMatch(teks, /sk-[A-Za-z0-9]{10,}/);
  assert.match(opencode.provider.router.options.apiKey, /^\{env:/);
  assert.match(opencode.mcp['agent-bus'].headers.Authorization, /^Bearer \{env:/);
  assert.match(baca('.gitignore'), /^mesin-agen\/\.env$/m);
  for (const baris of baca('mesin-agen/.env.example').split('\n')) {
    if (/(KEY|TOKEN)=/.test(baris)) assert.match(baris, /=$/, `contoh .env harus kosong: ${baris}`);
  }
});

test('OpenCode memakai model dari router dan membawa peran Mesin', () => {
  const nama = namaModelRouter();
  for (const pilihan of [opencode.model, opencode.small_model]) {
    const [provider, model] = pilihan.split('/');
    assert.equal(provider, 'router');
    assert.ok(nama.includes(model), `${model} tidak ada di router.yaml`);
    assert.ok(opencode.provider.router.models[model], `${model} tidak terdaftar di provider OpenCode`);
  }
  assert.deepEqual(opencode.instructions, ['mesin-agen/PERAN.md']);
  assert.match(baca('mesin-agen/PERAN.md'), /agent-bus\/CLAIM-PROMPT\.md/);
});

test('pagar: mesin tidak bisa deploy, push ke main, atau push paksa', () => {
  const bash = opencode.permission.bash;
  for (const pola of ['npm run deploy*', 'npx wrangler*', 'wrangler *', 'git push *main*', 'git push *--force*', 'git push -f*']) {
    assert.equal(bash[pola], 'deny', `${pola} harus ditolak`);
  }
  // Aturan yang cocok terakhir menang: penolakan harus sesudah izin umum.
  const urutan = Object.keys(bash);
  assert.ok(urutan.indexOf('git push *main*') > urutan.indexOf('git push -u origin mesin/*'));
  assert.equal(bash['*'], 'ask');
});

test('detak: event OpenCode dipetakan ke status Agent Office', () => {
  assert.deepEqual(statusDariEvent({ type: 'session.status', properties: { status: { type: 'busy' } } }), { status: 'WORKING' });
  assert.equal(statusDariEvent({ type: 'session.status', properties: { status: { type: 'retry' } } }).status, 'WORKING');
  assert.deepEqual(statusDariEvent({ type: 'session.idle', properties: {} }), { status: 'IDLE' });
  assert.equal(statusDariEvent({ type: 'session.error', properties: { error: { name: 'APIError' } } }).status, 'ERROR');
  assert.deepEqual(statusDariEvent({ type: 'permission.asked', properties: {} }), { status: 'WAITING_APPROVAL' });
  assert.equal(statusDariEvent({ type: 'message.updated', properties: {} }), null);
});

test('detak: file status ditulis, "sejak" hanya berubah saat status berubah', () => {
  const env = { MESIN_STATUS_FILE: join(mkdtempSync(join(tmpdir(), 'detak-')), 'status.json'), MESIN_NAMA: 'Mesin' };
  tulisStatus({ status: 'WORKING', alat: 'bash' }, { env, now: new Date('2026-10-08T10:00:00Z') });
  tulisStatus({ status: 'WORKING', alat: 'edit' }, { env, now: new Date('2026-10-08T10:05:00Z') });
  let data = JSON.parse(readFileSync(env.MESIN_STATUS_FILE, 'utf8'));
  assert.equal(data.agen, 'Mesin');
  assert.equal(data.sejak, '2026-10-08T10:00:00.000Z');
  assert.equal(data.diperbarui, '2026-10-08T10:05:00.000Z');
  assert.equal(data.alat, 'edit');
  tulisStatus({ status: 'ERROR', catatan: 'limit' }, { env, now: new Date('2026-10-08T10:06:00Z') });
  tulisStatus({ status: 'IDLE' }, { env, now: new Date('2026-10-08T10:07:00Z') });
  data = JSON.parse(readFileSync(env.MESIN_STATUS_FILE, 'utf8'));
  assert.equal(data.sejak, '2026-10-08T10:07:00.000Z');
  assert.equal(data.catatan, undefined, 'catatan error lama tidak menempel di status baru');
});

test('detak: pembaca menyimpulkan STALLED dan UNRESPONSIVE dari umur detak', () => {
  const t = Date.parse('2026-10-08T10:00:00Z');
  const data = status => ({ status, diperbarui: new Date(t).toISOString() });
  assert.equal(statusTampil(data('WORKING'), t + 1000), 'WORKING');
  assert.equal(statusTampil(data('WORKING'), t + BATAS_DIAM_MS + 1), 'STALLED');
  assert.equal(statusTampil(data('IDLE'), t + BATAS_DIAM_MS + 1), 'IDLE');
  assert.equal(statusTampil(data('IDLE'), t + BATAS_HILANG_MS + 1), 'UNRESPONSIVE');
  assert.equal(statusTampil(null), 'TIDAK_ADA_DATA');
});
