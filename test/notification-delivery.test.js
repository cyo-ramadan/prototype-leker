import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildPushPayload } from '@block65/webcrypto-web-push';
import { deliverNotification, flushNotificationDeliveries, genericPushMessage, handleNotificationDeliveryApi, notificationPushConfigured, resolveNotificationPushStoreCode, validPushEndpoint, validatePushSubscription } from '../src/notification-delivery.js';

const key = bytes => Buffer.from(bytes).toString('base64url');
async function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE management_push_subscriptions(id TEXT PRIMARY KEY,recipient_key TEXT,endpoint TEXT UNIQUE,subscription_json TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE management_user_preferences(recipient_key TEXT PRIMARY KEY,push_enabled INTEGER,sound_enabled INTEGER);
    CREATE TABLE management_notification_push_outbox(id TEXT PRIMARY KEY,notification_id TEXT,recipient_key TEXT,attempts INTEGER,next_attempt_at TEXT,created_at TEXT,UNIQUE(notification_id,recipient_key));`);
  const DB = { prepare(sql) { return { bind(...args) { return {
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; }
  }; } }; } };
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const env = { DB, VAPID_PUBLIC_KEY: key(await crypto.subtle.exportKey('raw', pair.publicKey)), VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: 'mailto:test@example.org' };
  const subPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-device', keys: { p256dh: key(await crypto.subtle.exportKey('raw', subPair.publicKey)), auth: key(crypto.getRandomValues(new Uint8Array(16))) } };
  return { db, env, subscription };
}
const actor = { key: 'ENTITY_ADMIN:alice', role: 'ENTITY_ADMIN' };
const api = (env, method, body, identity = actor) => handleNotificationDeliveryApi(new Request('https://example.org/api/notifications/subscriptions', { method, body: JSON.stringify(body) }), env, '/api/notifications/subscriptions', identity);

 test('allowlists push services without allowing local/private URLs or lookalike hosts', () => {
  for (const value of ['https://fcm.googleapis.com/fcm/send/a', 'https://updates.push.services.mozilla.com/wpush/v2/a', 'https://web.push.apple.com/a', 'https://wns2-db5p.notify.windows.com/a']) assert.equal(validPushEndpoint(value), true, value);
  for (const value of ['http://fcm.googleapis.com/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://169.254.169.254/', 'https://[::1]/', 'https://fcm.googleapis.com.evil.test/a', 'https://evilnotify.windows.com/a', 'https://user@fcm.googleapis.com/a', 'https://fcm.googleapis.com:8443/a', 'https://fcm.googleapis.com/a#redirect', 'https://evil.test']) assert.equal(validPushEndpoint(value), false, value);
});

test('validates real curve keys and rejects malformed base64 or wrong key lengths', async () => {
  const { subscription } = await fixture();
  assert.equal((await validatePushSubscription(subscription)).endpoint, subscription.endpoint);
  for (const p256dh of ['!', 'AAAA', key(new Uint8Array(65).fill(4))]) await assert.rejects(validatePushSubscription({ ...subscription, keys: { ...subscription.keys, p256dh } }));
  await assert.rejects(validatePushSubscription({ ...subscription, keys: { ...subscription.keys, auth: 'AAAA' } }));
});

test('push payload uses library encryption and does not expose confidential values', async () => {
  const { env, subscription } = await fixture();
  assert.equal(notificationPushConfigured(env), true);
  assert.equal(notificationPushConfigured({}), false);
  const generic = genericPushMessage(actor.key, { id: 'n1', title: 'Profit 100000000', body: 'tenant secret', url: 'https://evil.test/' }, false);
  assert.deepEqual(generic, { title: 'Notifikasi MAXI', body: 'Ada pemberitahuan baru. Buka aplikasi untuk melihatnya.', url: '/entity-admin', tag: 'n1', silent: true });
  const payload = await buildPushPayload({ data: generic }, subscription, { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT });
  assert.equal(payload.headers['content-encoding'], 'aes128gcm');
  assert.match(payload.headers.authorization, /^vapid /);
  assert.equal(new Uint8Array(payload.body).byteLength, 4096);
  assert.equal(Buffer.from(payload.body).includes(Buffer.from('Notifikasi MAXI')), false);
});

test('subscription registration binds authenticated recipient and delete cannot remove another user device', async () => {
  const { env, subscription, db } = await fixture();
  assert.equal((await api(env, 'POST', { subscription, recipientKey: 'OWNER:forged' })).status, 201);
  assert.equal(db.prepare('SELECT recipient_key FROM management_push_subscriptions').get().recipient_key, actor.key);
  await api(env, 'DELETE', { endpoint: subscription.endpoint }, { key: 'ENTITY_ADMIN:bob' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM management_push_subscriptions').get().n, 1);
  await api(env, 'DELETE', { endpoint: subscription.endpoint });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM management_push_subscriptions').get().n, 0);
  assert.equal((await api(env, 'POST', subscription, null)).status, 401);
});

test('delivery isolates subscriber, removes expired endpoint and uses generic encrypted payload', async t => {
  const { env, subscription, db } = await fixture();
  await api(env, 'POST', subscription);
  const other = { ...subscription, endpoint: 'https://fcm.googleapis.com/fcm/send/other' };
  await api(env, 'POST', other, { key: 'ENTITY_ADMIN:bob' });
  db.prepare('INSERT INTO management_user_preferences VALUES (?,1,0)').run(actor.key);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.equal(url, subscription.endpoint);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    assert.equal(new Uint8Array(options.body).length, 4096);
    return new Response(null, { status: 410 });
  });
  await deliverNotification(env, { recipientKey: actor.key, notification: { id: 'n1', title: 'Confidential' } });
  assert.equal(calls, 1);
  assert.equal(db.prepare('SELECT recipient_key FROM management_push_subscriptions').get().recipient_key, 'ENTITY_ADMIN:bob');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM management_notification_push_outbox').get().n, 0);
});

test('transient push failures persist retry and eventual success clears it', async t => {
  const { env, subscription, db } = await fixture();
  await api(env, 'POST', subscription);
  db.prepare('INSERT INTO management_user_preferences VALUES (?,1,1)').run(actor.key);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: ++calls === 1 ? 503 : 201 }));
  await deliverNotification(env, { recipientKey: actor.key, notification: { id: 'n2' } });
  assert.equal(db.prepare('SELECT attempts FROM management_notification_push_outbox').get().attempts, 1);
  await flushNotificationDeliveries(env, new Date(Date.now() + 3600000));
  assert.equal(calls, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM management_notification_push_outbox').get().n, 0);
});

test('delivery failure cannot change committed transaction and opt-out sends nothing', async t => {
  const { env, subscription, db } = await fixture();
  await api(env, 'POST', subscription);
  db.prepare('INSERT INTO management_user_preferences VALUES (?,0,1)').run(actor.key);
  t.mock.method(globalThis, 'fetch', () => assert.fail('push disabled'));
  await assert.doesNotReject(deliverNotification(env, { recipientKey: actor.key, notification: { id: 'n3' } }));
  await assert.doesNotReject(deliverNotification({ DB: { prepare() { throw new Error('DB offline'); } } }, { recipientKey: actor.key, notification: { id: 'n4' } }));
});

test('VAPID helper exports matching WebCrypto key pair and requires explicit secret pipe mode', async () => {
  const { generateNotificationPushSecrets, runSetupNotificationPush } = await import('../scripts/setup-notification-push.mjs');
  const secrets = await generateNotificationPushSecrets('mailto:test@example.org');
  assert.equal(secrets.VAPID_PUBLIC_KEY.length, 87);
  assert.equal(secrets.VAPID_PRIVATE_KEY.length, 43);
  assert.equal(notificationPushConfigured(secrets), true);
  const { subscription } = await fixture();
  await assert.doesNotReject(buildPushPayload({ data: 'test' }, subscription, { publicKey: secrets.VAPID_PUBLIC_KEY, privateKey: secrets.VAPID_PRIVATE_KEY, subject: secrets.VAPID_SUBJECT }));
  let output = '', errors = '';
  const io = { stdout: { isTTY: false, write(value) { output += value; } }, stderr: { write(value) { errors += value; } } };
  assert.equal(await runSetupNotificationPush([], io), 1);
  assert.equal(output, '');
  assert.ok(errors.includes('Tanpa --json'));
  assert.equal(await runSetupNotificationPush(['--json', '--subject', 'mailto:test@example.org'], { ...io, stdout: { isTTY: true, write() { assert.fail('must not print a private key to terminal'); } } }), 1);
});

test('delivery consumes an outbox entry already atomically queued with the inbox', async t => {
  const { env, subscription, db } = await fixture();
  await api(env, 'POST', subscription);
  db.prepare('INSERT INTO management_user_preferences VALUES (?,1,1)').run(actor.key);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO management_notification_push_outbox VALUES (?,?,?,?,?,?)').run('prequeued', 'n5', actor.key, 0, now, now);
  let sent = 0;
  t.mock.method(globalThis, 'fetch', async () => { sent++; return new Response(null, { status: 201 }); });
  await deliverNotification(env, { recipientKey: actor.key, notification: { id: 'n5' } });
  assert.equal(sent, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM management_notification_push_outbox').get().n, 0);
});

test('invalid JSON values fail cleanly before subscription database mutation', async () => {
  const { env } = await fixture();
  for (const input of [null, [], 'invalid']) assert.equal((await api(env, 'DELETE', input)).status, 400);
});


test('ADMIN push opens only the recipient active store, never unscoped or notification-supplied store', async t => {
  const { env, db, subscription } = await fixture();
  db.exec(`CREATE TABLE stores(id TEXT PRIMARY KEY,code TEXT,is_active INTEGER);
    CREATE TABLE store_admins(id TEXT PRIMARY KEY,store_id TEXT,is_active INTEGER);
    INSERT INTO stores VALUES ('store-a','STORE_A',1),('store-b','STORE_B',1);
    INSERT INTO store_admins VALUES ('admin-a','store-a',1),('admin-b','store-b',1);`);
  const admin = { key: 'ADMIN:admin-b' };
  const notification = { id: 'admin-n1', title: 'Profit 100000000', body: 'private name', url: '/s/STORE_A/admin' };
  const storeCode = await resolveNotificationPushStoreCode(env, admin.key);
  const message = genericPushMessage(admin.key, notification, true, storeCode);
  assert.equal(message.url, '/s/STORE_B/admin');
  assert.equal(message.title, 'Notifikasi MAXI');
  assert.equal(message.body.includes('private name'), false);
  assert.equal(genericPushMessage(admin.key, notification, true).url, '/login');
  assert.equal(genericPushMessage(admin.key, notification, true, 'B code').url, '/s/B%20code/admin');
  await api(env, 'POST', subscription, admin);
  db.prepare('INSERT INTO management_user_preferences VALUES (?,1,1)').run(admin.key);
  let membershipReads = 0, calls = 0;
  const prepare = env.DB.prepare.bind(env.DB);
  t.mock.method(env.DB, 'prepare', sql => {
    if (sql.includes('FROM store_admins a')) membershipReads++;
    return prepare(sql);
  });
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(null, { status: 201 }); });
  await deliverNotification(env, { recipientKey: admin.key, notification });
  assert.equal(membershipReads, 1);
  assert.equal(calls, 1);
});

test('ADMIN push goes to login if recipient admin or store is missing or inactive', async () => {
  const { env, db } = await fixture();
  db.exec(`CREATE TABLE stores(id TEXT PRIMARY KEY,code TEXT,is_active INTEGER);
    CREATE TABLE store_admins(id TEXT PRIMARY KEY,store_id TEXT,is_active INTEGER);
    INSERT INTO stores VALUES ('active','STORE_B',1),('inactive','STORE_C',0);
    INSERT INTO store_admins VALUES ('off','active',0),('off-store','inactive',1),('missing-store','absent',1);`);
  for (const id of ['missing', 'off', 'off-store', 'missing-store']) {
    const recipientKey = 'ADMIN:' + id;
    const storeCode = await resolveNotificationPushStoreCode(env, recipientKey);
    assert.equal(storeCode, null);
    assert.equal(genericPushMessage(recipientKey, { id: 'n', url: '/branch-admin' }, true, storeCode).url, '/login');
  }
  for (const [role, url] of [['OWNER', '/admin'], ['ENTITY_ADMIN', '/entity-admin'], ['CASHIER', '/staff']]) {
    assert.equal(await resolveNotificationPushStoreCode(env, role + ':someone'), null);
    assert.equal(genericPushMessage(role + ':someone', { id: 'n' }, true).url, url);
  }
});
