import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Halaman /diagnostik dipakai untuk HP kasir yang tidak bisa login (2026-10-01):
// harus tetap berjalan dan melapor jelas walau penyimpanan browser diblokir.

const source = readFileSync(new URL('../public/diagnostik.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/diagnostik.html', import.meta.url), 'utf8');

function loadDiagnostics() {
  const sandbox = { window: {}, document: { getElementById: () => null }, navigator: {}, location: {} };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  return sandbox.LekerDiagnostik;
}

class FakeStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

function fakeDocument() {
  let jar = '';
  return {
    get cookie() { return jar; },
    set cookie(value) { jar = /max-age=0/.test(value) ? '' : value.split(';')[0]; }
  };
}

test('penyimpanan sehat dilaporkan OK untuk localStorage, sessionStorage, dan cookie', () => {
  const rows = loadDiagnostics().checkStorage({ localStorage: new FakeStorage(), sessionStorage: new FakeStorage(), document: fakeDocument() });
  assert.equal(JSON.stringify(rows.map(row => [row.label, row.status])), JSON.stringify([['localStorage', 'OK'], ['sessionStorage', 'OK'], ['cookie', 'OK']]));
});

test('penyimpanan yang diblokir browser dilaporkan GAGAL beserta nama errornya, tanpa membuat diagnosis berhenti', () => {
  const blocked = {
    get localStorage() { const error = new Error('Access is denied for this document.'); error.name = 'SecurityError'; throw error; },
    sessionStorage: new FakeStorage(),
    document: fakeDocument()
  };
  const rows = loadDiagnostics().checkStorage(blocked);
  const local = rows.find(row => row.label === 'localStorage');
  assert.equal(local.status, 'GAGAL');
  assert.match(local.detail, /SecurityError/);
  assert.equal(rows.find(row => row.label === 'sessionStorage').status, 'OK');
});

test('penyimpanan yang menulis tapi tidak bisa dibaca kembali dilaporkan GAGAL', () => {
  const amnesia = { getItem: () => null, setItem() {}, removeItem() {} };
  const rows = loadDiagnostics().checkStorage({ localStorage: amnesia, sessionStorage: new FakeStorage(), document: fakeDocument() });
  assert.equal(rows.find(row => row.label === 'localStorage').status, 'GAGAL');
});

test('keadaan sesi staf hanya menunjukkan ada/kosong dan panjang, tidak pernah nilai tokennya', () => {
  const storage = new FakeStorage();
  storage.setItem('lekerCashierToken', 'RAHASIA-TOKEN-123');
  storage.setItem('lekerStaffBrowserLease', JSON.stringify({ role: 'CASHIER', updatedAt: Date.now() - 12000 }));
  const rows = loadDiagnostics().staffSessionState({ localStorage: storage });
  const token = rows.find(row => row.label === 'lekerCashierToken');
  assert.equal(token.status, 'ADA');
  assert.equal(rows.some(row => `${row.label}${row.detail}`.includes('RAHASIA')), false);
  assert.match(rows.find(row => row.label === 'lease: peran / umur').detail, /^CASHIER \/ \d+ detik lalu$/);
});

test('pemeriksaan skrip menandai file yang dibelokkan jaringan atau tidak terbaca browser', async () => {
  const diag = loadDiagnostics();
  const win = status => ({
    fetch: async () => ({ ok: status.ok ?? true, status: status.code ?? 200, headers: { get: () => status.type }, text: async () => status.body }),
    Function
  });
  assert.equal((await diag.checkScript(win({ type: 'application/javascript', body: 'const a = 1;' }), 'x.js')).status, 'OK');
  const redirected = await diag.checkScript(win({ type: 'text/html', body: '<html>blocked</html>' }), 'x.js');
  assert.equal(redirected.status, 'GAGAL');
  assert.match(redirected.detail, /bukan JavaScript/);
  const broken = await diag.checkScript(win({ type: 'text/javascript', body: 'const = ;' }), 'x.js');
  assert.equal(broken.status, 'GAGAL');
  assert.match(broken.detail, /tidak bisa membaca skrip/);
});

test('daftar skrip yang diperiksa mencakup alur login pelanggan dan kasir, dan semuanya benar-benar ada', () => {
  const { SCRIPTS } = loadDiagnostics();
  for (const name of ['customer-login.js', 'auth-entry-split.js', 'staff-entry-guard.js', 'staff-tab-lock.js', 'cashier.js']) {
    assert.ok(SCRIPTS.includes(name), `${name} harus diperiksa`);
  }
  for (const name of SCRIPTS) readFileSync(new URL(`../public/${name}`, import.meta.url));
  assert.match(html, /<script src="\/diagnostik\.js"><\/script>/);
});
