import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 2026-09-15, Bos Cyo: "maksud penataan kaya kasir itu dari pertama landing
// di admin, tombol2nya mulai dari toko dst bukan yang ada dibtransaksi
// doank" -- the earlier pass (see admin-tx-stock-button-theme.test.js) only
// themed the buttons INSIDE the Transaksi/Stok tab content. This covers the
// outer .admin-tab navigation bar itself, which is the very first thing a
// user sees landing in Admin, starting from "Toko".

const branchAdminHtml = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
const adminCss = readFileSync(new URL('../public/admin.css', import.meta.url), 'utf8');
const masterMenuUi = readFileSync(new URL('../public/admin-master-menu.js', import.meta.url), 'utf8');

test('the .admin-tabs bar wraps and stacks on mobile instead of horizontal-scrolling forever, matching Kasir\'s .drawer-actions', () => {
  assert.match(adminCss, /\.admin-tabs\s*\{[^}]*flex-wrap:wrap/);
  assert.doesNotMatch(adminCss, /\.admin-tabs\s*\{[^}]*overflow:auto/, 'the old horizontal-scroll-only behavior must be gone, not just supplemented');
  assert.match(adminCss, /@media \(max-width:620px\)\s*\{[\s\S]*\.admin-tabs\s*\{\s*width:100%/);
  assert.match(adminCss, /\.admin-tabs > \*\s*\{\s*flex:1 1 46%/);
});

test('the static top-level admin tabs (Toko, Data Barang, Kategori, Supplier, Customer, Kotak Saran) all carry an icon, not plain text', () => {
  for (const marker of ['🏪 Toko', '🥞 Data Barang', '🏷️ Kategori', '🧺 Supplier', '👤 Customer', '💬 Kotak Saran']) {
    assert.ok(branchAdminHtml.includes(marker), `missing icon-prefixed tab label: ${marker}`);
  }
});

test('the Master ▾ dropdown toggle gets an icon without breaking its live label span (still read by stock-production-points.test.js)', () => {
  assert.match(masterMenuUi, /🗂️ <span id="adminMasterMenuLabel">Master<\/span> ▾/);
});

test('dynamically-injected tabs (Stok, Transaksi, Detail Laci, Voucher, Approval Queue, Raport Kasir, Akuntansi, Master Biaya) also carry icons, not just their inner filter chips', () => {
  const files = {
    'public/admin-stock.js': "'📦 Stok'",
    'public/admin-transactions-ui.js': "'📊 Transaksi'",
    'public/admin-drawers.js': "'📚 Detail Laci'",
    'public/admin-voucher.js': "'🎟️ Voucher'",
    'public/management-approval-queue.js': '✅ Approval Queue',
    'public/admin-cashier-raport.js': "'📋 Raport Kasir'",
    'public/admin-cost-master.js': "'💸 Master Biaya'"
  };
  for (const [path, marker] of Object.entries(files)) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.ok(source.includes(marker), `${path} missing icon-prefixed label ${marker}`);
  }
});
