import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { hashCredential } from '../src/owner-auth.js';
import { handleCacaWorkspaceApi } from '../src/caca-workspace.js';

class Statement {
 constructor(db,sql,params=[]){this.db=db;this.sql=sql;this.params=params;}
 bind(...params){assert.ok(params.length<=100);return new Statement(this.db,this.sql,params);}
 first(){return this.db.prepare(this.sql).get(...this.params)??null;}
 all(){return{results:this.db.prepare(this.sql).all(...this.params)};}
 run(){return{meta:{changes:Number(this.db.prepare(this.sql).run(...this.params).changes)}};}
}
async function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort())sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const env={DB:{prepare:sql=>new Statement(sqlite,sql),batch:async statements=>{sqlite.exec('BEGIN');try{const results=statements.map(s=>s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}}};
 sqlite.exec(`INSERT INTO entity_admins(id,entity_id,username,password_hash,display_name) VALUES('ws-e1','ENT-G001','ws-e1','x','Entity One'),('ws-e2','ENT-G002','ws-e2','x','Entity Two')`);
 for(const[token,table,column,id]of[['owner','owner_sessions','owner_id','owner_primary'],['e1','entity_admin_sessions','entity_admin_id','ws-e1'],['e2','entity_admin_sessions','entity_admin_id','ws-e2'],['admin','store_admin_sessions','admin_id','admin_g001_bablil']])sqlite.prepare(`INSERT INTO ${table}(token_hash,${column},created_at,expires_at) VALUES(?,?,'2026-01-01T00:00:00Z','2099-01-01T00:00:00Z')`).run(await hashCredential(token),id);
 const calls=[];
 const options={bangunKonteks:async(req,scope)=>({ok:true,ctx:{lingkup:scope.lingkup,storeCode:scope.storeCode,namaLingkup:scope.label,hariIni:'2026-10-11',baca:async()=>({ok:true,data:{products:[{id:10001,name:'Satu'},{id:10002,name:'Dua'}],units:[{id:'PCS',code:'PCS',name:'Pcs',symbol:'pcs'}],categories:['Menu'],accounts:[]}})}}),jalurUtama:async request=>{calls.push({request,body:await request.json()});return Response.json({tercatat:true,jawaban:'Sudah dicatat.',hasil:'dibuat',id:'fact-one'});}};
 return{sqlite,env,options,calls};
}
function req(path,token='e1',method='GET',body){return new Request('https://example.test'+path,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),'content-type':'application/json'},...(body!==undefined&&method!=='GET'&&method!=='HEAD'?{body:JSON.stringify(body)}:{})});}
async function call(f,path,token='e1',method='GET',body){const response=await handleCacaWorkspaceApi(req(path,token,method,body),f.env,new URL('https://example.test'+path).pathname,f.options);return{status:response.status,body:await response.json()};}
const base='/api/caca/workspace';
const expense={jenis:'BEA_LAINNYA',keterangan:'Tagihan lapak',nominal:5000,pihak:'Pemilik lokasi',tanggal:'2026-10-01'};
async function create(f,body={draft:expense},token='e1',query='?store=G001'){const result=await call(f,base+query,token,'POST',body);assert.equal(result.status,201,JSON.stringify(result.body));return result.body.workspace;}
const path=task=>base+'/'+task.id;

test('workspace requires human Owner/EntityAdmin and persists only own scoped tasks',async t=>{
 const f=await fixture(t);
 for(const token of [null,'bad','admin'])assert.equal((await call(f,base+'?store=G001',token)).status,401);
 const task=await create(f,{draft:expense,title:'Tugas sewa',principal_key:'OWNER:owner_primary',entity_id:'ENT-G002'});
 assert.equal(task.scope.entityId,'ENT-G001');assert.equal(task.scope.storeId,'store_001');assert.equal(task.revision,1);assert.equal(task.status,'DRAFT');
 assert.equal((await call(f,path(task),'e2')).status,404);assert.equal((await call(f,path(task),'owner')).status,404);
 const list=await call(f,base+'?store=G001');assert.equal(list.body.items.length,1);assert.equal(list.body.items[0].title,'Tugas sewa');
 assert.equal((await call(f,base+'?store=G002','e1')).status,403);
 assert.equal((await call(f,path(task)+'?store=G002')).body.workspace.scope.storeId,'store_001');
 assert.equal(f.calls.length,0);
});

test('inactive or reparented gerai invalidates previously stored workspace on every access',async t=>{
 const f=await fixture(t);const task=await create(f);
 f.sqlite.exec("UPDATE stores SET is_active=0 WHERE id='store_001'");
 for(const[method,suffix,body]of[['GET','',null],['PATCH','',{revision:1,title:'No'}],['POST','/catat',{revision:1,expectedCursor:0}]])assert.equal((await call(f,path(task)+suffix,'e1',method,body)).status,403);
 f.sqlite.exec("UPDATE stores SET is_active=1,entity_id='ENT-G002' WHERE id='store_001'");
 assert.equal((await call(f,path(task),'e1')).status,403);assert.equal(f.calls.length,0);
});

test('entity scope is bound to active entity admin; Owner cannot guess an entity scope',async t=>{
 const f=await fixture(t);
 assert.equal((await call(f,base+'?lingkup=entity','owner')).status,403);
 const task=await create(f,{tertunda:{alat:'buat_jurnal',tangkapan:{}}},'e1','?lingkup=entity');
 assert.equal(task.scope.lingkup,'entity');assert.equal(task.scope.entityId,'ENT-G001');assert.equal(task.status,'NEEDS_INPUT');
 assert.equal((await call(f,path(task),'e2')).status,404);
 f.sqlite.exec("UPDATE entities SET status='CLOSED' WHERE id='ENT-G001'");
 assert.equal((await call(f,path(task))).status,401);
});

test('revisions regenerate from capture, ignore forged muatan, and invalidate previous review',async t=>{
 const f=await fixture(t);
 const task=await create(f,{draft:{aksi:'buat_barang',tangkapan:{barang_nama:'Baru',barang_harga_jual:'5000'},muatan:{name:'Forged',price:1}}});
 assert.equal(task.draft.muatan.name,'Baru');assert.equal(task.draft.muatan.price,5000);
 const revised=await call(f,path(task),'e1','PATCH',{revision:1,tangkapan:{barang_nama:'Revisi',barang_harga_jual:'6000'}});
 assert.equal(revised.status,200);assert.equal(revised.body.workspace.revision,2);assert.equal(revised.body.workspace.draft.muatan.name,'Revisi');assert.equal(revised.body.workspace.draft.muatan.price,6000);
 assert.equal((await call(f,path(task)+'/catat','e1','POST',{revision:1,expectedCursor:0})).status,409);assert.equal(f.calls.length,0);
});

test('incomplete draft persists, cannot execute, and can be completed without AI',async t=>{
 const f=await fixture(t);
 const task=await create(f,{tertunda:{alat:'buat_barang',tangkapan:{barang_nama:'Belum Lengkap'}}});
 assert.equal(task.status,'NEEDS_INPUT');assert.equal(task.draft,null);assert.ok(task.tertunda.tanya);
 assert.equal((await call(f,path(task)+'/catat','e1','POST',{revision:1,expectedCursor:0})).status,409);
 const ready=await call(f,path(task),'e1','PATCH',{revision:1,tangkapan:{barang_nama:'Lengkap',barang_harga_jual:'5000'}});
 assert.equal(ready.body.workspace.status,'DRAFT');assert.equal(ready.body.workspace.revision,2);
});

test('one step uses fixed canonical catat endpoint and same identity; double click and replay never repost',async t=>{
 const f=await fixture(t);const task=await create(f);
 let release,entered;const ready=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);
 f.options.jalurUtama=async request=>{f.calls.push({request,body:await request.json()});entered();await hold;return Response.json({tercatat:true,jawaban:'Selesai'});};
 const first=call(f,path(task)+'/catat','e1','POST',{revision:1,expectedCursor:0});await ready;
 const second=await call(f,path(task)+'/catat','e1','POST',{revision:1,expectedCursor:0});assert.equal(second.status,409);release();
 const result=await first;assert.equal(result.status,200);assert.equal(result.body.workspace.status,'COMPLETED');assert.equal(result.body.workspace.cursor,1);
 const replay=await call(f,path(task)+'/catat','e1','POST',{revision:1,expectedCursor:0});assert.equal(replay.body.replayed,true);assert.equal(f.calls.length,1);
 assert.equal(new URL(f.calls[0].request.url).pathname,'/api/caca/catat');assert.equal(new URL(f.calls[0].request.url).searchParams.get('store'),'G001');assert.equal(f.calls[0].request.headers.get('authorization'),'Bearer e1');assert.deepEqual(f.calls[0].body,{draft:task.draft});
 assert.equal((await call(f,path(task),'e1','PATCH',{revision:1,draft:expense})).status,409);
});

test('batch performs exactly next canonical bagian per call; reload resumes durable cursor only explicitly',async t=>{
 const f=await fixture(t);const task=await create(f,{draft:{aksi:'nonaktifkan_barang',tangkapan:{nonaktif_barang:['Satu','Dua']}}});
 assert.equal(task.total,2);assert.equal((await call(f,path(task)+'/catat','e1','POST',{revision:1,expectedCursor:1})).status,409);
 const first=await call(f,path(task)+'/catat','e1','POST',{revision:1,expectedCursor:0});assert.equal(first.body.workspace.status,'PARTIAL');assert.equal(first.body.workspace.cursor,1);assert.equal(f.calls[0].body.bagian,0);
 const reload=await call(f,path(task));assert.equal(reload.body.workspace.cursor,1);assert.equal(reload.body.workspace.results.length,1);assert.equal(f.calls.length,1);
 assert.equal((await call(f,path(task),'e1','PATCH',{revision:1,tangkapan:{nonaktif_barang:['Dua']}})).status,409);
 const next=await call(f,path(task)+'/catat','e1','POST',{revision:1,expectedCursor:1});assert.equal(next.body.workspace.status,'COMPLETED');assert.equal(f.calls[1].body.bagian,1);assert.equal(next.body.workspace.results.length,2);
});

test('ambiguous canonical response never unlocks for retry, even if business write already committed',async t=>{
 const f=await fixture(t);const task=await create(f);
 f.options.jalurUtama=async()=>{f.calls.push('possibly-committed');return Response.json({error:'Bridge failed after write'},{status:502});};
 const failed=await call(f,path(task)+'/catat','e1','POST',{revision:1,expectedCursor:0});assert.equal(failed.status,409);assert.equal(failed.body.workspace.status,'INDETERMINATE');
 assert.equal((await call(f,path(task)+'/catat','e1','POST',{revision:1,expectedCursor:0})).status,409);assert.equal(f.calls.length,1);
 assert.equal((await call(f,path(task),'e1','PATCH',{revision:1,cancel:true})).status,409);
});

test('post-write progress failure and stale crash lock require manual review rather than duplicate transaction',async t=>{
 const f=await fixture(t);const task=await create(f);
 f.env.DB.batch=async()=>{throw new Error('progress unavailable');};
 const failed=await call(f,path(task)+'/catat','e1','POST',{revision:1,expectedCursor:0});assert.equal(failed.status,503);assert.equal(failed.body.workspace.status,'INDETERMINATE');
 assert.equal((await call(f,path(task)+'/catat','e1','POST',{revision:1,expectedCursor:0})).status,409);assert.equal(f.calls.length,1);
 const fresh=await create(f);f.sqlite.prepare("UPDATE una_workspace_tasks SET status='RUNNING',locked_at='2020-01-01T00:00:00Z',execution_key='crashed' WHERE id=?").run(fresh.id);
 const crashed=await call(f,path(fresh));assert.equal(crashed.body.workspace.status,'INDETERMINATE');assert.equal((await call(f,path(fresh)+'/catat','e1','POST',{revision:1,expectedCursor:0})).status,409);
});

test('sensitive data rejected recursively before persistence, output secrets remain ephemeral only',async t=>{
 const f=await fixture(t);
 for(const extra of [{unknown:{nested:{api_key:'hidden'}}},{history:[{credentials:{password:'hidden'}}]},{draft:{...expense,unknown:{access_token:'hidden'}}},{title:'password: hidden'}]){
  const result=await call(f,base+'?store=G001','e1','POST',{draft:expense,...extra});assert.equal(result.status,400);assert.equal(result.body.code,'CACA_WORKSPACE_SENSITIVE');
 }
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM una_workspace_tasks').get().n,0);
 const task=await create(f);f.options.jalurUtama=async()=>Response.json({tercatat:true,jawaban:'Selesai',rahasia:{password:'one-time'},hasil:{nested:{token:'never-persist',ok:true}}});
 const result=await call(f,path(task)+'/catat','e1','POST',{revision:1,expectedCursor:0});assert.equal(result.status,200);assert.deepEqual(result.body.rahasia,{password:'one-time'});
 const stored=JSON.stringify(f.sqlite.prepare('SELECT * FROM una_workspace_steps').all());assert.ok(!stored.includes('one-time'));assert.ok(!stored.includes('never-persist'));assert.deepEqual(result.body.workspace.results[0].result.hasil,{nested:{ok:true}});
 const replay=await call(f,path(task)+'/catat','e1','POST',{revision:1,expectedCursor:0});assert.equal(replay.body.rahasia,undefined);
});

test('cancel is compare-and-swap metadata only; partial cancellation never reverses completed facts',async t=>{
 const f=await fixture(t);const task=await create(f);
 assert.equal((await call(f,path(task),'e1','PATCH',{revision:999,cancel:true})).status,409);
 const cancelled=await call(f,path(task),'e1','PATCH',{revision:1,cancel:true});assert.equal(cancelled.body.workspace.status,'CANCELLED');assert.equal(cancelled.body.workspace.revision,1);
 assert.equal((await call(f,path(task)+'/catat','e1','POST',{revision:1,expectedCursor:0})).status,409);assert.equal(f.calls.length,0);
});


test('listing sixty tasks uses bounded queries and one bulk step lookup',async t=>{
 const f=await fixture(t);const first=await create(f);
 const row=f.sqlite.prepare('SELECT * FROM una_workspace_tasks WHERE id=?').get(first.id);
 const columns=Object.keys(row);const insert=f.sqlite.prepare(`INSERT INTO una_workspace_tasks(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
 for(let index=1;index<60;index++)insert.run(...columns.map(column=>column==='id'?`task-${index}`:row[column]));
 for(const task of f.sqlite.prepare('SELECT id,revision FROM una_workspace_tasks').all())f.sqlite.prepare("INSERT INTO una_workspace_steps(task_id,revision,step_index,status,result_json,created_at) VALUES(?,?,0,'COMPLETED',?,'2026-10-01')").run(task.id,task.revision,JSON.stringify({tercatat:true}));
 let queries=0;const prepare=f.env.DB.prepare;f.env.DB.prepare=sql=>{queries++;return prepare(sql);};
 const result=await call(f,base+'?store=G001');assert.equal(result.status,200);assert.equal(result.body.items.length,60);assert.ok(result.body.items.every(task=>task.results.length===1));assert.ok(queries<=8,`${queries} queries for list`);
});


test('cancelling a partial batch preserves completed step history and does not execute the remainder',async t=>{
 const f=await fixture(t);const task=await create(f,{draft:{aksi:'nonaktifkan_barang',tangkapan:{nonaktif_barang:['Satu','Dua']}}});
 await call(f,path(task)+'/catat','e1','POST',{revision:1,expectedCursor:0});
 const cancelled=await call(f,path(task),'e1','PATCH',{revision:1,cancel:true});
 assert.equal(cancelled.body.workspace.status,'CANCELLED');assert.equal(cancelled.body.workspace.cursor,1);assert.equal(cancelled.body.workspace.results.length,1);assert.equal(f.calls.length,1);
 assert.equal((await call(f,path(task)+'/catat','e1','POST',{revision:1,expectedCursor:1})).status,409);
});


test('total database outage after canonical write still reports indeterminate and leaves execution locked',async t=>{
 const f=await fixture(t);const task=await create(f);const prepare=f.env.DB.prepare;
 f.options.jalurUtama=async()=>{f.calls.push('committed');f.env.DB.prepare=()=>{throw new Error('Database unavailable');};return Response.json({tercatat:true,jawaban:'Selesai'});};
 const result=await call(f,path(task)+'/catat','e1','POST',{revision:1,expectedCursor:0});
 assert.equal(result.status,503);assert.equal(result.body.code,'CACA_WORKSPACE_INDETERMINATE');assert.equal(result.body.workspace.status,'INDETERMINATE');
 f.env.DB.prepare=prepare;
 assert.equal((await call(f,path(task)+'/catat','e1','POST',{revision:1,expectedCursor:0})).status,409);assert.equal(f.calls.length,1);
});
