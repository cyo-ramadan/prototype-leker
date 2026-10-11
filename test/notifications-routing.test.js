import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
class Statement {
  constructor(db, sql, params = []) { Object.assign(this, { db, sql, params }); }
  bind(...params) { return new Statement(this.db, this.sql, params); }
  async first() { return this.db.prepare(this.sql).get(...this.params) || null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  async run() { return { meta: { changes: Number(this.db.prepare(this.sql).run(...this.params).changes) } }; }
}
class DB {
  constructor(db) { this.db = db; }
  prepare(sql) { return new Statement(this.db, sql); }
  async batch(statements) {
    this.db.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.db.exec('COMMIT'); return results; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

test('Worker routes personal API before generic handlers; business write commits then notifies scoped recipients', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const dir = new URL('../migrations/', import.meta.url);
    for (const file of readdirSync(dir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()) db.exec(readFileSync(new URL(file, dir), 'utf8'));
    db.prepare("INSERT INTO entity_admins(id,entity_id,username,password_hash,display_name,is_active) VALUES('notif-routing','ENT-KPM','notif-routing','x','Uji notifikasi',1)").run();
    db.prepare("INSERT INTO entity_admin_sessions(token_hash,entity_admin_id,created_at,expires_at) VALUES(?,'notif-routing','2026-01-01','2099-01-01')").run(await hashCredential('routing-test-token'));
    const env = { DB: new DB(db) }; const pending = [];
    const call = (path, method = 'GET', body, token = 'routing-test-token') => worker.fetch(new Request('https://app.example' + path, {
      method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined
    }), env, { waitUntil: task => pending.push(task) });
    assert.equal((await call('/api/notifications', 'GET', null, '')).status, 401);
    const feed = await call('/api/notifications'); assert.equal(feed.status, 200); assert.equal((await feed.json()).actor.key, 'ENTITY_ADMIN:notif-routing');
    assert.equal(feed.headers.get('cache-control'), 'no-store');
    const pref = await call('/api/notifications/preferences', 'PATCH', { homePins: ['setoran', 'profit'] }); assert.equal(pref.status, 200);
    assert.deepEqual((await pref.json()).preferences.homePins, ['setoran', 'profit']);
    assert.equal(pending.length, 0);
    const rejected = await call('/api/admin/announcements?store=G001', 'POST', { title: 'Cannot cross entity', body: 'Denied' }); assert.equal(rejected.status, 403); assert.equal(pending.length, 0);
    const published = await call('/api/admin/announcements?store=MANDALA', 'POST', { title: 'Pengumuman uji lokal', body: 'Event setelah commit', entityWide: true });
    assert.equal(published.status, 201); const { id } = await published.json();
    assert.ok(db.prepare('SELECT id FROM announcements WHERE id=?').get(id)); assert.equal(pending.length, 1);
    await Promise.all(pending);
    const inbox = db.prepare("SELECT * FROM management_notifications WHERE recipient_key='ENTITY_ADMIN:notif-routing' AND kind='ANNOUNCEMENT'").all();
    assert.equal(inbox.filter(item => item.dedup_key === 'announcement:' + id).length, 1);
    assert.equal(inbox.find(item => item.dedup_key === 'announcement:' + id).entity_id, 'ENT-KPM');
    const pushKey = await call('/api/notifications/push-key'); assert.equal(pushKey.status, 200); assert.equal((await pushKey.json()).configured, false);
    assert.equal((await call('/api/notifications/live')).status, 426);
    assert.equal((await call('/api/notifications/live-ticket')).status, 503);
  } finally { db.close(); }
});