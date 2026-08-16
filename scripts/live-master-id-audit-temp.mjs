const BASE='https://prototype-leker-v2.daily-napkin.workers.dev';
const STORE='G001';
async function call(path,{method='GET',token='',body}={}){const c=new AbortController();const t=setTimeout(()=>c.abort(),20000);try{const r=await fetch(BASE+path,{method,signal:c.signal,headers:{accept:'application/json',...(body!==undefined?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const text=await r.text();let p;try{p=text?JSON.parse(text):{}}catch{p={raw:text}}if(!r.ok)throw new Error(`${path} HTTP ${r.status}: ${JSON.stringify(p)}`);return p}finally{clearTimeout(t)}}
const admin=await call('/api/store-admin/login',{method:'POST',body:{username:'bablil',password:'bablil123'}});
const editor=await call(`/api/admin/master/products/editor?store=${STORE}`,{token:admin.token});
console.log('=== LIVE PRODUCT MASTER ID AUDIT ===');
console.log(JSON.stringify({
 itemTypes:(editor.itemTypes||[]).map(x=>({id:x.id,code:x.code,name:x.name,trackStock:x.trackStock,canProduce:x.canProduce,isActive:x.isActive})),
 units:(editor.units||[]).map(x=>({id:x.id,code:x.code,name:x.name,symbol:x.symbol,isActive:x.isActive})),
 productKinds:(editor.productKinds||[]).map(x=>({id:x.id,code:x.code,name:x.name,isActive:x.isActive})),
 syntheticProducts:(editor.products||[]).filter(p=>String(p.name||'').startsWith('[API SMOKE]')).map(p=>({id:p.id,name:p.name,itemTypeId:p.itemTypeId,baseUnitId:p.baseUnitId,productKindId:p.productKindId,stockTrackingEnabled:p.stockTrackingEnabled,isActive:p.isActive})),
 productsCount:(editor.products||[]).length
},null,2));
