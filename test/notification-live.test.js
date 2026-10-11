import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NotificationLive, issueNotificationLiveTicket, handleNotificationLive } from '../src/notification-live.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE management_notification_tickets(token_hash TEXT PRIMARY KEY,recipient_key TEXT,expires_at TEXT,created_at TEXT)');
  const routes = [];
  const env = {
    DB: { prepare(sql) { return { bind(...args) { return {
      async run() { return db.prepare(sql).run(...args); },
      async first() { return db.prepare(sql).get(...args) || null; }
    }; } }; } },
    NOTIFICATION_LIVE: { idFromName(key) { return key; }, get(key) { return { async fetch(request) { routes.push({ key, request }); return new Response('upgraded'); } }; } }
  };
  return { env, db, routes };
}
const upgrade = (ticket, origin = 'https://example.org') => new Request('https://example.org/api/notifications/live?ticket=' + ticket, { headers: { Upgrade: 'websocket', Origin: origin } });

test('live ticket requires authenticated actor and stores only token hash', async () => {
  const { env, db } = fixture();
  assert.equal((await issueNotificationLiveTicket(env, null)).status, 401);
  const response = await issueNotificationLiveTicket(env, { key: 'ENTITY_ADMIN:a' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { ticket, expiresAt } = await response.json();
  assert.match(ticket, /^[a-f0-9]{64}$/);
  assert.ok(new Date(expiresAt).getTime() <= Date.now() + 60000);
  const row = db.prepare('SELECT * FROM management_notification_tickets').get();
  assert.notEqual(row.token_hash, ticket);
  assert.equal(row.recipient_key, 'ENTITY_ADMIN:a');
});

test('ticket is consumed once and routes only its authenticated recipient', async () => {
  const { env, routes } = fixture();
  const { ticket } = await (await issueNotificationLiveTicket(env, { key: 'ENTITY_ADMIN:alice' })).json();
  assert.equal((await handleNotificationLive(upgrade(ticket), env)).status, 200);
  assert.equal(routes[0].key, 'ENTITY_ADMIN:alice');
  assert.equal(new URL(routes[0].request.url).search, '');
  assert.equal((await handleNotificationLive(upgrade(ticket), env)).status, 401);
  assert.equal(routes.length, 1);
});

test('expired or cross-origin tickets cannot open a socket', async () => {
  const { env, db, routes } = fixture();
  const { ticket } = await (await issueNotificationLiveTicket(env, { key: 'ADMIN:a' })).json();
  assert.equal((await handleNotificationLive(upgrade(ticket, 'https://evil.test'), env)).status, 403);
  assert.equal((await handleNotificationLive(new Request('https://example.org/api/notifications/live?ticket=' + ticket), env)).status, 426);
  db.prepare('UPDATE management_notification_tickets SET expires_at=?').run(new Date(Date.now() - 1).toISOString());
  assert.equal((await handleNotificationLive(upgrade(ticket), env)).status, 401);
  assert.equal(routes.length, 0);
});

function socket(expiresAt) {
  return { sent: [], closed: [], deserializeAttachment() { return { expiresAt }; }, send(value) { this.sent.push(value); }, close(...value) { this.closed.push(value); } };
}

test('Durable Object broadcasts only invalidation with no financial or tenant content', async () => {
  const active = socket(Date.now() + 10000), expired = socket(Date.now() - 1);
  const ctx = { getWebSockets() { return [active, expired]; }, storage: { async setAlarm() {}, async deleteAlarm() {} } };
  const object = new NotificationLive(ctx, {});
  const response = await object.fetch(new Request('https://notification.internal/changed', { method: 'POST', body: JSON.stringify({ title: 'Profit', tenant: 'private' }) }));
  assert.equal(response.status, 204);
  assert.deepEqual(active.sent, ['{"type":"notifications-changed"}']);
  assert.deepEqual(expired.sent, []);
  assert.equal(expired.closed[0][0], 4001);
});

test('alarm closes expired sockets and schedules earliest remaining expiry', async () => {
  const old = socket(Date.now() - 100), next = socket(Date.now() + 10000), later = socket(Date.now() + 30000);
  let alarm;
  const object = new NotificationLive({ getWebSockets: () => [old, next, later], storage: { async setAlarm(value) { alarm = value; }, async deleteAlarm() { alarm = null; } } }, {});
  await object.alarm();
  assert.equal(old.closed[0][0], 4001);
  assert.equal(alarm, next.deserializeAttachment().expiresAt);
  await object.webSocketMessage(next, JSON.stringify({ type: 'broadcast', body: 'secret' }));
  assert.equal(next.sent.length, 0);
});

test('connection limits and unauthorized internal paths fail before creating sockets', async () => {
  const ctx = { getWebSockets: () => Array.from({ length: 5 }, () => socket(Date.now() + 10000)) };
  const object = new NotificationLive(ctx, {});
  const response = await object.fetch(new Request('https://notification.internal/connect', { headers: { Upgrade: 'websocket', 'X-Notification-Expires': String(Date.now() + 10000) } }));
  assert.equal(response.status, 429);
  assert.equal((await object.fetch(new Request('https://notification.internal/anything'))).status, 404);
});

test('unused live tickets are bounded per authenticated actor', async () => {
  const { env } = fixture();
  for (let i = 0; i < 10; i++) assert.equal((await issueNotificationLiveTicket(env, { key: 'ADMIN:a' })).status, 200);
  assert.equal((await issueNotificationLiveTicket(env, { key: 'ADMIN:a' })).status, 429);
  assert.equal((await issueNotificationLiveTicket(env, { key: 'ADMIN:b' })).status, 200);
});
