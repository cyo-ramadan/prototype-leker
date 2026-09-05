import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const uiEnhancement = readFileSync(new URL('../public/admin-accounting-journal-master-detail.js', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');

test('Accounting journal master-detail UX stays presentation-only and wired into branch admin', () => {
  assert.doesNotThrow(() => new Function(uiEnhancement));
  assert.match(adminHtml, /admin-accounting-journal-master-detail\.js/);
  assert.match(uiEnhancement, /data-journal-detail/);
  assert.match(uiEnhancement, /MutationObserver/);
  assert.match(uiEnhancement, /row\.tabIndex = 0/);
  assert.doesNotMatch(uiEnhancement, /\bfetch\s*\(/);
  assert.doesNotMatch(uiEnhancement, /\/api\//);
});

test('Journal detail renders in the shared admin modal, not a sticky side panel', () => {
  const workspace = readFileSync(new URL('../public/admin-accounting-workspace.js', import.meta.url), 'utf8');
  assert.match(workspace, /window\.openAdminDetailModal\(/);
  assert.doesNotMatch(workspace, /acctJournalDetail/);
  assert.doesNotMatch(uiEnhancement, /acct-journal-master-detail/);
  assert.doesNotMatch(uiEnhancement, /position:sticky/);
  assert.match(adminHtml, /admin-detail-modal\.js/);
});
