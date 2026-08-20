import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'https://prototype-leker-v2.daily-napkin.workers.dev';
const MARKER_PREFIX = 'Karen production E2E';
const store = {
  code: 'G001',
  admins: [
    { username: 'bablil', password: 'bablil123' },
    { username: 'kingluhut', password: 'luhut123' }
  ],
  customers: [
    { username: 'fafa', password: 'fafa123' },
    { username: 'fufu', password: 'fufu123' }
  ]
};

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
  console.log(`login ${username}: HTTP ${response.status} role=${payload.role || '-'} error=${payload.error || '-'}`);
  if (!response.ok) return null;
  return payload;
}

async function adminSession() {
  for (const admin of store.admins) {
    const session = await login(admin.username, admin.password);
    if (session?.token && session.role === 'ADMIN') return session;
  }
  assert.fail(`At least one seeded Admin demo ${store.code} must be able to login`);
}

async function adminInbox() {
  const session = await adminSession();
  const { response, payload } = await jsonRequest(`/api/admin/customer-feedback?store=${store.code}`, {
    token: session.token
  });
  console.log(`Admin inbox ${store.code}: HTTP ${response.status} count=${Array.isArray(payload.feedback) ? payload.feedback.length : '-'}`);
  assert.equal(response.status, 200, `Admin inbox ${store.code} must return 200: ${JSON.stringify(payload)}`);
  assert.ok(Array.isArray(payload.feedback), `Admin inbox ${store.code} must return feedback array`);
  return payload.feedback;
}

test('production customer feedback is readable from Admin Gerai inbox with reporter identity', async () => {
  // Reuse a recent proof from an earlier diagnostic attempt, if one already consumed the entitlement.
  const existingFeedback = await adminInbox();
  const existing = existingFeedback.find(item =>
    String(item.manualNote || '').startsWith(MARKER_PREFIX) &&
    Date.now() - Date.parse(item.createdAt || 0) < 24 * 60 * 60 * 1000
  );
  if (existing) {
    assert.ok(existing.feedbackCode);
    assert.ok(existing.reporter?.username, 'Admin payload must expose reporter username');
    console.log(`E2E_EXISTING_PASS feedbackCode=${existing.feedbackCode} store=${store.code} customer=${existing.reporter.username}`);
    return;
  }

  let chosen = null;
  for (const customer of store.customers) {
    const session = await login(customer.username, customer.password);
    if (!session?.token || session.role !== 'CUSTOMER') continue;

    const { response, payload } = await jsonRequest(`/api/customer/feedback/access?store=${store.code}`, {
      token: session.token
    });
    console.log(`feedback access ${store.code}/${customer.username}: HTTP ${response.status} available=${payload.available ?? '-'} code=${payload.code || '-'}`);
    if (response.ok && payload.available === true) {
      chosen = { customer, token: session.token };
      break;
    }
  }

  assert.ok(chosen, 'No seeded G001 demo customer currently has feedback entitlement; cannot create a fresh production feedback without modifying business data.');

  const manualNote = `${MARKER_PREFIX} ${new Date().toISOString()}`;
  const { response: submitResponse, payload: submitPayload } = await jsonRequest(
    `/api/customer/feedback?store=${store.code}`,
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

  console.log(`submit ${store.code}/${chosen.customer.username}: HTTP ${submitResponse.status} code=${submitPayload.feedbackCode || submitPayload.code || '-'} error=${submitPayload.error || '-'}`);
  assert.equal(submitResponse.status, 201, `Feedback submit must return 201: ${JSON.stringify(submitPayload)}`);
  assert.equal(submitPayload.ok, true);
  assert.ok(submitPayload.feedbackCode);
  console.log(`E2E_SUBMITTED feedbackCode=${submitPayload.feedbackCode} store=${store.code} customer=${chosen.customer.username}`);

  const feedback = await adminInbox();
  const received = feedback.find(item => item.feedbackCode === submitPayload.feedbackCode);
  assert.ok(received, `Admin inbox must contain submitted feedback ${submitPayload.feedbackCode}`);
  assert.equal(received.manualNote, manualNote);
  assert.equal(received.reporter?.username, chosen.customer.username);
  assert.equal(received.store?.code, store.code);
  assert.equal(received.category, 'SERVICE');
  assert.ok(received.issues?.some(issue => issue.code === 'SERVICE_TOO_SLOW'));

  console.log(`E2E_PASS feedbackCode=${received.feedbackCode} store=${received.store.code} customer=${received.reporter.username}`);
});
