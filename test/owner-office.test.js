import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleOwnerOfficeApi } from '../src/owner-office.js';
import { requireCashier } from '../src/cashier-auth.js';
import { handleCashierDrawerApi } from '../src/cashier-drawer.js';
import { handleApprovalQueueApi } from '../src/approval-queue.js';
import { hashCredential } from '../src/owner-auth.js';
import { setTenantPolicySetting, UI_SKIN_KEY } from '../src/tenant-policy.js';
const migrationDir = new URL('../migrations/', import.meta.url);
class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}

class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) {
    this.db.exec('BEGIN');
    try {
      const results = statements.map(statement => statement.run());
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function migratedDatabase(upTo = null) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    if (upTo && file > upTo) break;
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}

const OWNER_TOKEN = 'office-test-owner-session';
const ADMIN_TOKEN = 'office-test-entity-session';
const expires = '2099-01-01T00:00:00.000Z';
function req(path, token=OWNER_TOKEN, method='GET', body) {
  return new Request('https://example.test'+path, {method, headers:{authorization:'Bearer '+token,'content-type':'application/json'}, body:body===undefined?undefined:JSON.stringify(body)});
}
async function setup() {
  const sql=migratedDatabase(), db=new D1Database(sql);
  const store=sql.prepare("SELECT s.id,s.code,s.entity_id,et.tenant_id FROM stores s JOIN entity_tenancy et ON et.entity_id=s.entity_id AND et.effective_to IS NULL WHERE s.code='G001'").get();
  sql.prepare('INSERT INTO owner_sessions(token_hash,owner_id,created_at,expires_at) VALUES(?,?,?,?)').run(await hashCredential(OWNER_TOKEN),'owner_primary','2026-01-01',expires);
  sql.prepare("INSERT INTO entity_admins(id,entity_id,username,password_hash,display_name) VALUES('office-admin',?,'office-admin','unused','Pemilik')").run(store.entity_id);
  sql.prepare("INSERT INTO entity_admin_sessions(token_hash,entity_admin_id,created_at,expires_at) VALUES(?,'office-admin','2026-01-01',?)").run(await hashCredential(ADMIN_TOKEN),expires);
  sql.prepare("INSERT INTO stores(id,code,store_name,entity_id) VALUES('office-second','OFFICE2','Kantor Kedua',?)").run(store.entity_id);
  const env={DB:db}, base='/api/management/owner-office';
  const api=async (method='GET',body,token=OWNER_TOKEN,entity=store.entity_id,session=false) => {
    const path=base+(session?'/session':'');
    return handleOwnerOfficeApi(req(path+'?entity='+entity,token,method,body),env,path);
  };
  const skin=value=>setTenantPolicySetting(db,store.tenant_id,UI_SKIN_KEY,value);
  const configure=()=>api('PATCH',{storeCode:store.code});
  const session=token=>api('POST',undefined,token,store.entity_id,true);
  return {sql,db,store,env,api,skin,configure,session};
}
test('Office requires active H and scoped human entity; CS policy remains unchanged', async()=>{
  const f=await setup();
  try {
    assert.equal((await f.api()).status,403);
    await f.skin('H');
    assert.equal((await f.api('GET',undefined,'not-a-human-token')).status,403);
    assert.equal((await f.api('GET',undefined,ADMIN_TOKEN,'different-entity')).status,403);
    assert.equal((await f.session()).status,409);
    const foreign=f.sql.prepare('SELECT code FROM stores WHERE entity_id<>? AND is_active=1 LIMIT 1').get(f.store.entity_id);
    assert.equal((await f.api('PATCH',{storeCode:foreign.code})).status,403);
    const configured=await f.configure();
    assert.equal(configured.status,200,await configured.clone().text());
    assert.equal((await configured.json()).office.storeCode,f.store.code);
    assert.equal((await f.api('GET',undefined,ADMIN_TOKEN)).status,200);
    const c=f.sql.prepare('SELECT id FROM cashiers WHERE store_id=? AND is_active=1 LIMIT 1').get(f.store.id);
    f.sql.prepare('INSERT INTO cashier_sessions(token_hash,cashier_id,created_at,expires_at) VALUES(?,?,?,?)').run(await hashCredential('normal-cs'),c.id,'2026-01-01',expires);
    const normal=await requireCashier(req('/api/cashier/drawer?store=G001','normal-cs'),f.db);
    assert.equal(normal.ok,true);
    assert.equal(normal.cashier.store.attendanceOptional,false);
    assert.equal(normal.cashier.store.ownerOperated,false);
    assert.equal(normal.cashier.officeActor,undefined);
  } finally {f.sql.close();}
});
test('Office opens canonical drawer once, records human authority and rejects close/store substitution',async()=>{
  const f=await setup();
  try {
    await f.skin('H'); await f.configure();
    const response=await f.session(ADMIN_TOKEN);
    assert.equal(response.status,200,await response.clone().text());
    const first=await response.json();
    assert.equal(first.drawer.status,'OPEN');
    assert.equal((await (await f.session(ADMIN_TOKEN)).json()).drawer.id,first.drawer.id);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM cash_drawer_sessions WHERE store_id=? AND status='OPEN'").get(f.store.id).n,1);
    const auth=await requireCashier(req('/api/cashier/drawer?store=G001',first.token),f.db);
    assert.equal(auth.ok,true);
    assert.deepEqual(auth.cashier.officeActor,{role:'ENTITY_ADMIN',id:'office-admin'});
    assert.equal(auth.cashier.store.attendanceOptional,true);
    assert.equal(auth.cashier.store.ownerOperated,false);
    assert.equal((await requireCashier(req('/api/cashier/drawer?store=G002',first.token),f.db)).ok,false);
    const closing=await handleCashierDrawerApi(req('/api/cashier/drawer/close',first.token,'POST',{}),f.env,'/api/cashier/drawer/close');
    assert.equal(closing.status,403);
    assert.equal((await closing.json()).code,'OWNER_OFFICE_CONTINUOUS_DRAWER');
    assert.equal((await f.session(OWNER_TOKEN)).status,409,'another human must not steal drawer');
  }finally{f.sql.close();}
});
test('every skin transition invalidates Office reads/writes; H round trip never revives token',async()=>{
  const f=await setup();
  try {
    await f.skin('H'); await f.configure();
    const first=await (await f.session()).json();
    await f.skin('H');
    assert.equal((await requireCashier(req('/api/cashier/drawer',first.token),f.db)).ok,true,'same skin write preserves session');
    for (const skin of ['0','A','B','C','D','E','F','G']) {
      const current=await (await f.session()).json();
      await f.skin(skin);
      for (const method of ['GET','POST']) {
        const auth=await requireCashier(req('/api/cashier/drawer',current.token,method,method==='POST'?{}:undefined),f.db);
        assert.equal(auth.ok,false,skin+' must reject Office '+method);
      }
      assert.equal((await f.api()).status,403);
      await f.skin('H');
      assert.equal((await requireCashier(req('/api/cashier/drawer',current.token),f.db)).ok,false,'old session must stay revoked after '+skin);
    }
    assert.equal(f.sql.prepare("SELECT status FROM cash_drawer_sessions WHERE id=?").get(first.drawer.id).status,'OPEN','financial history is not rewritten on skin change');
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM store_approval_settings WHERE store_id=? AND auto_permit_enabled=1").get(f.store.id).n,0);
    f.sql.prepare('DELETE FROM owner_sessions WHERE token_hash=?').run(await hashCredential(OWNER_TOKEN));
    assert.equal((await requireCashier(req('/api/cashier/drawer',first.token),f.db)).ok,false);
  }finally{f.sql.close();}
});
test('Office configuration revisions and human revocation immediately invalidate cached session',async()=>{
  const f=await setup();
  try {
    await f.skin('H'); await f.configure();
    const first=await (await f.session()).json();
    const other=f.sql.prepare('SELECT code FROM stores WHERE entity_id=? AND id<>? AND is_active=1 LIMIT 1').get(f.store.entity_id,f.store.id);
    assert.ok(other);
    assert.equal((await f.api('PATCH',{storeCode:other.code})).status,200);
    assert.equal((await requireCashier(req('/api/cashier/drawer',first.token),f.db)).ok,false);
    await f.configure();
    assert.equal((await requireCashier(req('/api/cashier/drawer',first.token),f.db)).ok,false);
    const current=await (await f.session()).json();
    f.sql.prepare("UPDATE owner_accounts SET is_active=0 WHERE id='owner_primary'").run();
    assert.equal((await requireCashier(req('/api/cashier/drawer',current.token),f.db)).ok,false);
  }finally{f.sql.close();}
});

test('Office direct action uses canonical approval posting and never persists Auto Permit',async()=>{
  const f=await setup();
  try {
    await f.skin('H'); await f.configure();
    const session=await (await f.session(ADMIN_TOKEN)).json();
    const path='/api/cashier/approval-requests';
    const payload={requestType:'ASSET',payload:{direction:'INCREASE',amount:12500,description:'Aset Kantor'}};
    const response=await handleApprovalQueueApi(req(path,session.token,'POST',payload),f.env,path);
    assert.equal(response.status,201,await response.clone().text());
    const posted=await response.json();
    assert.equal(posted.request.approvalStatus,'approved');
    assert.equal(posted.request.postingStatus,'posted');
    const ledger=f.sql.prepare('SELECT amount,approved_by_role,approved_by_id FROM asset_ledger_entries WHERE approval_request_id=?').get(posted.request.id);
    assert.deepEqual({...ledger},{amount:12500,approved_by_role:'ENTITY_ADMIN',approved_by_id:'office-admin'});
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM store_approval_settings WHERE store_id=?').get(f.store.id).n,0);
    await f.skin('0');
    const denied=await handleApprovalQueueApi(req(path,session.token,'POST',payload),f.env,path);
    assert.equal(denied.status,403);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM asset_ledger_entries WHERE store_id=?').get(f.store.id).n,1);
  }finally{f.sql.close();}
});
