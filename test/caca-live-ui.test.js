import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../public/caca-pengaturan.js',import.meta.url),'utf8');
const chatSource=readFileSync(new URL('../public/caca-chat.js',import.meta.url),'utf8');
const chatMarkup=vm.runInNewContext(chatSource.match(/const CACA_KERANGKA = (`[\s\S]*?`);/)[0]+'\nCACA_KERANGKA');
const defer=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};

// Small DOM fixture parses the actual HTML and chat template. Assertions exercise
// the executed UI and ancestry/events, rather than looking for source strings.
function setup({owner=false,profile=false,lazy=false,page='branch',scope='G001',role='ENTITY_ADMIN',profileGate,libraryGate,transcriptGate}={}){
 const nodes=new Map(),listeners=new Map(),docListeners=new Map(),calls=[],adapters=[];
 let options,hold,token='login-one',profileName='Una',ownerOption=owner;
 const storage=new Map();
 if(role==='ENTITY_ADMIN')storage.set('lekerEntityAdminToken',token);
 if(role==='OWNER')storage.set('lekerOwnerToken',token);
 const subscribe=(map,type,callback)=>{const group=map.get(type)||[];group.push(callback);map.set(type,group);};
 function matches(node,selector){
  if(selector.startsWith('#'))return node.id===selector.slice(1);
  if(selector.startsWith('.'))return node.classList.contains(selector.slice(1));
  const attr=/^\[([^\]]+)\]$/.exec(selector);if(attr)return Object.hasOwn(node.attrs,attr[1]);
  return node.tagName.toLowerCase()===selector.toLowerCase();
 }
 function element(tag='div'){
  let id='',classes=new Set();
  const node={tagName:tag.toUpperCase(),parentElement:null,children:[],attrs:{},value:'',checked:false,disabled:false,hidden:false,textContent:'',handlers:{},
   appendChild(child){child.parentElement=this;this.children.push(child);return child;},
   remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);if(id)nodes.delete(id);this.parentElement=null;},
   setAttribute(key,value){this.attrs[key]=String(value);if(key==='id')this.id=String(value);if(key==='class')this.className=String(value);},
   getAttribute(key){return this.attrs[key]??null;},
   addEventListener(type,callback){this.handlers[type]=callback;},
   contains(child){return child===this||this.children.some(item=>item.contains(child));},
   closest(selector){for(let current=this;current;current=current.parentElement)if(matches(current,selector))return current;return null;},
   querySelectorAll(selector){const selectors=selector.split(',').map(value=>value.trim());const found=[];const visit=current=>{for(const child of current.children){if(selectors.some(part=>matches(child,part)))found.push(child);visit(child);}};visit(this);return found;},
   querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  };
  node.classList={contains:value=>classes.has(value),add:(...values)=>values.forEach(value=>classes.add(value)),remove:(...values)=>values.forEach(value=>classes.delete(value)),toggle(value,force){const on=force===undefined?!classes.has(value):Boolean(force);if(on)classes.add(value);else classes.delete(value);return on;}};
  Object.defineProperty(node,'id',{get:()=>id,set:value=>{if(id)nodes.delete(id);id=value;if(id)nodes.set(id,node);}});
  Object.defineProperty(node,'className',{get:()=>[...classes].join(' '),set:value=>{classes=new Set(String(value).split(/\s+/).filter(Boolean));}});
  Object.defineProperty(node,'innerHTML',{set:html=>{node.children=[];parse(html,node);}});
  return node;
 }
 function parse(html,parent){
  const stack=[parent],voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr','path']);
  for(const match of html.matchAll(/<\/?([a-z][\w:-]*)([^>]*)>/gi)){
   const tag=match[1].toLowerCase();
   if(match[0].startsWith('</')){for(let at=stack.length-1;at>0;at--)if(stack[at].tagName.toLowerCase()===tag){stack.length=at;break;}continue;}
   const node=element(tag);
   for(const attr of match[2].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g))node.setAttribute(attr[1],attr[2]??attr[3]??'');
   node.hidden=Object.hasOwn(node.attrs,'hidden');node.checked=Object.hasOwn(node.attrs,'checked');node.disabled=Object.hasOwn(node.attrs,'disabled');
   stack.at(-1).appendChild(node);if(!voids.has(tag)&&!match[0].endsWith('/>'))stack.push(node);
  }
 }
 const root=element('document'),head=element('head'),body=element('body');root.appendChild(head);root.appendChild(body);
 const html=readFileSync(new URL('../public/'+(page==='entity'?'entity-admin.html':'branch-admin.html'),import.meta.url),'utf8').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
 parse(html,body);parse(chatMarkup,body);
 const makeAdapter=()=>{
  const adapter={
   hentikan(){calls.push('stop');},wajib:()=>ownerOption,hasProfile:()=>profile,
   muatTranskrip:async()=>{calls.push('transcript');if(transcriptGate)await transcriptGate.promise;},
   muatModel:async()=>{calls.push('speaker');},
   mulaiLive:async value=>{options=value;calls.push('live');},
   status:()=>({}),setWajib(value){calls.push('set-owner');ownerOption=value;},
   rekam:async()=>{calls.push('record');return new Float32Array([0.1,0.2]);},
   daftarkan:async samples=>{calls.push({enrolled:samples.length});}
  };adapters.push(adapter);return adapter;
 };
 const library={buat:makeAdapter};
 const window={LEKER_PAGE_CONTEXT:page==='branch'?'admin':'entity',LEKER_STORE_CODE:page==='branch'?'G001':undefined,addEventListener:(type,callback)=>subscribe(listeners,type,callback),KerangkaSuaraPemilik:lazy?undefined:library,speechSynthesis:{speaking:true,pause(){calls.push('pause');},resume(){calls.push('resume');}}};
 const append=head.appendChild.bind(head);
 head.appendChild=script=>{append(script);calls.push('library');const finish=()=>{window.KerangkaSuaraPemilik=library;script.onload();};if(libraryGate)void libraryGate.promise.then(finish);else void Promise.resolve().then(finish);return script;};
 const context=vm.createContext({window,document:{head,body,hidden:false,getElementById:id=>nodes.get(id),createElement:element,querySelectorAll:selector=>root.querySelectorAll(selector),addEventListener:(type,callback)=>subscribe(docListeners,type,callback)},localStorage:{getItem:key=>storage.get(key)||null},console,Boolean,encodeURIComponent,
  entityAdminState:page==='entity'?{ownerMode:role==='OWNER'}:undefined,CACA_ENTITY:'@entity',cacaState:{scope,lampiran:null,siap:true,sedangKirim:false},cacaSuara:{sesi:null},cacaMulutGenerasi:3,cacaSidikLogin:()=>token,cacaSedangNgambek:()=>false,cacaAturTombol(){},cacaDiam(){calls.push('cut');},
  cacaApi:async(path,opts={})=>{calls.push({api:path,method:opts.method||'GET'});if(opts.method==='PATCH'){profileName=JSON.parse(opts.body).namaAsisten;return{namaAsisten:profileName};}calls.push('profile');const result={namaAsisten:profileName,ruangSuara:path+':'+token};if(profileGate)await profileGate.promise;return result;},
  cacaKirimTeks:async(text,voiceContext)=>{calls.push({text,context:voiceContext});if(hold)await hold;}
 });
 vm.runInContext(source,context);
 const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
 const emit=async(map,type,event={})=>{for(const callback of map.get(type)||[])callback(event);await flush();};
 const click=async(id='cacaLiveToggle')=>{const node=nodes.get(id);assert.ok(node,'actual control '+id+' exists');if(node.disabled)return;await node.handlers.click?.({target:node});await flush();};
 return{nodes,listeners,docListeners,calls,context,adapters,flush,click,emitWindow:(type,event)=>emit(listeners,type,event),emitDocument:(type,event)=>emit(docListeners,type,event),get options(){return options;},async init(){await emit(docListeners,'DOMContentLoaded');},async openSettings(){if(page==='entity')await emit(listeners,'entity-admin-tab',{detail:{name:'settings'}});else await click('cacaPengaturanTab');},setHold:value=>{hold=value;},changeLogin(){token='login-two';storage.set('lekerEntityAdminToken',token);},addStaleOwner(){storage.set('lekerOwnerToken','stale-owner-token');},setRole(value){if(context.entityAdminState)context.entityAdminState.ownerMode=value==='OWNER';storage.delete('lekerEntityAdminToken');storage.delete('lekerOwnerToken');if(value==='ENTITY_ADMIN')storage.set('lekerEntityAdminToken',token);if(value==='OWNER')storage.set('lekerOwnerToken',token);}};
}
const sent=h=>h.calls.filter(call=>call?.text);
const profileReads=h=>h.calls.filter(call=>call==='profile').length;

test('settings controls mount under the real Pengaturan host outside chat; live stays in composer',async()=>{
 for(const page of ['branch','entity']){
  const h=setup({page});await h.init();const card=h.nodes.get('cacaPengaturan');
  assert.equal(card.tagName,'ARTICLE');assert.ok(h.nodes.get('cacaPengaturanHost').contains(card));assert.equal(h.nodes.get('cacaPanel').contains(card),false);
  assert.ok(h.nodes.get(page==='branch'?'tab-assistant-settings':'entityTab-settings').contains(card));
  assert.ok(h.nodes.get('cacaTanyaForm').contains(h.nodes.get('cacaLiveToggle')));
  assert.equal(card.contains(h.nodes.get('cacaLiveToggle')),false);
 }
});

test('settings opens directly without chat and saves the authenticated fallback scope without models or mic',async()=>{
 for(const page of ['branch','entity']){
  const h=setup({page,scope:'',lazy:true});await h.init();assert.equal(profileReads(h),0);await h.openSettings();
  assert.equal(profileReads(h),1);assert.equal(h.calls.filter(call=>call==='library').length,1);assert.equal(h.calls.includes('transcript'),false);assert.equal(h.calls.includes('speaker'),false);assert.equal(h.calls.includes('record'),false);assert.equal(h.calls.includes('live'),false);
  const query=page==='entity'?'lingkup=entity':'store=G001';assert.ok(h.calls.some(call=>call?.api==='/api/caca/pengaturan?'+query));
  h.nodes.get('cacaNamaAsisten').value='Jarvis';await h.click('cacaNamaSimpan');
  assert.equal(h.context.window.cacaNamaAsisten(),'Jarvis');assert.ok(h.calls.some(call=>call?.api==='/api/caca/pengaturan?'+query&&call.method==='PATCH'));
 }
});

test('live button lazily prepares settings/library from chat without first visiting Pengaturan',async()=>{
 const h=setup({lazy:true});await h.init();assert.equal(h.calls.includes('library'),false);await h.click();
 assert.equal(h.calls.filter(call=>call==='library').length,1);assert.ok(h.options);assert.ok(h.calls.includes('transcript'));assert.equal(h.calls.includes('speaker'),false);
});

test('live starts without enrollment when owner-only is off and uses the ordinary text task pipeline',async()=>{
 const h=setup();await h.init();await h.click();assert.ok(h.options);assert.equal(h.calls.includes('speaker'),false);assert.equal(h.calls.includes('set-owner'),false);
 const stops=h.calls.filter(call=>call==='stop').length;h.options.onTunda();h.options.onLanjut();h.options.onPotong();assert.ok(h.calls.includes('pause'));assert.ok(h.calls.includes('resume'));assert.ok(h.calls.includes('cut'));assert.equal(h.calls.filter(call=>call==='stop').length,stops,'interrupting speech keeps the microphone adapter running');
 await h.options.onPerintah('buka karyawan');const task=sent(h)[0];assert.equal(task.text,'buka karyawan');assert.equal(task.context.suara,true);assert.equal(h.context.cacaState.sedangKirim,false);
 await h.options.onPerintah('ya');assert.equal(sent(h)[1].text,'ya');assert.ok(h.calls.filter(call=>call?.api).every(call=>call.api.startsWith('/api/caca/pengaturan?')),'voice bridge never calls approval or transaction endpoints');
});

test('owner-only requires enrollment and loads the speaker model only for an enrolled profile',async()=>{
 const missing=setup({owner:true});await missing.init();await missing.click();assert.equal(missing.options,undefined);assert.match(missing.nodes.get('cacaPengaturanStatus').textContent,/Daftarkan/);
 const h=setup({owner:true,profile:true});await h.init();await h.click();assert.ok(h.calls.includes('speaker'));assert.ok(h.options);
});

test('queued live tasks preserve typed composer and drain only when the text is cleared',async()=>{
 const h=setup();await h.init();await h.click();h.context.cacaState.sedangKirim=true;await h.options.onPerintah('cek stok');assert.equal(sent(h).length,0);
 h.nodes.get('cacaPertanyaan').value='catatan belum dikirim';h.context.cacaState.sedangKirim=false;await h.emitWindow('caca-chat-idle');assert.equal(sent(h).length,0);assert.equal(h.nodes.get('cacaPertanyaan').value,'catatan belum dikirim');
 h.nodes.get('cacaPertanyaan').value='';h.nodes.get('cacaPertanyaan').handlers.input();await h.flush();assert.equal(sent(h)[0].text,'cek stok');
});

test('queued live tasks preserve a photo attachment until it is removed',async()=>{
 const h=setup();await h.init();await h.click();const photo={photo:true};h.context.cacaState.lampiran=photo;await h.options.onPerintah('cek hutang');assert.equal(sent(h).length,0);assert.equal(h.context.cacaState.lampiran,photo);
 h.context.cacaState.lampiran=null;await h.emitWindow('caca-chat-idle');assert.equal(sent(h)[0].text,'cek hutang');
});

test('closing or changing login discards queued and late voice commands',async()=>{
 const h=setup();await h.init();await h.click();h.context.cacaState.sedangKirim=true;await h.options.onPerintah('cek stok');const cuts=h.calls.filter(call=>call==='cut').length;
 await h.emitWindow('caca-audio-stop');assert.ok(h.calls.filter(call=>call==='cut').length>cuts);h.context.cacaState.sedangKirim=false;await h.emitWindow('caca-chat-idle');await h.options.onPerintah('late');assert.equal(sent(h).length,0);
 await h.click();h.changeLogin();await h.options.onPerintah('wrong account');assert.equal(sent(h).length,0);
});

test('starting live preserves an existing photo or typed composer',async()=>{
 for(const photo of [true,false]){
  const h=setup();await h.init();if(photo)h.context.cacaState.lampiran={photo:true};else h.nodes.get('cacaPertanyaan').value='belum selesai';
  await h.click();assert.equal(h.options,undefined);assert.match(h.nodes.get('cacaPengaturanStatus').textContent,/kosongkan/);
 }
});

test('ordinary chat opening downloads no voice library/model and starts no capture',async()=>{
 const h=setup({lazy:true});await h.init();assert.equal(h.options,undefined);for(const action of ['library','transcript','speaker','live','record'])assert.equal(h.calls.includes(action),false);
});

test('reopening settings during live reuses adapter/cache and never stops capture or resets enrollment',async()=>{
 const h=setup({lazy:true});await h.init();await h.openSettings();await h.click('cacaSuaraDaftar');await h.click('cacaSuaraDaftar');await h.click();
 const adapter=h.context.window.cacaSuaraPemilik,stops=h.calls.filter(call=>call==='stop').length,reads=profileReads(h);
 await h.openSettings();await h.openSettings();assert.equal(h.context.window.cacaSuaraPemilik,adapter);assert.equal(profileReads(h),reads);assert.equal(h.calls.filter(call=>call==='stop').length,stops);
 await h.options.onPerintah('cek laporan');assert.equal(sent(h)[0].text,'cek laporan');
 await h.click();await h.openSettings();await h.click('cacaSuaraDaftar');
 // Stopping live intentionally clears pending enrollment samples. Merely opening
 // settings must preserve them, which is checked separately below.
 assert.equal(h.calls.filter(call=>call?.enrolled).length,0);
});

test('reopening settings alone preserves two pending owner enrollment samples',async()=>{
 const h=setup({lazy:true});await h.init();await h.openSettings();await h.click('cacaSuaraDaftar');await h.click('cacaSuaraDaftar');await h.openSettings();await h.click('cacaSuaraDaftar');
 assert.equal(h.calls.find(call=>call?.enrolled)?.enrolled,3);assert.equal(profileReads(h),1);assert.equal(h.adapters.length,1);
});

test('reopening cached profile is cheap while scope or login changes load a fresh authenticated profile',async()=>{
 const h=setup();await h.init();assert.equal(profileReads(h),1);for(let i=0;i<3;i++)await h.emitWindow('caca-profile-needed');assert.equal(profileReads(h),1);
 h.context.cacaState.scope='G002';await h.emitWindow('caca-scope-change');assert.equal(profileReads(h),2);h.changeLogin();await h.emitWindow('caca-profile-needed');assert.equal(profileReads(h),3);
});

test('settings host and branch tab stay hidden for Owner or a browser without Entity Admin login',async()=>{
 for(const role of ['OWNER','NONE']){
  const h=setup({role,scope:''});await h.init();assert.equal(h.nodes.get('cacaPengaturanHost').classList.contains('hidden'),true);assert.equal(h.nodes.get('cacaPengaturanTab').classList.contains('hidden'),true);assert.equal(profileReads(h),0);assert.equal(h.calls.includes('library'),false);
  h.setRole('ENTITY_ADMIN');await h.emitWindow('entity-admin-ready');assert.equal(h.nodes.get('cacaPengaturanHost').classList.contains('hidden'),false);assert.equal(h.nodes.get('cacaPengaturanTab').classList.contains('hidden'),false);
 }
});

test('scope or login changes during lazy preparation cannot start live on the old context',async()=>{
 for(const change of ['scope','login']){
  const gate=defer();const h=setup({lazy:true,libraryGate:gate});await h.init();const pending=h.click();await h.flush();assert.equal(h.calls.includes('library'),true);
  if(change==='scope'){h.context.cacaState.scope='G002';await h.emitWindow('caca-scope-change');}else h.changeLogin();
  gate.resolve();await pending;assert.equal(h.calls.includes('live'),false);assert.equal(h.calls.includes('transcript'),false);
 }
});

test('closing or hiding during transcription preparation cancels the pending start',async()=>{
 for(const change of ['close','hidden']){
  const gate=defer();const h=setup({transcriptGate:gate});await h.init();const pending=h.click();await h.flush();assert.ok(h.calls.includes('transcript'));
  if(change==='close')await h.emitWindow('caca-audio-stop');else{h.context.document.hidden=true;await h.emitDocument('visibilitychange');}
  gate.resolve();await pending;assert.equal(h.calls.includes('live'),false);
 }
});
test('an Entity Admin on the entity page keeps settings despite an unrelated stale Owner token',async()=>{
 const h=setup({page:'entity',scope:'',lazy:true});h.addStaleOwner();await h.init();
 assert.equal(h.nodes.get('cacaPengaturanHost').classList.contains('hidden'),false);
 await h.openSettings();assert.equal(profileReads(h),1);assert.equal(h.calls.filter(call=>call==='library').length,1);
 h.context.entityAdminState.ownerMode=true;await h.emitWindow('storage',{key:'lekerOwnerToken'});
 assert.equal(h.nodes.get('cacaPengaturanHost').classList.contains('hidden'),true);
});

test('unsupported roles issue no settings request even when a chat/store scope already exists',async()=>{
 for(const role of ['OWNER','NONE']){
  const h=setup({role,scope:'G001',lazy:true});await h.init();
  assert.equal(h.nodes.get('cacaPengaturanHost').classList.contains('hidden'),true);
  assert.equal(profileReads(h),0);assert.equal(h.calls.includes('library'),false);
 }
});
test('a late settings response after a scope or login change cannot begin microphone/model work',async()=>{
 for(const change of ['scope','login']){
  const gate=defer();const h=setup({scope:'',profileGate:gate,lazy:true});await h.init();h.context.cacaState.scope='G001';const pending=h.click();await h.flush();assert.equal(profileReads(h),1);
  if(change==='scope')h.context.cacaState.scope='G002';else h.changeLogin();
  gate.resolve();await pending;
  for(const action of ['live','transcript','speaker','record'])assert.equal(h.calls.includes(action),false);
 }
});