import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const TIMEOUT_MS = 120000;
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function wrangler(args,{json=false}={}){const r=spawnSync(npx,['--yes','wrangler',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:TIMEOUT_MS,killSignal:'SIGTERM'});if(r.error)throw r.error;if(r.status!==0)throw new Error(r.stderr||r.stdout||`wrangler exited ${r.status}`);return json?JSON.parse(r.stdout):r.stdout}
function rows(payload){const out=[];for(const c of(Array.isArray(payload)?payload:[payload])){if(Array.isArray(c?.results))out.push(...c.results);else if(Array.isArray(c?.result?.results))out.push(...c.result.results);else if(Array.isArray(c?.result))out.push(...c.result)}return out}
function query(sql){return rows(wrangler(['d1','execute','DB','--remote','--json','--command',sql],{json:true}))}

const tables=['products','sales','sale_items','orders','order_items','order_status_history','inventory_stock_balances','stock_movements','production_runs','approval_permits','purchases','expenses','item_types','units','product_kinds'];
const schema={};for(const table of tables){schema[table]=query(`PRAGMA table_info(${table});`).map(row=>({cid:row.cid,name:row.name,type:row.type,notnull:row.notnull,defaultValue:row.dflt_value,pk:row.pk}))}
const migrationNames=['0007_customer_identity_unified_entry.sql','0012_drawer_bound_sales_orders.sql','0017_product_stock_production_points.sql','0019_product_costing_and_kinds.sql','0027_transaction_void_permits.sql'];
const migrations=query(`SELECT id,name,applied_at FROM d1_migrations WHERE name IN (${migrationNames.map(name=>`'${name}'`).join(',')}) ORDER BY id;`);
const foreignKeyViolations=query('PRAGMA foreign_key_check;');
const indexes=query(`SELECT name,tbl_name,sql FROM sqlite_schema WHERE type='index' AND tbl_name IN ('products','sales','sale_items','orders','order_items','order_status_history') ORDER BY tbl_name,name;`);
const masterRows={
 itemTypes:query(`SELECT id,store_id,code,name,track_stock,can_produce,is_active FROM item_types WHERE store_id='store_001' ORDER BY code;`),
 units:query(`SELECT id,store_id,code,name,symbol,is_active FROM units WHERE store_id='store_001' ORDER BY code;`),
 syntheticProducts:query(`SELECT id,store_id,name,item_type_id,base_unit_id,product_kind_id,stock_tracking_enabled,is_active FROM products WHERE name LIKE '[API SMOKE]%' ORDER BY id;`),
 syntheticKinds:query(`SELECT id,store_id,code,name,is_active FROM product_kinds WHERE code LIKE 'API_SMOKE_%' OR name LIKE 'API Smoke%' ORDER BY id;`),
 syntheticBalances:query(`SELECT b.rowid AS rowid,b.store_id,b.product_id,b.quantity,b.updated_at,p.name AS product_name,p.is_active AS product_active FROM inventory_stock_balances b LEFT JOIN products p ON p.id=b.product_id WHERE b.rowid IN (14,15) OR p.name LIKE '[API SMOKE]%' ORDER BY b.rowid;`)
};
const payload={generatedAt:new Date().toISOString(),diagnostic:'TEMP_REMOTE_SCHEMA_ARTIFACT_V2',schema,migrations,foreignKeyViolations,indexes,masterRows};
writeFileSync('public/schema-diagnostic-temp.json',`${JSON.stringify(payload,null,2)}\n`);
console.log('Temporary schema diagnostic asset V2 generated.');
wrangler(['deploy']);