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

test('the actual login write site (auth-entry-split.js) puts OWNER/ADMIN in localStorage and leaves CASHIER on sessionStorage', () => {
  assert.match(authEntrySplit, /const tokenStore = payload\.role === 'CASHIER' \? sessionStorage : localStorage;/);
  assert.match(authEntrySplit, /tokenStore\.setItem\(staffTokenKey\(payload\.role\), payload\.token\)/);
  assert.match(authEntrySplit, /if \(payload\.role === 'ADMIN'\) localStorage\.setItem\('lekerAdminStoreCode'/);
});

test('single-active-tab lock strips the token from wherever it actually lives, not just sessionStorage', () => {
  assert.match(staffTabLock, /const tokenStore = meta\.role === 'CASHIER' \? sessionStorage : localStorage;/);
  assert.match(staffTabLock, /tokenStore\.removeItem\(tokenKey\)/);
  assert.doesNotMatch(staffTabLock, /sessionStorage\.removeItem\(tokenKey\)/);
});

test('cashier and staff-meta keys are untouched -- scope did not creep', () => {
  assert.match(authEntrySplit, /sessionStorage\.setItem\(`lekerCustomerToken:\$\{storeCode\}`, payload\.token\)/);
  assert.match(authEntrySplit, /sessionStorage\.setItem\('lekerStaffSessionMeta'/);
  assert.match(authEntrySplit, /sessionStorage\.setItem\('lekerStaffHandoffId', handoffId\)/);
  assert.match(staffEntryGuard, /sessionStorage\.getItem\('lekerCashierToken'\)/);
  assert.match(staffTabLock, /sessionStorage\.getItem\('lekerStaffSessionMeta'\)/);
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
  assert.match(staffEntryGuard, /\(isBranchAdmin \|\| isCashierPreview\)\s*\?\s*Boolean\(localStorage\.getItem\('lekerOwnerToken'\)\s*\|\|\s*localStorage\.getItem\('lekerAdminToken'\)\s*\|\|\s*localStorage\.getItem\('lekerEntityAdminToken'\)\)/);
});

// Bug bersaudara di file yang sama-sama menjaga sesi staf: kalau tab-lock
// (single-active-session) ini pernah men-block sesi Entity Admin, ia salah
// hapus 'lekerCashierToken' (token yang bahkan tidak dipakai Entity Admin)
// alih-alih 'lekerEntityAdminToken' -- token asli tidak pernah tercabut,
// tapi user tetap dilempar ke halaman login seolah tidak logout beneran.
test('staff-tab-lock.js resolves ENTITY_ADMIN to its own token key, not the CASHIER fallback', () => {
  assert.match(staffTabLock, /meta\.role === 'ENTITY_ADMIN'\s*\n?\s*\?\s*'lekerEntityAdminToken'/);
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
  assert.match(authEntrySplit, /sessionStorage\.getItem\('lekerCashierToken'\)\) return '\/cashier'/);
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
