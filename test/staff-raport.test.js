import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const raport = readFileSync(new URL('../src/staff-raport.js', import.meta.url), 'utf8');
const portal = readFileSync(new URL('../src/staff-portal.js', import.meta.url), 'utf8');
const staffUi = readFileSync(new URL('../public/staff.js', import.meta.url), 'utf8');
const staffHtml = readFileSync(new URL('../public/staff.html', import.meta.url), 'utf8');
const adminUi = readFileSync(new URL('../public/admin-cashier-raport.js', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');

test('one Raport fact model feeds staff and admin', () => {
  assert.match(raport, /MAXI_STAFF_RAPORT_FACTS_V1/);
  assert.match(raport, /getCashierRaportFacts/);
  assert.match(portal, /getCashierRaportFacts/);
  assert.match(adminUi, /cashier-raport/);
});

test('Raport exposes operational facts but does not invent a score', () => {
  assert.match(raport, /transactionVoidPermits/);
  assert.match(raport, /approval_permits/);
  assert.match(raport, /score: null/);
  assert.match(raport, /grade: null/);
  assert.match(raport, /NEEDS_KPI_POLICY/);
  assert.match(raport, /UNCONFIGURED/);
});

test('staff and branch admin both render Raport surfaces', () => {
  assert.match(staffHtml, /Raport \/ KPI/);
  assert.match(staffUi, /renderKpi/);
  assert.match(adminUi, /Raport Kasir/);
  assert.match(adminHtml, /admin-cashier-raport\.js/);
});
