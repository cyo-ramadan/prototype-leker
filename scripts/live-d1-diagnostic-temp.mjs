const BASE='https://prototype-leker-v2.daily-napkin.workers.dev';
async function raw(path,{method='GET',token='',body}={}){const c=new AbortController();const timer=setTimeout(()=>c.abort(),15000);try{const r=await fetch(BASE+path,{method,signal:c.signal,headers:{accept:'application/json',...(body!==undefined?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const text=await r.text();let payload;try{payload=text?JSON.parse(text):{}}catch{payload={raw:text}}return{ok:r.ok,status:r.status,payload}}finally{clearTimeout(timer)}}
const login=await raw('/api/store-admin/login',{method:'POST',body:{username:'bablil',password:'bablil123'}});if(!login.ok||!login.payload.token)throw new Error(`Admin login failed: ${JSON.stringify(login)}`);
let diagnostic=null;
for(let attempt=1;attempt<=24;attempt+=1){const result=await raw('/api/admin/system/d1-diagnostic-temp',{token:login.payload.token});if(result.ok&&result.payload?.diagnostic==='TEMP_READ_ONLY_SCHEMA'){diagnostic=result.payload;break}console.log(`diagnostic attempt ${attempt}: HTTP ${result.status}`);await new Promise(resolve=>setTimeout(resolve,5000))}
if(!diagnostic)throw new Error('Temporary D1 diagnostic endpoint did not become available after retries.');
console.log('=== LIVE D1 SCHEMA DIAGNOSTIC PASS ===');
console.log(JSON.stringify(diagnostic,null,2));
