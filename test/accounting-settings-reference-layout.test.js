import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const comfort = readFileSync(new URL('../public/admin-accounting-settings-comfort.js', import.meta.url), 'utf8');
const referenceLayout = readFileSync(new URL('../public/admin-accounting-settings-reference-layout.js', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');

test('Accounting Settings renders Debit and Kredit as two independent visual columns', () => {
  assert.match(comfort, /<div class="acc-columns">/);
  assert.match(comfort, /acc-col debit/);
  assert.match(comfort, /acc-col credit/);
  assert.match(comfort, /Tambah Baris Debit/);
  assert.match(comfort, /Tambah Baris Kredit/);
});

test('reference layout keeps Debit and Kredit side by side on phone widths', () => {
  assert.match(referenceLayout, /max-width:760px/);
  assert.match(referenceLayout, /grid-template-columns:minmax\(180px,1fr\) minmax\(180px,1fr\)!important/);
  assert.match(referenceLayout, /grid-template-columns:132px minmax\(390px,1fr\)!important/);
  assert.doesNotMatch(referenceLayout, /acc-columns\s*\{[^}]*grid-template-columns:1fr!important/);
  assert.match(adminHtml, /admin-accounting-settings-reference-layout\.js/);
});
