import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { KATALOG, cariApi, bangunAlamat, daftarApiUntukModel, ID_API } from '../src/caca-baca-katalog.js';
import { PINTU_AKSI, bangunJalurAksi } from '../src/caca-chat.js';

const sumber = readdirSync(new URL('../src/', import.meta.url))
  .filter((f) => f.endsWith('.js') && !f.startsWith('caca-'))
  .map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'))
  .join('\n');

test('setiap path katalog benar-benar ada di kode (tidak menunjuk jalur yang sudah dihapus)', () => {
  for (const api of KATALOG) {
    const pola = api.path.replace(':id', '(\\d+)').replace(/\//g, '\\/');
    const tulisan = api.path.includes(':id')
      ? sumber.includes('/api/admin/stock') && /stock\\\/\(\\d\+\)\\\/movements/.test(sumber)
      : sumber.includes(`'${api.path}'`);
    assert.ok(tulisan, `${api.id}: ${api.path} tidak ditemukan di src/ (pola ${pola})`);
  }
});

test('id unik, hanya GET, dan lingkupnya dikenal', () => {
  assert.equal(new Set(ID_API).size, ID_API.length);
  for (const api of KATALOG) {
    assert.ok(['gerai', 'entity'].includes(api.lingkup), api.id);
    assert.ok(api.path.startsWith('/api/admin/') || api.path.startsWith('/api/entity'), api.id);
  }
});

// Pitfall KNOWN_PITFALLS: parameter daftar gerai di query string tidak ikut terkunci.
test('tidak ada API yang mengizinkan parameter gerai, entity, atau identitas peminta', () => {
  const terlarang = /^(store|stores|storeId|store_id|storeCode|entity|entityId|entity_id|requester|which|token|pin|password)$/i;
  for (const api of KATALOG) {
    for (const nama of Object.keys(api.param)) assert.equal(terlarang.test(nama), false, `${api.id}.${nama}`);
  }
});

test('bangunAlamat: hanya parameter yang diizinkan, nilai divalidasi, gerai tak bisa diselundupkan', () => {
  const laba = cariApi('laba');
  const ok = bangunAlamat(laba, [
    { kunci: 'from', nilai: '2026-10-01' }, { kunci: 'to', nilai: '2026-10-02' },
    { kunci: 'store', nilai: 'DERMO' }, { kunci: 'stores', nilai: 'A,B' }, { kunci: 'x', nilai: 'y' }
  ]);
  assert.equal(ok.alamat, '/api/admin/reports/net-profit?from=2026-10-01&to=2026-10-02');

  assert.match(bangunAlamat(laba, [{ kunci: 'from', nilai: '1 Oktober' }]).error, /YYYY-MM-DD/);
  assert.match(bangunAlamat(cariApi('transaksi'), [{ kunci: 'limit', nilai: '10; DROP' }]).error, /angka/);
  assert.equal(bangunAlamat(laba, null).alamat, '/api/admin/reports/net-profit');
});

test('bangunAlamat: path ber-id dan parameter wajib', () => {
  const mutasi = cariApi('stok_mutasi');
  assert.match(bangunAlamat(mutasi, []).error, /butuh parameter id/);
  assert.equal(bangunAlamat(mutasi, [{ kunci: 'id', nilai: '42' }, { kunci: 'limit', nilai: '20' }]).alamat, '/api/admin/stock/42/movements?limit=20');
  assert.match(bangunAlamat(mutasi, [{ kunci: 'id', nilai: '../../x' }]).error, /angka/);
  assert.match(bangunAlamat(cariApi('buku_besar'), []).error, /butuh parameter accountId/);
});

test('daftar untuk model memuat tiap API satu baris, menandai yang berat dan tingkat entity', () => {
  const teks = daftarApiUntukModel();
  assert.equal(teks.split('\n').length, KATALOG.length);
  assert.match(teks, /- transaksi \[berat\]/);
  assert.match(teks, /- jurnal_entity \[entity\]/);
});

test('pintu: katalog membuka halaman bacanya saja, bukan sub-path tulis di bawahnya', async () => {
  const dipanggil = [];
  const request = new Request('https://leker.test/api/caca/tanya', { method: 'POST', headers: { authorization: 'Bearer x' }, body: '{}' });
  const jalur = bangunJalurAksi(request, {}, { jalurUtama: async (r) => { dipanggil.push(new URL(r.url).pathname); return new Response('{}'); } });

  for (const api of KATALOG) {
    const path = api.path.replace(':id', '12');
    assert.equal((await jalur.baca(path)).ok, true, path);
  }
  for (const liar of ['/api/admin/settings/accounting/journal-rules', '/api/admin/accounting/standardize-accounts', '/api/admin/stock/abc/movements', '/api/admin/stock/12/movements/x', '/api/cashier/sales', '/api/admin/bootstrap']) {
    assert.equal((await jalur.baca(liar)).ok, false, liar);
  }
  assert.equal(dipanggil.length, KATALOG.length);
  assert.ok(PINTU_AKSI.length > KATALOG.length - 5);
});

test('jalur yang meledak jadi kegagalan baca, tidak menjatuhkan percakapan', async () => {
  const request = new Request('https://leker.test/x', { method: 'POST', headers: {}, body: '{}' });
  const jalur = bangunJalurAksi(request, {}, { jalurUtama: async () => { throw new Error('Too many API requests by single worker invocation.'); } });
  const hasil = await jalur.baca('/api/admin/stock');
  assert.equal(hasil.ok, false);
  assert.match(hasil.error, /Too many API requests/);
});
