import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'https://prototype-leker-v2.daily-napkin.workers.dev';
const MARKER_PREFIX = 'Karen production E2E';

async function jsonRequest(path, { method = 'GET', token = '', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function login(username, password) {
  const { response, payload } = await jsonRequest('/api/auth/login', {
    method: 'POST',
    body: { username, password }
  });
  if (!response.ok) return null;
  return payload;
}

const stores = [
  {
    code: 'G001',
    admin: { username: 'bablil', password: 'bablil123' },
    customers: [
      { username: 'fafa', password: 'fafa123' },
      { username: 'fufu', password: 'fufu123' }
    ]
  },
  {
    code: 'G002',
    admin: { username: 'lordrizz', password: 'rizz123' },
    customers: [
      { username: 'elkecepatan', password: 'cepat123' },
      { username: 'aurafarming', password: 'aura123' }
    ]
  }
];

async function adminInbox(store) {
  const adminSession = await login(store.admin.username, store.admin.password);
  assert.ok(adminSession?.token, `Admin demo ${store.code} must be able to login`);
  assert.equal(adminSession.role, 'ADMIN');

  const { response, payload } = await jsonRequest(`/api/admin/customer-feedback?store=${store.code}`, {
    token: adminSession.token
  });
  assert.equal(response.status, 200, `Admin inbox ${store.code} must return 200`);
  assert.ok(Array.isArray(payload.feedback), `Admin inbox ${store.code} must return feedback array`);
  return payload.feedback;
}

test('production customer feedback is readable from Admin Gerai inbox with reporter identity', async () => {
  // A previous push of this same diagnostic branch may already have executed the smoke path.
  // Reuse that fresh proof instead of consuming another monthly feedback entitlement.
  for (const store of stores) {
    const feedback = await adminInbox(store);
    const existing = feedback.find(item =>
      String(item.manualNote || '').startsWith(MARKER_PREFIX) &&
      Date.now() - Date.parse(item.createdAt || 0) < 60 * 60 * 1000
    );
    if (existing) {
      assert.ok(existing.feedbackCode);
      assert.ok(existing.reporter?.username, 'Admin payload must expose reporter username');
      console.log(`E2E_EXISTING_PASS feedbackCode=${existing.feedbackCode} store=${store.code} customer=${existing.reporter.username}`);
      return;
    }
  }

  let chosen = null;
  for (const store of stores) {
    for (const customer of store.customers) {
      const session = await login(customer.username, customer.password);
      if (!session?.token || session.role !== 'CUSTOMER') continue;

      const { response, payload } = await jsonRequest(`/api/customer/feedback/access?store=${store.code}`, {
        token: session.token
      });
      console.log(`feedback access ${store.code}/${customer.username}: HTTP ${response.status}`);
      if (response.ok && payload.available === true) {
        chosen = { store, customer, token: session.token };
        break;
      }
    }
    if (chosen) break;
  }

  assert.ok(chosen, 'At least one seeded demo customer must have feedback entitlement for production E2E');

  const manualNote = `${MARKER_PREFIX} ${new Date().toISOString()}`;
  const { response: submitResponse, payload: submitPayload } = await jsonRequest(
    `/api/customer/feedback?store=${chosen.store.code}`,
    {
      method: 'POST',
      token: chosen.token,
      body: {
        category: 'SERVICE',
        issues: ['SERVICE_TOO_SLOW'],
        manualNote
      }
    }
  );

  assert.equal(submitResponse.status, 201, `Feedback submit must return 201: ${JSON.stringify(submitPayload)}`);
  assert.equal(submitPayload.ok, true);
  assert.ok(submitPayload.feedbackCode);
  console.log(`E2E_SUBMITTED feedbackCode=${submitPayload.feedbackCode} store=${chosen.store.code} customer=${chosen.customer.username}`);

  const feedback = await adminInbox(chosen.store);
  const received = feedback.find(item => item.feedbackCode === submitPayload.feedbackCode);
  assert.ok(received, `Admin inbox must contain submitted feedback ${submitPayload.feedbackCode}`);
  assert.equal(received.manualNote, manualNote);
  assert.equal(received.reporter?.username, chosen.customer.username);
  assert.equal(received.store?.code, chosen.store.code);
  assert.equal(received.category, 'SERVICE');
  assert.ok(received.issues?.some(issue => issue.code === 'SERVICE_TOO_SLOW'));

  console.log(`E2E_PASS feedbackCode=${received.feedbackCode} store=${received.store.code} customer=${received.reporter.username}`);
});
