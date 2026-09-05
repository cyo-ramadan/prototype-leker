import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const transactionsUi = readFileSync(new URL('../public/admin-transactions-ui.js', import.meta.url), 'utf8');
const stockUi = readFileSync(new URL('../public/admin-stock.js', import.meta.url), 'utf8');
const cashierVoidPermits = readFileSync(new URL('../public/cashier-transaction-void-permits.js', import.meta.url), 'utf8');
const managementVoidPermits = readFileSync(new URL('../public/management-transaction-void-permits.js', import.meta.url), 'utf8');
const adminCss = readFileSync(new URL('../public/admin.css', import.meta.url), 'utf8');
const adminJs = readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8');
const journalWorkspace = readFileSync(new URL('../public/admin-accounting-workspace.js', import.meta.url), 'utf8');
const modalScript = readFileSync(new URL('../public/admin-detail-modal.js', import.meta.url), 'utf8');

test('Transaction tracking cards show human kind labels, not raw enum/ref/JSON', () => {
  assert.match(transactionsUi, /KIND_LABEL/);
  assert.match(transactionsUi, /GOODS_FLOW: 'Arus Barang'/);
  assert.doesNotMatch(transactionsUi, /Ref \$\{esc\(transaction\.sourceReference/);
  assert.doesNotMatch(transactionsUi, /JSON\.stringify/);
});

test('Stock movement and HPP history rows drop raw sourceId refs', () => {
  assert.doesNotMatch(stockUi, /Ref \$\{esc\(row\.sourceId\)\}/);
});

test('Kasir permit-hapus list does not expose raw subjectId to the cashier', () => {
  assert.doesNotMatch(cashierVoidPermits, /escapeHtml\(item\.subjectId\)/);
});

test('Admin/Owner permit review drops the raw Ref line but keeps journal audit fields', () => {
  assert.doesNotMatch(managementVoidPermits, /Ref \$\{esc\(item\.subjectId\)\}/);
  assert.match(managementVoidPermits, /Jurnal sumber/);
  assert.match(managementVoidPermits, /Jurnal pembalik/);
});

test('.master-row defaults to a 2-column layout; thumbnail rows opt in via .with-thumb', () => {
  assert.match(adminCss, /\.master-row \{ display:grid; grid-template-columns:minmax\(0,1fr\) auto;/);
  assert.match(adminCss, /\.master-row\.with-thumb \{ grid-template-columns:auto minmax\(0,1fr\) auto; \}/);
  assert.match(adminJs, /master-row with-thumb/);
});

test('mobile breakpoint stacks thumbnail-less rows instead of squeezing content into the 50px thumb column', () => {
  const mobileBlock = adminCss.slice(adminCss.indexOf('@media (max-width:620px)'));
  assert.match(mobileBlock, /\.master-row \{ grid-template-columns:1fr; \}/);
  assert.match(mobileBlock, /\.master-row\.with-thumb \{ grid-template-columns:50px minmax\(0,1fr\); \}/);
});

test('Journal detail modal opens wide (financial table needs more room) and drops the raw source reference id', () => {
  assert.match(journalWorkspace, /openAdminDetailModal\(\{\s*wide: true,/);
  assert.doesNotMatch(journalWorkspace, /esc\(j\.sourceReferenceId\)/);
  assert.match(modalScript, /\$\{MODAL_ID\}\.wide/);
});
