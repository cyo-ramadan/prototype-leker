import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspaceUi = readFileSync(new URL('../public/admin-accounting-workspace.js', import.meta.url), 'utf8');

test('Data Jurnal list shows both Debit and Kredit totals from Accounting read model', () => {
  assert.match(
    workspaceUi,
    /<th>Debit<\/th><th>Kredit<\/th>/,
    'journal list must expose both sides of the double-entry total'
  );
  assert.match(
    workspaceUi,
    /row\.totalDebitExact\s*\?\?\s*row\.totalDebitMinor/,
    'journal list must render the Debit total supplied by Accounting'
  );
  assert.match(
    workspaceUi,
    /row\.totalCreditExact\s*\?\?\s*row\.totalCreditMinor/,
    'journal list must render the Credit total supplied by Accounting'
  );
});
