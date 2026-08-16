import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
const balanceUi = readFileSync(new URL('../public/admin-accounting-journal-balance-ui.js', import.meta.url), 'utf8');

test('Data Jurnal list exposes both Debit and Kredit totals', () => {
  assert.match(html, /admin-accounting-workspace\.js/);
  assert.match(html, /admin-accounting-journal-balance-ui\.js/);
  assert.ok(
    html.indexOf('admin-accounting-journal-balance-ui.js') > html.indexOf('admin-accounting-workspace.js'),
    'journal balance enhancer must load after the Accounting workspace renderer'
  );
  assert.match(balanceUi, /data-journal-credit-total/);
  assert.match(balanceUi, /textContent = 'Kredit'/);
  assert.match(balanceUi, /totalCreditExact/);
  assert.match(balanceUi, /\/api\/admin\/accounting\/journals/);
});
