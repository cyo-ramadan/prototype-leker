import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

test('Ikan desktop layout expands without changing the existing phone breakpoint', () => {
  assert.match(html, /@media\s*\(min-width:421px\)/);
  assert.match(html, /width:min\(1180px,calc\(100vw - 48px\)\)/);
  assert.match(html, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(html, /@media\(max-width:420px\)\{\.device\{width:100vw;height:100vh/);
});

test('Ikan UI remains isolated under its own public path', () => {
  assert.match(html, /<style id="ikan-desktop-layout">/);
  assert.match(html, /<div class="device"><div class="screen">/);
});

test('left drawer keeps every existing navigation destination and remains collapsible on desktop', () => {
  assert.match(html, /id="menuToggle"[^>]+aria-controls="mainNavDrawer"[^>]+aria-expanded="false"/);
  assert.match(html, /id="mainNavDrawer"[^>]+aria-hidden="true"[^>]+inert/);
  for (const page of ['sales', 'invoice', 'purchase', 'master', 'costPayable', 'report']) {
    assert.match(html, new RegExp(`data-page="${page}"`));
  }
  assert.doesNotMatch(html, /@media\s*\(min-width:421px\)[^}]*\.nav-drawer\s*\{[^}]*transform\s*:\s*none/s);
});

test('drawer close behavior covers toggle, overlay, Escape, mobile selection, and focus restoration', () => {
  assert.match(html, /onclick="toggleNavDrawer\(\)"/);
  assert.match(html, /id="drawerOverlay"[^>]+onclick="closeNavDrawer\(true\)"/);
  assert.match(html, /event\.key==='Escape'&&navDrawerIsOpen\(\)/);
  assert.match(html, /matchMedia\('\(max-width:420px\)'\)\.matches\)closeNavDrawer\(false\)/);
  assert.match(html, /if\(restoreFocus\)toggle\.focus\(\)/);
  assert.match(html, /event\.key!=='Tab'\|\|!navDrawerIsOpen\(\)/);
});

test('drawer preserves the established palette and only adds a transparent overlay', () => {
  assert.match(html, /background:linear-gradient\(135deg,#111827,#374151\)/);
  assert.match(html, /\.drawer-overlay\{[^}]*background:rgba\(17,24,39,\.52\)/);
  assert.match(html, /\.nav-drawer\{[^}]*background:#111827/);
});

test('customer receivable UI consumes the server read-model without calculating balances locally', () => {
  assert.match(html, /data-page="customers"/);
  assert.match(html, /id="customersPage"/);
  assert.match(html, /ikanFetch\(`\/customers\/receivables\?\$\{params\}`\)/);
  assert.match(html, /ikanFetch\(`\/customers\/\$\{encodeURIComponent\(contactId\)\}\/receivables\?paymentLimit=20`\)/);
  assert.doesNotMatch(html, /customerReceivableState[^;]+reduce\(/);
});

test('customer receivable UI exposes loading empty error retry search and bounded pagination states', () => {
  assert.match(html, /Memuat rekap customer/);
  assert.match(html, /Rekap customer belum bisa dimuat/);
  assert.match(html, /Belum ada transaksi customer/);
  assert.match(html, /onclick="loadCustomerReceivables\(\)">Coba lagi/);
  assert.match(html, /new URLSearchParams\(\{limit:'20'\}\)/);
  assert.match(html, /params\.set\('q',state\.query\.trim\(\)\)/);
  assert.match(html, /params\.set\('cursor',cursor\)/);
});

test('customer detail links outstanding invoices and payment history to the existing invoice flow', () => {
  assert.match(html, /onclick="setCustomerInvoiceFilter\('outstanding'\)"/);
  assert.match(html, /onclick="toggleCustomerPaymentHistory\(\)"/);
  assert.match(html, /function openReceivableInvoice\(encodedId\)/);
  assert.match(html, /document\.querySelector\('\.tab\[data-page="invoice"\]'\)/);
  assert.match(html, /class="receivable-card"[^>]*type="button"|class="card receivable-card" type="button"/);
});
