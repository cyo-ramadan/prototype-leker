import test from 'node:test';
import assert from 'node:assert/strict';
import { isNotificationEventMutation, queueNotificationEvent } from '../src/notification-events.js';
const req = (path, method = 'POST') => new Request('https://app.example' + path, { method });

test('only supported completed business mutation routes trigger notifications', () => {
  for (const [path, method] of [
    ['/api/cashier/employee-deposits/d1/payments', 'POST'],
    ['/api/admin/employee-deposits/payments/p1', 'PATCH'],
    ['/api/cashier/approval-requests', 'POST'],
    ['/api/cashier/approval-requests/stock-adjustment-batch', 'POST'],
    ['/api/management/approval-requests/a1', 'PATCH'],
    ['/api/management/approval-requests/session/s1', 'PATCH'],
    ['/api/admin/announcements', 'POST']
  ]) assert.equal(isNotificationEventMutation(req(path, method)), true, path);
  for (const [path, method] of [
    ['/api/cashier/sales', 'POST'], ['/api/notifications/read', 'POST'],
    ['/api/admin/announcements', 'GET'], ['/api/cashier/approval-requests', 'GET'],
    ['/api/management/approval-requests/a1/accounting-sync', 'POST'],
    ['/api/cashier/employee-deposits/d1/payments/proof', 'POST']
  ]) assert.equal(isNotificationEventMutation(req(path, method)), false, path);
});

test('mutation collection is scoped to authenticated store and entity', async () => {
  let scope; const received = [];
  const result = await queueNotificationEvent(req('/api/cashier/approval-requests?store=OTHER'), {}, {
    notificationActor: async () => ({ role: 'CASHIER', entityId: 'e1', storeId: 's1' }),
    resolveStore: async () => { throw new Error('cannot override authenticated store'); },
    listNotificationActors: async (_env, filter) => { scope = filter; return [{ key: 'ENTITY_ADMIN:a' }, { key: 'ADMIN:b' }]; },
    collectGeneralNotifications: async (_env, recipient) => received.push(recipient.key)
  });
  assert.deepEqual(scope, { entityId: 'e1', storeId: 's1' });
  assert.deepEqual(received, ['ENTITY_ADMIN:a', 'ADMIN:b']); assert.equal(result.actors, 2);
});

test('entity managers cannot use another entity store to fan out events', async () => {
  let listed = false;
  const result = await queueNotificationEvent(req('/api/admin/employee-deposits/payments/p1?store=OTHER', 'PATCH'), { DB: {} }, {
    notificationActor: async () => ({ role: 'ENTITY_ADMIN', entityId: 'e1' }),
    resolveStore: async () => ({ id: 's2', entityId: 'e2' }),
    listNotificationActors: async () => { listed = true; return []; }
  });
  assert.equal(listed, false); assert.equal(result.actors, 0);
});

test('entity announcements collect all entity stores, with failures isolated', async () => {
  let scope; const received = [];
  const result = await queueNotificationEvent(req('/api/admin/announcements?store=G001'), { DB: {} }, {
    notificationActor: async () => ({ role: 'OWNER' }),
    resolveStore: async () => ({ id: 's1', entityId: 'e1' }),
    listNotificationActors: async (_env, filter) => { scope = filter; return [{ key: 'ADMIN:a' }, { key: 'CASHIER:b' }]; },
    collectGeneralNotifications: async (_env, recipient) => { received.push(recipient.key); if (recipient.key === 'ADMIN:a') throw new Error('transient'); }
  });
  assert.deepEqual(scope, { entityId: 'e1', storeId: null });
  assert.deepEqual(received, ['ADMIN:a', 'CASHIER:b']); assert.equal(result.failed, 1);
});

test('unauthenticated requests never enumerate notification recipients', async () => {
  const result = await queueNotificationEvent(req('/api/cashier/approval-requests'), {}, {
    notificationActor: async () => null,
    listNotificationActors: async () => { throw new Error('must not list'); }
  });
  assert.equal(result.actors, 0);
});