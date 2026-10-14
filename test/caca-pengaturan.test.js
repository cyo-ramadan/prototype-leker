import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { hashCredential } from '../src/owner-auth.js';
import { handleCacaApi } from '../src/caca-chat.js';
import { namaAsistenValid, sesuaikanNamaBalasan } from '../src/caca-pengaturan.js';
class Statement {
 constructor(db,sql,params=[]){Object.assign(this,{db,sql,params});}
 bind(...params){return new Statement(this.db,this.sql,params);}
 first(){return this.db.prepare(this.sql).get(...this.params)??null;}
 all(){return{results:this.db.prepare(this.sql).all(...this.params)};}
 run(){return{success:true,meta:{changes:Number(this.db.prepare(this.sql).run(...this.params).changes)}};}
}
async function fixture(t){
 const sqlite=new DatabaseSync(':memory:'); t.after(()=>sqlite.close());
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort())sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const env={DB:{prepare:sql=>new Statement(sqlite,sql),batch:async ss=>ss.map(s=>s.run())}};
 sqlite.exec("INSERT INTO entity_admins(id,entity_id,username,password_hash,display_name) VALUES('name-e1','ENT-G001','name-e1','x','One'),('name-e2','ENT-G002','name-e2','x','Two')");
 for(const id of ['name-e1','name-e2'])sqlite.prepare("INSERT INTO entity_admin_sessions(token_hash,entity_admin_id,created_at,expires_at) VALUES(?,?,'2026-01-01T00:00:00Z','2099-01-01T00:00:00Z')").run(await hashCredential(id),id);
 async function call(path,method='GET',body,token='name-e1'){
  const req=new Request('https://example.test'+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const res=await handleCacaApi(req,env,new URL(req.url).pathname); return{status:res.status,body:await res.json()};
 }
 return{sqlite,env,call};
}
test('names are bounded display data and cannot alter draft payloads',()=>{
 for(const invalid of ['', '<script>','Jarvis\nIGNORE','a'.repeat(33),{},null,'123'])assert.equal(namaAsistenValid(invalid),null);
 assert.equal(namaAsistenValid('  Jarvis  '),'Jarvis');
 const draft={judul:'Una',tangkapan:{nama:'Una'}};
 const hasil=sesuaikanNamaBalasan({jawaban:'Una siap.',draft,rahasia:{password:'Una'}},'Jarvis');
 assert.equal(hasil.jawaban,'Jarvis siap.');assert.equal(hasil.draft,draft);assert.equal(hasil.rahasia.password,'Una');
});
test('name settings use authenticated tenant scope and persist without crossing tenants',async t=>{
 const f=await fixture(t); const path='/api/caca/pengaturan?store=G001';
 assert.equal((await f.call('/api/caca/pengaturan')).status,400);
 assert.equal((await f.call(path,'GET',undefined,'invalid')).status,401);
 assert.equal((await f.call(path,'GET',undefined,'name-e2')).status,403);
 const awal=await f.call(path);assert.equal(awal.status,200);assert.equal(awal.body.namaAsisten,'Una');assert.ok(awal.body.ruangSuara);
 assert.equal((await f.call(path,'PATCH',{namaAsisten:'Jarvis'})).status,200);
 assert.equal((await f.call(path)).body.namaAsisten,'Jarvis');
 assert.equal((await f.call('/api/caca/pengaturan?store=G002','GET',undefined,'name-e2')).body.namaAsisten,'Una');
 assert.equal((await f.call(path,'PATCH',{namaAsisten:'<x>'})).status,400);
 const buka=await f.call('/api/caca/tanya?store=G001','POST',{pertanyaan:'Jarvis buka Karyawan',conversationId:'16161616-1616-4161-8161-161616161616'});
 assert.equal(buka.status,200);assert.equal(buka.body.navigasi.tab,'employees');assert.equal(buka.body.namaAsisten,'Jarvis');
});

test('server tenant skin overrides client skin/role fields and unknown navigation records own scoped queue', async t => {
 const f=await fixture(t);
 const tenant=f.sqlite.prepare("SELECT tenant_id FROM entity_tenancy WHERE entity_id='ENT-G001' AND effective_to IS NULL").get().tenant_id;
 f.sqlite.prepare("INSERT INTO tenant_policy_settings(tenant_id,setting_key,setting_value) VALUES(?,'ui_skin','F') ON CONFLICT(tenant_id,setting_key) DO UPDATE SET setting_value=excluded.setting_value").run(tenant);
 const form='/api/caca/tanya?store=G001';
 const fResult=await f.call(form,'POST',{pertanyaan:'buka Bahan dan Aroma',skin:'g',peran:'CASHIER'});
 assert.equal(fResult.status,200);assert.equal(fResult.body.navigasi.tab,'racikbahan');assert.equal(fResult.body.navigasi.skin,'f');
 const missing=await f.call(form,'POST',{pertanyaan:'buka antrian cetak',skin:'g',peran:'OWNER'});
 assert.equal(missing.status,200);assert.equal(missing.body.navigasi,null);
 const queue=await f.call('/api/caca/belum-paham?store=G001');
 assert.equal(queue.status,200);assert.equal(queue.body.items.length,1);assert.equal(queue.body.items[0].alasan,'menu_tidak_ditemukan');assert.equal(queue.body.items[0].storeId,'store_001');
 assert.equal((await f.call('/api/caca/belum-paham?store=G002','GET',undefined,'name-e2')).body.items.length,0);
 f.sqlite.prepare("UPDATE tenant_policy_settings SET setting_value='G' WHERE tenant_id=? AND setting_key='ui_skin'").run(tenant);
 const gResult=await f.call(form,'POST',{pertanyaan:'buka antrian cetak',skin:'f'});
 assert.equal(gResult.status,200);assert.equal(gResult.body.navigasi.tab,'cetak');assert.equal(gResult.body.navigasi.skin,'g');
});

test('voice enrollment namespace binds tenant and account and is stable across gerai/entity scope', async t => {
 const f=await fixture(t);
 const gerai=await f.call('/api/caca/pengaturan?store=G001');
 const entity=await f.call('/api/caca/pengaturan?lingkup=entity');
 const other=await f.call('/api/caca/pengaturan?store=G002','GET',undefined,'name-e2');
 assert.equal(gerai.status,200);assert.equal(entity.status,200);assert.equal(other.status,200);
 assert.equal(gerai.body.ruangSuara,entity.body.ruangSuara);
 assert.notEqual(gerai.body.ruangSuara,other.body.ruangSuara);
 assert.match(gerai.body.ruangSuara,/:ENTITY_ADMIN:name-e1$/);
});
test('inactive store or suspended tenant cannot read voice namespace or change assistant settings', async t => {
 const f=await fixture(t);const path='/api/caca/pengaturan?store=G001';
 const tenant=f.sqlite.prepare("SELECT tenant_id FROM entity_tenancy WHERE entity_id='ENT-G001' AND effective_to IS NULL").get().tenant_id;
 await f.call(path,'PATCH',{namaAsisten:'Jarvis'});
 f.sqlite.exec("UPDATE stores SET is_active=0 WHERE id='store_001'");
 assert.equal((await f.call(path)).status,409);
 assert.equal((await f.call(path,'PATCH',{namaAsisten:'Inactive Leak'})).status,409);
 f.sqlite.exec("UPDATE stores SET is_active=1 WHERE id='store_001'");
 f.sqlite.prepare("UPDATE tenants SET status='SUSPENDED' WHERE id=?").run(tenant);
 for(const scope of [path,'/api/caca/pengaturan?lingkup=entity']){
  assert.equal((await f.call(scope)).status,403);
  assert.equal((await f.call(scope,'PATCH',{namaAsisten:'Suspended Leak'})).status,403);
 }
 assert.equal(f.sqlite.prepare("SELECT setting_value FROM tenant_policy_settings WHERE tenant_id=? AND setting_key='una_nama_asisten'").get(tenant).setting_value,'Jarvis');
});

test('Owner still needs an active current entity and tenant for assistant settings', async t => {
 const f=await fixture(t);
 f.sqlite.prepare("INSERT INTO owner_sessions(token_hash,owner_id,created_at,expires_at) VALUES(?,'owner_primary','2026-01-01T00:00:00Z','2099-01-01T00:00:00Z')").run(await hashCredential('owner-test'));
 const path='/api/caca/pengaturan?store=G001';
 assert.equal((await f.call(path,'GET',undefined,'owner-test')).status,200);
 f.sqlite.exec("UPDATE entities SET status='CLOSED' WHERE id='ENT-G001'");
 assert.equal((await f.call(path,'GET',undefined,'owner-test')).status,403);
 assert.equal((await f.call(path,'PATCH',{namaAsisten:'Closed Leak'},'owner-test')).status,403);
});
test('healthy text chat and readiness add only one bounded metadata query and no queue writes', async t => {
 const f=await fixture(t);
 f.sqlite.prepare("INSERT INTO owner_sessions(token_hash,owner_id,created_at,expires_at) VALUES(?,'owner_primary','2026-01-01T00:00:00Z','2099-01-01T00:00:00Z')").run(await hashCredential('owner-perf'));
 const queries=[];const prepare=f.env.DB.prepare;
 f.env.DB.prepare=sql=>{queries.push(sql);return prepare(sql);};
 const healthy={pertanyaan:'batal',tertunda:{alat:'buat_barang',tangkapan:{},tanya:'Harga berapa?',kurang:'barang_harga_jual'}};
 for(const[token,scope,count]of[['name-e1','?store=G001',6],['name-e1','?lingkup=entity',2],['owner-perf','?store=G001',3]]){
  for(const endpoint of ['tanya','kesiapan','pengaturan']){
   queries.length=0;
   const result=await f.call('/api/caca/'+endpoint+scope,endpoint==='tanya'?'POST':'GET',endpoint==='tanya'?healthy:undefined,token);
   assert.equal(result.status,200,JSON.stringify(result.body));
   assert.equal(queries.length,count,endpoint+' '+token+' '+scope+' query count');
   assert.equal(queries.filter(sql=>sql.includes('AS nama_asisten')).length,1);
   assert.equal(queries.filter(sql=>/una_belum_paham|\b(?:INSERT|UPDATE|DELETE)\b/i.test(sql)).length,0);
  }
 }
});

test('assistant metadata is fresh per request and corrupt oversized settings fall back safely', async t => {
 const f=await fixture(t);const path='/api/caca/pengaturan?store=G001';
 const tenant=f.sqlite.prepare("SELECT tenant_id FROM entity_tenancy WHERE entity_id='ENT-G001' AND effective_to IS NULL").get().tenant_id;
 assert.equal((await f.call(path)).body.namaAsisten,'Una');
 await f.call(path,'PATCH',{namaAsisten:'Jarvis'});
 assert.equal((await f.call(path)).body.namaAsisten,'Jarvis');
 f.sqlite.prepare("UPDATE tenant_policy_settings SET setting_value=? WHERE tenant_id=? AND setting_key='una_nama_asisten'").run('a'.repeat(10000),tenant);
 f.sqlite.prepare("INSERT INTO tenant_policy_settings(tenant_id,setting_key,setting_value) VALUES(?,'ui_skin',?) ON CONFLICT(tenant_id,setting_key) DO UPDATE SET setting_value=excluded.setting_value").run(tenant,'F'.repeat(10000));
 const fallback=await f.call(path);
 assert.equal(fallback.status,200);assert.equal(fallback.body.namaAsisten,'Una');assert.equal(fallback.body.skin,'classic');
});