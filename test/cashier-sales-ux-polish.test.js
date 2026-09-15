import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cashierHtml = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');
const cashierUi = readFileSync(new URL('../public/cashier.js', import.meta.url), 'utf8');
const cashierCss = readFileSync(new URL('../public/cashier-pos.css', import.meta.url), 'utf8');

test('sale success toast stays visible longer and can be dismissed without changing ordinary toast duration', () => {
  assert.match(cashierUi, /const isSaleSuccess = String\(message\)\.startsWith\('Penjualan tersimpan'\)/);
  assert.match(cashierUi, /if \(isSaleSuccess\) document\.body\.appendChild\(node\)/);
  assert.match(cashierUi, /isSaleSuccess \? 6500 : 1900/);
  assert.match(cashierUi, /node\.onclick = hideToast/);
  assert.match(cashierCss, /\.cashier-toast-sale-success\{/);
});

test('mobile cashier has a fixed summary bar that opens the full draft drawer', () => {
  assert.match(cashierHtml, /id="cashierMobileCartBar"/);
  assert.match(cashierHtml, /id="mobileDraftCount"/);
  assert.match(cashierHtml, /id="mobileDraftTotal"/);
  assert.match(cashierHtml, /id="mobileProcessSaleBtn"[^>]*>PROSES</);
  assert.match(cashierUi, /function setMobileDraftOpen\(open\)/);
  assert.match(cashierUi, /event\.target\.closest\('\[data-cashier-workspace-mode\]'\)/);
  assert.match(cashierCss, /\.cashier-mobile-cart-bar\{position:fixed;/);
  assert.match(cashierCss, /\.cashier-draft-panel\.mobile-open\{/);
});

test('cashier menu search filters already-loaded products by name without another request', () => {
  assert.match(cashierHtml, /id="cashierMenuSearch"[^>]*type="search"/);
  assert.match(cashierUi, /state\.menuSearch = event\.target\.value/);
  assert.match(cashierUi, /String\(product\.name \|\| ''\)\.toLocaleLowerCase\('id-ID'\)\.includes\(normalizedSearch\)/);
  assert.doesNotMatch(cashierUi, /cashierMenuSearch[\s\S]{0,240}\bapi\(/);
});

test('menu cards show the quantity currently selected in the shared sale draft', () => {
  assert.match(cashierUi, /state\.draft\.get\(Number\(product\.id\)\)\?\.quantity \|\| 0/);
  assert.match(cashierUi, /cashier-menu-qty-badge/);
  assert.match(cashierUi, /renderMenu\(\);\n\}/);
  assert.match(cashierCss, /\.cashier-menu-card\.selected\{/);
});

test('draft rows accept a typed quantity and clamp it to the existing zero-to-fifty range', () => {
  assert.match(cashierUi, /data-draft-quantity="\$\{line\.product\.id\}" type="number"/);
  assert.match(cashierUi, /function commitDraftQuantity\(productId, rawQuantity\)/);
  assert.match(cashierUi, /Math\.max\(0, Math\.min\(50, parsedQuantity\)\)/);
  assert.match(cashierUi, /input\.onblur = \(\) => commitDraftQuantity/);
  assert.match(cashierUi, /if \(event\.key !== 'Enter'\) return/);
  assert.match(cashierCss, /\.cashier-draft-quantity-input\{/);
});
