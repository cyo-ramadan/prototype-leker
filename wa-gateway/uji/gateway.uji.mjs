import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { Archive, normalizeMessage, validTenant } from '../store.mjs';
import { Connection, authState } from '../connection.mjs';
import { createApp, acquireLock } from '../server.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wa-gateway-'));
  const archive = new Archive(root, 'tenant-a');
  t.after(() => { archive.close(); rmSync(root, { recursive:true,force:true }); });
  return { root, archive };
}
const rawMessage = (id = 'A', extra = {}) => ({ key:{id,remoteJid:'628123@s.whatsapp.net',fromMe:false},message:{conversation:'Cetak dua lembar'},messageTimestamp:123,pushName:'Pelanggan',...extra });
function fake(archive) {
  let socket;
  const lib = { BufferJSON:{}, initAuthCreds:() => ({test:'credential'}), proto:{},
    default: options => { socket = {ev:new EventEmitter(),end:()=>{},options}; return socket; },
    downloadMediaMessage: async () => Readable.from([Buffer.from('pdf bytes')])
  };
  const connection = new Connection(archive, () => {}, {lib,logger:{}});
  return {connection,lib,get socket(){return socket;}};
}

test('tenant path traversal and empty names are rejected', () => {
  for (const value of ['', '../other','a/b','a\\b','..',' a']) assert.throws(() => validTenant(value));
  assert.equal(validTenant('tenant-a'), 'tenant-a');
});
test('groups, own messages, view-once and ephemeral messages are excluded', () => {
  for (const raw of [rawMessage('a',{key:{id:'a',remoteJid:'1@g.us'}}),rawMessage('a',{key:{id:'a',remoteJid:'1@s.whatsapp.net',fromMe:true}}),rawMessage('a',{message:{viewOnceMessage:{}}}),rawMessage('a',{message:{ephemeralMessage:{}}}),rawMessage('a',{message:{reactionMessage:{}}})]) assert.equal(normalizeMessage(raw),null);
  assert.equal(normalizeMessage(rawMessage()).body,'Cetak dua lembar');
});
test('duplicates use chat plus message ID and tenant archives are isolated', t => {
  const {archive,root} = fixture(t); const raw = rawMessage(); const msg = normalizeMessage(raw);
  assert.equal(archive.insert(msg,JSON.stringify(raw)),1);
  assert.equal(archive.insert(msg,JSON.stringify(raw)),null);
  assert.equal(archive.insert({...msg,jid:'999@lid'},JSON.stringify(raw)),3);
  const other = new Archive(root,'tenant-b'); assert.equal(other.list().length,0); other.close();
  assert.equal(archive.list().length,2);
});
test('auth and raw message payload are encrypted and restored across restart', t => {
  const {archive,root} = fixture(t);
  archive.authSet('creds','TOP_SECRET');
  assert.equal(archive.authGet('creds'),'TOP_SECRET');
  assert.ok(!archive.db.prepare('SELECT value FROM auth').get().value.includes('TOP_SECRET'));
  const reopened = new Archive(root,'tenant-a'); assert.equal(reopened.authGet('creds'),'TOP_SECRET'); reopened.close();
  const sealed = archive.seal('hello'); assert.equal(archive.open(sealed),'hello');
  const corrupted = Buffer.from(sealed,'base64'); corrupted[20] ^= 1; assert.throws(() => archive.open(corrupted.toString('base64')));
});
test('signal auth keys round-trip and support deletion', async t => {
  const {archive} = fixture(t); const f = fake(archive); const auth = authState(archive,f.lib);
  await auth.state.keys.set({session:{a:{value:42}}});
  assert.deepEqual(await auth.state.keys.get('session',['a']),{a:{value:42}});
  await auth.state.keys.set({session:{a:null}}); assert.deepEqual(await auth.state.keys.get('session',['a']),{a:null});
  auth.save(); assert.equal(JSON.parse(archive.authGet('creds')).test,'credential');
});
test('no connection until start; duplicate start does not create second socket', async t => {
  const {archive} = fixture(t); const f = fake(archive);
  assert.equal(f.socket,undefined); await f.connection.start(); const socket=f.socket; await f.connection.start(); assert.equal(f.socket,socket);
  assert.equal(socket.options.markOnlineOnConnect,false); assert.equal(socket.options.shouldSyncHistoryMessage(),false);
  f.connection.stop();
});
test('logged-out connection stops retries and clears QR', async t => {
  const {archive} = fixture(t); const f = fake(archive); await f.connection.start();
  f.socket.ev.emit('connection.update',{qr:'secret'});
  f.socket.ev.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:401}}}});
  assert.equal(f.connection.state,'NEEDS_ATTENTION'); assert.equal(f.connection.wanted,false); assert.equal(f.connection.qr,null);
});
test('network reconnect can be stopped and stale events ignored', async t => {
  const {archive} = fixture(t); const f=fake(archive); await f.connection.start(); const old=f.socket;
  old.ev.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:408}}}});
  assert.equal(f.connection.state,'RECONNECTING'); f.connection.stop();
  old.ev.emit('messages.upsert',{messages:[rawMessage()]}); assert.equal(archive.list().length,0);
  old.ev.emit('connection.update',{qr:'old'}); assert.equal(f.connection.qr,null);
});
test('incoming event is persisted once without invoking sendMessage', async t => {
  const {archive}=fixture(t); const f=fake(archive); await f.connection.start();
  f.socket.sendMessage=()=>assert.fail('must not send');
  f.socket.ev.emit('messages.upsert',{messages:[rawMessage(),rawMessage()]});
  assert.equal(archive.list().length,1); f.connection.stop();
});
test('media bytes saved with sha256; oversized metadata rejected', async t => {
  const {archive}=fixture(t); const f=fake(archive); await f.connection.start();
  const raw=rawMessage('doc',{message:{documentMessage:{fileName:'../../outside.pdf',mimetype:'application/pdf',fileLength:9}}});
  const seq=archive.insert(normalizeMessage(raw),JSON.stringify(raw)); await f.connection.download(seq);
  assert.equal(archive.get(seq).media_status,'SAVED'); assert.equal(archive.get(seq).media_sha256.length,64);
  assert.equal(readFileSync(join(archive.dir,'media',`${seq}.bin`),'utf8'),'pdf bytes');
  raw.key.id='big'; raw.message.documentMessage.fileLength=30*1024*1024;
  const big=archive.insert(normalizeMessage(raw),JSON.stringify(raw)); await f.connection.download(big);
  assert.equal(archive.get(big).media_status,'TOO_LARGE'); f.connection.stop();
});
test('stream enforces size even when declared file size is false', async t => {
  const {archive}=fixture(t); const f=fake(archive); await f.connection.start();
  f.lib.downloadMediaMessage=async()=>Readable.from([Buffer.alloc(26*1024*1024)]);
  const raw=rawMessage('big',{message:{documentMessage:{fileLength:1}}});
  const seq=archive.insert(normalizeMessage(raw),JSON.stringify(raw)); await f.connection.download(seq);
  assert.equal(archive.get(seq).media_status,'TOO_LARGE'); f.connection.stop();
});
test('one process per tenant session enforced', t => {
  const {archive}=fixture(t); const unlock=acquireLock(archive.dir);
  assert.throws(()=>acquireLock(archive.dir),/masih berjalan/); unlock();
  const again=acquireLock(archive.dir); again();
});
async function httpFixture(t) {
  const {archive}=fixture(t); const f=fake(archive), token='a'.repeat(64);
  const server=createApp(archive,f.connection,token); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{ f.connection.stop(); server.closeClients(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); });
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(path,body={},cookie='')=>fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
  const login=await post('/api/login',{token}); const cookie=login.headers.get('set-cookie').split(';')[0];
  return {base,post,cookie,archive,f};
}
test('HTTP denies anonymous access, hostile host and cross-origin mutation',async t=>{
  const {base,post,cookie}=await httpFixture(t);
  assert.equal((await fetch(base+'/api/messages')).status,401);
  assert.equal((await post('/api/login',{token:'bad'})).status,401);
  const hostile = await new Promise((resolve,reject) => { const req=http.get(base+'/api/messages',{headers:{Host:'evil.example',Cookie:cookie}},res=>{res.resume();resolve(res.statusCode);}); req.on('error',reject); });
  assert.equal(hostile,403);
  assert.equal((await fetch(base+'/api/connect',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json',Cookie:cookie},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/messages',{headers:{Cookie:cookie}})).status,200);
});
test('HTTP exports only this tenant; no raw/session data or send endpoint',async t=>{
  const {base,post,cookie,archive}=await httpFixture(t);
  archive.insert(normalizeMessage(rawMessage()),'SECRET_RAW');
  const response=await fetch(base+'/api/export',{headers:{Cookie:cookie}}), text=await response.text();
  assert.ok(text.includes('Cetak dua lembar')); assert.ok(!text.includes('SECRET_RAW')); assert.ok(!text.includes('media_path'));
  assert.equal((await post('/api/send',{},cookie)).status,404);
  assert.equal((await fetch(base+'/api/messages?before=no',{headers:{Cookie:cookie}})).status,400);
});
test('session reset preserves archive and requires authentication',async t=>{
  const {post,cookie,archive}=await httpFixture(t); archive.authSet('creds','test');
  archive.insert(normalizeMessage(rawMessage()),'{}');
  assert.equal((await post('/api/reset-session')).status,401);
  assert.equal((await post('/api/reset-session',{},cookie)).status,200);
  assert.equal(archive.authGet('creds'),null); assert.equal(archive.list().length,1);
});

test('installed Baileys loads and real credential buffers survive SQLite round-trip', async t => {
  const {archive}=fixture(t); const lib=await import('@whiskeysockets/baileys');
  assert.equal(typeof lib.default,'function');
  const auth=authState(archive,lib); auth.save(); const restored=authState(archive,lib);
  assert.deepEqual(restored.state.creds.noiseKey.private,auth.state.creds.noiseKey.private);
  assert.ok(Buffer.isBuffer(restored.state.creds.noiseKey.private));
});

test('restricted launcher removes inherited secrets and blocks outside files/child processes', async () => {
  const {restrictedArgs,cleanEnvironment}=await import('../launch.mjs');
  const {spawnSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  assert.deepEqual(cleanEnvironment({PATH:'x',WA_TENANT:'tenant-a',OPENAI_API_KEY:'secret',NODE_OPTIONS:'bad',GITHUB_TOKEN:'secret'}),{PATH:'x',WA_TENANT:'tenant-a'});
  const result=spawnSync(process.execPath,restrictedArgs(fileURLToPath(new URL('../support/permission-probe.mjs',import.meta.url))),{encoding:'utf8',env:cleanEnvironment(),timeout:30000});
  assert.equal(result.status,0,result.stderr); assert.match(result.stdout,/permission-probe passed/);
});

test('media locations reject local network and unrelated hosts',async()=>{
  const {validateMediaLocation}=await import('../connection.mjs');
  for (const url of ['http://127.0.0.1/a','https://evil.example/a','https://mmg.whatsapp.net.evil.example/a','https://user:pass@mmg.whatsapp.net/a','https://mmg.whatsapp.net:123/a']) assert.throws(()=>validateMediaLocation({url}));
  assert.doesNotThrow(()=>validateMediaLocation({url:'https://mmg.whatsapp.net/file.enc',directPath:'/file.enc'}));
});

test('a stalled media request times out instead of hanging the queue',async t=>{
  const {archive}=fixture(t); const f=fake(archive); await f.connection.start();
  f.connection.dependencies.mediaTimeoutMs=20;
  f.lib.downloadMediaMessage=()=>new Promise(()=>{});
  const raw=rawMessage('timeout',{message:{documentMessage:{fileLength:1}}});
  const seq=archive.insert(normalizeMessage(raw),JSON.stringify(raw));
  await f.connection.download(seq); assert.equal(archive.get(seq).media_status,'FAILED'); f.connection.stop();
});
