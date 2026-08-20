import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'https://prototype-leker-v2.daily-napkin.workers.dev';
const MARKER_PREFIX = 'Karen production E2E';
const stores = [
  {
    code: 'G001',
    customers: [
      { username: 'fafa', password: 'fafa123' },
      { username: 'fufu', password: 'fufu123' }
    ]
  },
  {
    code: 'G002',
    customers: [
      { username: 'elkecepatan', password: 'cepat123' },
      { username: 'aurafarming', password: 'aura123' }
    ]
  }
];

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

async function customerLogin(username, password) {
  const { response, payload } = await jsonRequest('/api/auth/login', {
    method: 'POST',
    body: { username, password }
  });
  console.log(`customer login ${username}: HTTP ${response.status} role=${payload.role || '-'} error=${payload.error || '-'}`);
  if (!response.ok) return null;
  return payload;
}

async function ownerLogin() {
  const { response, payload } = await jsonRequest('/api/owner/login', {
    method: 'POST',
    body: { username: 'owner', password: '123456' }
  });
  console.log(`owner login: HTTP ${response.status} error=${payload.error || '-'}`);
  assert.equal(response.status, 200, `Prototype Owner must be able to login: ${JSON.stringify(payload)}`);
  assert.ok(payload.token, 'Prototype Owner login must return token');
  return payload.token;
}

async function managementInbox(storeCode, ownerToken) {
  const { response, payload } = await jsonRequest(`/api/admin/customer-feedback?store=${storeCode}`, {
    token: ownerToken
  });
  console.log(`Management inbox ${storeCode}: HTTP ${response.status} count=${Array.isArray(payload.feedback) ? payload.feedback.length : '-'}`);
  assert.equal(response.status, 200, `Management inbox ${storeCode} must return 200: ${JSON.stringify(payload)}`);
  assert.ok(Array.isArray(payload.feedback), `Management inbox ${storeCode} must return feedback array`);
  for (const item of payload.feedback.slice(0, 5)) {
    console.log(`INBOX_ITEM store=${storeCode} feedbackCode=${item.feedbackCode || '-'} createdAt=${item.createdAt || '-'} category=${item.category || '-'} reporter=${item.reporter?.username || item.reporter?.name || '-'} note=${JSON.stringify(String(item.manualNote || '').slice(0, 120))} issues=${(item.issues || []).map(issue => issue.code).join(',') || '-'}`);
  }
  return payload.feedback;
}

test('production customer feedback can be submitted by an entitled demo customer and read back by management', async () => {
  const ownerToken = await ownerLogin();
  const inboxByStore = new Map();

  for (const store of stores) {
    const feedback = await managementInbox(store.code, ownerToken);
    inboxByStore.set(store.code, feedback);
    const existing = feedback.find(item =>
      String(item.manualNote || '').startsWith(MARKER_PREFIX) &&
      Date.now() - Date.parse(item.createdAt || 0) < 24 * 60 * 60 * 1000
    );
    if (existing) {
      assert.ok(existing.feedbackCode);
      assert.ok(existing.reporter?.username, 'Management payload must expose reporter username');
      console.log(`E2E_EXISTING_PASS feedbackCode=${existing.feedbackCode} store=${store.code} customer=${existing.reporter.username}`);
      return;
    }
  }

  let chosen = null;
  for (const store of stores) {
    for (const customer of store.customers) {
      const session = await customerLogin(customer.username, customer.password);
      if (!session?.token || session.role !== 'CUSTOMER') continue;

      const { response, payload } = await jsonRequest(`/api/customer/feedback/access?store=${store.code}`, {
        token: session.token
      });
      console.log(`feedback access ${store.code}/${customer.username}: HTTP ${response.status} available=${payload.available ?? '-'} code=${payload.code || '-'}`);
      if (response.ok && payload.available === true) {
        chosen = { store, customer, token: session.token };
        break;
      }
    }
    if (chosen) break;
  }

  assert.ok(chosen, 'No seeded demo customer in G001 or G002 currently has feedback entitlement; fresh production submit is blocked without modifying business data.');

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

  console.log(`submit ${chosen.store.code}/${chosen.customer.username}: HTTP ${submitResponse.status} code=${submitPayload.feedbackCode || submitPayload.code || '-'} error=${submitPayload.error || '-'}`);
  assert.equal(submitResponse.status, 201, `Feedback submit must return 201: ${JSON.stringify(submitPayload)}`);
  assert.equal(submitPayload.ok, true);
  assert.ok(submitPayload.feedbackCode);
  console.log(`E2E_SUBMITTED feedbackCode=${submitPayload.feedbackCode} store=${chosen.store.code} customer=${chosen.customer.username}`);

  const feedback = await managementInbox(chosen.store.code, ownerToken);
  const received = feedback.find(item => item.feedbackCode === submitPayload.feedbackCode);
  assert.ok(received, `Management inbox must contain submitted feedback ${submitPayload.feedbackCode}`);
  assert.equal(received.manualNote, manualNote);
  assert.equal(received.reporter?.username, chosen.customer.username);
  assert.equal(received.store?.code, chosen.store.code);
  assert.equal(received.category, 'SERVICE');
  assert.ok(received.issues?.some(issue => issue.code === 'SERVICE_TOO_SLOW'));

  console.log(`E2E_PASS feedbackCode=${received.feedbackCode} store=${received.store.code} customer=${received.reporter.username}`);
});
