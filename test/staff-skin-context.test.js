import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const staffCode = readFileSync(new URL('../public/staff.js', import.meta.url), 'utf8');

test('staff recovers its theme from authenticated portal data after the initial profile finishes', async () => {
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', innerHTML: '', dataset: {}, style: {}, className: '',
      addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
      classList: { add() {}, remove() {}, toggle() {} } });
    return nodes.get(id);
  };
  let finishInitialProfile;
  const ready = new Promise(resolve => { finishInitialProfile = resolve; });
  let refreshes = 0;
  const window = { MaxiSkin: { ready, refresh() { refreshes++; } } };
  const requests = [];
  const context = {
    window, document: { getElementById: element, querySelectorAll: () => [] },
    location: { search: '', assign() {}, replace() {} }, localStorage: { getItem: () => null },
    URLSearchParams, Headers, FormData, URL, Intl, Date,
    fetch: async (url, options = {}) => {
      requests.push({ url, method: options.method || 'GET' });
      return { ok: true, json: async () => url === '/api/staff/portal'
        ? { staff: { employeeName: 'Fixture', store: { code: 'MANDALA' } }, attendance: [], attendanceStatus: 'out', payroll: [] }
        : {} };
    }
  };
  runInNewContext(staffCode, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(window.LEKER_STORE_CODE, 'MANDALA');
  assert.equal(refreshes, 0, 'do not reuse an in-flight profile from the old store');
  finishInitialProfile();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refreshes, 1);
  assert.ok(requests.length >= 5);
  assert.ok(requests.every(request => request.method === 'GET'), 'theme recovery must not write staff data');
});
