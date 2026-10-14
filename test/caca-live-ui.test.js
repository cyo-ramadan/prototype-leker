import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/caca-pengaturan.js',import.meta.url),'utf8');
function setup({owner=false,profile=false}={}){
 const nodes=new Map(),listeners=new Map(),docListeners=new Map(),calls=[],adapters=[];let options,hold,token='login-one';
 function node(id){if(nodes.has(id))return nodes.get(id);const n={id,value:'',checked:false,disabled:false,textContent:'',handlers:{},classList:{contains:()=>false},setAttribute(){},querySelector:()=>({after(){}}),addEventListener(k,f){this.handlers[k]=f;}};
 Object.defineProperty(n,'innerHTML',{set(html){for(const match of html.matchAll(/id="([^"]+)"/g))node(match[1]);}});nodes.set(id,n);return n;}
 for(const id of ['cacaPanel','cacaPertanyaan','cacaStatus','cacaFab','cacaTutup'])node(id);
 const fake={hentikan(){calls.push('stop');},wajib:()=>owner,hasProfile:()=>profile,muatTranskrip:async()=>{calls.push('transcript');},muatModel:async()=>{calls.push('speaker');},mulaiLive:async o=>{options=o;calls.push('live');},status:()=>({}),setWajib(){throw Error('must not change option automatically');}};
 const window={addEventListener:(k,f)=>listeners.set(k,f),KerangkaSuaraPemilik:{buat:()=>{adapters.push(fake);return fake;}},speechSynthesis:{speaking:true,pause(){calls.push('pause');},resume(){calls.push('resume');}}};
 const context=vm.createContext({window,document:{hidden:false,getElementById:id=>nodes.get(id),createElement:()=>node('settings-created'),querySelectorAll:()=>[],addEventListener:(k,f)=>docListeners.set(k,f)},console,Boolean,encodeURIComponent,
 CACA_ENTITY:'@entity',cacaState:{scope:'G001',lampiran:null,siap:true,sedangKirim:false},cacaSuara:{sesi:null},cacaMulutGenerasi:3,cacaSidikLogin:()=>token,cacaSedangNgambek:()=>false,cacaAturTombol(){},cacaDiam(){calls.push('cut');},cacaApi:async()=>({namaAsisten:'Una',ruangSuara:'tenant:EA:account'}),cacaKirimTeks:async(t,k)=>{calls.push({text:t,context:k});if(hold)await hold;}});
 vm.runInContext(source,context);
 const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
 return {nodes,listeners,docListeners,calls,context,flush,get options(){return options;},async init(){docListeners.get('DOMContentLoaded')();await flush();},async click(){await nodes.get('cacaLiveToggle').handlers.click();await flush();},setHold:p=>{hold=p;},changeLogin(){token='login-two';}};
}
test('live UI starts without profile and loads only transcription when owner option is off',async()=>{
 const h=setup();await h.init();await h.click();assert.ok(h.options);assert.equal(h.calls.includes('speaker'),false);assert.ok(h.calls.includes('transcript'));
 h.options.onPotong();assert.ok(h.calls.includes('cut'));await h.options.onPerintah('buka karyawan');const sent=h.calls.find(x=>x.text);assert.equal(sent.text,'buka karyawan');assert.equal(sent.context.suara,true);assert.equal(h.context.cacaState.sedangKirim,false);
});
test('owner-only choice requires enrollment and loads speaker only after valid profile',async()=>{
 const missing=setup({owner:true});await missing.init();await missing.click();assert.equal(missing.options,undefined);assert.match(missing.nodes.get('cacaPengaturanStatus').textContent,/Daftarkan/);
 const h=setup({owner:true,profile:true});await h.init();await h.click();assert.ok(h.calls.includes('speaker'));assert.ok(h.options);
});
test('live queues during work, preserves typed text and drains on idle event',async()=>{
 const h=setup();await h.init();await h.click();h.context.cacaState.sedangKirim=true;await h.options.onPerintah('cek stok');assert.equal(h.calls.some(x=>x.text),false);
 h.nodes.get('cacaPertanyaan').value='catatan belum dikirim';h.context.cacaState.sedangKirim=false;h.listeners.get('caca-chat-idle')();await h.flush();assert.equal(h.calls.some(x=>x.text),false);assert.equal(h.nodes.get('cacaPertanyaan').value,'catatan belum dikirim');
 h.nodes.get('cacaPertanyaan').value='';h.nodes.get('cacaPertanyaan').handlers.input();await h.flush();assert.equal(h.calls.find(x=>x.text).text,'cek stok');
});
test('closing or changing login discards queued and late voice commands',async()=>{
 const h=setup();await h.init();await h.click();h.context.cacaState.sedangKirim=true;await h.options.onPerintah('cek stok');const cutsBefore=h.calls.filter(x=>x==='cut').length;h.listeners.get('caca-audio-stop')();assert.ok(h.calls.filter(x=>x==='cut').length>cutsBefore,'stopping live also cancels speech and invalidates future narration');h.context.cacaState.sedangKirim=false;h.listeners.get('caca-chat-idle')();await h.options.onPerintah('late');await h.flush();assert.equal(h.calls.some(x=>x.text),false);
 await h.click();h.changeLogin();await h.options.onPerintah('wrong account');assert.equal(h.calls.some(x=>x.text),false);
});
test('starting live preserves existing attachment and typed composer',async()=>{
 const h=setup();await h.init();h.context.cacaState.lampiran={photo:true};await h.click();assert.equal(h.options,undefined);assert.match(h.nodes.get('cacaPengaturanStatus').textContent,/kosongkan/);
});
