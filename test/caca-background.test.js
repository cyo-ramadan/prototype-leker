import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import worker from '../src/index.js';
import { handleCacaApi } from '../src/caca-chat.js';
import { hashCredential } from '../src/owner-auth.js';

class Statement {
 constructor(db,sql,params=[]){Object.assign(this,{db,sql,params});}
 bind(...params){return new Statement(this.db,this.sql,params);}
 first(){return this.db.prepare(this.sql).get(...this.params)??null;}
 all(){return{results:this.db.prepare(this.sql).all(...this.params)};}
 run(){return{success:true,meta:{changes:Number(this.db.prepare(this.sql).run(...this.params).changes)}};}
}
async function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort())sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 sqlite.exec("INSERT INTO entity_admins(id,entity_id,username,password_hash,display_name) VALUES('bg-e1','ENT-G001','bg-e1','x','One')");
 sqlite.prepare("INSERT INTO entity_admin_sessions(token_hash,entity_admin_id,created_at,expires_at) VALUES(?,'bg-e1','2026-01-01T00:00:00Z','2099-01-01T00:00:00Z')").run(await hashCredential('background-token'));
 const env={DB:{prepare:sql=>new Statement(sqlite,sql),batch:async statements=>statements.map(statement=>statement.run())}};
 return{sqlite,env};
}
function request(path='/api/caca/tanya?store=G001',token='background-token'){
 const method=path.includes('/jelaskan')?'GET':'POST';
 return new Request('https://example.test'+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify({pertanyaan:'buka halaman tidakadadiaplikasi',conversationId:'12345678-1234-4234-8234-123456789abc'})}:{})});
}
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}
function blockRecording(f,shouldFail=false){
 const entered=deferred(),release=deferred();const prepare=f.env.DB.prepare;
 f.env.DB.prepare=sql=>{
  const statement=prepare(sql);
  if(!sql.includes('FROM customers c JOIN stores s'))return statement;
  const wrap=value=>{
   const bind=value.bind.bind(value);
   value.bind=(...params)=>wrap(bind(...params));
   value.all=async()=>{entered.resolve();await release.promise;if(shouldFail)throw new Error('never-log-private-secret');return{results:[]};};
   return value;
  };
  return wrap(statement);
 };
 return{entered,release};
}
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('response waited for blocked diagnostics')),1000))]);}finally{clearTimeout(timer);}}

test('Worker routing keeps bound waitUntil and returns while diagnostics are blocked',async t=>{
 const f=await fixture(t);const block=blockRecording(f);const tasks=[];
 const ctx={waitUntil(task){assert.equal(this,ctx);assert.ok(task instanceof Promise);tasks.push(task);}};
 const responsePromise=worker.fetch(request(),f.env,ctx);
 await bounded(block.entered.promise);
 const response=await bounded(responsePromise);
 assert.equal(response.status,200);assert.equal((await response.json()).navigasi,null);
 assert.equal(tasks.length,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM una_belum_paham').get().n,0);
 block.release.resolve();await Promise.all(tasks);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM una_belum_paham').get().n,1);
});

test('direct callers without ctx await best-effort diagnostics before returning',async t=>{
 const f=await fixture(t);const block=blockRecording(f);let settled=false;
 const req=request();const responsePromise=handleCacaApi(req,f.env,new URL(req.url).pathname).then(response=>{settled=true;return response;});
 await bounded(block.entered.promise);await Promise.resolve();assert.equal(settled,false);
 block.release.resolve();assert.equal((await responsePromise).status,200);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM una_belum_paham').get().n,1);
});

test('background errors are observed and logged without raw errors, tokens or conversation text',async t=>{
 const f=await fixture(t);const block=blockRecording(f,true);const tasks=[];const warnings=[];
 const warn=console.warn;console.warn=(...args)=>warnings.push(args);t.after(()=>{console.warn=warn;});
 const responsePromise=worker.fetch(request(),f.env,{waitUntil(task){tasks.push(task);}});
 await bounded(block.entered.promise);assert.equal((await bounded(responsePromise)).status,200);
 block.release.resolve();await Promise.all(tasks);
 assert.equal(tasks.length,1);assert.equal(warnings.length,1);
 assert.match(JSON.stringify(warnings),/UNA_DIAGNOSTIC_UNAVAILABLE/);
 assert.doesNotMatch(JSON.stringify(warnings),/never-log-private-secret|background-token|tidakadadiaplikasi/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM una_belum_paham').get().n,0);
});

test('background scheduling never bypasses authorization and scoped missing guidance remains recorded',async t=>{
 const f=await fixture(t);const tasks=[];const ctx={waitUntil(task){tasks.push(task);}};
 assert.equal((await worker.fetch(request(undefined,'invalid-token'),f.env,ctx)).status,401);
 assert.equal((await worker.fetch(request('/api/caca/tanya?store=G002'),f.env,ctx)).status,403);
 assert.equal(tasks.length,0);
 const req=request('/api/caca/jelaskan?lingkup=entity&topik=tidakadadidalampanduan');
 const response=await worker.fetch(req,f.env,ctx);assert.equal(response.status,200);
 await Promise.all(tasks);
 const rows=f.sqlite.prepare('SELECT scope_kind,entity_id,reason FROM una_belum_paham').all();
 assert.equal(rows.length,1);assert.equal(rows[0].scope_kind,'entity');assert.equal(rows[0].entity_id,'ENT-G001');assert.equal(rows[0].reason,'topik_tidak_ditemukan');
});