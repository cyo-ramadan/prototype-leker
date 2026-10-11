import { json } from './http.js';
import { ownerFromRequest, entityAdminFromRequest } from './owner-auth.js';
import { cariAksi, bolehDiLingkup } from './caca-aksi.js';
import { siapkanDraftPengeluaran } from './caca-tulis.js';
import { DEFAULT_STORE_CODE } from './stores.js';
import { getJakartaBusinessDate } from './time.js';

const ROOT = '/api/caca/workspace';
const MAX_BODY = 220000;
const MAX_STEPS = 200;
const LOCK_AGE = 5 * 60000;
const UNFINISHED = new Set(['DRAFT','NEEDS_INPUT','PARTIAL']);
const SENSITIVE = /password|passwd|passphrase|privatekey|apikey|secret|rahasia|katasandi|credential|authorization|accesstoken|refreshtoken|sessiontoken|token|cookie|^auth$|^pass$|^pwd$|^sandi$/i;
const SECRET_TEXT = /(?:\bBearer\s+[A-Za-z0-9._-]{12,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:password|kata\s*sandi|api[_ -]?key|secret)\s*[:=]\s*\S+)/i;
const parse = (value,fallback=null) => { try { return JSON.parse(value); } catch { return fallback; } };
const fail = (message,status=400,code='CACA_WORKSPACE_INVALID') => { const error=new Error(message);error.status=status;error.code=code;return error; };
const plain = value => value && typeof value==='object' && !Array.isArray(value);
function sensitive(value,depth=0) {
  if(depth>16) throw fail('Isian terlalu dalam.');
  if(typeof value==='string') return SECRET_TEXT.test(value);
  if(!value||typeof value!=='object') return false;
  return Object.entries(value).some(([key,child])=>SENSITIVE.test(key.replace(/[^a-z0-9]/gi,''))||sensitive(child,depth+1));
}
function safeValue(value,depth=0) {
  if(depth>12) return null;
  if(typeof value==='string') return SECRET_TEXT.test(value)?'[informasi rahasia disembunyikan]':value.slice(0,4000);
  if(value===null||typeof value==='boolean') return value;
  if(typeof value==='number') return Number.isFinite(value)?value:null;
  if(Array.isArray(value)) return value.slice(0,MAX_STEPS).map(item=>safeValue(item,depth+1));
  if(plain(value)) return Object.fromEntries(Object.entries(value).filter(([key])=>!SENSITIVE.test(key.replace(/[^a-z0-9]/gi,''))&&!['__proto__','constructor','prototype'].includes(key)).slice(0,100).map(([key,child])=>[key,safeValue(child,depth+1)]));
  return null;
}
async function inputBody(request) {
  if(Number(request.headers.get('content-length'))>MAX_BODY) throw fail('Workspace terlalu besar.',413);
  const reader=request.body?.getReader();if(!reader) throw fail('Isian belum dikirim.');
  const parts=[];let size=0;
  for(;;){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();throw fail('Workspace terlalu besar.',413);}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{throw fail('Isian bukan JSON yang valid.');}
  if(!plain(value))throw fail('Isian workspace tidak valid.');
  if(sensitive(value))throw fail('Draft berisi informasi rahasia. Gunakan mode sementara yang tidak menyimpan rahasia.',400,'CACA_WORKSPACE_SENSITIVE');
  return value;
}
async function principal(request,env) {
  const owner=await ownerFromRequest(request,env.DB);
  if(owner)return{key:`OWNER:${owner.id}`,role:'OWNER',id:owner.id};
  const admin=await entityAdminFromRequest(request,env.DB);
  if(admin)return{key:`ENTITY_ADMIN:${admin.id}`,role:'ENTITY_ADMIN',id:admin.id,entityId:admin.entityId};
  throw fail('Login Owner atau Entity Admin diperlukan.',401,'CACA_WORKSPACE_LOGIN_REQUIRED');
}
async function scopeFor(request,env,actor,stored=null) {
  const params=new URL(request.url).searchParams;
  const kind=stored?.scope_kind||(params.get('lingkup')==='entity'?'entity':'gerai');
  if(kind==='entity') {
    if(actor.role!=='ENTITY_ADMIN')throw fail('Mode entity hanya untuk Entity Admin.',403);
    const entityId=stored?.entity_id||actor.entityId;
    if(entityId!==actor.entityId)throw fail('Lingkup workspace tidak tersedia.',404);
    const entity=await env.DB.prepare("SELECT id,name FROM entities WHERE id=? AND status='ACTIVE'").bind(entityId).first();
    if(!entity)throw fail('Entity sudah tidak aktif.',403);
    return{lingkup:'entity',entityId:entity.id,storeId:null,storeCode:'',label:entity.name};
  }
  const identifier=stored?.store_id||params.get('store')||DEFAULT_STORE_CODE;
  const store=await env.DB.prepare(`SELECT s.id,s.code,s.store_name,s.entity_id FROM stores s JOIN entities e ON e.id=s.entity_id
    WHERE ${stored?'s.id=?':'(s.id=? OR s.code=?)'} AND s.is_active=1 AND e.status='ACTIVE' LIMIT 1`).bind(...(stored?[identifier]:[identifier,String(identifier).toUpperCase()])).first();
  if(!store||(stored&&store.entity_id!==stored.entity_id)||(actor.role==='ENTITY_ADMIN'&&actor.entityId!==store.entity_id))throw fail('Gerai workspace sudah tidak tersedia dalam lingkup akun ini.',403,'CACA_WORKSPACE_SCOPE_CHANGED');
  return{lingkup:'gerai',entityId:store.entity_id,storeId:store.id,storeCode:store.code,label:store.store_name};
}
function scopedRequest(request,scope,path=ROOT,body=null) {
  const url=new URL(path,request.url);url.search='';
  if(scope.lingkup==='entity')url.searchParams.set('lingkup','entity');else url.searchParams.set('store',scope.storeCode);
  const headers=new Headers(request.headers);headers.delete('content-length');headers.set('content-type','application/json');
  return new Request(url,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});
}
function cleanCapture(action,value) {
  if(!plain(value))return{};
  const keys=[...Object.keys(action.skema||{}),...(action.nama==='nonaktifkan_barang'?['nonaktif_id']:[])];
  return Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
}
async function prepare(request,env,scope,input,options,previous=null) {
  const draft=input.draft;
  const pending=input.tertunda;
  const name=draft?.aksi||pending?.alat||previous?.draft?.aksi||previous?.tertunda?.alat;
  if(name&&name!=='catat_pengeluaran') {
    const action=cariAksi(name);
    if(!action||action.baca)throw fail('Jenis draft tidak dapat disimpan di Workspace.');
    if(!bolehDiLingkup(action,scope.lingkup))throw fail('Draft dibuat untuk lingkup lain.',409);
    const capture=cleanCapture(action,input.tangkapan||draft?.tangkapan||pending?.tangkapan||previous?.draft?.tangkapan||previous?.tertunda?.tangkapan);
    if(!options.bangunKonteks)throw fail('Penyusun draft belum tersambung.',503,'CACA_WORKSPACE_UNAVAILABLE');
    const context=await options.bangunKonteks(scopedRequest(request,scope),scope);
    if(!context?.ok)throw fail('Konteks draft tidak tersedia.',context?.response?.status||503);
    // Revisions must regenerate from capture: old draftAsli would freeze its old payload.
    const prepared=await action.siapkan(capture,{...context.ctx,referensi:draft?.muatan?.sourceReferenceId||previous?.draft?.muatan?.sourceReferenceId});
    if(!prepared.ok)return{status:'NEEDS_INPUT',draft:null,total:0,tertunda:{alat:name,tangkapan:capture,tanya:String(prepared.tanya||prepared.error||'Lengkapi isian draft.').slice(0,300),kurang:prepared.kurang||null,revisi:true}};
    const ready={...prepared.draft,tangkapan:capture};
    if(sensitive(ready))throw fail('Draft berisi informasi rahasia dan harus tetap sementara.',400,'CACA_WORKSPACE_SENSITIVE');
    const total=action.bertahap?ready.muatan?.daftar?.length:1;
    if(!Number.isInteger(total)||total<1||total>MAX_STEPS)throw fail('Jumlah langkah draft tidak valid.');
    return{status:'DRAFT',draft:ready,total,tertunda:null};
  }
  if(scope.lingkup!=='gerai')throw fail('Pengeluaran perlu gerai yang dipilih.',409);
  const source=input.tangkapan||pending?.tangkapan||draft||previous?.draft;
  if(!plain(source))throw fail('Draft atau isian tertunda diperlukan.');
  const capture={keterangan:source.keterangan,nominal_tertulis:source.nominal_tertulis??String(source.nominal??''),pihak_tertulis:source.pihak_tertulis??source.pihak,tanggal_tertulis:source.tanggal_tertulis??source.tanggal};
  const prepared=siapkanDraftPengeluaran(capture,{hariIni:getJakartaBusinessDate()});
  if(!prepared.ok)return{status:'NEEDS_INPUT',draft:null,total:0,tertunda:{alat:'catat_pengeluaran',tangkapan:capture,tanya:prepared.tanya,kurang:null,revisi:true}};
  return{status:'DRAFT',draft:prepared.draft,total:1,tertunda:null};
}
async function taskRow(env,id,actor,recover=false) {
  const row=await env.DB.prepare('SELECT * FROM una_workspace_tasks WHERE id=? AND principal_key=?').bind(id,actor.key).first();
  if(!row)throw fail('Workspace tidak ditemukan.',404,'CACA_WORKSPACE_NOT_FOUND');
  if(recover&&row.status==='RUNNING'&&Date.parse(row.locked_at)<Date.now()-LOCK_AGE) {
    await env.DB.prepare("UPDATE una_workspace_tasks SET status='INDETERMINATE',updated_at=? WHERE id=? AND principal_key=? AND status='RUNNING' AND execution_key=?")
      .bind(new Date().toISOString(),id,actor.key,row.execution_key).run();
    row.status='INDETERMINATE';
  }
  return row;
}
function mappedView(row,scope,steps) {
  return{id:row.id,title:row.title,scope,status:row.status,revision:row.revision,cursor:row.cursor,total:row.total,draft:parse(row.draft_json),tertunda:parse(row.pending_json),results:steps.map(step=>({index:step.step_index,status:step.status,result:parse(step.result_json)})),createdAt:row.created_at,updatedAt:row.updated_at};
}
async function view(env,row,scope) {
  const result=await env.DB.prepare('SELECT step_index,status,result_json FROM una_workspace_steps WHERE task_id=? AND revision=? ORDER BY step_index').bind(row.id,row.revision).all();
  return mappedView(row,scope,result.results||[]);
}
async function markUnknown(env,row,actor,token) {
  try{await env.DB.prepare("UPDATE una_workspace_tasks SET status='INDETERMINATE',updated_at=? WHERE id=? AND principal_key=? AND status='RUNNING' AND execution_key=?")
    .bind(new Date().toISOString(),row.id,actor.key,token).run();}catch{}
}
async function unknownView(env,row,actor,scope) {
  try{return{...(await view(env,await taskRow(env,row.id,actor),scope)),status:'INDETERMINATE'};}
  catch{return{...mappedView(row,scope,[]),status:'INDETERMINATE'};}
}

export async function handleCacaWorkspaceApi(request,env,pathname=new URL(request.url).pathname,options={}) {
  if(pathname!==ROOT&&!pathname.startsWith(ROOT+'/'))return null;
  try {
    const actor=await principal(request,env);
    if(pathname===ROOT) {
      const scope=await scopeFor(request,env,actor);
      if(request.method==='GET') {
        const result=await env.DB.prepare('SELECT * FROM una_workspace_tasks WHERE principal_key=? AND entity_id=? AND scope_kind=? AND store_id IS ? ORDER BY updated_at DESC,id LIMIT 60').bind(actor.key,scope.entityId,scope.lingkup,scope.storeId).all();
        const taskRows=result.results||[];
        if(!taskRows.length)return json({items:[]});
        const cutoff=new Date(Date.now()-LOCK_AGE).toISOString();
        const stale=taskRows.filter(row=>row.status==='RUNNING'&&row.locked_at<cutoff);
        if(stale.length){
          await env.DB.prepare(`UPDATE una_workspace_tasks SET status='INDETERMINATE',updated_at=? WHERE principal_key=? AND status='RUNNING' AND locked_at<? AND id IN (${stale.map(()=>'?').join(',')})`)
            .bind(new Date().toISOString(),actor.key,cutoff,...stale.map(row=>row.id)).run();
          for(const row of stale)row.status='INDETERMINATE';
        }
        // One bounded lookup for all visible tasks, never a query per task/step.
        const steps=await env.DB.prepare(`SELECT s.task_id,s.step_index,s.status,s.result_json FROM una_workspace_steps s JOIN una_workspace_tasks t ON t.id=s.task_id AND t.revision=s.revision WHERE t.principal_key=? AND t.id IN (${taskRows.map(()=>'?').join(',')}) ORDER BY s.task_id,s.step_index`)
          .bind(actor.key,...taskRows.map(row=>row.id)).all();
        const grouped=new Map();for(const step of steps.results||[]){if(!grouped.has(step.task_id))grouped.set(step.task_id,[]);grouped.get(step.task_id).push(step);}
        const items=taskRows.map(row=>mappedView(row,scope,grouped.get(row.id)||[]));
        return json({items});
      }
      if(request.method==='POST') {
        const input=await inputBody(request);const value=await prepare(request,env,scope,input,options);
        const id=crypto.randomUUID(),now=new Date().toISOString();const title=String(input.title||value.draft?.judul||value.draft?.keterangan||value.tertunda?.alat||'Pekerjaan Una').trim().slice(0,160);
        await env.DB.prepare(`INSERT INTO una_workspace_tasks(id,principal_key,entity_id,store_id,scope_kind,title,status,revision,cursor,total,draft_json,pending_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,0,?,?,?,?,?)`)
          .bind(id,actor.key,scope.entityId,scope.storeId,scope.lingkup,title,value.status,value.total,value.draft?JSON.stringify(value.draft):null,value.tertunda?JSON.stringify(value.tertunda):null,now,now).run();
        return json({workspace:await view(env,await taskRow(env,id,actor),scope)},201);
      }
      throw fail('Metode tidak tersedia.',405);
    }
    const match=pathname.match(/^\/api\/caca\/workspace\/([a-zA-Z0-9-]{1,80})(\/catat)?$/);if(!match)throw fail('Workspace tidak ditemukan.',404);
    let row=await taskRow(env,match[1],actor);const scope=await scopeFor(request,env,actor,row);row=await taskRow(env,row.id,actor,true);
    if(request.method==='GET'&&!match[2])return json({workspace:await view(env,row,scope)});
    const input=await inputBody(request);
    if(!Number.isInteger(input.revision)||input.revision!==row.revision)throw fail('Draft sudah direvisi. Tinjau versi terbaru sebelum melanjutkan.',409,'CACA_WORKSPACE_STALE');
    if(request.method==='PATCH'&&!match[2]) {
      if(input.cancel===true) {
        if(!UNFINISHED.has(row.status))throw fail('Pekerjaan sedang berjalan atau hasilnya perlu diperiksa; tidak dapat dibatalkan otomatis.',409);
        const changed=await env.DB.prepare("UPDATE una_workspace_tasks SET status='CANCELLED',updated_at=? WHERE id=? AND principal_key=? AND revision=? AND status IN('DRAFT','NEEDS_INPUT','PARTIAL')").bind(new Date().toISOString(),row.id,actor.key,row.revision).run();
        if(changed.meta?.changes!==1)throw fail('Workspace berubah. Muat ulang.',409);
      } else {
        if(row.cursor!==0||!['DRAFT','NEEDS_INPUT'].includes(row.status))throw fail('Draft hanya bisa direvisi sebelum langkah pertama dijalankan.',409);
        const old={draft:parse(row.draft_json),tertunda:parse(row.pending_json)};
        const changing=input.draft||input.tangkapan||input.tertunda;
        const value=changing?await prepare(request,env,scope,input,options,old):{status:row.status,draft:old.draft,tertunda:old.tertunda,total:row.total};
        const title=Object.hasOwn(input,'title')?String(input.title).trim().slice(0,160):row.title;
        if(!title)throw fail('Judul tidak boleh kosong.');
        const changed=await env.DB.prepare(`UPDATE una_workspace_tasks SET title=?,status=?,revision=revision+1,total=?,draft_json=?,pending_json=?,updated_at=? WHERE id=? AND principal_key=? AND revision=? AND cursor=0 AND status IN('DRAFT','NEEDS_INPUT')`)
          .bind(title,value.status,value.total,value.draft?JSON.stringify(value.draft):null,value.tertunda?JSON.stringify(value.tertunda):null,new Date().toISOString(),row.id,actor.key,row.revision).run();
        if(changed.meta?.changes!==1)throw fail('Workspace berubah. Tinjau versi terbaru.',409,'CACA_WORKSPACE_STALE');
      }
      return json({workspace:await view(env,await taskRow(env,row.id,actor),scope)});
    }
    if(request.method!=='POST'||!match[2])throw fail('Metode tidak tersedia.',405);
    if(!Number.isInteger(input.expectedCursor)||input.expectedCursor<0)throw fail('Urutan langkah tidak valid.');
    if(input.expectedCursor<row.cursor) {
      const done=await env.DB.prepare("SELECT result_json FROM una_workspace_steps WHERE task_id=? AND revision=? AND step_index=? AND status='COMPLETED'").bind(row.id,row.revision,input.expectedCursor).first();
      if(done)return json({workspace:await view(env,row,scope),result:parse(done.result_json),replayed:true});
    }
    if(input.expectedCursor!==row.cursor||!['DRAFT','PARTIAL'].includes(row.status)||row.cursor>=row.total)throw fail('Langkah sudah berubah, sedang berjalan, atau perlu diperiksa manual. Tidak diulang otomatis.',409,'CACA_WORKSPACE_NOT_EXECUTABLE');
    if(!options.jalurUtama)throw fail('Jalur pencatatan belum tersambung.',503);
    const token=crypto.randomUUID(),now=new Date().toISOString();
    const claim=await env.DB.prepare("UPDATE una_workspace_tasks SET status='RUNNING',execution_key=?,locked_at=?,updated_at=? WHERE id=? AND principal_key=? AND revision=? AND cursor=? AND status IN('DRAFT','PARTIAL')")
      .bind(token,now,now,row.id,actor.key,row.revision,row.cursor).run();
    if(claim.meta?.changes!==1)throw fail('Langkah sedang dijalankan oleh permintaan lain.',409,'CACA_WORKSPACE_BUSY');
    const draft=parse(row.draft_json);const action=cariAksi(draft?.aksi);
    let response,data;
    try {
      // Fixed canonical endpoint: all accounting wrappers and draft revalidation remain intact.
      response=await options.jalurUtama(scopedRequest(request,scope,'/api/caca/catat',{draft,...(action?.bertahap?{bagian:row.cursor}:{})}));
      data=await response?.json();
      if(!response?.ok||data?.tercatat!==true)throw new Error('Canonical result is uncertain');
    }catch{await markUnknown(env,row,actor,token);return json({error:'Hasil langkah belum dapat dipastikan. Periksa data asli sebelum melanjutkan; langkah tidak akan diulang otomatis.',code:'CACA_WORKSPACE_INDETERMINATE',workspace:await unknownView(env,row,actor,scope)},409);}
    const result=safeValue(Object.fromEntries(['tercatat','bagian','jumlah','hasil','nama','id','selesai','jawaban','draft'].filter(key=>Object.hasOwn(data,key)).map(key=>[key,data[key]])));
    const next=row.cursor+1,status=next>=row.total?'COMPLETED':'PARTIAL',finished=new Date().toISOString();
    try {
      const committed=await env.DB.batch([
        env.DB.prepare(`INSERT INTO una_workspace_steps(task_id,revision,step_index,status,result_json,created_at)
          SELECT id,revision,cursor,'COMPLETED',?,? FROM una_workspace_tasks WHERE id=? AND principal_key=? AND revision=? AND cursor=? AND status='RUNNING' AND execution_key=?`).bind(JSON.stringify(result),finished,row.id,actor.key,row.revision,row.cursor,token),
        env.DB.prepare("UPDATE una_workspace_tasks SET cursor=?,status=?,execution_key=NULL,locked_at=NULL,updated_at=? WHERE id=? AND principal_key=? AND revision=? AND cursor=? AND status='RUNNING' AND execution_key=?")
          .bind(next,status,finished,row.id,actor.key,row.revision,row.cursor,token)
      ]);
      if(committed.some(item=>item.meta?.changes!==1))throw new Error('Workspace completion lost lock');
    }catch{await markUnknown(env,row,actor,token);return json({error:'Pencatatan mungkin sudah berhasil, tetapi progres belum terkonfirmasi. Periksa data asli; jangan ulang langkah ini.',code:'CACA_WORKSPACE_INDETERMINATE',workspace:await unknownView(env,row,actor,scope)},503);}
    return json({workspace:await view(env,await taskRow(env,row.id,actor),scope),result,...(data.rahasia?{rahasia:data.rahasia}:{})});
  }catch(error){return json({error:error.status?error.message:'Workspace belum dapat dimuat. Coba muat ulang tanpa menjalankan langkah lagi.',code:error.code||'CACA_WORKSPACE_UNAVAILABLE'},error.status||503);}
}
