import { buildPushPayload } from '@block65/webcrypto-web-push';
import { issueNotificationLiveTicket, notificationLiveStub } from './notification-live.js';

const reply = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const canonicalPage = key => ({ OWNER: '/admin', ENTITY_ADMIN: '/entity-admin', ADMIN: '/login', CASHIER: '/staff' })[String(key).split(':')[0]] || '/login';
const base64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
function decodeKey(value, size) {
  if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) throw new Error('Kunci push tidak sah.');
  let bytes;
  try { bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); } catch { throw new Error('Kunci push tidak sah.'); }
  if (bytes.length !== size || base64(bytes) !== value.replace(/=+$/, '')) throw new Error('Kunci push tidak sah.');
  return bytes;
}

export function validPushEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
    const host = url.hostname.toLowerCase();
    return host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com'
      || host === 'push.services.mozilla.com' || host.endsWith('.push.services.mozilla.com')
      || host === 'web.push.apple.com' || host.endsWith('.web.push.apple.com')
      || host === 'notify.windows.com' || host.endsWith('.notify.windows.com');
  } catch { return false; }
}

export async function validatePushSubscription(value) {
  if (!value || !validPushEndpoint(value.endpoint)) throw new Error('Layanan push tidak didukung.');
  const publicKey = decodeKey(value.keys?.p256dh, 65);
  if (publicKey[0] !== 4) throw new Error('Kunci push tidak sah.');
  decodeKey(value.keys?.auth, 16);
  try { await crypto.subtle.importKey('raw', publicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []); } catch { throw new Error('Kunci push tidak sah.'); }
  return { endpoint: value.endpoint, expirationTime: null, keys: { p256dh: value.keys.p256dh.replace(/=+$/, ''), auth: value.keys.auth.replace(/=+$/, '') } };
}

export function notificationPushConfigured(env) {
  try {
    decodeKey(env.VAPID_PUBLIC_KEY, 65); decodeKey(env.VAPID_PRIVATE_KEY, 32);
    const subject = new URL(env.VAPID_SUBJECT);
    return subject.protocol === 'mailto:' || (subject.protocol === 'https:' && !subject.username && !subject.password);
  } catch { return false; }
}

async function requestBody(request) {
  if (Number(request.headers.get('Content-Length')) > 8192) throw new Error('Permintaan terlalu besar.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Permintaan kosong.');
  const chunks = []; let length = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.length;
    if (length > 8192) { await reader.cancel(); throw new Error('Permintaan terlalu besar.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function handleNotificationDeliveryApi(request, env, pathname, actor) {
  if (!actor?.key) return reply({ error: 'Login diperlukan.' }, 401);
  if (pathname === '/api/notifications/push-key' && request.method === 'GET') {
    const configured = notificationPushConfigured(env);
    return reply({ publicKey: configured ? env.VAPID_PUBLIC_KEY : null, configured });
  }
  if (pathname === '/api/notifications/live-ticket' && request.method === 'GET') return issueNotificationLiveTicket(env, actor);
  if (pathname !== '/api/notifications/subscriptions') return null;
  if (!['POST', 'DELETE'].includes(request.method)) return reply({ error: 'Metode tidak didukung.' }, 405);
  let input;
  try { input = await requestBody(request); } catch { return reply({ error: 'Permintaan tidak sah atau terlalu besar.' }, 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return reply({ error: 'Permintaan tidak sah.' }, 400);
  if (request.method === 'DELETE') {
    if (!validPushEndpoint(input.endpoint)) return reply({ error: 'Endpoint tidak sah.' }, 400);
    await env.DB.prepare('DELETE FROM management_push_subscriptions WHERE recipient_key = ? AND endpoint = ?').bind(actor.key, input.endpoint).run();
    return reply({ ok: true });
  }
  if (!notificationPushConfigured(env)) return reply({ error: 'Push HP belum dikonfigurasi.' }, 503);
  let subscription;
  try { subscription = await validatePushSubscription(input.subscription || input); } catch (error) { return reply({ error: error.message }, 400); }
  const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM management_push_subscriptions WHERE recipient_key = ? AND endpoint != ?').bind(actor.key, subscription.endpoint).first();
  if (Number(count?.total) >= 10) return reply({ error: 'Maksimal 10 perangkat per pengguna.' }, 409);
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO management_push_subscriptions (id,recipient_key,endpoint,subscription_json,created_at,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET recipient_key=excluded.recipient_key,subscription_json=excluded.subscription_json,updated_at=excluded.updated_at`).bind(crypto.randomUUID(), actor.key, subscription.endpoint, JSON.stringify(subscription), now, now).run();
  return reply({ ok: true }, 201);
}

export async function resolveNotificationPushStoreCode(env, recipientKey) {
  if (!String(recipientKey).startsWith('ADMIN:')) return null;
  const row = await env.DB.prepare(`SELECT s.code FROM store_admins a
    JOIN stores s ON s.id = a.store_id
    WHERE a.id = ? AND a.is_active = 1 AND s.is_active = 1 LIMIT 1`).bind(recipientKey.slice('ADMIN:'.length)).first();
  return typeof row?.code === 'string' && row.code && !['.', '..'].includes(row.code) ? row.code : null;
}

export function genericPushMessage(recipientKey, notification, soundEnabled, trustedStoreCode = null) {
  // This optional code comes only from the recipient's active database membership.
  // Notification URLs and client data must never choose another store's workspace.
  const url = String(recipientKey).startsWith('ADMIN:') && trustedStoreCode
    ? `/s/${encodeURIComponent(trustedStoreCode)}/admin` : canonicalPage(recipientKey);
  return { title: 'Notifikasi MAXI', body: 'Ada pemberitahuan baru. Buka aplikasi untuk melihatnya.', url, tag: String(notification.id), silent: !soundEnabled };
}

async function sendPushForRecipient(env, recipientKey, notification) {
  const preferences = await env.DB.prepare('SELECT push_enabled,sound_enabled FROM management_user_preferences WHERE recipient_key = ?').bind(recipientKey).first();
  if (!preferences?.push_enabled || !notificationPushConfigured(env)) return { retry: false };
  const rows = await env.DB.prepare('SELECT id,endpoint,subscription_json FROM management_push_subscriptions WHERE recipient_key = ? ORDER BY created_at LIMIT 10').bind(recipientKey).all();
  const trustedStoreCode = await resolveNotificationPushStoreCode(env, recipientKey);
  let retry = false;
  await Promise.all((rows.results || []).map(async row => {
    let subscription;
    try { subscription = await validatePushSubscription(JSON.parse(row.subscription_json)); } catch { return; }
    if (subscription.endpoint !== row.endpoint) return;
    try {
      const payload = await buildPushPayload({ data: genericPushMessage(recipientKey, notification, !!preferences.sound_enabled, trustedStoreCode), options: { ttl: 300, urgency: 'normal' } }, subscription, { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT });
      const response = await fetch(subscription.endpoint, { ...payload, redirect: 'error', signal: AbortSignal.timeout(8000) });
      if (response.status === 404 || response.status === 410) {
        await env.DB.prepare('DELETE FROM management_push_subscriptions WHERE id = ? AND recipient_key = ?').bind(row.id, recipientKey).run();
      } else if (response.status === 429 || response.status >= 500) retry = true;
      await response.body?.cancel();
    } catch { retry = true; }
  }));
  return { retry };
}

async function processOutboxRow(env, row) {
  const result = await sendPushForRecipient(env, row.recipient_key, { id: row.notification_id });
  const attempts = Number(row.attempts) + 1;
  if (!result.retry || attempts >= 6) {
    await env.DB.prepare('DELETE FROM management_notification_push_outbox WHERE id = ?').bind(row.id).run();
  } else {
    const next = new Date(Date.now() + Math.min(60, 5 * 2 ** (attempts - 1)) * 60_000).toISOString();
    await env.DB.prepare('UPDATE management_notification_push_outbox SET attempts = ?,next_attempt_at = ? WHERE id = ?').bind(attempts, next, row.id).run();
  }
}

export async function deliverNotification(env, { recipientKey, notification, deferPush = false }) {
  // Inbox already committed: delivery never changes the business transaction result.
  try {
    if (env.NOTIFICATION_LIVE) await notificationLiveStub(env, recipientKey).fetch(new Request('https://notification.internal/changed', { method: 'POST' }));
  } catch {}
  if (deferPush) return; // Core has atomically queued push for the scheduled handler.
  try {
    const now = new Date().toISOString();
    const row = { id: crypto.randomUUID(), notification_id: notification.id, recipient_key: recipientKey, attempts: 0 };
    await env.DB.prepare('INSERT OR IGNORE INTO management_notification_push_outbox (id,notification_id,recipient_key,attempts,next_attempt_at,created_at) VALUES (?,?,?,0,?,?)').bind(row.id, notification.id, recipientKey, now, now).run();
    // Core may have atomically queued this alongside the inbox insert.
    const pending = await env.DB.prepare('SELECT id,notification_id,recipient_key,attempts FROM management_notification_push_outbox WHERE notification_id = ? AND recipient_key = ? AND next_attempt_at <= ?').bind(notification.id, recipientKey, now).first();
    if (pending) await processOutboxRow(env, pending);
  } catch {}
}

export async function flushNotificationDeliveries(env, now = new Date()) {
  try {
    const rows = await env.DB.prepare('SELECT id,notification_id,recipient_key,attempts FROM management_notification_push_outbox WHERE next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 20').bind(new Date(now).toISOString()).all();
    for (const row of rows.results || []) { try { await processOutboxRow(env, row); } catch {} }
    return { processed: rows.results?.length || 0 };
  } catch { return { processed: 0 }; }
}
export const drainNotificationPushOutbox = flushNotificationDeliveries;



