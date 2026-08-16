const BASE='https://prototype-leker-v2.daily-napkin.workers.dev';
const STORE='G001';
async function call(path,{method='GET',token='',body}={}){const r=await fetch(BASE+path,{method,headers:{accept:'application/json',...(body!==undefined?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const t=await r.text();let p;try{p=JSON.parse(t)}catch{p={raw:t}}if(!r.ok)throw new Error(`${path} HTTP ${r.status}: ${JSON.stringify(p)}`);return p}
const login=await call('/api/store-admin/login',{method:'POST',body:{username:'bablil',password:'bablil123'}});
const s=await call(`/api/admin/settings/accounting?store=${STORE}`,{token:login.token});
const targetCodes=new Set(['sale','purchase_material','operational']);
console.log('=== COMPACT ACCOUNTING SETTINGS AUDIT ===');
console.log(JSON.stringify({
 accounts:s.accounts.filter(a=>a.isActive).map(a=>({id:a.id,code:a.code,name:a.name,type:a.type,subtype:a.subtype})),
 paymentMethods:s.paymentMethods.map(p=>({id:p.id,code:p.code,name:p.name,accountId:p.accountId,accountCode:p.accountCode,accountName:p.accountName,isActive:p.isActive,isDefault:p.isDefault})),
 productKinds:s.productKinds.map(k=>({id:k.id,code:k.code,name:k.name,isActive:k.isActive})),
 itemCategories:s.itemCategories.map(c=>({id:c.id,productKindId:c.productKindId,name:c.name,inventoryAccountId:c.inventoryAccountId,cogsAccountId:c.cogsAccountId,revenueAccountId:c.revenueAccountId,isActive:c.isActive})),
 transactionCategories:s.transactionCategories.filter(c=>targetCodes.has(c.code)).map(c=>({id:c.id,code:c.code,name:c.name,registeredByModule:c.registeredByModule,isActive:c.isActive,completeness:c.completeness,debitCount:c.debitCount,creditCount:c.creditCount,rules:c.rules.map(r=>({id:r.id,label:r.label,side:r.side,sourceType:r.sourceType,fixedAccountId:r.fixedAccountId,isActive:r.isActive,isDefault:r.isDefault,sortOrder:r.sortOrder}))}))
},null,2));
