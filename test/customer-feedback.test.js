import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  CUSTOMER_FEEDBACK_CATALOG,
  CUSTOMER_FEEDBACK_REWARD_POINTS,
  buildMonthlyFeedbackEntitlementKey,
  normalizeFeedbackSubmission
} from '../src/customer-feedback.js';
import {
  REQUIRED_REMOTE_TABLES,
  extractWranglerD1Rows,
  missingRequiredTables
} from '../scripts/verify-remote-schema.mjs';

test('customer feedback catalog has the three approved evaluation categories', () => {
  assert.deepEqual(Object.keys(CUSTOMER_FEEDBACK_CATALOG), [
    'PRODUCT_QUALITY',
    'SERVICE',
    'CLEANLINESS'
  ]);
  assert.equal(CUSTOMER_FEEDBACK_REWARD_POINTS, 500);
  assert.ok(CUSTOMER_FEEDBACK_CATALOG.PRODUCT_QUALITY.issues.length >= 5);
  assert.ok(CUSTOMER_FEEDBACK_CATALOG.SERVICE.issues.length >= 5);
  assert.ok(CUSTOMER_FEEDBACK_CATALOG.CLEANLINESS.issues.length >= 5);
});

test('feedback accepts category issue codes and manual-only reports', () => {
  const issueReport = normalizeFeedbackSubmission({
    category: 'PRODUCT_QUALITY',
    issues: ['TASTE_NOT_GOOD', 'TASTE_INCONSISTENT'],
    manualNote: ''
  });
  assert.equal(issueReport.ok, true);
  assert.deepEqual(issueReport.value.issues.map(issue => issue.code), [
    'TASTE_NOT_GOOD',
    'TASTE_INCONSISTENT'
  ]);

  const manualReport = normalizeFeedbackSubmission({
    category: 'SERVICE',
    issues: [],
    manualNote: 'Ada hal lain yang perlu dievaluasi.'
  });
  assert.equal(manualReport.ok, true);
  assert.equal(manualReport.value.manualNote, 'Ada hal lain yang perlu dievaluasi.');
});

test('feedback rejects empty reports and issue codes from another category', () => {
  assert.equal(normalizeFeedbackSubmission({
    category: 'CLEANLINESS',
    issues: [],
    manualNote: ''
  }).ok, false);

  assert.equal(normalizeFeedbackSubmission({
    category: 'CLEANLINESS',
    issues: ['TASTE_NOT_GOOD'],
    manualNote: ''
  }).ok, false);
});

test('monthly entitlement key is deterministic by customer and Jakarta business month', () => {
  assert.equal(
    buildMonthlyFeedbackEntitlementKey('customer_1', '2026-08-16'),
    'MONTHLY:customer_1:2026-08'
  );
});

test('customer feedback UI keeps entitlement algorithm private and both new browser scripts parse', async () => {
  const [customerScript, managementScript] = await Promise.all([
    readFile(new URL('../public/customer-feedback.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/management-customer-feedback.js', import.meta.url), 'utf8')
  ]);

  assert.doesNotMatch(customerScript, /50000|50\.000|QUALIFYING_SALE|entitlement_key|MONTHLY:/i);
  assert.match(customerScript, /Privasi pelapor dijaga/);
  assert.match(customerScript, /Laporkan/);
  assert.match(managementScript, /Identitas pelapor disembunyikan/);

  assert.doesNotThrow(() => new vm.Script(customerScript));
  assert.doesNotThrow(() => new vm.Script(managementScript));
});

test('feedback migration provides normalized report and issue facts with unique entitlement guards', async () => {
  const migration = await readFile(new URL('../migrations/0033_customer_feedback.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS customer_feedback_reports/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS customer_feedback_report_issues/);
  assert.match(migration, /entitlement_key TEXT NOT NULL UNIQUE/);
  assert.match(migration, /qualifying_sale_id/);
  assert.match(migration, /idx_customer_feedback_qualifying_sale/);
});

test('remote schema verifier requires both feedback tables and parses Wrangler JSON shapes', () => {
  assert.deepEqual(REQUIRED_REMOTE_TABLES, [
    'customer_feedback_reports',
    'customer_feedback_report_issues'
  ]);

  const wranglerPayload = [{
    success: true,
    results: [
      { name: 'customer_feedback_report_issues' },
      { name: 'customer_feedback_reports' }
    ]
  }];

  assert.deepEqual(extractWranglerD1Rows(wranglerPayload), wranglerPayload[0].results);
  assert.deepEqual(missingRequiredTables(wranglerPayload), []);
  assert.deepEqual(
    missingRequiredTables([{ success: true, results: [{ name: 'customer_feedback_reports' }] }]),
    ['customer_feedback_report_issues']
  );
});
