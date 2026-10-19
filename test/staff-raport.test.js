import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
const raport = readFileSync(new URL('../src/staff-raport.js', import.meta.url), 'utf8');
const portal = readFileSync(new URL('../src/staff-portal.js', import.meta.url), 'utf8');
const staffUi = readFileSync(new URL('../public/staff.js', import.meta.url), 'utf8');
const staffHtml = readFileSync(new URL('../public/staff.html', import.meta.url), 'utf8');
const adminUi = readFileSync(new URL('../public/admin-cashier-raport.js', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');

test('one Raport fact model feeds staff and admin', () => {
  assert.match(raport, /MAXI_STAFF_RAPORT_FACTS_V1/);
  assert.match(raport, /getCashierRaportFacts/);
  assert.match(portal, /getCashierRaportFacts/);
  assert.match(adminUi, /cashier-raport/);
});

test('Raport exposes operational facts but does not invent a score', () => {
  assert.match(raport, /transactionVoidPermits/);
  assert.match(raport, /approval_permits/);
  assert.match(raport, /score: null/);
  assert.match(raport, /grade: null/);
  assert.match(raport, /NEEDS_KPI_POLICY/);
  assert.match(raport, /UNCONFIGURED/);
});

test('staff and branch admin both render Raport surfaces', () => {
  assert.match(staffHtml, /Raport \/ KPI/);
  assert.match(staffUi, /renderKpi/);
  assert.match(adminUi, /Raport Kasir/);
  assert.match(adminHtml, /admin-cashier-raport\.js/);
});

// 2026-09-15, bug ketemu Bos Cyo (tanya "dimana lihat riwayat presensi"):
// admin-cashier-raport.js membaca f.attendance?.checkIn / ?.checkOut,
// padahal getCashierRaportFacts() di src/staff-raport.js cuma pernah
// mengembalikan attendance:{total,closed,open} -- checkIn/checkOut tidak
// pernah ada di objek itu, jadi kartu Presensi di Admin selalu menampilkan
// "0 masuk · 0 keluar" berapa pun banyaknya presensi sungguhan.
test('admin cashier raport card reads the real attendance field shape (total/closed/open), not nonexistent checkIn/checkOut', () => {
  assert.doesNotMatch(raport, /attendance:\s*\{[^}]*checkIn/);
  assert.doesNotMatch(adminUi, /attendance\?\.checkIn|attendance\?\.checkOut/);
  assert.match(adminUi, /f\.attendance\?\.closed/);
  assert.match(adminUi, /f\.attendance\?\.open/);
});


test('pengumuman mendukung teks tebal tanpa menerima HTML mentah', () => {
  const source = staffUi.match(/function formatAnnouncementBody\(value\) \{[\s\S]*?\n  \}/)[0];
  const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const format = new Function('escapeHtml', 'return ' + source)(escapeHtml);
  assert.equal(format('**WAJIB klaim**'), '<strong>WAJIB klaim</strong>');
  assert.equal(format('**<script>alert(1)</script>**'), '<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong>');
  assert.equal(format('**Baris 1\nBaris 2**'), '<strong>Baris 1\nBaris 2</strong>');
});


test('angka merah Portal Staf menjumlah pengumuman dan inbox; berkurang sesudah dibaca', async () => {
  const events = {}, focus = {};
  let unread = 2, html = '';
  const link = { querySelector: () => ({ remove() { html = ''; } }), insertAdjacentHTML: (_, value) => { html = value; } };
  runInNewContext(readFileSync(new URL('../public/pengumuman-badge.js', import.meta.url), 'utf8'), {
    document: { getElementById: () => link, addEventListener: (name, fn) => { events[name] = fn; }, hidden: false },
    window: { addEventListener: (name, fn) => { focus[name] = fn; } },
    localStorage: { getItem: () => 'cashier-test' },
    fetch: async () => ({ ok: true, json: async () => ({ unread }) })
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(html, />2<\/span>/);
  events['maxi-notifications-changed']({ detail: { actor: { role: 'CASHIER' }, unreadCount: 5 } });
  assert.match(html, />7<\/span>/);
  events['maxi-notifications-changed']({ detail: { actor: { role: 'CASHIER' }, unreadCount: 0 } });
  assert.match(html, />2<\/span>/);
  unread = 0; await focus.focus();
  assert.equal(html, '');
});
