import { json } from './http.js';
import { ownerFromRequest, entityAdminFromRequest } from './owner-auth.js';
import { bacaKonteksAsisten } from './caca-pengaturan.js';
import { menuUntuk } from './caca-peta.js';
import { dateValid } from './una-kemampuan-validasi.js';
import { validateCanvas } from './una-kanvas-patch.js';

const ROOT = '/api/caca/surfaces';
const LIMIT = 512 * 1024;
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const closed = (v,keys) => plain(v) && Object.keys(v).every(k => keys.includes(k));
const fail = (message,status=400,code='INVALID_PARAMS') => Object.assign(new Error(message),{status,code});
const missing = () => fail('Lembar tidak ditemukan.',404,'NOT_FOUND');
const secret = /(?:\bBearer\s+[A-Za-z0-9._-]{12,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:password|kata\s*sandi|api[_ -]?key|secret)\s*[:=]\s*\S+|<\/?(?:script|iframe|object)\b)/i;
function safeText(value) { return typeof value === 'string' && !secret.test(value); }
async function readBody(request) {
  const reader = request.body?.getReader(); if (!reader) throw fail('Isian lembar belum dikirim.');
  let size=0;const chunks=[];
  for (;;) { const {done,value}=await reader.read(); if(done)break; size+=value.byteLength;
    if(size>LIMIT+8192){await reader.cancel();throw fail('Isi lembar terlalu besar.',413,'CONTENT_TOO_LARGE');} chunks.push(value); }
  const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
  try { const body=JSON.parse(new TextDecoder().decode(bytes)); if(!plain(body))throw new Error(); return body; }
  catch { throw fail('Isian lembar bukan JSON yang valid.'); }
}
async function contextFor(request,env) {
  const owner=await ownerFromRequest(request,env.DB);
  const admin=owner?null:await entityAdminFromRequest(request,env.DB);
  if(!owner&&!admin)throw fail('Login Owner atau Entity Admin diperlukan.',401,'LOGIN_REQUIRED');
  const actor={key:owner?'OWNER:'+owner.id:'ENTITY_ADMIN:'+admin.id,role:owner?'OWNER':'ENTITY_ADMIN'};
  const query=new URL(request.url).searchParams;
  let entityId,storeId=null,storeCode='',lingkup;
  if(query.get('lingkup')==='entity') {
    if(!admin)throw fail('Pilih gerai untuk akun Owner.',403,'SCOPE_DENIED');
    entityId=admin.entityId;lingkup='entity';
  } else {
    const code=query.get('store');if(!code)throw fail('Pilih lingkup lembar.');
    const store=await env.DB.prepare('SELECT id,code,entity_id FROM stores WHERE code=? AND is_active=1').bind(code.toUpperCase()).first();
    if(!store||(admin&&admin.entityId!==store.entity_id))throw missing();
    entityId=store.entity_id;storeId=store.id;storeCode=store.code;lingkup='gerai';
  }
  const policy=await bacaKonteksAsisten(env.DB,entityId);
  if(!policy.aktif)throw missing();
  return {...actor,entityId,storeId,storeCode,lingkup,skin:policy.profil.skin};
}
function validateContent(kind,content,ctx) {
  if(new TextEncoder().encode(JSON.stringify(content)??'').byteLength>LIMIT)throw fail('Isi lembar terlalu besar.',413,'CONTENT_TOO_LARGE');
  if(kind==='canvas') {
    if(!validateCanvas(content)||content.objects.some(o=>o.type==='text'&&!safeText(o.text)))throw fail('Isi kanvas tidak valid.');
    return;
  }
  if(!closed(content,['halaman','tab','filters'])||!closed(content.filters,['from','to','stores'])
    ||!menuUntuk({skin:ctx.skin,peran:ctx.role,halaman:content.halaman}).some(m=>m.halaman===content.halaman&&m.tab===content.tab))throw fail('Halaman tidak tersedia.',400,'FORBIDDEN_TARGET');
  if((ctx.lingkup==='entity')!==(content.halaman==='entity'))throw fail('Halaman berbeda lingkup.',400,'SCOPE_DENIED');
  const f=content.filters;
  if((f.from!==undefined&&!dateValid(f.from))||(f.to!==undefined&&!dateValid(f.to))||(f.from&&f.to&&f.from>f.to))throw fail('Periksa tanggal lembar.');
  if(f.stores!==undefined&&(!Array.isArray(f.stores)||f.stores.length>100||!f.stores.every(c=>typeof c==='string'&&/^[A-Za-z0-9_-]{1,20}$/.test(c))))throw fail('Filter gerai tidak valid.');
}
const mapped = (row,ctx,list=false) => ({id:row.id,kind:row.kind,title:row.title,scope:ctx.lingkup==='entity'?{lingkup:'entity'}:{lingkup:'gerai',storeCode:ctx.storeCode},revision:row.revision,formatVersion:row.format_version,
  ...(!list||row.kind==='page'?{content:JSON.parse(row.content_json)}:{}),createdAt:row.created_at,updatedAt:row.updated_at});
const keys = ctx => [ctx.key,ctx.entityId,ctx.storeId,ctx.lingkup];
const where = 'principal_key=? AND entity_id=? AND store_id IS ? AND scope_kind=?';
async function rowFor(env,ctx,id) { return env.DB.prepare('SELECT * FROM una_surfaces WHERE '+where+' AND id=?').bind(...keys(ctx),id).first(); }
async function validateStores(env,ctx,content) {
  for(const code of content.filters?.stores||[]) {
    const store=await env.DB.prepare('SELECT id FROM stores WHERE code=? AND entity_id=? AND is_active=1').bind(code,ctx.entityId).first();
    if(!store||(ctx.storeId&&store.id!==ctx.storeId))throw fail('Filter gerai tidak tersedia.',400,'FORBIDDEN_TARGET');
  }
}
export async function handleUnaSurfacesApi(request,env,pathname=new URL(request.url).pathname) {
  if(pathname!==ROOT&&!pathname.startsWith(ROOT+'/'))return null;
  try {
    const ctx=await contextFor(request,env);
    if(pathname===ROOT) {
      if(request.method==='GET') {
        const rows=await env.DB.prepare('SELECT id,kind,title,revision,format_version,CASE WHEN kind=\'page\' THEN content_json ELSE NULL END AS content_json,created_at,updated_at FROM una_surfaces WHERE '+where+' ORDER BY updated_at DESC,id LIMIT 50').bind(...keys(ctx)).all();
        return json({items:(rows.results||[]).map(row=>mapped(row,ctx,true))});
      }
      if(request.method!=='POST')return json({error:'Method not allowed'},405);
      const body=await readBody(request);
      if(!closed(body,['kind','title','content'])||!['page','canvas'].includes(body.kind))throw fail('Jenis lembar tidak valid.');
      if(!safeText(body.title)||!body.title.trim()||body.title.length>80)throw fail('Judul lembar harus 1–80 karakter.');
      validateContent(body.kind,body.content,ctx);await validateStores(env,ctx,body.content);
      const id='srf_'+crypto.randomUUID(),now=new Date().toISOString(),pageKey=body.kind==='page'?body.content.halaman+':'+body.content.tab:null;
      const result=await env.DB.prepare('INSERT INTO una_surfaces(id,principal_key,entity_id,store_id,scope_kind,kind,title,revision,format_version,content_json,page_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,1,?,?,?,?) ON CONFLICT DO NOTHING')
        .bind(id,ctx.key,ctx.entityId,ctx.storeId,ctx.lingkup,body.kind,body.title.trim(),JSON.stringify(body.content),pageKey,now,now).run();
      const row=result.meta.changes?await rowFor(env,ctx,id):await env.DB.prepare('SELECT * FROM una_surfaces WHERE '+where+' AND page_key=?').bind(...keys(ctx),pageKey).first();
      if(!row)throw fail('Lembar belum tersimpan.',503,'SAVE_FAILED');
      return json({surface:mapped(row,ctx)},result.meta.changes?201:200);
    }
    const id=pathname.slice(ROOT.length+1);if(!/^srf_[0-9a-f-]{36}$/.test(id))throw missing();
    const row=await rowFor(env,ctx,id);if(!row)throw missing();
    if(request.method==='GET')return json({surface:mapped(row,ctx)});
    if(!['PATCH','DELETE'].includes(request.method))return json({error:'Method not allowed'},405);
    const body=request.method==='PATCH'?await readBody(request):{expectedRevision:Number(new URL(request.url).searchParams.get('expectedRevision'))};
    if(!closed(body,['expectedRevision','title','content'])||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<1)throw fail('Versi lembar tidak valid.');
    const conflict=async()=>{const latest=await rowFor(env,ctx,id);return latest?json({code:'REVISION_CONFLICT',surface:mapped(latest,ctx)},409):json({code:'NOT_FOUND',error:'Lembar tidak ditemukan.'},404);};
    if(body.expectedRevision!==row.revision)return conflict();
    if(request.method==='DELETE') {
      const result=await env.DB.prepare('DELETE FROM una_surfaces WHERE '+where+' AND id=? AND revision=?').bind(...keys(ctx),id,body.expectedRevision).run();
      return result.meta.changes?new Response(null,{status:204}):conflict();
    }
    if(body.title!==undefined&&(!safeText(body.title)||!body.title.trim()||body.title.length>80))throw fail('Judul lembar tidak valid.');
    const content=Object.hasOwn(body,'content')?body.content:JSON.parse(row.content_json);validateContent(row.kind,content,ctx);await validateStores(env,ctx,content);
    if(row.kind==='page'&&content.halaman+':'+content.tab!==row.page_key)throw fail('Identitas halaman tidak boleh berubah.');
    const result=await env.DB.prepare('UPDATE una_surfaces SET title=?,content_json=?,revision=revision+1,updated_at=? WHERE '+where+' AND id=? AND revision=?')
      .bind(body.title?.trim()??row.title,JSON.stringify(content),new Date().toISOString(),...keys(ctx),id,body.expectedRevision).run();
    return result.meta.changes?json({surface:mapped(await rowFor(env,ctx,id),ctx)}):conflict();
  } catch(error) { return json({error:error.status?error.message:'Lembar belum dapat dimuat atau disimpan.',code:error.code||'SURFACE_FAILED'},error.status||503); }
}
