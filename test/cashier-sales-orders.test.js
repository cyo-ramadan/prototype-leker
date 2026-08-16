import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cashierHtml = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');
const cashierFlow = readFileSync(new URL('../public/cashier-sales-orders.js', import.meta.url), 'utf8');
const customerHtml = readFileSync(new URL('../public/customer.html', import.meta.url), 'utf8');
const customerStatus = readFileSync(new URL('../public/customer-order-status.js', import.meta.url), 'utf8');

test('cashier exposes drawer-bound Penjualan, Buku Menu, and Pesanan modes', () => {
  assert.match(cashierHtml, /cashier-sales-orders\.js/);
  assert.match(cashierFlow, /data-cashier-workspace-mode="sales"/);
  assert.match(cashierFlow, /🧾 Penjualan/);
  assert.match(cashierFlow, /📖 Buku Menu/);
  assert.match(cashierFlow, /📥 Pesanan/);
  assert.match(cashierFlow, /openSaleDialog\(\)/);
  assert.match(cashierFlow, /id="salePimasatu"/);
  assert.doesNotMatch(cashierHtml, /id="salePimasatu"/);
});

test('search and book-menu entry share the existing sale draft', () => {
  assert.match(cashierFlow, /cashier:sale-dialog-opened/);
  assert.match(cashierFlow, /Lanjut ke Penjualan/);
  assert.match(cashierHtml, /id="processSaleBtn"[^>]*>PROSES PENJUALAN</);
  assert.doesNotMatch(cashierFlow, /setInterval\s*\(/);
});

test('cashier order actions implement reject-only-before-acceptance flow', () => {
  assert.match(cashierFlow, /data-status="PREPARING">Terima Pesanan/);
  assert.match(cashierFlow, /data-status="CANCELLED">Tolak/);
  assert.match(cashierFlow, /data-status="READY">Mulai Buat/);
  assert.match(cashierFlow, /data-status="COMPLETED">Sudah Jadi/);
  assert.match(cashierFlow, /id="rejectedList"/);
});

test('customer status display uses the same four-stage lifecycle', () => {
  assert.match(customerHtml, /1\. Dipesan/);
  assert.match(customerHtml, /2\. Diterima/);
  assert.match(customerHtml, /3\. Dibuat/);
  assert.match(customerHtml, /4\. Sudah Jadi/);
  assert.match(customerHtml, /customer-order-status\.js/);
  assert.match(customerStatus, /Pesanan ditolak/);
});
