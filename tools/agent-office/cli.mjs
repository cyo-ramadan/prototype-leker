import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer} from './server.mjs';
import {installHooks} from './install.mjs';
import {send,config,dataHome} from './lib/config.mjs';
import {identity} from './lib/model.mjs';
const args=process.argv.slice(2),mode=args.shift()||'serve';
function option(name,fallback=''){const i=args.indexOf(`--${name}`);return i>=0?args[i+1]??fallback:fallback;}
if(mode==='serve'){
 const port=option('port');if(port&&(!/^\d+$/.test(port)||+port<1024||+port>65535))throw Error('Port harus 1024–65535');const app=await startServer({port:port?+port:undefined});let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0);});
}else if(mode==='install'||mode==='uninstall'){
 console.log(`${mode==='install'?'Hooks dipasang':'Hooks dilepas'}: ${installHooks(option('project',process.cwd()),mode==='uninstall')}\nRestart sesi Claude Code untuk memuat konfigurasi. Hooks lain dipertahankan.`);
}else if(mode==='run'){
 const split=args.indexOf('--'),cmd=split>=0?args.slice(split+1):[];if(!cmd.length)throw Error('Contoh: node cli.mjs run --name Hana --role Developer -- claude');
 config();const sid=randomUUID(),name=option('name','Agent baru'),role=option('role','Belum diatur'),project=option('project',basename(process.cwd())),task=option('task'),agent_id=option('id',`agent:${identity(resolve(process.cwd())+name)}`);
 const env={...process.env,MAXI_MONITOR_RUN:sid,MAXI_AGENT_ID:agent_id,MAXI_AGENT_NAME:name,MAXI_AGENT_ROLE:role,MAXI_AGENT_TASK:task,MAXI_AGENT_PROJECT:project,MAXI_AGENT_PROVIDER:option('provider')};
 const base={session_id:sid,agent_id,name,role,project,task,harness:basename(cmd[0]),provider:option('provider'),source:'process_wrapper'};
 const emit=type=>send({...base,id:randomUUID(),type,occurred_at:Date.now()});await emit('process_start');let cancelled=false;
 // CLI is an explicit user launcher; the HTTP dashboard has no process-control route.
 const child=spawn(cmd[0],cmd.slice(1),{stdio:'inherit',env,shell:false});
 const timer=setInterval(()=>emit('process_heartbeat'),15000);timer.unref();
 const handles={};for(const signal of ['SIGINT','SIGTERM']){handles[signal]=()=>{cancelled=true;child.kill(signal);};process.on(signal,handles[signal]);}
 const result=await new Promise(r=>{child.once('error',()=>r({code:127,signal:null}));child.once('exit',(code,signal)=>r({code,signal}));});clearInterval(timer);for(const [sig,fn]of Object.entries(handles))process.off(sig,fn);
 await send({...base,id:randomUUID(),type:'process_exit',...result,cancelled,occurred_at:Date.now()});process.exitCode=result.code??(cancelled?0:1);
}else if(mode==='help'){
 console.log(`MAXI Agent Office\nserve [--port 4318]\ninstall --project <folder>\nuninstall --project <folder>\nrun --name Hana --role Developer --task "Task" -- claude\nLive launcher: ${dataHome()}/open-office.html\nNode: ${process.execPath}\nCLI: ${fileURLToPath(import.meta.url)}`);
}else throw Error('Mode tidak dikenal. Gunakan help.');
