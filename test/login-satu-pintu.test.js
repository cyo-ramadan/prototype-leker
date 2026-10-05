import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Bos Cyo, 2026-10-05: "habis klik login masih nyangkut ke login entity kadang juga engga.
// trrus kalo terlanjur masuk ke entity engga bisa login karyawan lain ... dibikin bener dulu
// layaknya login facebook. dan kalo di back sampe mau keluar kasih dulu tulisan apakah anda mau
// keluar ... tombolnya engga bisa dibuat buka new tab ... pertahankan walaupun ber-tab-tab tetap
// login di satu id sebelum adanya logout."

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function storage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    dump: () => Object.fromEntries(map)
  };
}

function fakeElement(id) {
  const listeners = {};
  return {
    id, hidden: false, textContent: '', value: '', type: 'password', disabled: false, href: '', dataset: {},
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener(type, fn) { listeners[type] = fn; },
    focus() {},
    fire: (type, event = {}) => listeners[type]?.({ preventDefault() {}, ...event })
  };
}

function runLoginPage({ local = {}, url = 'https://x.test/login', fetchImpl } = {}) {
  const elements = {};
  const el = id => (elements[id] ||= fakeElement(id));
  const localStorage = storage(local);
  const sessionStorage = storage();
  const replaced = [];
  const fetches = [];
  const context = {
    document: { getElementById: el },
    localStorage, sessionStorage,
    location: { href: url, replace: target => replaced.push(target) },
    fetch: async (path, init) => { fetches.push({ path, init }); return fetchImpl ? fetchImpl(path, init) : { ok: true, json: async () => ({}) }; },
    setTimeout: (fn) => { fn(); return 0; },
    console, URL, JSON, Promise, Date, Math, crypto: globalThis.crypto
  };
  runInNewContext(read('public/staff-login.js'), context);
  return { el, elements, localStorage, replaced, fetches };
}

test('login: sesi tersimpan -> kartu "Masuk sebagai" dengan tautan Lanjutkan ke workspace peran itu, bukan lemparan otomatis', () => {
  const page = runLoginPage({ local: {
    lekerCashierToken: 'tok-kasir',
    lekerStaffSessionMeta: JSON.stringify({ id: 'k1', role: 'CASHIER', name: 'Siti', storeCode: 'PENDEM' }),
    // Token Entity basi yang dulu membuat orang tersangkut di form "Login Entity Admin".
    lekerEntityAdminToken: 'tok-entity-basi'
  } });
  assert.deepEqual(page.replaced, [], 'tidak lagi melempar diam-diam');
  assert.equal(page.el('loginCard').dataset.state, 'continue');
  assert.equal(page.el('accountName').textContent, 'Siti');
  assert.equal(page.el('accountRole').textContent, 'Kasir · PENDEM');
  assert.equal(page.el('continueLink').href, '/cashier', 'peran mengikuti identitas sesi, bukan token tertinggal');
  assert.equal(page.el('staffLoginForm').hidden, true);
});

test('login: tanpa sesi -> form; Admin Gerai tanpa kode gerai tidak ditawarkan lanjutkan', () => {
  assert.equal(runLoginPage().el('loginCard').dataset.state, 'form');
  const admin = runLoginPage({ local: { lekerAdminToken: 'tok' } });
  assert.equal(admin.el('loginCard').dataset.state, 'form');
});

test('login: "Masuk dengan akun lain" mengeluarkan semua sesi karyawan (server + browser) lalu menampilkan form', async () => {
  const page = runLoginPage({ local: {
    lekerOwnerToken: 'o', lekerEntityAdminToken: 'e',
    lekerStaffSessionMeta: JSON.stringify({ id: 'x', role: 'OWNER', name: 'Bos' })
  } });
  assert.equal(page.el('loginCard').dataset.state, 'continue');
  await page.el('switchAccountBtn').fire('click');
  assert.deepEqual(page.fetches.map(f => f.path).sort(), ['/api/entity-admin/logout', '/api/owner/logout']);
  assert.deepEqual(page.localStorage.dump(), {});
  assert.equal(page.el('loginCard').dataset.state, 'form');
});

test('login sukses: token peran lain dibuang dulu, token + identitas baru ditulis, halaman diganti (bukan ditambah) ke workspace', async () => {
  const page = runLoginPage({
    local: { lekerEntityAdminToken: 'basi', lekerAdminToken: 'basi2', lekerAdminStoreCode: 'G001' },
    fetchImpl: async () => ({ ok: true, json: async () => ({ role: 'CASHIER', token: 'baru', redirect: '/cashier', cashier: { id: 'c9', employeeName: 'Rina', store: { code: 'BEJI' } } }) })
  });
  // Ada token Admin tanpa meta -> kartu lanjutkan muncul; pilih akun lain tanpa logout untuk menguji form langsung.
  page.el('staffUsername').value = 'rina';
  page.el('staffPassword').value = 'rahasia';
  page.el('staffLoginForm').fire('submit');
  await new Promise(resolve => setImmediate(resolve));
  const store = page.localStorage.dump();
  assert.equal(store.lekerCashierToken, 'baru');
  assert.equal(store.lekerEntityAdminToken, undefined);
  assert.equal(store.lekerAdminToken, undefined);
  assert.equal(store.lekerAdminStoreCode, undefined);
  assert.equal(JSON.parse(store.lekerStaffSessionMeta).role, 'CASHIER');
  assert.deepEqual(page.replaced, ['/cashier']);
});

function runBackGuard({ referrer = '', state = null, redirecting = false } = {}) {
  const calls = [];
  const listeners = {};
  const appended = [];
  const history = {
    state,
    replaceState(next) { calls.push(['replace', next]); this.state = next; },
    pushState(next) { calls.push(['push', next]); this.state = next; },
    back() { calls.push(['back']); }
  };
  const node = () => ({ style: {}, setAttribute() {}, set innerHTML(v) { this.html = v; }, querySelector: () => ({ addEventListener(type, fn) { this.fn = fn; }, focus() {} }), remove() {} });
  const window = { addEventListener: (type, fn) => { listeners[type] = fn; }, removeEventListener() {}, lekerRedirecting: redirecting };
  runInNewContext(read('public/staff-back-guard.js'), {
    window, history, URL,
    location: { origin: 'https://x.test' },
    document: { referrer, createElement: node, body: { appendChild: n => appended.push(n) } }
  });
  return { calls, listeners, appended, window };
}

test('Back: halaman kerja pertama di tab memasang penahan; Back ke titik dasar menampilkan "Keluar dari aplikasi?"', () => {
  const guard = runBackGuard({ referrer: 'https://x.test/login' });
  assert.deepEqual(guard.calls.map(c => c[0]), ['replace', 'push']);
  assert.equal(guard.calls[0][1].lekerExitBase, true);
  guard.listeners.popstate({ state: { lekerExitBase: true } });
  assert.equal(guard.appended.length, 1, 'dialog konfirmasi muncul');
  assert.match(guard.appended[0].html, /Keluar dari aplikasi\?/);
  assert.match(guard.appended[0].html, /Tetap di sini/);
});

test('Back: datang dari halaman kerja lain (Owner -> Gerai) atau sedang dialihkan ke login -> riwayat tidak disentuh', () => {
  assert.deepEqual(runBackGuard({ referrer: 'https://x.test/owner' }).calls, []);
  assert.deepEqual(runBackGuard({ referrer: 'https://x.test/s/PENDEM/admin' }).calls, []);
  assert.deepEqual(runBackGuard({ redirecting: true }).calls, []);
  assert.deepEqual(runBackGuard({ referrer: 'https://x.test/customer' }).calls.map(c => c[0]), ['replace', 'push'], 'dari halaman pelanggan tetap dijaga');
  assert.deepEqual(runBackGuard({ state: { lekerExitGuard: true } }).calls, [], 'muat ulang tidak menumpuk penahan');
});

test('satu pintu login: Entity, Kasir, dan Admin Gerai tanpa sesi tidak lagi punya form sendiri / ke halaman pelanggan', () => {
  const entity = read('public/entity-admin.js');
  assert.match(entity, /function showEntityAdminLogin\(\) \{[\s\S]*?location\.replace\('\/login'\);\s*\}/);
  const cashier = read('public/cashier.js');
  assert.match(cashier, /function showLogin\(\) \{[\s\S]*?location\.replace\('\/login'\);\s*\}/);
  const branch = read('public/branch-owner-auth.js');
  assert.doesNotMatch(branch, /\/customer`/, 'Admin Gerai tanpa/habis sesi tidak dilempar ke halaman pelanggan');
  assert.match(branch, /if \(!token\) \{\s*location\.replace\('\/login'\);/);
  const guard = read('public/staff-entry-guard.js');
  assert.match(guard, /isEntityAdmin\s*\?\s*Boolean\(localStorage\.getItem\('lekerEntityAdminToken'\)\)/, '/entity-admin tanpa sesi -> /login');
});

test('halaman login: kartu tinggi tetap, tanpa CSS halaman admin (penyebab tampilan bergeser), skrip baru dimuat', () => {
  const html = read('public/login.html');
  assert.match(html, /id="loginCard" data-state="loading"/);
  assert.match(html, /\/login\.css\?v=20261005-login-fb-v2/);
  assert.match(html, /\/staff-login\.js\?v=20261005-login-fb-v1/);
  assert.doesNotMatch(html, /admin\.css|styles\.css/);
  assert.match(read('public/login.css'), /\.login-card \{[\s\S]*?min-height: 430px;/);
  assert.match(html, /<input id="staffPassword"[^>]*type="password"/);
  assert.match(html, /<input id="staffUsername"[^>]*autocomplete="username"/);
});

test('penjaga Back + tautan tab terpasang di halaman kerja, dan file barunya masuk script check', () => {
  for (const page of ['owner', 'admin', 'entity-admin', 'branch-admin', 'cashier', 'staff', 'warung']) {
    assert.match(read(`public/${page}.html`), /<script src="\/staff-back-guard\.js\?v=20261005-login-satu-pintu-v1"><\/script>/, `${page}.html`);
  }
  for (const page of ['entity-admin', 'branch-admin']) {
    assert.match(read(`public/${page}.html`), /<script src="\/tab-tautan\.js\?v=20261005-login-satu-pintu-v1"><\/script>/, `${page}.html`);
  }
  const pkg = read('package.json');
  for (const file of ['public/staff-back-guard.js', 'public/tab-tautan.js']) assert.ok(pkg.includes(`node --check ${file}`), file);
  const tabs = read('public/tab-tautan.js');
  assert.match(tabs, /event\.ctrlKey \|\| event\.metaKey \|\| event\.shiftKey/);
  assert.match(tabs, /window\.open\(urlFor\(name\), '_blank', 'noopener'\)/);
  assert.match(tabs, /history\.replaceState\(history\.state, '', urlFor\(name\)\)/, 'pindah tab tidak menumpuk riwayat Back dan tidak merusak penahan Back');
});
