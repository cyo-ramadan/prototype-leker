import {mkdirSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
export const dataHome=()=>process.env.MAXI_MONITOR_HOME||join(homedir(),'.maxi-agent-office');
export function config(home=dataHome()){
 mkdirSync(home,{recursive:true,mode:0o700});const path=join(home,'connection.json');
 try{return JSON.parse(readFileSync(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('Invalid connection.json; restore it instead of silently resetting credentials');}
 const c={version:1,port:4318,producer:randomBytes(32).toString('hex'),viewer:randomBytes(32).toString('hex')};writeFileSync(path,JSON.stringify(c,null,2),{mode:0o600,flag:'wx'});try{chmodSync(path,0o600);}catch{}return c;
}
export function readConfig(){return JSON.parse(readFileSync(join(dataHome(),'connection.json'),'utf8'));}
export async function send(event){try{const c=readConfig();const r=await fetch(`http://127.0.0.1:${c.port}/api/events`,{method:'POST',headers:{authorization:`Bearer ${c.producer}`,'content-type':'application/json'},body:JSON.stringify(event),signal:AbortSignal.timeout(1200)});return r.ok;}catch{return false;}}
