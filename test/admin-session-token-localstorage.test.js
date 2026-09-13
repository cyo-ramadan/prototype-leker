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
