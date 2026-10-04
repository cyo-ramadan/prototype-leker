import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assetRoute } from '../src/index.js';

const pub = name => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

// Bos Cyo, 2026-10-03: "bikin halaman login khusus karyawan, jadi semua entity,
// karyawan, tenant dan owner bisa login disitu. halaman login yang sekarang
// dikhususkan untuk customer saja."

test('/login dilayani sebagai halaman sendiri, bukan jatuh ke halaman customer', () => {
  assert.equal(assetRoute('/login'), '/login');
  assert.equal(assetRoute('/customer'), '/customer');
});

test('halaman /login tidak memasang penjaga sesi -- penjaga itulah yang melempar ke sini, jadi memasangnya membuat loop', () => {
  const html = pub('login.html');
  assert.doesNotMatch(html, /staff-entry-guard\.js/);
  assert.doesNotMatch(html, /staff-tab-lock\.js/);
  assert.match(html, /staff-login\.js\?v=/);
  assert.match(html, /id="staffLoginForm"/);
});

test('halaman /login memakai endpoint karyawan dan menerima keempat pangkat', () => {
  const js = pub('staff-login.js');
  assert.match(js, /\/api\/auth\/staff-login/);
  assert.doesNotMatch(js, /customer-login/);
  assert.match(js, /\['OWNER', 'ADMIN', 'ENTITY_ADMIN', 'CASHIER'\]/);
  for (const key of ['lekerOwnerToken', 'lekerEntityAdminToken', 'lekerAdminToken', 'lekerCashierToken']) {
    assert.match(js, new RegExp(key), `${key} harus ditulis/dibaca oleh halaman login karyawan`);
  }
});

test('login customer tidak lagi menampung login karyawan, dan link lama ?login=staff diteruskan ke /login', () => {
  const split = pub('auth-entry-split.js');
  assert.doesNotMatch(split, /staffTokenKey|entryStaffTab|api\/auth\/staff-login/);
  assert.match(split, /location\.replace\(blocked \? '\/login\?staffBlocked=1' : '\/login'\)/);
  assert.match(split, /Karyawan\? Login di sini/);
  assert.match(split, /\/api\/auth\/customer-login/);
});

test('semua titik yang melempar orang ke login karyawan sekarang menuju /login, tidak ada lagi yang ke /?login=staff', () => {
  for (const name of ['cashier-workspace.js', 'owner-central-entry.js', 'staff-entry-guard.js', 'staff-tab-lock.js', 'staff.js']) {
    const source = pub(name);
    assert.doesNotMatch(source, /\/\?login=staff/, `${name} masih melempar ke /?login=staff`);
    assert.match(source, /'\/login(\?staffBlocked=1)?'/, `${name} harus mengarah ke /login`);
  }
});

test('file JS lama yang diedit sudah dibump ?v= di setiap HTML yang memuatnya', () => {
  const V = '20261003-login-karyawan-v1';
  const htmlFiles = ['admin.html', 'branch-admin.html', 'cashier.html', 'customer.html', 'entity-admin.html', 'owner.html', 'staff.html', 'warung.html'];
  const edited = ['staff-entry-guard', 'staff-tab-lock', 'owner-central-entry', 'cashier-workspace', 'auth-entry-split', 'staff'];
  for (const file of htmlFiles) {
    const html = pub(file);
    for (const name of edited) {
      for (const match of html.matchAll(new RegExp(`/${name}\\.js\\?v=([^"']+)`, 'g'))) {
        // Boleh lebih baru dari V (fitur sesudahnya ikut membump), asal tidak mundur.
        assert.ok(match[1] >= V, `${file}: ${name}.js belum dibump ke ${V} (sekarang ${match[1]})`);
      }
    }
  }
});

test('server tetap mengenali keempat pangkat lewat satu endpoint karyawan', () => {
  const api = readFileSync(new URL('../src/unified-login.js', import.meta.url), 'utf8');
  for (const role of ["'OWNER'", "'ADMIN'", "'CASHIER'", "'ENTITY_ADMIN'"]) assert.match(api, new RegExp(role));
  assert.match(api, /pathname === '\/api\/auth\/staff-login'/);
});
