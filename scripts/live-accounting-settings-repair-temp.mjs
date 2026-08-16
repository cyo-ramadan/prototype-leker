const BASE='https://prototype-leker-v2.daily-napkin.workers.dev';
const STORE='G001';
async function call(path,{method='GET',token='',body}={}){const r=await fetch(BASE+path,{method,headers:{accept:'application/json',...(body!==undefined?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const t=await r.text();let p;try{p=JSON.parse(t)}catch{p={raw:t}}if(!r.ok)throw new Error(`${path} HTTP ${r.status}: ${JSON.stringify(p)}`);return p}
const login=await call('/api/store-admin/login',{method:'POST',body:{username:'bablil',password:'bablil123'}});
const token=login.token;
let s=await call(`/api/admin/settings/accounting?store=${STORE}`,{token});
const sale=s.transactionCategories.find(c=>c.code==='sale');
if(!sale) throw new Error('SALE transaction category does not exist');
const canonical=[
  {label:'Pembayaran Penjualan',side:'DEBIT',sourceType:'payment_method',sortOrder:10},
  {label:'Pendapatan sesuai Jenis Barang',side:'CREDIT',sourceType:'item_category_revenue',sortOrder:20},
  {label:'HPP sesuai Jenis Barang',side:'DEBIT',sourceType:'item_category_cogs',sortOrder:30},
  {label:'Persediaan Keluar sesuai Jenis Barang',side:'CREDIT',sourceType:'item_category_inventory',sortOrder:40}
];
const changes=[];
for(const rule of canonical){
  const current=(sale.rules||[]).find(r=>r.isActive&&r.side===rule.side&&r.sourceType===rule.sourceType);
  if(current) continue;
  const created=await call(`/api/admin/settings/accounting/journal-rules?store=${STORE}`,{method:'POST',token,body:{transactionCategoryId:sale.id,...rule,isActive:true,isDefault:false}});
  changes.push({createdRuleId:created.id,...rule});
}
s=await call(`/api/admin/settings/accounting?store=${STORE}`,{token});
const after=s.transactionCategories.find(c=>c.code==='sale');
const required=canonical.every(rule=>after.rules.some(r=>r.isActive&&r.side===rule.side&&r.sourceType===rule.sourceType));
if(!required||after.completeness!=='COMPLETE') throw new Error(`SALE settings repair incomplete: ${JSON.stringify(after)}`);
console.log('=== SALE ACCOUNTING SETTINGS REPAIR PASS ===');
console.log(JSON.stringify({categoryId:after.id,changes,completeness:after.completeness,debitCount:after.debitCount,creditCount:after.creditCount,rules:after.rules},null,2));
