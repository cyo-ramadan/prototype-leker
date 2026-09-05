import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modalScript = readFileSync(new URL('../public/admin-detail-modal.js', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
const transactionsUi = readFileSync(new URL('../public/admin-transactions-ui.js', import.meta.url), 'utf8');
const stockUi = readFileSync(new URL('../public/admin-stock.js', import.meta.url), 'utf8');
const journalWorkspace = readFileSync(new URL('../public/admin-accounting-workspace.js', import.meta.url), 'utf8');

test('shared admin detail modal is a real <dialog>, presentation-only, wired before its consumers', () => {
  assert.doesNotThrow(() => new Function(modalScript));
  assert.match(modalScript, /createElement\('dialog'\)/);
  assert.match(modalScript, /showModal\(\)/);
  assert.match(modalScript, /window\.openAdminDetailModal/);
  assert.match(modalScript, /window\.closeAdminDetailModal/);
  assert.doesNotMatch(modalScript, /\bfetch\s*\(/);

  const modalTagIndex = adminHtml.indexOf('admin-detail-modal.js');
  assert.ok(modalTagIndex >= 0, 'admin-detail-modal.js must be included in branch-admin.html');
  for (const consumer of ['admin-transactions-ui.js', 'admin-stock.js', 'admin-accounting-workspace.js']) {
    const consumerIndex = adminHtml.indexOf(consumer);
    assert.ok(consumerIndex > modalTagIndex, `${consumer} must load after admin-detail-modal.js`);
  }
});

test('Transaction detail, stock mutation/HPP history, and journal detail all open through the shared modal (not an inline page panel)', () => {
  assert.match(transactionsUi, /window\.openAdminDetailModal\(/);
  assert.doesNotMatch(transactionsUi, /adminTransactionDetail/);

  assert.match(stockUi, /window\.openAdminDetailModal\(/);
  assert.doesNotMatch(stockUi, /adminStockDetail/);

  assert.match(journalWorkspace, /window\.openAdminDetailModal\(/);
});
