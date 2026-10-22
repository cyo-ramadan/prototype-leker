import {spawn} from 'node:child_process';
import {readFileSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import net from 'node:net';
import assert from 'node:assert/strict';
import {restrictedArgs,cleanEnvironment} from '../launch.mjs';
const folder=fileURLToPath(new URL('../',import.meta.url));
const tenant=`smoke-${process.pid}`;
const data=fileURLToPath(new URL(`../data/${tenant}/`,import.meta.url));
const portProbe=net.createServer(); await new Promise(r=>portProbe.listen(0,'127.0.0.1',r));
const port=portProbe.address().port; await new Promise(r=>portProbe.close(r));
async function run() {
  const child=spawn(process.execPath,restrictedArgs(),{cwd:folder,env:{...cleanEnvironment(),WA_TENANT:tenant,WA_PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
  const exit=once(child,'exit'); let output=''; let errors=''; child.stderr.on('data',d=>errors+=d);
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('startup timeout: '+errors)),20000);
      child.once('exit',()=>{clearTimeout(timer);reject(new Error('startup failed: '+errors));});
      child.stdout.on('data',d=>{output+=d;if(output.includes('Gateway lokal:')){clearTimeout(timer);resolve();}});
    });
    const base=`http://127.0.0.1:${port}`;
    const page=await fetch(base); assert.equal(page.status,200); assert.match(await page.text(),/Pesan masuk, tercatat/);
    assert.equal((await fetch(base+'/api/status')).status,401);
    const token=readFileSync(data+'admin.token','utf8');
    const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token})});
    assert.equal(login.status,200); const cookie=login.headers.get('set-cookie').split(';')[0];
    const status=await (await fetch(base+'/api/status',{headers:{Cookie:cookie}})).json();
    assert.equal(status.state,'STOPPED'); assert.equal(status.tenant,tenant);
    assert.equal(status.qr,null);
  } finally { child.kill('SIGTERM'); await exit; }
}
try { await run(); await run(); console.log('Smoke PASS: restricted server startup, login, local panel, no WA connection, restart after process exit.'); }
finally { rmSync(data,{recursive:true,force:true}); }
