import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { hashCredential } from '../src/owner-auth.js';
import { handleUnaSurfacesApi } from '../src/una-surfaces.js';
class Statement {
  constructor(db,sql,params=[]){Object.assign(this,{db,sql,params});}
  bind(...params){assert.ok(params.length<=100);return new Statement(this.db,this.sql,params);}
  first(){return this.db.prepare(this.sql).get(...this.params)??null;}
  all(){return {results:this.db.prepare(this.sql).all(...this.params)};}
  run(){return {meta:{changes:Number(this.db.prepare(this.sql).run(...this.params).changes)}};}
}
async function fixture(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>/^\d{4}_.*\.sql$/.test(n)).sort())db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  db.exec("INSERT INTO entity_admins(id,entity_id,username,password_hash,display_name) VALUES('s1','ENT-G001','s1','x','One'),('s2','ENT-G002','s2','x','Two'),('s3','ENT-G001','s3','x','Other account')");
  for(const token of ['s1','s2','s3'])db.prepare("INSERT INTO entity_admin_sessions(token_hash,entity_admin_id,created_at,expires_at) VALUES(?,?,'2026-01-01','2099-01-01')").run(await hashCredential(token),token);
  const env={DB:{prepare:sql=>new Statement(db,sql)}};
  const call=async(path='',method='GET',body,token='s1',scope='?lingkup=entity')=>{
    const response=await handleUnaSurfacesApi(new Request('https://example.test/api/caca/surfaces'+path+scope,{method,headers:{authorization:'Bearer '+token},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env);
    return {status:response.status,body:response.status===204?null:await response.json()};
  };
  return {db,call};
}
const page={kind:'page',title:'Laporan',content:{halaman:'entity',tab:'reports',filters:{from:'2026-10-01',to:'2026-10-10',stores:['G001']}}};
const canvas=JSON.parse(readFileSync(new URL('./fixtures/una-live/lembar.json',import.meta.url),'utf8')).surfaces.find(s=>s.kind==='canvas');
const drawing={kind:'canvas',title:canvas.title,content:canvas.content};
test('surface persistence isolates accounts and scopes on every verb; device sessions share account',async t=>{
  const {call}=await fixture(t);
  assert.equal((await call('','GET',undefined,'bad')).status,401);
  const created=await call('','POST',drawing);assert.equal(created.status,201,JSON.stringify(created.body));const s=created.body.surface;
  assert.equal((await call('/'+s.id)).body.surface.title,drawing.title);
  for(const token of ['s2','s3'])for(const [verb,body] of [['GET',undefined],['PATCH',{expectedRevision:1,title:'forged'}],['DELETE',undefined]])assert.equal((await call('/'+s.id,verb,body,token,verb==='DELETE'?'?lingkup=entity&expectedRevision=1':'?lingkup=entity')).status,404);
  assert.equal((await call('/'+s.id,'GET',undefined,'s1','?store=G001')).status,404);
  assert.equal((await call()).body.items[0].content,undefined);
  assert.ok(!JSON.stringify(s).includes('principal'));assert.equal(s.scope.entityId,undefined);
});
test('page identity is unique with NULL store even under concurrent create; reload keeps filters only',async t=>{
  const {call,db}=await fixture(t);const results=await Promise.all([call('','POST',page),call('','POST',page)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);assert.equal(results[0].body.surface.id,results[1].body.surface.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM una_surfaces').get().n,1);
  const result=await call('','POST',{...page,content:{...page.content,rows:[{amount:1}]}});assert.equal(result.status,400);
});
test('two devices compare revisions atomically; delete requires expected revision',async t=>{
  const {call}=await fixture(t);const s=(await call('','POST',drawing)).body.surface;
  const results=await Promise.all([call('/'+s.id,'PATCH',{expectedRevision:1,title:'One'}),call('/'+s.id,'PATCH',{expectedRevision:1,title:'Two'})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(results.find(r=>r.status===409).body.surface.revision,2);
  assert.equal((await call('/'+s.id,'DELETE',undefined,'s1','?lingkup=entity&expectedRevision=1')).status,409);
  assert.equal((await call('/'+s.id,'DELETE',undefined,'s1','?lingkup=entity&expectedRevision=2')).status,204);
  assert.equal((await call('/'+s.id)).status,404);
});
test('invalid artifacts, credentials, active HTML, forged identity and cross-store filters never persist',async t=>{
  const {call,db}=await fixture(t);
  for(const body of [{...page,principal_key:'other'},{...drawing,title:'password: secret'}, {...page,content:{...page.content,tab:'accounting'}}, {...page,content:{...page.content,filters:{stores:['G002']}}}, {...drawing,content:{...drawing.content,html:'<script>x</script>'}}, {...drawing,content:{...drawing.content,objects:[{id:'bad',type:'text',z:1,x:1,y:1,text:'<script>alert(1)</script>',fontSize:18,color:'#000000'}]}}])assert.equal((await call('','POST',body)).status,400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM una_surfaces').get().n,0);
  assert.equal((await call('','POST',{...drawing,content:{x:'x'.repeat(525000)}})).status,413);
});
test('reparenting store and inactive tenancy invalidate prior surfaces',async t=>{
  const {call,db}=await fixture(t);const s=(await call('','POST',drawing,'s1','?store=G001')).body.surface;
  db.exec("UPDATE stores SET entity_id='ENT-G002' WHERE code='G001'");
  for(const verb of ['GET','PATCH','DELETE'])assert.equal((await call('/'+s.id,verb,verb==='PATCH'?{expectedRevision:1,title:'No'}:undefined,'s1','?store=G001&expectedRevision=1')).status,404);
});
