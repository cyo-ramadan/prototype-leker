import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

// 2026-09-13: Admin/Owner/Entity Admin kept sessionStorage for their bearer
// token, which is tied to the tab's browsing context. On mobile, backgrounding
// the browser long enough lets the OS/Chrome discard that context -- the tab
// itself is never closed, but sessionStorage comes back empty on return, and
// branch-owner-auth.js (public/branch-owner-auth.js:14-17) treated that as
// "never logged in" and bounced straight to the customer page. The server
// session itself was still valid (OWNER_SESSION_HOURS / STORE_ADMIN_SESSION_HOURS
// = 12h, src/owner-auth.js) -- only the client's copy of the token was lost
// prematurely. Moving these keys to localStorage stops the client from
// discarding a still-valid session; it does not change how long the server
// honors it.

const branchOwnerAuth = read('branch-owner-auth.js');
const bootstrapGuard = read('admin-session-bootstrap-guard.js');
const owner = read('owner.js');
const entityAdmin = read('entity-admin.js');
const entityAdminHtml = read('entity-admin.html');
const ownerCentralEntry = read('owner-central-entry.js');
const staffEntryGuard = read('staff-entry-guard.js');
const authEntrySplit = read('auth-entry-split.js');
const adminMultistore = read('admin-multistore.js');
const storeContext = read('store-context.js');
const managementApprovalQueue = read('management-approval-queue.js');
const managementCustomerFeedback = read('management-customer-feedback.js');
const managementVoidPermits = read('management-transaction-void-permits.js');
const staffTabLock = read('staff-tab-lock.js');
const adminJs = read('admin.js');
const ownerAuthSrc = readFileSync(new URL('../src/owner-auth.js', import.meta.url), 'utf8');

test('Owner/Admin/Entity Admin bearer token and store-code marker live in localStorage, not sessionStorage', () => {
  const localStorageOnly = [
    [branchOwnerAuth, 'branch-owner-auth.js'],
    [bootstrapGuard, 'admin-session-bootstrap-guard.js'],
    [owner, 'owner.js'],
    [entityAdmin, 'entity-admin.js'],
    [entityAdminHtml, 'entity-admin.html'],
    [ownerCentralEntry, 'owner-central-entry.js'],
    [staffEntryGuard, 'staff-entry-guard.js'],
    [adminMultistore, 'admin-multistore.js'],
    [storeContext, 'store-context.js'],
    [managementApprovalQueue, 'management-approval-queue.js'],
    [managementCustomerFeedback, 'management-customer-feedback.js'],
    [managementVoidPermits, 'management-transaction-void-permits.js'],
    [adminJs, 'admin.js']
  ];
  for (const [source, name] of localStorageOnly) {
    for (const key of ['lekerAdminToken', 'lekerOwnerToken', 'lekerEntityAdminToken', 'lekerAdminPin', 'lekerAdminStoreCode']) {
      const re = new RegExp(`sessionStorage\\.(get|set|remove)Item\\([\`'"]${key}[\`'"]`);
      assert.doesNotMatch(source, re, `${name} must not read/write/remove ${key} via sessionStorage`);
    }
  }
  assert.match(branchOwnerAuth, /localStorage\.getItem\('lekerOwnerToken'\)/);
  assert.match(branchOwnerAuth, /localStorage\.getItem\('lekerAdminToken'\)/);
  assert.match(branchOwnerAuth, /localStorage\.getItem\('lekerEntityAdminToken'\)/);
  assert.match(branchOwnerAuth, /localStorage\.getItem\('lekerAdminStoreCode'\)/);
  assert.match(owner, /localStorage\.setItem\('lekerOwnerToken', payload\.token\)/);
  assert.match(entityAdmin, /localStorage\.setItem\('lekerEntityAdminToken', payload\.token\)/);
});

// KOREKSI 2026-09-18: pengecualian CASHIER dicabut. Alasan lamanya ("terikat
// lifecycle laci") dicek langsung dan terbukti tidak berdasar -- tidak ada satu
// pun kode yang menutup laci saat tab ditutup, jadi sessionStorage tidak
// menjaga apa pun soal laci; lacinya tetap terbuka di server sementara
// kasirnya dipaksa login ulang. Bos Cyo: "tab ketutup, terus buka lagi harus
// login lagi ... user udah mulai risih."
test('the actual login write site (auth-entry-split.js) puts EVERY staff role -- cashier included -- in localStorage', () => {
  assert.match(authEntrySplit, /localStorage\.setItem\(staffTokenKey\(payload\.role\), payload\.token\)/);
  assert.doesNotMatch(authEntrySplit, /payload\.role === 'CASHIER' \? sessionStorage/, 'kasir tidak boleh dikecualikan ke sessionStorage lagi');
  assert.match(authEntrySplit, /if \(payload\.role === 'ADMIN'\) localStorage\.setItem\('lekerAdminStoreCode'/);
});

// KOREKSI 2026-09-18: guard ini berubah dari "satu TAB" jadi "satu USER"
// (Bos Cyo: "meskipun dia buka program pos ini 2 tab ga masalah, yang penting
// di 2 tab itu ga pindah user"). Konsekuensinya menghapus token saat memblokir
// jadi SALAH: tab yang diblokir sekarang justru tab yang usernya sudah bukan
// pemegang browser ini, jadi token di localStorage sudah milik user yang baru
// -- menghapusnya berarti menendang keluar orang yang sedang sah memakai
// aplikasi.
test('the per-user guard blocks by redirecting only -- it must never strip a token that now belongs to the incoming user', () => {
  assert.doesNotMatch(staffTabLock, /removeItem\(tokenKey\)/, 'block() tidak boleh menghapus token siapa pun');
  assert.match(staffTabLock, /function block\(\)[\s\S]*?location\.replace\('\/\?login=staff&staffBlocked=1'\)/);
  assert.match(staffTabLock, /function leaseIsOtherUser\(lease\)/, 'keputusan blokir wajib berdasar identitas user, bukan kepemilikan tab');
  assert.match(staffTabLock, /lease\.staffId !== meta\.id \|\| lease\.role !== meta\.role/);
});

// Dua tab dengan karyawan yang SAMA harus hidup berdampingan -- itu inti
// permintaan Bos Cyo. Lease yang belum membawa staffId (sisa versi lama yang
// masih nyangkut di browser user) sengaja diperlakukan sebagai "user sama",
// supaya perubahan ini tidak menendang keluar orang yang sedang login saat
// versi baru pertama kali dimuat.
test('a second tab with the SAME staff member is allowed through, and a legacy lease without staffId never blocks', () => {
  assert.match(staffTabLock, /if \(!lease\?\.staffId\) return false;/);
});

// KOREKSI 2026-09-18: scope-nya sekarang MEMANG diperluas, dengan sengaja.
// Yang tetap di sessionStorage cuma dua, dan dua-duanya ada alasannya:
// - token CUSTOMER: sesi belanja per tab, bukan sesi karyawan.
// - lekerStaffHandoffId: penanda "halaman berikutnya adalah diri saya
//   sendiri", yang memang harus per-tab -- kalau dibagi antar tab, artinya
//   justru hilang.
test('only the customer token and the per-tab handoff marker stay in sessionStorage -- staff token and identity do not', () => {
  assert.match(authEntrySplit, /sessionStorage\.setItem\(`lekerCustomerToken:\$\{storeCode\}`, payload\.token\)/);
  assert.match(authEntrySplit, /sessionStorage\.setItem\('lekerStaffHandoffId', handoffId\)/);
  assert.match(authEntrySplit, /localStorage\.setItem\('lekerStaffSessionMeta'/);
  assert.match(staffEntryGuard, /localStorage\.getItem\('lekerCashierToken'\)/);
  assert.match(staffTabLock, /localStorage\.getItem\('lekerStaffSessionMeta'\)/);
  for (const [source, name] of [[authEntrySplit, 'auth-entry-split.js'], [staffEntryGuard, 'staff-entry-guard.js'], [staffTabLock, 'staff-tab-lock.js']]) {
    for (const key of ['lekerCashierToken', 'lekerStaffSessionMeta']) {
      const re = new RegExp(`sessionStorage\\.(get|set|remove)Item\\(['"]${key}['"]`);
      assert.doesNotMatch(source, re, `${name} must not touch ${key} via sessionStorage anymore`);
    }
  }
});

test('server-side session lifetime for Owner/Store Admin stays 12 hours -- this fix only stops the client from discarding it early', () => {
  assert.match(ownerAuthSrc, /OWNER_SESSION_HOURS = 12/);
  assert.match(ownerAuthSrc, /STORE_ADMIN_SESSION_HOURS = 12/);
});

// 2026-09-17, bug Bos Cyo: klik "Buka Workspace" gerai dari panel Entity
// Admin (entity-admin.js -> /s/<code>/admin) malah dilempar ke halaman
// customer dengan menu login, walau sesi Entity Admin-nya masih valid.
// Root cause: staff-entry-guard.js sudah lebih dulu mengenali OWNER/ADMIN
// buat masuk /s/:code/admin, tapi lupa ENTITY_ADMIN -- padahal Entity Admin
// sudah lama berwenang buka workspace gerai manapun di entity-nya sendiri
// (requireManagement -> entityAdminStoreAuthorized, src/owner-auth.js).
test('staff-entry-guard.js lets an Entity Admin session (not just Owner/Admin) reach /s/:code/admin', () => {
  assert.match(staffEntryGuard, /isBranchAdmin\s*\?\s*Boolean\(localStorage\.getItem\('lekerOwnerToken'\)\s*\|\|\s*localStorage\.getItem\('lekerAdminToken'\)\s*\|\|\s*localStorage\.getItem\('lekerEntityAdminToken'\)\)/);
});

// Bug bersaudara di file yang sama-sama menjaga sesi staf: kalau tab-lock
// (single-active-session) ini pernah men-block sesi Entity Admin, ia salah
// hapus 'lekerCashierToken' (token yang bahkan tidak dipakai Entity Admin)
// alih-alih 'lekerEntityAdminToken' -- token asli tidak pernah tercabut,
// tapi user tetap dilempar ke halaman login seolah tidak logout beneran.
// Bug aslinya (guard menghapus token kasir padahal yang login Entity Admin)
// sekarang mustahil terulang dengan cara yang jauh lebih kuat daripada
// memetakan role ke nama key: guard sudah tidak menghapus token APA PUN.
test('staff-tab-lock.js no longer maps roles to token keys at all -- the whole class of "cleared the wrong token" bugs is gone', () => {
  assert.doesNotMatch(staffTabLock, /tokenKey/, 'tidak boleh ada lagi pemetaan role -> nama key token');
  assert.doesNotMatch(staffTabLock, /meta\.role === 'ENTITY_ADMIN'/, 'tidak ada lagi cabang per-role untuk memilih token yang dihapus');
  // Helper logout di file yang sama MEMANG menyebut semua nama key -- itu beda
  // urusan (membersihkan seluruh jejak saat user menekan Logout), bukan guard
  // yang menebak-nebak token siapa yang harus dicabut saat memblokir.
  assert.match(staffTabLock, /window\.lekerClearStaffSession/);
});

// Logout harus membersihkan SELURUH jejak sesi, termasuk lease -- kalau
// lease-nya tertinggal, karyawan BERIKUTNYA yang login di perangkat yang sama
// ditolak sebagai "user lain masih aktif" sampai lease-nya kedaluwarsa sendiri.
// Helper-nya diekspos sebelum guard supaya tetap ada walau halaman dibuka
// tanpa sesi.
test('a single helper clears every staff session trace (token, identity, lease) and every logout button uses it', () => {
  assert.match(staffTabLock, /window\.lekerClearStaffSession = \(\) =>/);
  assert.match(staffTabLock, /lekerStaffSessionMeta['"], leaseKey\]/);
  for (const [source, name] of [
    [read('cashier.js'), 'cashier.js'],
    [read('staff.js'), 'staff.js'],
    [read('owner.js'), 'owner.js'],
    [read('owner-central-entry.js'), 'owner-central-entry.js'],
    [read('entity-admin.js'), 'entity-admin.js'],
    [read('branch-owner-auth.js'), 'branch-owner-auth.js']
  ]) {
    assert.match(source, /window\.lekerClearStaffSession\?\.\(\)/, `${name} must clear the whole staff session on logout, not just its own token`);
  }
});

// Bos Cyo, 2026-09-17: "jangan sampe orang yang uda berhasil login, dia ga
// sengaja ke back back malah ada menu loginnya lagi". Sebelum ini, kembali
// ke halaman /?login=staff (mis. tombol Back browser setelah redirect
// submitLogin()) SELALU menampilkan form login lagi, tidak pernah dicek
// dulu apakah token yang valid masih ada di localStorage/sessionStorage.
test('/?login=staff auto-redirects an already-authenticated staff session to its workspace instead of re-showing the login form', () => {
  assert.match(authEntrySplit, /function existingStaffWorkspaceRedirect\(\)/);
  assert.match(authEntrySplit, /localStorage\.getItem\('lekerOwnerToken'\)\) return '\/admin'/);
  assert.match(authEntrySplit, /localStorage\.getItem\('lekerEntityAdminToken'\)\) return '\/entity-admin'/);
  assert.match(authEntrySplit, /localStorage\.getItem\('lekerCashierToken'\)\) return '\/cashier'/);
  assert.match(authEntrySplit, /location\.replace\(existingRedirect\)/);
  // staffBlocked=1 means the tab-lock deliberately just cleared this
  // session's token -- the redirect must not fire off a stale read in that
  // exact moment and must still fall through to the login form.
  assert.match(authEntrySplit, /staffBlocked.*=== '1'/);
});

// Bos Cyo, 2026-09-17: Entity Admin landed on the bare /branch-admin entry
// point (screenshot: address bar showed "/branch-admin", no /s/:code/
// prefix, header showed "WORKSPACE GERAI - G001") and got a confusing
// "Entity Admin ... hanya berwenang pada gerai di bawah entity ..." failure.
// Root cause: without a store code in the URL, store-context.js has no
// Entity-Admin-aware fallback (only Store Admin's fixed lekerAdminStoreCode
// is remembered) and silently defaults to G001 -- almost never under the
// Entity Admin's own entity, so the workspace bootstrap always fails.
test('Entity Admin landing on branch-admin without an explicit /s/:code/ prefix is sent back to its own picker, not left to guess a wrong store', () => {
  assert.match(branchOwnerAuth, /isEntityAdmin && !\/\^\\\/s\\\/\/\.test\(location\.pathname\)/);
  assert.match(branchOwnerAuth, /location\.replace\('\/entity-admin'\)/);
});

// Bos Cyo, 2026-09-17: "ini kalo kembali ke hal entity harus relogin lagi
// ya?" -- yes, it was a bug. The button labeled "Kembali ke Entity Admin"
// (pure navigation, same intent as the Owner button right above it in the
// same function) was secretly performing a full logout first (server-side
// session revoke + token removal) before navigating, forcing a fresh login
// every single time an Entity Admin left a store workspace.
test('leaving a store workspace as Entity Admin just navigates back, like Owner does -- it does not log out or clear the token', () => {
  assert.doesNotMatch(branchOwnerAuth, /entity-admin\/logout/, 'leaveWorkspace must not call the entity-admin logout endpoint anymore');
  assert.doesNotMatch(branchOwnerAuth, /isEntityAdmin\)\s*\{\s*\n\s*localStorage\.removeItem\('lekerEntityAdminToken'\)/, 'must not remove the entity admin token when merely navigating back');
  assert.match(branchOwnerAuth, /if \(isEntityAdmin\) \{\s*\n\s*location\.href = '\/entity-admin';\s*\n\s*return;\s*\n\s*\}/, 'entity admin branch must mirror the Owner branch: navigate only, no logout');
});

// The eyebrow/button on the shared #authGate card in branch-admin.html
// always said "Owner session" / "Kembali ke Owner" regardless of which role
// (Owner, Entity Admin, or Admin Gerai) actually hit the failure -- pure
// static markup, never overwritten by any script. Misleading during
// diagnosis (looked like the server thought Bos Cyo was Owner) and just
// wrong for the other two roles.
test('the shared authGate card in branch-admin.html no longer hardcodes an Owner-only label', () => {
  const html = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /Owner session/);
  assert.doesNotMatch(html, />Kembali ke Owner</);
});
