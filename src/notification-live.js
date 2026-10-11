// This per-recipient Durable Object is reachable only through the Worker binding.
// Legacy class shape keeps the module importable by the Node test suite.
export const LIVE_SESSION_MS = 15 * 60 * 1000;
const TICKET_MS = 60 * 1000;
const reply = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const hashTicket = async ticket => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ticket)))].map(n => n.toString(16).padStart(2, '0')).join('');
export const notificationLiveStub = (env, key) => env.NOTIFICATION_LIVE.get(env.NOTIFICATION_LIVE.idFromName(key));

export async function issueNotificationLiveTicket(env, actor) {
  if (!actor?.key) return reply({ error: 'Login diperlukan.' }, 401);
  if (!env.NOTIFICATION_LIVE) return reply({ error: 'Notifikasi langsung belum tersedia.' }, 503);
  const now = new Date().toISOString();
  const ticket = [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
  const expiresAt = new Date(Date.now() + TICKET_MS).toISOString();
  await env.DB.prepare('DELETE FROM management_notification_tickets WHERE expires_at <= ?').bind(now).run();
  const active = await env.DB.prepare('SELECT COUNT(*) AS total FROM management_notification_tickets WHERE recipient_key = ?').bind(actor.key).first();
  if (Number(active?.total) >= 10) return reply({ error: 'Terlalu banyak tiket aktif.' }, 429);
  await env.DB.prepare('INSERT INTO management_notification_tickets (token_hash, recipient_key, expires_at, created_at) VALUES (?, ?, ?, ?)').bind(await hashTicket(ticket), actor.key, expiresAt, now).run();
  return reply({ ticket, expiresAt });
}

export async function handleNotificationLive(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return reply({ error: 'WebSocket diperlukan.' }, 426);
  if (request.headers.get('Origin') !== url.origin) return reply({ error: 'Origin tidak diizinkan.' }, 403);
  if (!env.NOTIFICATION_LIVE) return reply({ error: 'Notifikasi langsung belum tersedia.' }, 503);
  const ticket = url.searchParams.get('ticket') || '';
  if (!/^[a-f0-9]{64}$/.test(ticket)) return reply({ error: 'Tiket tidak sah.' }, 401);
  const row = await env.DB.prepare('DELETE FROM management_notification_tickets WHERE token_hash = ? AND expires_at > ? RETURNING recipient_key').bind(await hashTicket(ticket), new Date().toISOString()).first();
  if (!row) return reply({ error: 'Tiket kedaluwarsa atau sudah dipakai.' }, 401);
  return notificationLiveStub(env, row.recipient_key).fetch(new Request('https://notification.internal/connect', {
    headers: { Upgrade: 'websocket', 'X-Notification-Expires': String(Date.now() + LIVE_SESSION_MS) }
  }));
}

export class NotificationLive {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/changed' && request.method === 'POST') {
      await this.expireConnections();
      for (const ws of this.ctx.getWebSockets()) {
        if ((ws.deserializeAttachment()?.expiresAt || 0) <= Date.now()) continue;
        try { ws.send('{"type":"notifications-changed"}'); } catch { try { ws.close(1011, 'Reconnect'); } catch {} }
      }
      return new Response(null, { status: 204 });
    }
    if (url.pathname !== '/connect' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response(null, { status: 404 });
    await this.expireConnections();
    if (this.ctx.getWebSockets().length >= 5) return reply({ error: 'Terlalu banyak sambungan.' }, 429);
    const expiresAt = Math.min(Number(request.headers.get('X-Notification-Expires')) || 0, Date.now() + LIVE_SESSION_MS);
    if (expiresAt <= Date.now()) return reply({ error: 'Sesi kedaluwarsa.' }, 401);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ expiresAt });
    await this.scheduleExpiry();
    return new Response(null, { status: 101, webSocket: client });
  }
  async expireConnections() {
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment()?.expiresAt || 0) <= Date.now()) { try { ws.close(4001, 'Login ulang sambungan'); } catch {} }
    }
  }
  async scheduleExpiry() {
    const times = this.ctx.getWebSockets().map(ws => ws.deserializeAttachment()?.expiresAt || 0).filter(time => time > Date.now());
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm() { await this.expireConnections(); await this.scheduleExpiry(); }
  async webSocketMessage(ws) {
    // Receive-only channel; clients cannot broadcast or request confidential data.
    if ((ws.deserializeAttachment()?.expiresAt || 0) <= Date.now()) ws.close(4001, 'Login ulang sambungan');
  }
  webSocketClose(ws, code) { try { ws.close(code, ''); } catch {} }
  webSocketError(ws) { try { ws.close(1011, 'Reconnect'); } catch {} }
}

