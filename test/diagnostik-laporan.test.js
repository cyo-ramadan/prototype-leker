import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDiagnostikLaporanApi, rapikanHasil } from '../src/diagnostik-laporan.js';

// Laporan /diagnostik dikirim tanpa login; server menambah jaringan dari request.cf (2026-10-19).
function fakeDb(recentCount = 0) {
  const inserted = [];
  return {
    inserted,
    prepare(sql) {
      return {
        bind(...args) { this.args = args; return this; },
        async first() { return /COUNT/.test(sql) ? { n: recentCount } : null; },
        sql,
        get params() { return this.args; }
      };
    },
    async batch(statements) { for (const statement of statements) if (/INSERT/.test(statement.sql)) inserted.push(statement.args); }
  };
}

const request = body => Object.assign(new Request('https://x/api/diagnostik/laporan', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4' }, body: JSON.stringify(body) }), {});

test('laporan disimpan dengan kode, jumlah GAGAL, dan ISP dari request.cf', async () => {
  const db = fakeDb();
  const req = request({ rows: [{ label: 'Versi halaman kasir', status: 'GAGAL', detail: 'lama' }, { label: 'Browser', status: 'INFO', detail: 'Chrome' }], catatan: 'tombol kolam tidak ada' });
  Object.defineProperty(req, 'cf', { value: { asOrganization: 'PT XL Axiata', asn: 24203, colo: 'CGK' } });
  const response = await handleDiagnostikLaporanApi(req, { DB: db }, '/api/diagnostik/laporan');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(body.kode, /^D-[A-Z2-9]{5}$/);
  assert.equal(body.jaringan.isp, 'PT XL Axiata');
  const row = db.inserted[0];
  assert.equal(row[6], 'PT XL Axiata');
  assert.equal(row[12], 1);
  assert.doesNotMatch(row[11], /1\.2\.3\.4/);
});

test('kiriman berlebihan dari satu IP ditolak, rute lain tidak disentuh', async () => {
  const response = await handleDiagnostikLaporanApi(request({ rows: [{ label: 'a', status: 'OK' }] }), { DB: fakeDb(20) }, '/api/diagnostik/laporan');
  assert.equal(response.status, 429);
  assert.equal(await handleDiagnostikLaporanApi(request({}), { DB: fakeDb() }, '/api/lain'), null);
});

test('hasil dirapikan: dibatasi panjang dan baris tanpa label dibuang', () => {
  const rows = rapikanHasil([{ label: 'x'.repeat(500), status: 'OK', detail: 'd' }, { status: 'GAGAL' }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label.length, 120);
});
