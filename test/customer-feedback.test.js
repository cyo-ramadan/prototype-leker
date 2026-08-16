import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  CUSTOMER_FEEDBACK_CATALOG,
  CUSTOMER_FEEDBACK_REWARD_POINTS,
  buildMonthlyFeedbackEntitlementKey,
  findFeedbackAccess,
  normalizeFeedbackSubmission
} from '../src/customer-feedback.js';
import {
  REQUIRED_REMOTE_TABLES,
  WRANGLER_SCHEMA_VERIFY_TIMEOUT_MS,
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

function feedbackAccessDbWithBrokenSaleLookup({ monthlyReport = null } = {}) {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('SELECT created_at')) return null;
              if (sql.includes('FROM sales s')) throw new Error('D1_ERROR: no such column: s.voided_at');
              if (sql.includes('business_month = ?')) return monthlyReport;
              throw new Error(`Unexpected feedback access query: ${sql}`);
            }
          };
        }
      };
    }
  };
}

test('feedback access falls back to the guarded monthly path when sale lookup is unavailable', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const access = await findFeedbackAccess(
      feedbackAccessDbWithBrokenSaleLookup(),
      'store_001',
      'customer_1',
      '2026-08-16'
    );

    assert.deepEqual(access, {
      available: true,
      entitlementType: 'MONTHLY',
      entitlementKey: 'MONTHLY:customer_1:2026-08',
      qualifyingSaleId: null
    });
  } finally {
    console.error = originalError;
  }
});

test('broken sale lookup never grants an extra report when the monthly entitlement is already consumed', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const access = await findFeedbackAccess(
      feedbackAccessDbWithBrokenSaleLookup({ monthlyReport: { id: 'feedback_existing' } }),
      'store_001',
      'customer_1',
      '2026-08-16'
    );

    assert.deepEqual(access, { available: false });
  } finally {
    console.error = originalError;
  }
});

test('customer feedback renders categories before entitlement resolution', async () => {
  const customerScript = await readFile(new URL('../public/customer-feedback.js', import.meta.url), 'utf8');

  assert.match(customerScript, /await loadCatalog\(\);\s*accessState = 'CHECKING';\s*renderForm\(\);\s*await refreshFeedbackAccess\(\);/);
  assert.match(customerScript, /data-feedback-category/);
  assert.doesNotMatch(customerScript, /if\s*\(!window\.LEKER_CUSTOMER\)\s*return\s+renderLoginRequired/);
});

test('customer feedback keeps Laporkan actionable and explains unmet requirements', async () => {
  const customerScript = await readFile(new URL('../public/customer-feedback.js', import.meta.url), 'utf8');

  assert.match(customerScript, /<button id="customerFeedbackSubmit" class="customer-feedback-submit" type="button">Laporkan<\/button>/);
  assert.doesNotMatch(customerScript, /id="customerFeedbackSubmit"[^>]*\sdisabled/);
  assert.match(customerScript, /Pilih kategori saran terlebih dahulu\./);
  assert.match(customerScript, /Centang minimal satu poin evaluasi atau tulis saran lain\./);
  assert.match(customerScript, /Login pelanggan diperlukan sebelum saran dapat dikirim\./);
  assert.match(customerScript, /Pengiriman saran untuk akun ini belum tersedia saat ini\./);
});

test('customer feedback UI keeps entitlement algorithm private and browser scripts parse', async () => {
  const [customerScript, sessionBridge, customerHtml, managementScript] = await Promise.all([
    readFile(new URL('../public/customer-feedback.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/customer-feedback-session-ready.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/customer.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/management-customer-feedback.js', import.meta.url), 'utf8')
  ]);

  assert.doesNotMatch(customerScript, /50000|50\.000|QUALIFYING_SALE|entitlement_key|MONTHLY:/i);
  assert.match(customerScript, /Privasi pelapor dijaga/);
  assert.match(customerScript, /Laporkan/);
  assert.match(managementScript, /Identitas pelapor disembunyikan/);

  assert.match(sessionBridge, /lekerCustomerToken:/);
  assert.match(sessionBridge, /sessionRestoring/);
  assert.match(sessionBridge, /window\.LEKER_CUSTOMER/);
  assert.ok(
    customerHtml.indexOf('/customer-feedback-session-ready.js') < customerHtml.indexOf('/customer-feedback.js'),
    'session readiness bridge must load before customer feedback UI'
  );

  assert.doesNotThrow(() => new vm.Script(customerScript));
  assert.doesNotThrow(() => new vm.Script(sessionBridge));
  assert.doesNotThrow(() => new vm.Script(managementScript));
});

test('accepted feedback has both Admin Gerai and Owner management read surfaces', async () => {
  const [server, managementScript, branchAdminHtml, ownerHtml, adminHtml] = await Promise.all([
    readFile(new URL('../src/customer-feedback.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/management-customer-feedback.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/branch-admin.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/owner.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/admin.html', import.meta.url), 'utf8')
  ]);

  assert.match(server, /FROM customer_feedback_reports r/);
  assert.match(server, /if \(management\.admin\)[\s\S]*filters\.push\('r\.store_id = \?'\)/);
  assert.match(server, /pathname === '\/api\/admin\/customer-feedback'/);
  assert.match(managementScript, /tab\.textContent = 'Kotak Saran'/);
  assert.match(managementScript, /Komentar Customer · Semua Gerai/);
  assert.match(branchAdminHtml, /management-customer-feedback\.js/);
  assert.match(ownerHtml, /management-customer-feedback\.js/);
  assert.match(adminHtml, /management-customer-feedback\.js/);
});

test('feedback migration provides normalized report and issue facts with unique entitlement guards', async () => {
  const migration = await readFile(new URL('../migrations/0033_customer_feedback.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS customer_feedback_reports/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS customer_feedback_report_issues/);
  assert.match(migration, /entitlement_key TEXT NOT NULL UNIQUE/);
  assert.match(migration, /qualifying_sale_id/);
  assert.match(migration, /idx_customer_feedback_qualifying_sale/);
});

test('remote schema verifier requires both feedback tables, bounded runtime, and Wrangler JSON parsing', () => {
  assert.deepEqual(REQUIRED_REMOTE_TABLES, [
    'customer_feedback_reports',
    'customer_feedback_report_issues'
  ]);
  assert.equal(WRANGLER_SCHEMA_VERIFY_TIMEOUT_MS, 120000);

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
