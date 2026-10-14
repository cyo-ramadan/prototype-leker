import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../public/kerangka-suara-pemilik.js',import.meta.url),'utf8');
function setup({ trackSettings={echoCancellation:true} }={}) {
 const data=new Map(), workers=[], nodes=[], timers=new Map();let tid=0,scope='tenant-one:ENTITY_ADMIN:one',stopped=0;
 const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 class Worker {
  constructor(){workers.push(this);this.delayed=[];}
  postMessage(m){const vector=Array(512).fill(0);vector[0]=m.pcm?.[0]<0?0.2:1;vector[1]=m.pcm?.[0]<0?Math.sqrt(.96):0;
   const result=m.jenis==='embedding'?vector:m.jenis==='transkrip'?'buka Karyawan':true;
   const send=()=>this.onmessage({data:{id:m.id,result}}); if(this.hold)this.delayed.push(send);else queueMicrotask(send);}
  terminate(){this.terminated=true;}
 }
 class AudioContext { constructor(){this.sampleRate=16000;this.state='running';this.destination={};this.audioWorklet={addModule:async()=>{}};} createMediaStreamSource(){return{connect(){},disconnect(){}};} createGain(){return{gain:{},connect(){},disconnect(){}};} async resume(){} async close(){this.state='closed';} }
 class AudioWorkletNode {constructor(){this.port={};nodes.push(this);} connect(){} disconnect(){} }
 const context=vm.createContext({console,Date,Float32Array,Uint8Array,Map,Promise,Number,Math,JSON,Error,setTimeout:(f,ms)=>{timers.set(++tid,{f,ms});return tid;},clearTimeout:id=>timers.delete(id),
  AudioContext,AudioWorkletNode,isSecureContext:true,localStorage:storage,Worker,navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){stopped++;}}],getAudioTracks:()=>[{getSettings:()=>trackSettings,addEventListener(){}}]})}}});
 vm.runInContext(source,context);
 const api=context.KerangkaSuaraPemilik,runtime=api.buat({getScope:()=>scope});
 const pcm=sign=>new Float32Array(64000).fill(sign*.04);
 return{api,runtime,workers,nodes,timers,data,pcm,setScope:s=>{scope=s;},get stopped(){return stopped;}};
}
test('owner enrollment stores only scoped embeddings and checks actual vector similarity',async()=>{
 const h=setup();assert.equal(h.runtime.wajib(),false);assert.throws(()=>h.runtime.setWajib(true),/Daftarkan/);
 await h.runtime.muatModel();await h.runtime.daftarkan([h.pcm(1),h.pcm(1),h.pcm(1)]);h.runtime.setWajib(true);
 assert.equal(h.runtime.hasProfile(),true);assert.equal(h.runtime.wajib(),true);
 assert.equal((await h.runtime.verifikasi(h.pcm(1))).cocok,true);assert.equal((await h.runtime.verifikasi(h.pcm(-1))).cocok,false);
 const record=[...h.data.values()].find(v=>v.startsWith('{'));assert.doesNotMatch(record,/pcm|samples|rekaman/);assert.equal(JSON.parse(record).embeddings.length,3);
 assert.ok([...h.data.keys()].every(k=>k.includes('tenant-one:ENTITY_ADMIN:one')));
 await h.runtime.hapus();assert.equal(h.data.size,0);assert.equal(h.runtime.hasProfile(),false);assert.equal(h.runtime.wajib(),false);
});
test('inconsistent enrollment does not overwrite previous owner profile',async()=>{
 const h=setup();await h.runtime.muatModel();await h.runtime.daftarkan([h.pcm(1),h.pcm(1),h.pcm(1)]);const old=[...h.data.values()][0];
 await assert.rejects(h.runtime.daftarkan([h.pcm(1),h.pcm(-1),h.pcm(1)]),/konsisten/);assert.equal([...h.data.values()][0],old);
});
test('scope change and cancellation reject late model results',async()=>{
 const h=setup();await h.runtime.muatModel();await h.runtime.daftarkan([h.pcm(1),h.pcm(1),h.pcm(1)]);
 h.workers[0].hold=true;const late=h.runtime.verifikasi(h.pcm(1));h.setScope('tenant-two:ENTITY_ADMIN:two');h.workers[0].delayed.shift()();await assert.rejects(late,/Lingkup/);
 h.setScope('tenant-one:ENTITY_ADMIN:one');const cancelled=h.runtime.verifikasi(h.pcm(1));h.runtime.hentikan();await assert.rejects(cancelled,/dihentikan/);assert.equal(h.workers[0].terminated,true);assert.equal(h.timers.size,0);
});
test('owner-only live requires enrollment; default live still requires transcription and echo suppression',async()=>{
 const h=setup();await assert.rejects(h.runtime.mulaiLive(),/transkrip/);
 h.data.set('suaraPemilik:v1:tenant-one:ENTITY_ADMIN:one:wajib','true');await assert.rejects(h.runtime.mulaiLive(),/Daftarkan/);
 h.data.delete('suaraPemilik:v1:tenant-one:ENTITY_ADMIN:one:wajib');
 await h.runtime.muatModel();await h.runtime.muatTranskrip();await h.runtime.daftarkan([h.pcm(1),h.pcm(1),h.pcm(1)]);
 await assert.rejects(h.runtime.mulaiLive(),/Peredam gema penuh/);assert.equal(h.runtime.status().live,false);assert.equal(h.stopped,1);
});
test('audio validation and resampling reject silence/nonfinite/short recordings',()=>{
 const h=setup();assert.throws(()=>h.api.pcmValid(new Float32Array(64000)),/pelan/);assert.throws(()=>h.api.pcmValid(new Float32Array(20)),/sedikitnya/);
 const bad=h.pcm(1);bad[3]=NaN;assert.throws(()=>h.api.pcmValid(bad),/valid/);
 const result=h.api.resample(new Float32Array(48000).fill(.1),48000);assert.equal(result.length,16000);assert.ok(result.every(v=>Math.abs(v-.1)<1e-6));
 assert.throws(()=>h.api.cosine([0,0],[1,0]),/terbaca/);
});

const flush = async () => { for(let i=0;i<15;i++) await Promise.resolve(); };
function feed(h, voiced, frames) { for(let i=0;i<frames;i++) h.nodes[0].port.onmessage({data:new Float32Array(2048).fill(voiced ? .04 : 0)}); }
test('live works without owner profile and interrupts speech before local transcription finishes',async()=>{
 const h=setup({trackSettings:{echoCancellation:'all'}}),commands=[];let cuts=0;
 await h.runtime.muatTranskrip();assert.equal(h.runtime.status().ready,false);
 await h.runtime.mulaiLive({onPotong:()=>cuts++,onPerintah:async text=>commands.push(text)});
 assert.equal(h.runtime.hasProfile(),false);feed(h,true,10);assert.equal(cuts,1);assert.deepEqual(commands,[]);
 feed(h,false,6);await flush();assert.deepEqual(commands,['buka Karyawan']);
 h.runtime.hentikan();assert.equal(h.stopped,1);assert.equal(h.runtime.status().live,false);
});
test('owner-only live rejects other speaker before transcribing or sending a task',async()=>{
 const h=setup({trackSettings:{echoCancellation:'all'}}),commands=[];let cuts=0;
 await h.runtime.muatModel();await h.runtime.muatTranskrip();await h.runtime.daftarkan([h.pcm(1),h.pcm(1),h.pcm(1)]);h.runtime.setWajib(true);
 await h.runtime.mulaiLive({onPotong:()=>cuts++,onPerintah:async t=>commands.push(t)});
 for(let i=0;i<20;i++)h.nodes[0].port.onmessage({data:new Float32Array(2048).fill(-.04)});
 feed(h,false,6);await flush();assert.equal(cuts,0);assert.deepEqual(commands,[]);h.runtime.hentikan();
});
test('stopping live discards late transcription and never dispatches another task',async()=>{
 const h=setup({trackSettings:{echoCancellation:'all'}}),commands=[];
 await h.runtime.muatTranskrip();await h.runtime.mulaiLive({onPerintah:async t=>commands.push(t)});
 h.workers[0].hold=true;feed(h,true,10);feed(h,false,6);await flush();assert.equal(h.workers[0].delayed.length,1);
 h.runtime.hentikan();h.workers[0].delayed[0]();await flush();assert.deepEqual(commands,[]);
});


test('idle voice runtime does not create worker, audio context, timers, recordings or model downloads',()=>{
 const h=setup();h.runtime.status();h.runtime.hasProfile();h.runtime.wajib();assert.equal(h.workers.length,0);assert.equal(h.nodes.length,0);assert.equal(h.timers.size,0);assert.equal(h.data.size,0);assert.equal(h.stopped,0);
});
