const BASE='https://prototype-leker-v2.daily-napkin.workers.dev';
async function raw(path,{method='GET',token='',body}={}){const c=new AbortController();const timer=setTimeout(()=>c.abort(),15000);try{const r=await fetch(BASE+path,{method,signal:c.signal,headers:{accept:'application/json',...(body!==undefined?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const text=await r.text();let payload;try{payload=text?JSON.parse(text):{}}catch{payload={raw:text}}return{ok:r.ok,status:r.status,payload}}finally{clearTimeout(timer)}}
const login=await raw('/api/store-admin/login',{method:'POST',body:{username:'bablil',password:'bablil123'}});if(!login.ok||!login.payload.token)throw new Error(`Admin login failed: ${JSON.stringify(login)}`);
const result=await raw('/api/admin/system/d1-diagnostic-temp',{token:login.payload.token});if(!result.ok)throw new Error(`Diagnostic failed HTTP ${result.status}: ${JSON.stringify(result.payload)}`);const d=result.payload;
if(!d.tables?.approval_permits)throw new Error(`Extended diagnostic endpoint is not live yet: ${JSON.stringify({keys:Object.keys(d.tables||{}),indexes:d.indexes})}`);
console.log('=== LIVE D1 SCHEMA DIAGNOSTIC V2 PASS ===');
console.log(JSON.stringify({
  products:d.tables.products,
  sales:d.tables.sales,
  purchases:d.tables.purchases,
  expenses:d.tables.expenses,
  approvalPermits:d.tables.approval_permits,
  missingTables:d.missingTables,
  indexes:d.indexes,
  missingIndexes:d.missingIndexes,
  mismatchedTables:d.mismatchedTables,
  migration0017:d.migrations.find(m=>m.name==='0017_product_stock_production_points.sql'),
  migration0027:d.migrations.find(m=>m.name==='0027_transaction_void_permits.sql')
},null,2));
