import { createWriteStream } from 'node:fs';
import { Agent } from 'undici';
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import { normalizeMessage } from './store.mjs';

export function authState(archive, lib, isActive = () => true) {
  const parse = value => value ? JSON.parse(value, lib.BufferJSON.reviver) : null;
  const creds = parse(archive.authGet('creds')) || lib.initAuthCreds();
  return {
    state: { creds, keys: {
      get: async (type, ids) => Object.fromEntries(ids.map(id => {
        let value = parse(archive.authGet(`${type}:${id}`));
        if (type === 'app-state-sync-key' && value) value = lib.proto.Message.AppStateSyncKeyData.fromObject(value);
        return [id, value];
      })),
      set: async data => {
        if (!isActive()) return;
        archive.db.exec('BEGIN IMMEDIATE');
        try {
          for (const [type, values] of Object.entries(data)) for (const [id, value] of Object.entries(values))
            archive.authSet(`${type}:${id}`, value == null ? null : JSON.stringify(value, lib.BufferJSON.replacer));
          archive.db.exec('COMMIT');
        } catch (e) { archive.db.exec('ROLLBACK'); throw e; }
      }
    } },
    save: () => archive.authSet('creds', JSON.stringify(creds, lib.BufferJSON.replacer))
  };
}

export function validateMediaLocation(media) {
  if (media?.directPath && (typeof media.directPath !== 'string' || !media.directPath.startsWith('/') || media.directPath.includes('\\'))) throw new Error('MEDIA_LOCATION');
  if (media?.url) {
    const url = new URL(media.url);
    if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password ||
        !(url.hostname === 'mmg.whatsapp.net' || url.hostname.endsWith('.whatsapp.net'))) throw new Error('MEDIA_LOCATION');
  }
}
export class Connection {
  constructor(archive, changed = () => {}, dependencies = {}) {
    this.archive = archive; this.changed = changed; this.dependencies = dependencies;
    this.state = 'STOPPED'; this.qr = null; this.socket = null; this.generation = 0;
    this.attempt = 0; this.wanted = false; this.downloading = false; this.lastError = null;
  }
  snapshot() { return { tenant: this.archive.tenant, state: this.state, qr: this.qr, error: this.lastError, receiveOnly: true }; }
  notify() { this.changed(); }
  async start() {
    if (this.wanted) return;
    this.wanted = true; this.attempt = 0; this.lastError = null;
    await this.connect();
  }
  async connect() {
    const generation = ++this.generation;
    this.state = 'CONNECTING'; this.qr = null; this.notify();
    try {
      this.lib = this.dependencies.lib || await import('@whiskeysockets/baileys');
      const pino = this.dependencies.logger || (await import('pino')).default({ level: 'silent' });
      if (!this.wanted || generation !== this.generation) return;
      const auth = authState(this.archive, this.lib, () => this.wanted && this.generation === generation);
      const socket = this.lib.default({ auth: auth.state, logger: pino,
        markOnlineOnConnect: false, syncFullHistory: false, shouldSyncHistoryMessage: () => false,
        shouldIgnoreJid: jid => jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter'),
        getMessage: async () => undefined, enableAutoSessionRecreation: false
      });
      this.socket = socket;
      const current = () => this.wanted && this.generation === generation;
      socket.ev.on('creds.update', () => { if (current()) { try { auth.save(); } catch { this.fail('Gagal menyimpan sesi'); } } });
      socket.ev.on('connection.update', update => {
        if (!current()) return;
        if (update.qr) { this.qr = update.qr; this.state = 'SCAN_QR'; this.notify(); }
        if (update.connection === 'open') { this.state = 'CONNECTED'; this.qr = null; this.notify(); void this.drain(); }
        if (update.connection === 'close') {
          this.socket = null; this.qr = null;
          const code = update.lastDisconnect?.error?.output?.statusCode;
          if ([401,403,411,440,500].includes(code)) {
            this.wanted = false; this.state = 'NEEDS_ATTENTION'; this.lastError = `Koneksi dihentikan (${code}). Periksa WhatsApp di HP; tidak mencoba login berulang.`;
          } else if (++this.attempt > 5) {
            this.wanted = false; this.state = 'NEEDS_ATTENTION'; this.lastError = 'Lima percobaan koneksi gagal. Periksa jaringan lalu sambungkan manual.';
          } else {
            this.state = 'RECONNECTING';
            this.timer = setTimeout(() => { if (current()) void this.connect(); }, code === 515 ? 1000 : Math.min(60000, 2000 * 2 ** this.attempt));
          }
          this.notify();
        }
      });
      socket.ev.on('messages.upsert', event => {
        if (!current()) return;
        try {
          for (const raw of event.messages || []) {
            const message = normalizeMessage(raw);
            if (message) this.archive.insert(message, JSON.stringify(raw, this.lib.BufferJSON.replacer));
          }
          this.notify(); void this.drain();
        } catch { this.fail('Gagal menyimpan pesan. Periksa ruang disk dan izin folder data.'); }
      });
    } catch { this.fail('Koneksi gagal dimulai. Periksa instalasi dan jaringan.'); }
  }
  fail(message) { this.stop(); this.state = 'NEEDS_ATTENTION'; this.lastError = message; this.notify(); }
  stop() {
    this.wanted = false; ++this.generation; clearTimeout(this.timer);
    const socket = this.socket; this.socket = null; socket?.end(new Error('Local stop'));
    this.state = 'STOPPED'; this.qr = null; this.notify();
  }
  async drain() {
    if (this.downloading || this.state !== 'CONNECTED') return;
    this.downloading = true;
    try {
      while (this.state === 'CONNECTED') {
        const row = this.archive.pending()[0];
        if (!row) break;
        await this.download(row.seq);
      }
    } catch { this.fail('Gagal membaca arsip lampiran. Periksa ruang disk.'); } finally { this.downloading = false; }
  }
  async download(seq) {
    const row = this.archive.get(seq);
    const target = join(this.archive.dir, 'media', `${seq}.bin`), temporary = `${target}.part`;
    let stream, downloadTimer; const dispatcher = new Agent({ headersTimeout: 30000, bodyTimeout: 30000, connect: { timeout: 15000 } });
    try {
      const raw = JSON.parse(this.archive.open(row.raw), this.lib.BufferJSON.reviver);
      const media = raw.message[row.media_type];
      validateMediaLocation(media);
      if (Number(media?.fileLength) > 25 * 1024 * 1024) throw new Error('MEDIA_LIMIT');
      stream = await Promise.race([
        this.lib.downloadMediaMessage(raw, 'stream', { options: { dispatcher } }),
        new Promise((resolve, reject) => { downloadTimer = setTimeout(() => reject(new Error('MEDIA_TIMEOUT')), this.dependencies.mediaTimeoutMs || 30000); })
      ]);
      clearTimeout(downloadTimer);
      let total = 0; const hash = createHash('sha256');
      const limit = new Transform({ transform(chunk, encoding, callback) {
        total += chunk.length;
        if (total > 25 * 1024 * 1024) return callback(new Error('MEDIA_LIMIT'));
        hash.update(chunk); callback(null, chunk);
      } });
      await pipeline(stream, limit, createWriteStream(temporary, { flags: 'w', mode: 0o600 }), { signal: AbortSignal.timeout(60000) });
      await rename(temporary, target);
      this.archive.media(seq, 'SAVED', `${seq}.bin`, hash.digest('hex'));
    } catch (error) {
      stream?.destroy(); await rm(temporary, { force: true }).catch(() => {});
      this.archive.media(seq, error.message === 'MEDIA_LIMIT' ? 'TOO_LARGE' : 'FAILED');
    } finally { clearTimeout(downloadTimer); await dispatcher.destroy(); }
    this.notify();
  }
}
