import { json, readJson } from './http.js';
import { ownerFromRequest, entityAdminFromRequest, storeAdminFromRequest } from './owner-auth.js';
import { requireCashier } from './cashier-auth.js';
import { getJakartaBusinessDate, getJakartaTimeOfDay, timeOfDayToMinutes, jakartaWallClockToUtc } from './time.js';
import { deliverNotification } from './notification-delivery.js';

export const NOTIFICATION_PINS = [
  { id: 'profit', tab: 'reports', label: 'Laporan', description: 'Tampilkan isi menu Laporan yang sudah ada, termasuk laporan profit.' },
  { id: 'setoran', tab: 'setorancs', label: 'Setoran CS', description: 'Tampilkan menu Setoran CS yang sudah ada untuk memeriksa dan ACC setoran.' },
  { id: 'drawerstatus', tab: 'drawerstatus', label: 'Status Laci', description: 'Tampilkan isi menu Status Laci yang sudah ada.' },
  { id: 'stores', tab: 'stores', label: 'Gerai', description: 'Tampilkan isi menu Gerai dan akses workspace gerai sesuai izin.' },
  { id: 'customers', tab: 'customers', label: 'Pelanggan', description: 'Tampilkan isi menu Pelanggan yang sudah ada.' },
  { id: 'ledger', tab: 'ledger', label: 'Buku Entity', description: 'Tampilkan isi menu Buku Entity yang sudah ada.' },
  { id: 'sharedaccounts', tab: 'sharedaccounts', label: 'Rekening Bersama', description: 'Tampilkan isi menu Rekening Bersama yang sudah ada.' },
  { id: 'productmasters', tab: 'productmasters', label: 'Master Barang', description: 'Tampilkan isi menu Master Barang yang sudah ada.' },
  { id: 'entityrecipes', tab: 'entityrecipes', label: 'Resep Produksi', description: 'Tampilkan isi menu Resep Produksi yang sudah ada.' },
  { id: 'entitystock', tab: 'entitystock', label: 'Stok Gerai', description: 'Tampilkan isi menu Stok Gerai yang sudah ada.' },
  { id: 'storereport', tab: 'storereport', label: 'Laporan Gerai', description: 'Tampilkan isi menu Laporan Gerai yang sudah ada.' },
  { id: 'employees', tab: 'employees', label: 'Karyawan', description: 'Tampilkan isi menu Karyawan yang sudah ada.' }
];
export const NOTIFICATION_CONDITIONS = [
  { id: 'STORE_NOT_OPEN', label: 'Gerai belum buka', description: 'Mulai waktu alarm, ingatkan gerai yang belum pernah membuka laci pada tanggal Jakarta hari ini. Laci yang kemudian ditutup tetap dihitung sudah buka; pengulangan berhenti setelah gerai dibuka.' },
  { id: 'DEPOSIT_PENDING', label: 'Setoran menunggu ACC', description: 'Ada setoran karyawan yang menunggu pemeriksaan pada waktu alarm.' },
  { id: 'APPROVAL_PENDING', label: 'Permintaan menunggu ACC', description: 'Ada permintaan persetujuan yang belum diputuskan pada waktu alarm.' },
  { id: 'REMINDER', label: 'Pengingat terjadwal', description: 'Kirim pesan pengingat pada hari dan jam yang dipilih.' }
];
const PINS = new Set(NOTIFICATION_PINS.map(pin => pin.id));
const CONDITIONS = new Set(NOTIFICATION_CONDITIONS.map(condition => condition.id));
const START_TABS = new Set(['home', 'settings', ...NOTIFICATION_PINS.map(pin => pin.tab)]);
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const rows = async (db, sql, ...params) => (await db.prepare(sql).bind(...params).all()).results ?? [];
const decode = (value, fallback = []) => { try { return JSON.parse(value); } catch { return fallback; } };
const manager = actor => actor.role === 'OWNER' || actor.role === 'ENTITY_ADMIN';
const actorRecord = (role, value, entityId = null, storeId = null) => ({ key: `${role}:${value.id}`, role, id: value.id, entityId, ...(storeId ? { storeId } : {}), label: value.displayName || value.employeeName || value.employee_name || value.label || value.username || value.id });

// Authentication, never body/query recipient identity, determines each personal inbox.
async function homeUrl(db, role, id, storeId = null) {
  if (role === 'CASHIER') return '/staff';
  if (role === 'ENTITY_ADMIN') return '/entity-admin';
  if (role === 'OWNER') return '/admin';
  const row = storeId
    ? await db.prepare('SELECT code FROM stores WHERE id=?').bind(storeId).first()
    : await db.prepare('SELECT s.code FROM store_admins a JOIN stores s ON s.id=a.store_id WHERE a.id=?').bind(id).first();
  return row ? `/s/${encodeURIComponent(row.code)}/admin` : '/login';
}

export async function notificationActor(request, env) {
  const db = env.DB;
  const owner = await ownerFromRequest(request, db);
  if (owner) {
    const entityId = new URL(request.url).searchParams.get('entityId');
    if (entityId && !await db.prepare("SELECT id FROM entities WHERE id = ? AND status = 'ACTIVE'").bind(entityId).first()) return null;
    return actorRecord('OWNER', owner, entityId || null);
  }
  const entityAdmin = await entityAdminFromRequest(request, db);
  if (entityAdmin) return actorRecord('ENTITY_ADMIN', entityAdmin, entityAdmin.entityId);
  const admin = await storeAdminFromRequest(request, db);
  if (admin) {
    const store = await db.prepare("SELECT s.entity_id FROM stores s JOIN entities e ON e.id=s.entity_id WHERE s.id=? AND e.status='ACTIVE'").bind(admin.store.id).first();
    return store ? actorRecord('ADMIN', admin, store.entity_id, admin.store.id) : null;
  }
  const auth = await requireCashier(request, db);
  if (!auth.ok || auth.readOnly || auth.cashier?.readOnly) return null;
  const store = await db.prepare("SELECT s.entity_id FROM stores s JOIN entities e ON e.id=s.entity_id WHERE s.id=? AND e.status='ACTIVE'").bind(auth.cashier.store.id).first();
  return store ? actorRecord('CASHIER', auth.cashier, store.entity_id, auth.cashier.store.id) : null;
}

export async function listNotificationActors(env, { entityId = null, storeId = null } = {}) {
  const db = env.DB;
  if (storeId && !entityId) {
    const store = await db.prepare('SELECT entity_id FROM stores WHERE id=? AND is_active=1').bind(storeId).first();
    if (!store) return [];
    entityId = store.entity_id;
  }
  const actors = [];
  // Global Owners may receive any entity event, but ordinary recipients remain scoped.
  for (const row of await rows(db, 'SELECT id,display_name AS label FROM owner_accounts WHERE is_active=1')) actors.push(actorRecord('OWNER', row, entityId));
  const entityFilter = entityId ? ' AND a.entity_id=?' : '';
  for (const row of await rows(db, "SELECT a.id,a.display_name AS label,a.entity_id FROM entity_admins a JOIN entities e ON e.id=a.entity_id WHERE a.is_active=1 AND e.status='ACTIVE'"+entityFilter,...(entityId?[entityId]:[]))) actors.push(actorRecord('ENTITY_ADMIN', row, row.entity_id));
  for (const [table, role, column] of [['store_admins', 'ADMIN', 'display_name'], ['cashiers', 'CASHIER', 'employee_name']]) {
    const filter = (entityId ? ' AND s.entity_id=?' : '')+(storeId ? ' AND s.id=?' : '');
    for (const row of await rows(db, `SELECT a.id,a.${column} AS label,a.store_id,s.entity_id FROM ${table} a JOIN stores s ON s.id=a.store_id JOIN entities e ON e.id=s.entity_id WHERE a.is_active=1 AND s.is_active=1 AND e.status='ACTIVE'${filter}`,...(entityId?[entityId]:[]),...(storeId?[storeId]:[]))) actors.push(actorRecord(role, row, row.entity_id, row.store_id));
  }
  return actors;
}

async function recipientsFor(db, entityId) {
  const recipients = [];
  for (const row of await rows(db, 'SELECT id,display_name AS label FROM entity_admins WHERE entity_id=? AND is_active=1 ORDER BY display_name', entityId)) recipients.push({ key: `ENTITY_ADMIN:${row.id}`, label: row.label, role: 'ENTITY_ADMIN' });
  for (const [table, role, label] of [['store_admins','ADMIN','display_name'], ['cashiers','CASHIER','employee_name']]) {
    for (const row of await rows(db, `SELECT a.id,a.${label} AS label,s.store_name FROM ${table} a JOIN stores s ON s.id=a.store_id WHERE s.entity_id=? AND s.is_active=1 AND a.is_active=1 ORDER BY a.${label}`, entityId)) recipients.push({ key: `${role}:${row.id}`, label: `${row.label} (${row.store_name})`, role });
  }
  return recipients;
}

function mapNotification(row) {
  return { id: row.id, title: row.title, body: row.body, url: row.url, kind: row.kind, createdAt: row.created_at, readAt: row.read_at };
}
export async function emitNotification(env, input) {
  const id = crypto.randomUUID();
  const createdAt = input.createdAt || new Date().toISOString();
  const url = /^\/(?![\/\\])/.test(input.url || '') ? input.url : '';
  const deliveryTime = new Date().toISOString();
  const [result] = await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO management_notifications
      (id,recipient_key,entity_id,store_id,dedup_key,title,body,url,kind,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, input.recipientKey, input.entityId ?? null, input.storeId ?? null, input.dedupKey, text(input.title, 160), text(input.body, 1000), url, text(input.kind, 60), createdAt),
    // Only the freshly inserted inbox id can enqueue. Ignored duplicate ids do not exist.
    env.DB.prepare(`INSERT OR IGNORE INTO management_notification_push_outbox
      (id,notification_id,recipient_key,attempts,next_attempt_at,created_at)
      SELECT ?,id,recipient_key,0,?,? FROM management_notifications WHERE id=? AND recipient_key=?`)
      .bind(crypto.randomUUID(),deliveryTime,deliveryTime,id,input.recipientKey)
  ]);
  if (!result.meta?.changes) return null;
  const notification = { id, title: text(input.title, 160), body: text(input.body, 1000), url, kind: text(input.kind, 60), createdAt, readAt: null };
  try { await deliverNotification(env, { recipientKey: input.recipientKey, notification, deferPush: true }); }
  catch (error) { console.error('Notification persisted; delivery pending', { id, error: String(error?.message || error) }); }
  return notification;
}

async function preferencesFor(db, key) {
  const row = await db.prepare('SELECT * FROM management_user_preferences WHERE recipient_key=?').bind(key).first();
  const savedPins = row ? decode(row.home_pins_json) : [];
  return row ? {
    soundEnabled: Boolean(row.sound_enabled), pushEnabled: Boolean(row.push_enabled),
    homePins: Array.isArray(savedPins) ? [...new Set(savedPins.filter(pin => PINS.has(pin)))] : [],
    startTab: START_TABS.has(row.start_tab) ? row.start_tab : 'home'
  } : { soundEnabled: true, pushEnabled: false, homePins: [], startTab: 'home' };
}
function mapRule(row) {
  return { id: row.id, title: row.title, condition: row.condition, storeIds: decode(row.store_ids_json), recipients: decode(row.recipients_json), time: row.time_of_day, days: decode(row.days_json), enabled: Boolean(row.enabled), repeatMinutes: row.repeat_minutes, message: row.message };
}
async function validateRule(db, entityId, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Isian alarm tidak valid.';
  if (!text(input.title, 160) || typeof input.title !== 'string' || input.title.length > 160) return 'Judul wajib diisi, maksimal 160 karakter.';
  if (!CONDITIONS.has(input.condition)) return 'Jenis kondisi alarm tidak tersedia.';
  if (typeof input.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) return 'Jam harus berbentuk HH:MM dalam zona Asia/Jakarta.';
  if (!Array.isArray(input.days) || !input.days.length || input.days.length > 7 || input.days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) return 'Pilih hari 0 (Minggu) sampai 6 (Sabtu).';
  if (![0,15,30,60].includes(input.repeatMinutes) || typeof input.enabled !== 'boolean') return 'Pengulangan atau status alarm tidak valid.';
  if (typeof input.message !== 'string' || input.message.length > 1000) return 'Pesan maksimal 1000 karakter.';
  if (!Array.isArray(input.storeIds) || input.storeIds.length > 100 || input.storeIds.some(id => typeof id !== 'string' || !id || id.length > 120)) return 'Daftar gerai tidak valid (maksimal 100).';
  if (!Array.isArray(input.recipients) || !input.recipients.length || input.recipients.length > 50 || input.recipients.some(key => typeof key !== 'string')) return 'Pilih 1 sampai 50 penerima.';
  const allowedRecipients = new Set((await recipientsFor(db, entityId)).map(recipient => recipient.key));
  if (input.recipients.some(key => !allowedRecipients.has(key))) return 'Penerima harus akun aktif dalam entity ini.';
  const stores = new Set((await rows(db, 'SELECT id FROM stores WHERE entity_id=? AND is_active=1', entityId)).map(store => store.id));
  if (input.storeIds.some(id => !stores.has(id))) return 'Gerai harus aktif dan berada dalam entity ini.';
  return null;
}

export async function handleManagementNotificationsApi(request, env, pathname = new URL(request.url).pathname) {
  if (!pathname.startsWith('/api/notifications')) return null;
  const actor = await notificationActor(request, env);
  if (!actor) return json({ error: 'Login karyawan diperlukan.' }, 401);
  const db = env.DB;
  if (pathname === '/api/notifications' && request.method === 'GET') {
    await collectGeneralNotifications(env, actor);
    const items = await rows(db, 'SELECT * FROM management_notifications WHERE recipient_key=? ORDER BY created_at DESC,id DESC LIMIT 80', actor.key);
    const count = await db.prepare('SELECT COUNT(*) AS n FROM management_notifications WHERE recipient_key=? AND read_at IS NULL').bind(actor.key).first();
    return json({ items: items.map(mapNotification), unreadCount: count.n, preferences: await preferencesFor(db, actor.key), capabilities: { canManageRules: manager(actor) && Boolean(actor.entityId), entityId: actor.entityId }, actor: { key: actor.key, role: actor.role, label: actor.label } });
  }
  if (pathname === '/api/notifications/catalog' && request.method === 'GET') return json({ conditions: NOTIFICATION_CONDITIONS, pins: NOTIFICATION_PINS });
  if (pathname === '/api/notifications/preferences' && request.method === 'PATCH') {
    const parsed = await readJson(request);
    const input = parsed.value;
    if (!parsed.ok || !input || typeof input !== 'object' || Array.isArray(input)) return json({ error: 'Isian pengaturan tidak valid.' }, 400);
    for (const key of ['soundEnabled','pushEnabled']) if (key in input && typeof input[key] !== 'boolean') return json({ error: 'Pengaturan bunyi/push harus ya atau tidak.' }, 400);
    if ('homePins' in input && (!Array.isArray(input.homePins) || input.homePins.length > PINS.size || input.homePins.some(pin => !PINS.has(pin)))) return json({ error: 'Pilihan pin tidak valid.' }, 400);
    if ('startTab' in input && !START_TABS.has(input.startTab)) return json({ error: 'Halaman awal tidak tersedia.' }, 400);
    const before = await preferencesFor(db, actor.key);
    const value = { ...before, ...Object.fromEntries(['soundEnabled','pushEnabled','homePins','startTab'].filter(key => key in input).map(key => [key,input[key]])) };
    value.homePins = [...new Set(value.homePins)];
    await db.prepare(`INSERT INTO management_user_preferences(recipient_key,sound_enabled,push_enabled,home_pins_json,start_tab,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(recipient_key) DO UPDATE SET sound_enabled=excluded.sound_enabled,push_enabled=excluded.push_enabled,home_pins_json=excluded.home_pins_json,start_tab=excluded.start_tab,updated_at=excluded.updated_at`)
      .bind(actor.key, Number(value.soundEnabled), Number(value.pushEnabled), JSON.stringify(value.homePins), value.startTab, new Date().toISOString()).run();
    return json({ preferences: value });
  }
  if (pathname === '/api/notifications/read' && request.method === 'POST') {
    const input = await readJson(request);
    if (!input.ok || !input.value || (input.value.all !== true && !text(input.value.id, 120))) return json({ error: 'Pilih notifikasi yang akan ditandai dibaca.' }, 400);
    const now = new Date().toISOString();
    if (input.value.all === true) await db.prepare('UPDATE management_notifications SET read_at=? WHERE recipient_key=? AND read_at IS NULL').bind(now,actor.key).run();
    else await db.prepare('UPDATE management_notifications SET read_at=? WHERE recipient_key=? AND id=? AND read_at IS NULL').bind(now,actor.key,input.value.id).run();
    return json({ ok: true });
  }
  const ruleMatch = pathname.match(/^\/api\/notifications\/rules(?:\/([^/]+))?$/);
  if (pathname === '/api/notifications/recipients' || ruleMatch) {
    if (!manager(actor)) return json({ error: 'Pengaturan aturan alarm hanya untuk Admin Entity atau Owner.' }, 403);
    if (!actor.entityId) return json({ error: 'Pilih entity secara eksplisit dengan entityId.' }, 400);
    if (pathname === '/api/notifications/recipients' && request.method === 'GET') return json({ recipients: await recipientsFor(db,actor.entityId) });
    if (ruleMatch && !ruleMatch[1] && request.method === 'GET') return json({ rules: (await rows(db,'SELECT * FROM management_notification_rules WHERE entity_id=? ORDER BY created_at DESC,id',actor.entityId)).map(mapRule) });
    if (ruleMatch && (request.method === 'POST' || request.method === 'PATCH')) {
      const parsed = await readJson(request);
      if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return json({ error: 'Isian alarm tidak valid.' }, 400);
      const updating = request.method === 'PATCH';
      const ruleId = ruleMatch[1] || (updating ? text(parsed.value.id,120) : '');
      if (!updating && ruleMatch[1]) return json({ error: 'Gunakan PATCH untuk memperbarui alarm.' }, 405);
      const current = updating ? await db.prepare('SELECT * FROM management_notification_rules WHERE id=? AND entity_id=?').bind(ruleId,actor.entityId).first() : null;
      if (updating && !current) return json({ error: 'Alarm tidak ditemukan.' },404);
      if (!updating) {
        const count = await db.prepare('SELECT COUNT(*) AS n FROM management_notification_rules WHERE entity_id=?').bind(actor.entityId).first();
        if (count.n >= 200) return json({ error: 'Maksimal 200 aturan per entity.' },400);
      }
      const value = { title:'',condition:'',storeIds:[],recipients:[],time:'09:30',days:[0,1,2,3,4,5,6],enabled:true,repeatMinutes:0,message:'',...(current ? mapRule(current) : {}),...parsed.value };
      const onlyDisabling = current && parsed.value.enabled === false && Object.keys(parsed.value).every(key => key === 'enabled' || key === 'id');
      const problem = onlyDisabling ? null : await validateRule(db,actor.entityId,value);
      if (problem) return json({ error: problem },400);
      value.storeIds = [...new Set(value.storeIds)]; value.recipients = [...new Set(value.recipients)]; value.days = [...new Set(value.days)].sort();
      const id = current?.id || crypto.randomUUID(); const now = new Date().toISOString();
      if (current) await db.prepare(`UPDATE management_notification_rules SET title=?,condition=?,store_ids_json=?,recipients_json=?,time_of_day=?,days_json=?,enabled=?,repeat_minutes=?,message=?,updated_at=? WHERE id=? AND entity_id=?`)
        .bind(value.title.trim(),value.condition,JSON.stringify(value.storeIds),JSON.stringify(value.recipients),value.time,JSON.stringify(value.days),Number(value.enabled),value.repeatMinutes,value.message.trim(),now,id,actor.entityId).run();
      else await db.prepare(`INSERT INTO management_notification_rules(id,entity_id,title,condition,store_ids_json,recipients_json,time_of_day,days_json,enabled,repeat_minutes,message,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id,actor.entityId,value.title.trim(),value.condition,JSON.stringify(value.storeIds),JSON.stringify(value.recipients),value.time,JSON.stringify(value.days),Number(value.enabled),value.repeatMinutes,value.message.trim(),actor.key,now,now).run();
      return json({ rule: mapRule(await db.prepare('SELECT * FROM management_notification_rules WHERE id=? AND entity_id=?').bind(id,actor.entityId).first()) },current ? 200 : 201);
    }
  }
  return json({ error: 'Endpoint notifikasi tidak ditemukan.' },404);
}

// General events are independent of configurable alarms; collecting never changes a business fact.
export async function collectGeneralNotifications(env, actor, now = new Date()) {
  const db = env.DB;
  const since = new Date(now.getTime()-7*86400000).toISOString();
  const createdAt = now.toISOString();
  const entityScope = actor.role === 'OWNER' && !actor.entityId ? '1=1' : 's.entity_id=?';
  const scopeArgs = actor.role === 'OWNER' && !actor.entityId ? [] : [actor.entityId];
  const scope = actor.storeId ? `${entityScope} AND s.id=?` : entityScope;
  const args = actor.storeId ? [...scopeArgs,actor.storeId] : scopeArgs;
  const announceScope = actor.role === 'OWNER' && !actor.entityId ? '1=1' : 'a.entity_id=?';
  const announceStore = actor.storeId ? ' AND (a.store_id IS NULL OR a.store_id=?)' : '';
  const announcements = await rows(db,`SELECT a.* FROM announcements a JOIN entities e ON e.id=a.entity_id WHERE ${announceScope}${announceStore} AND e.status='ACTIVE' AND a.is_active=1 AND a.created_at>=? ORDER BY a.created_at DESC LIMIT 50`,...args,since.replace('T',' ').slice(0,19));
  for (const row of announcements) await emitNotification(env,{ recipientKey:actor.key,entityId:row.entity_id,storeId:row.store_id,dedupKey:`announcement:${row.id}`,title:row.title,body:row.body,url:await homeUrl(db,actor.role,actor.id,actor.storeId),kind:'ANNOUNCEMENT',createdAt });
  if (actor.role !== 'CASHIER') {
    const deposits = await rows(db,`SELECT p.id,p.entity_id,p.store_id,r.counterparty_name_snapshot,s.store_name,s.code FROM operational_receivable_payable_payments p JOIN operational_receivables_payables r ON r.id=p.receivable_payable_id AND r.store_id=p.store_id JOIN stores s ON s.id=p.store_id WHERE ${scope} AND s.is_active=1 AND p.entity_id=s.entity_id AND p.approval_status='pending_approval' AND r.source_type='EMPLOYEE_DEPOSIT' ORDER BY p.created_at DESC LIMIT 50`,...args);
    for (const row of deposits) await emitNotification(env,{recipientKey:actor.key,entityId:row.entity_id,storeId:row.store_id,dedupKey:`deposit:pending:${row.id}`,title:'Setoran menunggu ACC',body:`${row.counterparty_name_snapshot} mengirim setoran di ${row.store_name}.`,url:actor.role==='ENTITY_ADMIN'?'/entity-admin#tab=setorancs':`/s/${encodeURIComponent(row.code)}/admin#tab=employeedeposits`,kind:'DEPOSIT_PENDING',createdAt});
    const approvals = await rows(db,`SELECT a.id,a.store_id,s.entity_id,s.code,s.store_name FROM approval_requests a JOIN stores s ON s.id=a.store_id WHERE ${scope} AND s.is_active=1 AND a.approval_status='pending_approval' ORDER BY a.created_at DESC LIMIT 50`,...args);
    for (const row of approvals) await emitNotification(env,{recipientKey:actor.key,entityId:row.entity_id,storeId:row.store_id,dedupKey:`approval:pending:${row.id}`,title:'Permintaan menunggu ACC',body:`Ada permintaan persetujuan di ${row.store_name}.`,url:`/s/${encodeURIComponent(row.code)}/admin#tab=approvals`,kind:'APPROVAL_PENDING',createdAt});
  } else {
    const deposits = await rows(db,`SELECT p.id,p.entity_id,p.store_id,p.approval_status,p.rejection_reason FROM operational_receivable_payable_payments p JOIN operational_receivables_payables r ON r.id=p.receivable_payable_id AND r.store_id=p.store_id WHERE p.entity_id=? AND p.store_id=? AND p.submitted_by=? AND r.source_type='EMPLOYEE_DEPOSIT' AND p.approval_status IN('approved','rejected') AND p.reviewed_at>=? ORDER BY p.reviewed_at DESC LIMIT 50`,actor.entityId,actor.storeId,actor.id,since);
    for (const row of deposits) await emitNotification(env,{recipientKey:actor.key,entityId:row.entity_id,storeId:row.store_id,dedupKey:`deposit:${row.approval_status}:${row.id}`,title:row.approval_status==='approved'?'Setoran sudah di-ACC':'Setoran ditolak',body:row.approval_status==='approved'?'Setoran yang dikirim sudah diterima.':row.rejection_reason||'Periksa kembali bukti setoran.',url:'/staff',kind:'DEPOSIT_DECISION',createdAt});
    const approvals = await rows(db,`SELECT id,store_id,approval_status,decision_note FROM approval_requests WHERE store_id=? AND cashier_id=? AND approval_status IN('approved','rejected') AND updated_at>=? ORDER BY updated_at DESC LIMIT 50`,actor.storeId,actor.id,since);
    for (const row of approvals) await emitNotification(env,{recipientKey:actor.key,entityId:actor.entityId,storeId:row.store_id,dedupKey:`approval:${row.approval_status}:${row.id}`,title:row.approval_status==='approved'?'Permintaan disetujui':'Permintaan ditolak',body:row.decision_note||'Buka permintaan untuk melihat keputusan.',url:'/cashier#tab=approvals',kind:'APPROVAL_DECISION',createdAt});
  }
}

export async function collectAllGeneralNotifications(env, now = new Date()) {
  const actors = await listNotificationActors(env);
  for (const actor of actors) await collectGeneralNotifications(env,actor,now);
  return { actors:actors.length };
}

export async function evaluateNotificationRules(env, now = new Date()) {
  const db = env.DB;
  const date = getJakartaBusinessDate(now); const clock = getJakartaTimeOfDay(now); const minute = timeOfDayToMinutes(clock);
  const day = new Date(`${date}T12:00:00+07:00`).getUTCDay();
  const rules = await rows(db,"SELECT r.* FROM management_notification_rules r JOIN entities e ON e.id=r.entity_id WHERE r.enabled=1 AND e.status='ACTIVE' AND r.time_of_day<=?",clock);
  const eligibleByEntity = new Map(); const storesByEntity = new Map(); let emitted = 0;
  for (const row of rules) {
    const rule = mapRule(row);
    if (!rule.days.includes(day) || !CONDITIONS.has(rule.condition)) continue;
    if (!eligibleByEntity.has(row.entity_id)) eligibleByEntity.set(row.entity_id,new Set((await recipientsFor(db,row.entity_id)).map(user=>user.key)));
    const eligible = rule.recipients.filter(key=>eligibleByEntity.get(row.entity_id).has(key));
    if (!eligible.length) continue;
    if (!storesByEntity.has(row.entity_id)) storesByEntity.set(row.entity_id,await rows(db,'SELECT id,code,store_name FROM stores WHERE entity_id=? AND is_active=1',row.entity_id));
    const stores = rule.condition==='REMINDER' && !rule.storeIds.length ? [{id:null,code:null,store_name:''}] : storesByEntity.get(row.entity_id).filter(store=>!rule.storeIds.length || rule.storeIds.includes(store.id));
    const cutoff = timeOfDayToMinutes(rule.time);
    const slot = rule.repeatMinutes ? Math.floor((minute-cutoff)/rule.repeatMinutes) : 0;
    for (const store of stores) {
      const key = `rule:${row.id}:${store.id||'entity'}:${date}:${slot}`;
      // Avoid repeating business queries after this slot has reached every active recipient.
      const delivered = await rows(db,'SELECT recipient_key FROM management_notifications WHERE dedup_key=?',key);
      const sent = new Set(delivered.map(item=>item.recipient_key)); const pending = eligible.filter(recipient=>!sent.has(recipient));
      if (!pending.length) continue;
      let matched = rule.condition==='REMINDER';
      if (rule.condition==='STORE_NOT_OPEN') {
        const start = jakartaWallClockToUtc(date,'00:00').toISOString();
        const end = now.toISOString();
        // History, not current OPEN status. Late opening stops further reminders too.
        matched = !await db.prepare('SELECT id FROM cash_drawer_sessions WHERE store_id=? AND opened_at>=? AND opened_at<=? LIMIT 1').bind(store.id,start,end).first();
      } else if (rule.condition==='DEPOSIT_PENDING') {
        matched = Boolean(await db.prepare("SELECT p.id FROM operational_receivable_payable_payments p JOIN operational_receivables_payables r ON r.id=p.receivable_payable_id AND r.store_id=p.store_id WHERE p.entity_id=? AND p.store_id=? AND p.approval_status='pending_approval' AND r.source_type='EMPLOYEE_DEPOSIT' LIMIT 1").bind(row.entity_id,store.id).first());
      } else if (rule.condition==='APPROVAL_PENDING') matched = Boolean(await db.prepare("SELECT id FROM approval_requests WHERE store_id=? AND approval_status='pending_approval' LIMIT 1").bind(store.id).first());
      if (!matched) continue;
      const description = {STORE_NOT_OPEN:`${store.store_name} belum membuka gerai hari ini (pengingat mulai ${rule.time} WIB).`,DEPOSIT_PENDING:`Ada setoran menunggu ACC di ${store.store_name}.`,APPROVAL_PENDING:`Ada permintaan menunggu ACC di ${store.store_name}.`,REMINDER:`Pengingat pukul ${rule.time} WIB.`}[rule.condition];
      for (const recipientKey of pending) {
        const result = await emitNotification(env,{recipientKey,entityId:row.entity_id,storeId:store.id,dedupKey:key,title:rule.title,body:rule.message?`${description} ${rule.message}`:description,url:await homeUrl(db,recipientKey.slice(0,recipientKey.indexOf(':')),recipientKey.slice(recipientKey.indexOf(':')+1)),kind:`ALARM_${rule.condition}`,createdAt:now.toISOString()});
        if (result) emitted++;
      }
    }
  }
  return { evaluated:rules.length,emitted };
}
