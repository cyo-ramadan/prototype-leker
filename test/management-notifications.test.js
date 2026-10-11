import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { hashCredential } from '../src/owner-auth.js';
import { notificationActor, handleManagementNotificationsApi, evaluateNotificationRules, emitNotification, collectGeneralNotifications, listNotificationActors } from '../src/management-notifications.js';

class Statement {
  constructor(db, sql, params=[]) { this.db=db; this.sql=sql; this.params=params; }
  bind(...params) { assert.ok(params.length<=100,'D1 maximum 100 bind parameters'); return new Statement(this.db,this.sql,params); }
  first() { return this.db.prepare(this.sql).get(...this.params)??null; }
  all() { return {results:this.db.prepare(this.sql).all(...this.params)}; }
  run() { return {meta:{changes:Number(this.db.prepare(this.sql).run(...this.params).changes)}}; }
}
async function fixture(t) {
  const sqlite=new DatabaseSync(':memory:');
  t.after(()=>sqlite.close());
  for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort()) sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const env={DB:{prepare:sql=>new Statement(sqlite,sql),batch:async statements=>{sqlite.exec('BEGIN');try{const result=statements.map(s=>s.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}}};
  sqlite.exec(`INSERT INTO entity_admins(id,entity_id,username,password_hash,display_name) VALUES ('notif-e1','ENT-G001','notif-e1','x','Entity one'),('notif-e2','ENT-G002','notif-e2','x','Entity two')`);
  for(const [token,table,column,id] of [['e1','entity_admin_sessions','entity_admin_id','notif-e1'],['e2','entity_admin_sessions','entity_admin_id','notif-e2'],['a1','store_admin_sessions','admin_id','admin_g001_bablil'],['c1','cashier_sessions','cashier_id','cashier_wowo'],['c2','cashier_sessions','cashier_id','cashier_wiwi'],['owner','owner_sessions','owner_id','owner_primary']]) sqlite.prepare(`INSERT INTO ${table}(token_hash,${column},created_at,expires_at) VALUES(?,?,'2026-01-01T00:00:00Z','2099-01-01T00:00:00Z')`).run(await hashCredential(token),id);
  return {sqlite,env};
}
function req(path,token='e1',method='GET',body) {
  return new Request('https://example.test'+path,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),'content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
}
async function call(env,path,token='e1',method='GET',body) {
  const response=await handleManagementNotificationsApi(req(path,token,method,body),env);
  return {status:response.status,body:await response.json()};
}
const ruleInput=(extra={})=>({title:'Gerai buka',condition:'STORE_NOT_OPEN',storeIds:['store_001'],recipients:['ENTITY_ADMIN:notif-e1'],time:'09:30',days:[1],enabled:true,repeatMinutes:0,message:'Mohon diperiksa.',...extra});
async function rule(env,extra={}) {
  const result=await call(env,'/api/notifications/rules','e1','POST',ruleInput(extra));
  assert.equal(result.status,201,JSON.stringify(result.body)); return result.body.rule;
}
function drawer(db,id,storeId,cashierId,openedAt,status='CLOSED') {
  db.prepare('INSERT INTO cash_drawer_sessions(id,store_id,cashier_id,opening_amount,status,opened_at,closed_at) VALUES(?,?,?,0,?,?,?)').run(id,storeId,cashierId,status,openedAt,status==='CLOSED'?openedAt:null);
}
function deposit(db,id,storeId,entityId,submittedBy,status='pending_approval') {
  db.prepare(`INSERT INTO operational_receivables_payables(id,store_id,entity_id,source_type,balance_type,source_id,counterparty_id,counterparty_name_snapshot,original_amount,transaction_date) VALUES(?,?,?,'EMPLOYEE_DEPOSIT','RECEIVABLE',?,?,'Test CS',1000000,'2026-10-12')`).run('rp-'+id,storeId,entityId,id,'cashier:'+submittedBy);
  db.prepare(`INSERT INTO operational_receivable_payable_payments(id,receivable_payable_id,store_id,entity_id,amount,approval_status,submitted_by,proof_reference,reviewed_by,reviewed_at) VALUES(?,?,?,?,1000000,?,?,'proof','reviewer','2026-10-12T03:00:00.000Z')`).run(id,'rp-'+id,storeId,entityId,status,submittedBy);
}

test('migration installs no alarm defaults or business/accounting triggers',async t=>{
  const {sqlite}=await fixture(t);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM management_notification_rules').get().n,0);
  const migration=readFileSync(new URL('../migrations/0149_management_notifications.sql',import.meta.url),'utf8');
  assert.ok(!/CREATE TRIGGER|DELETE FROM|UPDATE (?:sales|accounting|cash_drawer)/i.test(migration));
});

test('actor resolves internal roles, ignores recipient spoofing and rejects invalid sessions',async t=>{
  const {env}=await fixture(t);
  assert.equal(await notificationActor(req('/api/notifications',null),env),null);
  assert.equal(await notificationActor(req('/api/notifications','bad'),env),null);
  for(const [token,role,key] of [['e1','ENTITY_ADMIN','ENTITY_ADMIN:notif-e1'],['a1','ADMIN','ADMIN:admin_g001_bablil'],['c1','CASHIER','CASHIER:cashier_wowo'],['owner','OWNER','OWNER:owner_primary']]) {
    const actor=await notificationActor(req('/api/notifications?recipientKey=CASHIER:cashier_wiwi',token),env);
    assert.equal(actor.role,role);assert.equal(actor.key,key);
  }
});

test('personal preferences persist and cannot overwrite another user',async t=>{
  const {env,sqlite}=await fixture(t);
  const result=await call(env,'/api/notifications/preferences','e1','PATCH',{recipientKey:'ENTITY_ADMIN:notif-e2',homePins:['profit','setoran'],startTab:'setorancs',soundEnabled:false,pushEnabled:true});
  assert.equal(result.status,200);assert.deepEqual(result.body.preferences.homePins,['profit','setoran']);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM management_user_preferences').get().n,1);
  assert.equal(sqlite.prepare('SELECT recipient_key FROM management_user_preferences').get().recipient_key,'ENTITY_ADMIN:notif-e1');
  const inbox=await call(env,'/api/notifications','e1');assert.equal(inbox.body.preferences.startTab,'setorancs');assert.equal(inbox.body.preferences.soundEnabled,false);
  assert.equal((await call(env,'/api/notifications','e2')).body.preferences.startTab,'home');
  for(const input of [{homePins:['unknown']},{homePins:['approvals']},{homePins:'profit'},{startTab:'unknown'},{soundEnabled:'false'}]) assert.equal((await call(env,'/api/notifications/preferences','e1','PATCH',input)).status,400);
});

test('inbox/read state isolated per authenticated account, dedup is concurrency safe',async t=>{
  const {env,sqlite}=await fixture(t);
  const input={recipientKey:'ENTITY_ADMIN:notif-e1',entityId:'ENT-G001',dedupKey:'same',title:'One',body:'Test',kind:'TEST',url:'https://unsafe.test'};
  const created=await Promise.all(Array.from({length:5},()=>emitNotification(env,input)));
  assert.equal(created.filter(Boolean).length,1);
  await emitNotification(env,{...input,recipientKey:'ENTITY_ADMIN:notif-e2',entityId:'ENT-G002',url:'/entity-admin'});
  const first=await call(env,'/api/notifications','e1');assert.equal(first.body.items.length,1);assert.equal(first.body.unreadCount,1);assert.equal(first.body.items[0].url,'');
  await call(env,'/api/notifications/read','e2','POST',{id:first.body.items[0].id});
  assert.equal(sqlite.prepare('SELECT read_at FROM management_notifications WHERE id=?').get(first.body.items[0].id).read_at,null);
  await call(env,'/api/notifications/read','e1','POST',{all:true,recipientKey:'ENTITY_ADMIN:notif-e2'});
  assert.equal((await call(env,'/api/notifications','e1')).body.unreadCount,0);
  assert.equal((await call(env,'/api/notifications','e2')).body.unreadCount,1);
});

test('only entity managers manage rules and eligible recipients; owner requires explicit active entity',async t=>{
  const {env}=await fixture(t);
  for(const token of ['a1','c1']) for(const route of ['/api/notifications/rules','/api/notifications/recipients']) assert.equal((await call(env,route,token)).status,403);
  assert.equal((await call(env,'/api/notifications/rules','owner')).status,400);
  assert.equal((await call(env,'/api/notifications/rules?entityId=ENT-G001','owner')).status,200);
  assert.equal((await call(env,'/api/notifications/rules?entityId=missing','owner')).status,401);
  const recipients=(await call(env,'/api/notifications/recipients?entityId=ENT-G002','e1')).body.recipients;
  assert.ok(recipients.some(user=>user.key==='ENTITY_ADMIN:notif-e1'));
  assert.ok(!recipients.some(user=>user.key==='ENTITY_ADMIN:notif-e2'||user.key==='CASHIER:cashier_wiwi'));
  const created=await rule(env);
  assert.equal((await call(env,`/api/notifications/rules/${created.id}`,'e2','PATCH',{enabled:false})).status,404);
  assert.equal((await call(env,`/api/notifications/rules/${created.id}`,'e1','PATCH',{enabled:false})).body.rule.enabled,false);
});

test('rule validation rejects cross-entity stores/recipients and unbounded expressions',async t=>{
  const {env}=await fixture(t);
  for(const input of [{storeIds:['store_002']},{recipients:['ENTITY_ADMIN:notif-e2']},{condition:'SQL: DROP TABLE stores'},{time:'25:00'},{time:['09:30']},{days:[7]},{repeatMinutes:1},{days:[]},{recipients:[]},{enabled:'true'}]) assert.equal((await call(env,'/api/notifications/rules','e1','POST',ruleInput(input))).status,400,JSON.stringify(input));
});

test('alarm respects Jakarta day and cutoff; no duplicate notification in same day',async t=>{
  const {env,sqlite}=await fixture(t);await rule(env);
  for(const time of ['2026-10-12T02:29:00Z','2026-10-11T03:00:00Z']) assert.equal((await evaluateNotificationRules(env,new Date(time))).emitted,0);
  assert.equal((await evaluateNotificationRules(env,new Date('2026-10-12T02:30:00Z'))).emitted,1);
  assert.equal((await evaluateNotificationRules(env,new Date('2026-10-12T05:00:00Z'))).emitted,0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM management_notifications').get().n,1);
});

test('opened then closed gerai is already open; prior business date is not today',async t=>{
  const one=await fixture(t);await rule(one.env);
  drawer(one.sqlite,'closed-today','store_001','cashier_wowo','2026-10-12T01:30:00.000Z');
  assert.equal((await evaluateNotificationRules(one.env,new Date('2026-10-12T02:30:00Z'))).emitted,0);
  const two=await fixture(t);await rule(two.env);
  drawer(two.sqlite,'yesterday','store_001','cashier_wowo','2026-10-11T13:00:00.000Z');
  assert.equal((await evaluateNotificationRules(two.env,new Date('2026-10-12T02:30:00Z'))).emitted,1);
});

test('repeat slots, disabled rules and revoked recipients are respected',async t=>{
  const {env,sqlite}=await fixture(t);const created=await rule(env,{repeatMinutes:15});
  assert.equal((await evaluateNotificationRules(env,new Date('2026-10-12T02:30:00Z'))).emitted,1);
  assert.equal((await evaluateNotificationRules(env,new Date('2026-10-12T02:44:00Z'))).emitted,0);
  assert.equal((await evaluateNotificationRules(env,new Date('2026-10-12T02:45:00Z'))).emitted,1);
  await call(env,`/api/notifications/rules/${created.id}`,'e1','PATCH',{enabled:false});
  assert.equal((await evaluateNotificationRules(env,new Date('2026-10-12T03:00:00Z'))).emitted,0);
  await call(env,`/api/notifications/rules/${created.id}`,'e1','PATCH',{enabled:true});
  sqlite.exec("UPDATE entity_admins SET is_active=0 WHERE id='notif-e1'");
  assert.equal((await evaluateNotificationRules(env,new Date('2026-10-12T03:15:00Z'))).emitted,0);
});

test('reminders and pending-deposit conditions use saved configuration only',async t=>{
  const {env,sqlite}=await fixture(t);
  await rule(env,{condition:'REMINDER',message:'Cek buku',storeIds:[]});
  await rule(env,{condition:'DEPOSIT_PENDING',title:'Cek setoran'});
  assert.equal((await evaluateNotificationRules(env,new Date('2026-10-12T02:30:00Z'))).emitted,1);
  deposit(sqlite,'test-pending','store_001','ENT-G001','cashier_wowo');
  assert.equal((await evaluateNotificationRules(env,new Date('2026-10-12T02:35:00Z'))).emitted,1);
  assert.equal(sqlite.prepare("SELECT approval_status FROM operational_receivable_payable_payments WHERE id='test-pending'").get().approval_status,'pending_approval');
});

test('general notifications scope announcements and pending deposits to actor entity/store',async t=>{
  const {env,sqlite}=await fixture(t);const now=new Date('2026-10-12T03:00:00.000Z');
  sqlite.exec(`INSERT INTO announcements(id,entity_id,title,body,created_by,created_by_role,created_at) VALUES('n1','ENT-G001','One','Body','test','ENTITY_ADMIN','2026-10-12 01:00:00'),('n2','ENT-G002','Two','Body','test','ENTITY_ADMIN','2026-10-12 01:00:00')`);
  deposit(sqlite,'d1','store_001','ENT-G001','cashier_wowo');deposit(sqlite,'d2','store_002','ENT-G002','cashier_wiwi');
  const actor=await notificationActor(req('/api/notifications','a1'),env);
  await collectGeneralNotifications(env,actor,now);await collectGeneralNotifications(env,actor,now);
  const notices=sqlite.prepare('SELECT * FROM management_notifications WHERE recipient_key=?').all(actor.key);
  assert.equal(notices.length,2);assert.ok(notices.every(item=>item.entity_id==='ENT-G001'));assert.ok(notices.some(item=>item.kind==='DEPOSIT_PENDING'));
});

test('cashier gets own deposit decision, never another submitter decision',async t=>{
  const {env,sqlite}=await fixture(t);deposit(sqlite,'own','store_001','ENT-G001','cashier_wowo','approved');deposit(sqlite,'other','store_001','ENT-G001','another-cashier','rejected');
  const actor=await notificationActor(req('/api/notifications','c1'),env);
  await collectGeneralNotifications(env,actor,new Date('2026-10-12T04:00:00Z'));
  const notices=sqlite.prepare('SELECT * FROM management_notifications WHERE recipient_key=?').all(actor.key);
  assert.equal(notices.length,1);assert.equal(notices[0].dedup_key,'deposit:approved:own');
});

test('event actor listing limits users to affected entity and active stores',async t=>{
  const {env,sqlite}=await fixture(t);
  const actors=await listNotificationActors(env,{entityId:'ENT-G001',storeId:'store_001'});
  assert.ok(actors.some(actor=>actor.key==='CASHIER:cashier_wowo'));
  assert.ok(!actors.some(actor=>actor.key==='CASHIER:cashier_wiwi'||actor.key==='ENTITY_ADMIN:notif-e2'));
  sqlite.exec("UPDATE stores SET is_active=0 WHERE id='store_001'");
  assert.ok(!(await listNotificationActors(env,{entityId:'ENT-G001'})).some(actor=>actor.key==='CASHIER:cashier_wowo'));
});


test('late opening stops repeated alarms and inactive recipients do not block disabling',async t=>{
  const {env,sqlite}=await fixture(t);
  const created=await rule(env,{repeatMinutes:15,recipients:['ADMIN:admin_g001_bablil']});
  assert.equal((await evaluateNotificationRules(env,new Date('2026-10-12T02:30:00Z'))).emitted,1);
  drawer(sqlite,'late-opening','store_001','cashier_wowo','2026-10-12T02:35:00.000Z');
  assert.equal((await evaluateNotificationRules(env,new Date('2026-10-12T02:45:00Z'))).emitted,0);
  sqlite.exec("UPDATE store_admins SET is_active=0 WHERE id='admin_g001_bablil'");
  assert.equal((await call(env,`/api/notifications/rules/${created.id}`,'e1','PATCH',{enabled:false})).status,200);
});


test('inbox and push retry queue commit atomically without inline provider work',async t=>{
  const {env,sqlite}=await fixture(t);
  const basePrepare=env.DB.prepare;
  let inlinePushChecks=0;
  env.DB.prepare=sql=>{
    if(sql.includes('SELECT push_enabled,sound_enabled')) { inlinePushChecks++; throw new Error('Provider work must stay off the request path'); }
    return basePrepare(sql);
  };
  const input={recipientKey:'ENTITY_ADMIN:notif-e1',entityId:'ENT-G001',dedupKey:'atomic',title:'Durable',body:'',kind:'TEST',url:'/entity-admin'};
  const notice=await emitNotification(env,input);
  assert.ok(notice);
  assert.equal(inlinePushChecks,0,'Push provider work is deferred to cron; inbox collection must remain fast');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM management_notifications').get().n,1);
  const queued=sqlite.prepare('SELECT notification_id,recipient_key FROM management_notification_push_outbox').all();
  assert.equal(queued.length,1);assert.equal(queued[0].notification_id,notice.id);
  assert.equal(await emitNotification(env,input),null);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM management_notification_push_outbox').get().n,1);
  await assert.rejects(()=>emitNotification(env,{...input,dedupKey:'bad-fk',storeId:'not-a-store'}));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM management_notifications').get().n,1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM management_notification_push_outbox').get().n,1);
});


test('home pin catalog selects existing entity menu contents and all real tabs persist',async t=>{
  const {env,sqlite}=await fixture(t);
  const expected=[['profit','reports'],['setoran','setorancs'],['drawerstatus','drawerstatus'],['stores','stores'],['customers','customers'],['ledger','ledger'],['sharedaccounts','sharedaccounts'],['productmasters','productmasters'],['entityrecipes','entityrecipes'],['entitystock','entitystock'],['storereport','storereport'],['employees','employees']];
  const catalog=await call(env,'/api/notifications/catalog','e1');
  assert.equal(catalog.status,200);
  assert.deepEqual(catalog.body.pins.map(pin=>[pin.id,pin.tab]),expected);
  const html=readFileSync(new URL('../public/entity-admin.html',import.meta.url),'utf8');
  for(const [id,tab] of expected) {
    assert.ok(html.includes(`data-entity-tab="${tab}"`),`Pin ${id} uses existing menu ${tab}`);
    const saved=await call(env,'/api/notifications/preferences','e1','PATCH',{homePins:[id],startTab:tab});
    assert.equal(saved.status,200,tab);
    assert.deepEqual(saved.body.preferences.homePins,[id]);assert.equal(saved.body.preferences.startTab,tab);
  }
  const ordered=expected.map(([id])=>id).reverse();
  const saved=await call(env,'/api/notifications/preferences','e1','PATCH',{homePins:ordered,startTab:'reports'});
  assert.equal(saved.status,200);assert.deepEqual(saved.body.preferences.homePins,ordered);
  const persisted=sqlite.prepare('SELECT home_pins_json,start_tab FROM management_user_preferences WHERE recipient_key=?').get('ENTITY_ADMIN:notif-e1');
  assert.deepEqual(JSON.parse(persisted.home_pins_json),ordered);assert.equal(persisted.start_tab,'reports');
  // Old local draft preferences may contain the removed invented approvals pin.
  sqlite.prepare('UPDATE management_user_preferences SET home_pins_json=? WHERE recipient_key=?').run(JSON.stringify(['profit','approvals','setoran']),'ENTITY_ADMIN:notif-e1');
  const inbox=await call(env,'/api/notifications','e1');
  assert.deepEqual(inbox.body.preferences.homePins,['profit','setoran']);
  const update=await call(env,'/api/notifications/preferences','e1','PATCH',{soundEnabled:false});
  assert.deepEqual(update.body.preferences.homePins,['profit','setoran']);
});
