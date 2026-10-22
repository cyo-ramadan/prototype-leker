import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export function validTenant(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(value || '')) throw new Error('Tenant tidak valid');
  return value;
}

export function normalizeMessage(raw) {
  const key = raw?.key;
  const jid = key?.remoteJid;
  if (!key?.id || key.fromMe || !jid || !/^[0-9]+@(s\.whatsapp\.net|lid)$/.test(jid)) return null;
  const m = raw.message;
  // Do not unwrap view-once, disappearing, protocol or reaction messages.
  if (!m || m.ephemeralMessage || m.viewOnceMessage || m.viewOnceMessageV2) return null;
  const mediaType = ['documentMessage', 'imageMessage', 'videoMessage', 'audioMessage'].find(k => m[k]);
  const media = mediaType ? m[mediaType] : null;
  const body = m.conversation ?? m.extendedTextMessage?.text ?? media?.caption ?? '';
  if (!media && !body) return null;
  const timestamp = Number(raw.messageTimestamp);
  return {
    id: String(key.id).slice(0, 200), jid, name: String(raw.pushName || '').slice(0, 150),
    body: String(body).slice(0, 65536), timestamp: Number.isFinite(timestamp) ? timestamp : 0,
    mediaType: mediaType || null, filename: String(media?.fileName || mediaType || '').slice(0, 200),
    mime: String(media?.mimetype || 'application/octet-stream').slice(0, 120)
  };
}

export class Archive {
  constructor(root, tenant) {
    this.tenant = validTenant(tenant);
    this.dir = join(root, this.tenant);
    mkdirSync(join(this.dir, 'media'), { recursive: true, mode: 0o700 });
    const keyPath = join(this.dir, 'session.key');
    try { this.secret = readFileSync(keyPath); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      this.secret = randomBytes(32);
      writeFileSync(keyPath, this.secret, { flag: 'wx', mode: 0o600 });
    }
    if (this.secret.length !== 32) throw new Error('Kunci sesi rusak');
    this.db = new DatabaseSync(join(this.dir, 'archive.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS auth (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, jid TEXT NOT NULL,
        name TEXT NOT NULL, body TEXT NOT NULL, timestamp INTEGER NOT NULL,
        received_at TEXT NOT NULL, media_type TEXT, filename TEXT, mime TEXT,
        media_status TEXT NOT NULL, media_path TEXT, media_sha256 TEXT, raw TEXT NOT NULL,
        UNIQUE(jid,id));`);
  }
  seal(value) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.secret, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  }
  open(value) {
    const b = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', this.secret, b.subarray(0,12));
    cipher.setAuthTag(b.subarray(12,28));
    return Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString('utf8');
  }
  authGet(key) { const row = this.db.prepare('SELECT value FROM auth WHERE key=?').get(key); return row ? this.open(row.value) : null; }
  authSet(key, value) {
    if (value === null) this.db.prepare('DELETE FROM auth WHERE key=?').run(key);
    else this.db.prepare('INSERT INTO auth VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, this.seal(value));
  }
  insert(message, raw) {
    const result = this.db.prepare(`INSERT OR IGNORE INTO messages
      (id,jid,name,body,timestamp,received_at,media_type,filename,mime,media_status,raw)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(message.id, message.jid, message.name, message.body,
      message.timestamp, new Date().toISOString(), message.mediaType, message.filename, message.mime,
      message.mediaType ? 'PENDING' : 'NONE', this.seal(raw));
    return result.changes ? Number(result.lastInsertRowid) : null;
  }
  list(before = Number.MAX_SAFE_INTEGER) {
    return this.db.prepare(`SELECT seq,id,jid,name,body,timestamp,received_at,media_type,filename,mime,media_status,media_sha256
      FROM messages WHERE seq<? ORDER BY seq DESC LIMIT 100`).all(before);
  }
  get(seq) { return this.db.prepare('SELECT * FROM messages WHERE seq=?').get(seq); }
  pending() { return this.db.prepare("SELECT seq FROM messages WHERE media_status='PENDING' LIMIT 100").all(); }
  media(seq, status, path = null, hash = null) {
    this.db.prepare('UPDATE messages SET media_status=?,media_path=?,media_sha256=? WHERE seq=?').run(status,path,hash,seq);
  }
  close() { this.db.close(); }
}
