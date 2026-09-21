import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../src/cashier-workspace.js', import.meta.url), 'utf8');
const workspaceUi = readFileSync(new URL('../public/cashier-workspace.js', import.meta.url), 'utf8');
const inputUi = readFileSync(new URL('../public/cashier-payment-methods.js', import.meta.url), 'utf8');
const enhancedInputUi = readFileSync(new URL('../public/cashier-enhancements.js', import.meta.url), 'utf8');
const sales = readFileSync(new URL('../src/cashier-sales-tracking.js', import.meta.url), 'utf8');
const purchases = readFileSync(new URL('../src/cashier-purchase.js', import.meta.url), 'utf8');
const expenses = readFileSync(new URL('../src/cashier-operational-expense.js', import.meta.url), 'utf8');
const posPayments = readFileSync(new URL('../src/pos-payment-methods.js', import.meta.url), 'utf8');
const accountingBridge = readFileSync(new URL('../src/accounting-pos-bridge.js', import.meta.url), 'utf8');
const drawerReport = readFileSync(new URL('../src/drawer-report.js', import.meta.url), 'utf8');
const purchaseDefaults = readFileSync(new URL('../migrations/0029_purchase_accounting_defaults.sql', import.meta.url), 'utf8');
const cashierPosCss = readFileSync(new URL('../public/cashier-pos.css', import.meta.url), 'utf8');
const cashierHtml = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');

test('cashier workspace exposes POS-owned payment methods without Accounting rule components', () => {
  assert.match(workspace, /listPosPaymentMethods/);
  assert.match(workspace, /from '\.\/pos-payment-methods\.js'/);
  assert.match(workspace, /paymentMethods/);
  assert.doesNotMatch(workspace, /listOperationalAccountingComponents|operationalAccountingComponents/);
  assert.match(workspaceUi, /state\.paymentMethods/);
  assert.doesNotMatch(workspaceUi, /state\.operationalAccountingComponents/);
  assert.match(workspaceUi, /cashier:workspace-applied/);
});

test('sale purchase and operational writes validate payment codes through POS Core', () => {
  assert.match(sales, /resolvePosPaymentMethod/);
  assert.match(purchases, /resolvePosPaymentMethod/);
  assert.match(expenses, /resolvePosPaymentMethod/);
  for (const source of [sales, purchases, expenses]) {
    assert.match(source, /from '\.\/pos-payment-methods\.js'/);
    assert.doesNotMatch(source, /PAYMENT_METHOD_NOT_AVAILABLE[\s\S]{0,200}Setting Akuntansi/);
  }
  assert.match(posPayments, /FROM payment_methods/);
  assert.doesNotMatch(posPayments, /chart_of_accounts|account_id/i);
  assert.doesNotMatch(accountingBridge, /export async function (?:list|resolve)PosPaymentMethods/);
  assert.doesNotMatch(sales, /NON_CASH'\s*\?\s*'NON_CASH'\s*:\s*'CASH'/);
  assert.doesNotMatch(purchases, /const PAYMENT_METHODS = new Set/);
  assert.doesNotMatch(purchases, /function purchasePaymentMethod/);
});

test('operational expense reports a business fact and never selects an Accounting rule', () => {
  assert.match(expenses, /businessEvent:\s*'EXPENSE'/);
  assert.match(expenses, /transactionCategoryCode:\s*'operational'/);
  assert.match(expenses, /buildTransactionAccountingSnapshot/);
  assert.doesNotMatch(expenses, /accountingComponentRuleId|accounting_component_rule_id|listOperationalAccountingComponents/);
  assert.match(inputUi, /cost-masters\/options/);
  assert.match(inputUi, /costMasterId/);
  assert.match(inputUi, /MAXIPimasatu/);
  assert.doesNotMatch(inputUi, /debitAccountId|creditAccountId|journalRuleId/);
});

test('cashier UI consumes the configured registry for sale purchase and operational payment inputs', () => {
  assert.match(inputUi, /salePaymentMethod/);
  assert.match(inputUi, /dialogPurchasePayment/);
  assert.match(inputUi, /dialogOperationalPayment/);
  assert.match(inputUi, /state\.paymentMethods/);
  assert.match(inputUi, /item\.isDefault/);
  assert.match(inputUi, /Hanya CASH/);
  assert.match(inputUi, /metode bayar POS/);
  assert.doesNotMatch(inputUi, /cara bayar aktif di Setting Akuntansi|Berasal dari Setting Akuntansi/);
});

test('purchase dialog keeps one Accounting payment selector, and PIMASATU owns pricing from Master Barang', () => {
  assert.match(inputUi, /<select id="dialogPurchasePayment"/);
  assert.match(purchases, /p\.purchase_price/);
  assert.match(purchases, /purchasePrice: costFromScaled\(row\.purchase_price\)/);
  assert.doesNotMatch(purchases, /purchase_price = CAST/);
});

// Bos Cyo, 2026-09-21: Beli Bahan gagal total ("wajib 1-50 baris barang")
// di Pendem dan Beji karena editor Beli Bahan LAMA di file ini (query
// [data-purchase-row], sudah tidak pernah dibuat sejak Beli Bahan pindah ke
// PIMASATU -- title dialognya berubah dari "Beli Bahan" jadi "Beli Bahan ·
// Transaksi") masih punya window.fetch wrapper yang menimpa body.items
// dengan array kosong hasil query itu SETELAH PIMASATU sudah membangun
// payload yang benar. Wrapper ini kebetulan tidak aktif sebelum perbaikan
// Safari 2026-09-19 (canonicalFactPost dulu fetch(new Request(...)), yang
// membuat wrapper ini bail lewat cek `request` truthy) -- begitu
// canonicalFactPost pindah ke fetch(path, init) string biasa, wrapper ini
// ikut jalan dan mengambil alih body Beli Bahan tanpa sepengetahuan siapa
// pun. Editor lama dan cabang sales/purchases/expenses di wrapper ini
// sudah dihapus total -- cashier-payment-methods.js (PIMASATU) sekarang
// satu-satunya pemilik ketiga path itu. Test ini menjaga supaya pola
// berbahaya itu (fetch wrapper lain yang menimpa body sales/purchases/
// expenses) tidak diam-diam masuk lagi.
test('legacy pre-PIMASATU purchase composer is gone, and the shared fetch wrapper here only ever touches drawer open/close', () => {
  for (const marker of [
    'purchaseItemsPayload', 'renderPurchaseSearchResults', 'selectPurchaseProduct',
    'resetPurchaseComposer', 'addPurchaseRow', 'preparePurchaseItemsEditor',
    'purchaseState', "title === 'Beli Bahan'", "title === 'Pengeluaran'",
    'purchase-detail-row', 'purchaseComposerQty', 'purchaseProductSearch'
  ]) {
    assert.doesNotMatch(enhancedInputUi, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `legacy purchase composer marker must not exist: ${marker}`);
  }
  const wrapperBody = enhancedInputUi.slice(enhancedInputUi.indexOf('window.fetch = async function cashierEnhancedFetch'));
  assert.doesNotMatch(wrapperBody, /\/api\/cashier\/sales|\/api\/cashier\/purchases|\/api\/cashier\/expenses/, 'this shared fetch wrapper must never touch sales/purchases/expenses again -- cashier-payment-methods.js owns those paths');
  assert.match(wrapperBody, /\/api\/cashier\/drawer\/open/);
  assert.match(wrapperBody, /\/api\/cashier\/drawer\/close/);
});

test('cashier-pos.css retains the legacy purchase composer grid rules', () => {
  assert.match(cashierPosCss, /\.purchase-composer\{[^}]*grid-template-columns:76px minmax\(0,1fr\)/);
  assert.match(cashierPosCss, /\.purchase-composer-product\{[^}]*grid-column:1\/-1\}\.purchase-composer-qty\{grid-column:1\}\.purchase-composer-price\{grid-column:2\}/);
  assert.match(cashierPosCss, /\.purchase-detail-row\{[^}]*grid-template-columns:minmax\(0,1fr\) 62px minmax\(82px,auto\)/);
  assert.match(cashierPosCss, /\.purchase-detail-quantity \.text-input\{[^}]*text-align:center/);
  assert.match(cashierPosCss, /\.purchase-detail-subtotal\{[^}]*background:#2b2118;color:#fff/);
  assert.match(cashierPosCss, /\.purchase-search-results\{[^}]*position:absolute[^}]*max-height:230px/);
  assert.match(cashierPosCss, /@media\(min-width:700px\)/);
});

test('cashier mobile purchase assets are versioned so deployed layout changes bypass stale browser cache', () => {
  // Yang dijaga: aset-nya PUNYA penanda versi -- bukan nilai versinya persis.
  // Memaku nilainya bikin test ini pecah setiap kali file-nya di-bump, padahal
  // mem-bump versi justru aturan yang wajib diikuti kalau file lama diedit
  // (KNOWN_PITFALLS "File JS lama yang diubah tapi query ?v= tidak dibump").
  assert.match(cashierHtml, /cashier-pos\.css\?v=[\w.-]+/);
  assert.match(cashierHtml, /cashier-enhancements\.js\?v=[\w.-]+/);
});

test('purchase Accounting defaults are canonical and remain editable by admin', () => {
  assert.match(purchaseDefaults, /Persediaan sesuai Jenis Barang/);
  assert.match(purchaseDefaults, /item_category_inventory/);
  assert.match(purchaseDefaults, /payment_method/);
  assert.match(purchaseDefaults, /is_default/);
  assert.match(purchaseDefaults, /Kompensasi Piutang \(review\)/);
  assert.match(purchaseDefaults, /coa_' \|\| k\.store_id \|\| '_1301/);
});

test('drawer classification treats only CASH as physical cash', () => {
  assert.match(drawerReport, /row\.payment_method \|\| 'CASH'/);
  assert.match(drawerReport, /cashSales = sales\.filter\(row => row\.paymentMethod === 'CASH'\)/);
  assert.match(drawerReport, /nonCashSales = sales\.filter\(row => row\.paymentMethod !== 'CASH'\)/);
  assert.match(drawerReport, /nonCashPurchases = purchases\.filter\(row => row\.paymentMethod !== 'CASH'\)/);
  assert.match(drawerReport, /nonCashExpenses = expenses\.filter\(row => row\.paymentMethod !== 'CASH'\)/);
});
