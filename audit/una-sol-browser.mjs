// Local UI fixture only. No credentials, remote API, microphone, or model.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../public/',import.meta.url)),surfaces=new Map();
let writes=0,reads=0,failSave=false,conflictSave=false;
const html=await readFile(path.join(root,'entity-admin.html'),'utf8');
const section=html.match(/<section id="entityTab-reports"[\s\S]*?<\/section>/)[0];
const script=`
let fixtureScope='__entity__',actionNumber=0,reportCalls=0;
const stores=Array.from({length:40},(_,i)=>({code:'G'+String(i+1).padStart(3,'0'),name:'Gerai contoh '+i}));
entityAdminState.stores=stores;entityAdminState.token='fixture-only';entityAdminState.entityAdmin={entityId:'fixture'};
entityAdminApi=async function(route){
 const u=new URL(route,location.origin);reportCalls++;document.getElementById('calls').textContent=String(reportCalls);
 const codes=u.searchParams.get('stores').split(','),from=u.searchParams.get('from'),to=u.searchParams.get('to');
 const n=Number(to.slice(-2));
 const byStore=Object.fromEntries(codes.map((code,i)=>[code,(i%3===0?-1:1)*987654321*n]));
 const total=Object.values(byStore).reduce((a,b)=>a+b,0);
 return {from,to,stores:codes.map(code=>({code})),rows:[{businessDate:to,byStore,total}],totals:{byStore,total},storeTotals:codes.map((code,i)=>({code,storeName:'Contoh',revenue:9876543210*n,hpp:4567890123,grossProfit:2222222222,totalBeban:1111111111,netProfit:byStore[code]}))};
};
const fixtureApi=async (route,options={})=>{const r=await fetch(route,{...options,headers:{'Content-Type':'application/json'}});const p=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(p.error||'Gagal fixture'),{status:r.status,payload:p});return p;};
UnaWorkspace.configure({getIdentity:()=> 'fixture-account',getScope:()=>fixtureScope,scopeQuery:s=>s==='__entity__'?'lingkup=entity':'store='+s,scopeLabel:()=> 'Entity contoh',api:fixtureApi,setPending:()=>{}});
renderEntityReportStoreChecklist();
document.getElementById('entityReportFrom').value='2026-10-01';document.getElementById('entityReportTo').value='2026-10-10';
document.getElementById('entityReportRun').addEventListener('click',()=>runEntityReport());renderEntityReportMetricButtons();
const command=async(id,params,target=true)=>{
 const c=UnaLembar.context();const r=await UnaRegistry.execute({actionId:'act_fixture_'+(++actionNumber),turnId:'turn_fixture',capabilityId:id,capabilityVersion:1,params,target:target&&c.surface?{surfaceId:c.surface.id,expectedRevision:c.surface.revision}:null,scopeEpoch:c.scopeEpoch,origin:'user'});
 document.getElementById('receipt').textContent=JSON.stringify(r);return r;
};
document.getElementById('openReport').onclick=()=>command('page.open',{halaman:'entity',tab:'reports'},false);
document.getElementById('ten').onclick=()=>command('report.set_filters',{from:'2026-10-01',to:'2026-10-10'});
document.getElementById('eight').onclick=()=>command('report.set_filters',{from:'2026-10-01',to:'2026-10-08'});
document.getElementById('pin').onclick=()=>UnaMount.claim('entity:reports',document.getElementById('pinHost'),'pin');
document.getElementById('menu').onclick=()=>UnaMount.claim('entity:reports',document.getElementById('entityTab-reports'),'menu');
document.getElementById('scope').onclick=()=>{fixtureScope=fixtureScope==='__entity__'?'G001':'__entity__';UnaWorkspace.scopeChanged();document.getElementById('scopeLabel').textContent=fixtureScope;};
document.getElementById('failSave').onclick=()=>fixtureApi('/fixture/fail',{method:'POST'});
document.getElementById('conflictSave').onclick=()=>fixtureApi('/fixture/conflict',{method:'POST'});
document.getElementById('inspect').onclick=()=>{const s=UnaLembar.active(),editor=s&&UnaLembar.editor(s.id);document.getElementById('inspection').textContent=JSON.stringify({active:s,objects:editor?.model.content().objects});};
window.addEventListener('una-live:surface',e=>document.getElementById('lastSurface').textContent=JSON.stringify(e.detail));
UnaWorkspace.open();
`;
const fixture=`<!doctype html><html lang="id" data-skin="classic"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Una local UI fixture</title>
${['styles.css','admin.css','owner.css','entity-management.css','entity-report-chart.css','caca-workspace.css','una-lembar.css','una-kanvas.css'].map(s=>`<link rel="stylesheet" href="/${s}">`).join('')}
<style>body{padding:12px}.fixture-tools{display:flex;flex-wrap:wrap;gap:6px;max-width:330px}.fixture-output{max-width:330px;overflow-wrap:anywhere;font-size:11px}#cacaPanel{position:fixed;bottom:0;right:0;width:360px;background:var(--surface);z-index:63;padding:8px}#cacaPertanyaan{width:100%}</style>
<div class="fixture-tools"><button id="openReport">Buka laporan di Workspace</button><button id="ten">Periode 1–10</button><button id="eight">Koreksi 1–8</button><button id="pin">Pin Laporan</button><button id="menu">Menu Laporan</button><button id="scope">Ganti lingkup</button><button id="failSave">Gagal simpan berikutnya</button><button id="conflictSave">Benturkan simpan berikutnya</button><button id="inspect">Periksa lembar</button></div>
<p>Fixture lokal, 40 gerai; panggilan laporan: <span id="calls">0</span>; lingkup <span id="scopeLabel">__entity__</span></p>
<div class="fixture-output"><pre id="receipt"></pre><pre id="inspection"></pre><pre id="lastSurface"></pre></div><section id="pinHost"></section>${section}
<div id="cacaPanel"><label>Chat tetap dapat diketik<textarea id="cacaPertanyaan"></textarea></label></div>
${['una-kemampuan-data.js','una-registry.js','una-mount.js','una-surfaces-client.js','una-lembar.js','una-kanvas.js','caca-workspace.js','entity-admin.js','una-adapter-laporan.js'].map(s=>`<script src="/${s}"></script>`).join('')}
<script>${script}</script></html>`;
const send=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});return res.end(fixture);}
  if(u.pathname==='/fixture/fail'){failSave=true;return send(res,200,{});}
  if(u.pathname==='/fixture/conflict'){conflictSave=true;return send(res,200,{});}
  if(u.pathname==='/api/caca/workspace')return send(res,200,{items:[]});
  if(u.pathname.startsWith('/api/caca/surfaces')){
   reads++;const id=u.pathname.split('/')[4],scope=u.search,found=surfaces.get(id);
   const items=[...surfaces.values()].filter(s=>s.fixtureScope===scope);
   if(req.method==='GET')return send(res,200,id?{surface:found}:{items:items.map(s=>s.kind==='canvas'?{...s,content:undefined}:s)});
   let body='';for await(const c of req)body+=c;const b=JSON.parse(body||'{}');
   if(req.method==='POST'){
    const old=items.find(s=>s.kind==='page'&&s.content.halaman===b.content.halaman&&s.content.tab===b.content.tab);
    if(old)return send(res,200,{surface:old});
    const s={...b,id:'srf_'+crypto.randomUUID(),scope:{lingkup:scope.includes('entity')?'entity':'gerai',storeCode:'G001'},revision:1,formatVersion:1,fixtureScope:scope,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};surfaces.set(s.id,s);writes++;return send(res,201,{surface:s});
   }
   if(failSave){failSave=false;return send(res,503,{error:'Fixture koneksi gagal'});}
   if(conflictSave){conflictSave=false;found.revision++;}
   if(found.revision!==b.expectedRevision)return send(res,409,{code:'REVISION_CONFLICT',surface:found});
   const s={...found,content:b.content,title:b.title,revision:found.revision+1};surfaces.set(id,s);writes++;return send(res,200,{surface:s});
  }
  const filename=path.resolve(root,'.'+u.pathname);if(!filename.startsWith(root))return send(res,404,{});
  let data=await readFile(filename);if(u.pathname==='/entity-admin.js')data=Buffer.from(data.toString().replace(/^initEntityAdmin\(\);/m,'// fixture: initialization is explicit'));
  res.writeHead(200,{'Content-Type':u.pathname.endsWith('.js')?'text/javascript':u.pathname.endsWith('.css')?'text/css':'application/octet-stream'});res.end(data);
 }catch(e){send(res,500,{error:String(e.message)});}
}).listen(8769,'127.0.0.1',()=>console.log('Una UI fixture http://127.0.0.1:8769/'));
