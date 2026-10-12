import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildDrawerReport } from '../src/drawer-report.js';
import { setTenantPolicySetting, UI_SKIN_KEY } from '../src/tenant-policy.js';

class Statement {
  constructor(db, sql, params = []) { Object.assign(this, { db, sql, params }); }
  bind(...params) { return new Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() { return { success: true, meta: { changes: this.db.prepare(this.sql).run(...this.params).changes } }; }
}
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) sql.exec(readFileSync(new URL(file, dir), 'utf8'));
  const db = { prepare: query => new Statement(sql, query), batch: statements => { sql.exec('BEGIN'); try { const rows=statements.map(s=>s.run()); sql.exec('COMMIT'); return rows; } catch(error) { sql.exec('ROLLBACK'); throw error; } } };
  const store = 'store_001';
  const otherStore = sql.prepare('SELECT id FROM stores WHERE id <> ? LIMIT 1').get(store).id;
  const tenant = sql.prepare('SELECT et.tenant_id FROM stores s JOIN entity_tenancy et ON et.entity_id=s.entity_id AND et.effective_to IS NULL WHERE s.id=?').get(store).tenant_id;
  const now = '2026-10-12T01:00:00.000Z';
  const later = '2026-10-12T01:05:00.000Z';
  for (const [id, storeId] of [['history_cashier', store], ['history_other_cashier', otherStore]]) {
    sql.prepare("INSERT INTO cashiers(id,username,password_hash,employee_name,store_id,is_active) VALUES(?,?,'fixture',?,?,1)").run(id,id,id,storeId);
  }
  for (const [id, storeId, cashier] of [['history_drawer', store, 'history_cashier'], ['history_second_drawer',store,'history_cashier'], ['history_foreign_drawer',otherStore,'history_other_cashier']]) {
    sql.prepare("INSERT INTO cash_drawer_sessions(id,store_id,cashier_id,opening_amount,status,opened_at) VALUES(?,?,?,100000,'CLOSED',?)").run(id,storeId,cashier,now);
  }
  const owner = sql.prepare('SELECT id,display_name FROM owner_accounts LIMIT 1').get();
  function approval(id, { type='GOODS_FLOW', status='pending_approval', posting='unposted', payload={}, storeId=store, drawer='history_drawer', cashier='history_cashier' } = {}) {
    sql.prepare('INSERT INTO approval_requests(id,store_id,drawer_session_id,cashier_id,request_type,approval_status,posting_status,payload_json,created_at,updated_at,approved_by_role,approved_by_id,approved_at,rejected_at,posted_at,decision_note,posting_block_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id,storeId,drawer,cashier,type,status,posting,JSON.stringify(payload),now,later,status==='pending_approval'?null:'OWNER',status==='pending_approval'?null:owner.id,status==='approved'?later:null,status==='rejected'?later:null,posting==='posted'?later:null,'Catatan keputusan',posting==='blocked'?'Mapping belum lengkap':'');
  }
  function permit(id, { status='pending_approval', execution='NOT_ATTEMPTED', role='OWNER', amount=25000, storeId=store, drawer='history_drawer', cashier='history_cashier' } = {}) {
    sql.prepare("INSERT INTO approval_permits(id,store_id,drawer_session_id,cashier_id,permit_type,subject_type,subject_id,subject_snapshot_json,reason,approval_status,execution_status,requested_at,updated_at,decided_at,executed_at,approved_by_role,approved_by_id,decision_note,execution_detail) VALUES(?,?,?,?,'TRANSACTION_VOID','SALE',?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id,storeId,drawer,cashier,'sale_'+id,JSON.stringify({amount,paymentMethod:'CASH',description:'Penjualan teh',createdAt:now}),'Salah entry',status,execution,now,later,status==='pending_approval'?null:later,execution==='EXECUTED'?later:null,status==='pending_approval'?null:role,role==='CASHIER_SELF'?cashier:owner.id,'Sudah diperiksa',execution==='HOLD'?'Stok belum dapat dibalik':'');
  }
  function closure(id, status='PENDING') {
    sql.prepare('INSERT INTO drawer_close_permits(id,store_id,drawer_session_id,target_cashier_id,requested_by_cashier_id,closing_amount,deposit_amount,reason,status,created_at,decided_at,decided_by_role,decided_by_id) VALUES(?,?,?,?,?,100000,50000,?,?,?,?,?,?)')
      .run(id,store,'history_drawer','history_cashier','history_cashier','Ganti shift',status,now,status==='PENDING'?null:later,status==='PENDING'?null:'OWNER',status==='PENDING'?null:owner.id);
  }
  return { sql, db, store, otherStore, tenant, now, later, owner, approval, permit, closure };
}

test('skin H combines linked drawer approvals, void decisions, cancellation and close permits without changing totals', async () => {
  const f = fixture();
  try {
    const {sql,db,store,tenant,approval,permit,closure}=f;
    await setTenantPolicySetting(db,tenant,UI_SKIN_KEY,'H');
    const baseline = await buildDrawerReport(db,store,'history_drawer');
    approval('stock_pending',{payload:{purpose:'STOCK_ADJUSTMENT',productName:'Teh',unitSymbol:'ml',currentQuantitySnapshot:100,targetQuantity:75,reason:'Tumpah'}});
    approval('cash_blocked',{type:'CASH_FLOW',status:'approved',posting:'blocked',payload:{direction:'OUT',amount:2000,description:'Kas kecil'}});
    approval('asset_rejected',{type:'ASSET',status:'rejected',payload:{assetName:'Meja',reason:'Belum perlu'}});
    approval('unknown_snapshot',{payload:{purpose:'STOCK_ADJUSTMENT',productName:'Gula',targetQuantity:0}});
    permit('void_pending');
    permit('void_hold',{status:'approved',execution:'HOLD'});
    permit('void_executed',{status:'approved',execution:'EXECUTED'});
    permit('void_failed',{status:'approved',execution:'FAILED'});
    permit('void_rejected',{status:'rejected'});
    permit('void_cancelled',{status:'rejected',role:'CASHIER_SELF'});
    const product=sql.prepare('SELECT id,base_unit_id FROM products WHERE store_id=? AND base_unit_id IS NOT NULL LIMIT 1').get(store);
    sql.prepare("INSERT INTO stock_movements(id,source_key,store_id,product_id,product_name,unit_id,unit_symbol,direction,quantity,source_type,source_id,drawer_session_id,occurred_at) VALUES('history_void_stock','SALE_VOID:void_executed:item',?,?,'Teh',?,'ml','IN',50,'SALE_VOID','sale_void_executed','history_drawer',?)").run(store,product.id,product.base_unit_id,f.later);
    closure('close_pending');
    closure('close_approved','APPROVED');
    closure('close_rejected','REJECTED');
    const report=await buildDrawerReport(db,store,'history_drawer');
    const rows=new Map(report.sections.permitHistory.map(row=>[row.id,row]));
    assert.equal(rows.size,13);
    assert.deepEqual(report.totals,baseline.totals,'history must never be added into posted financial totals');
    assert.equal(report.sections.stockAdjustments.length,0,'pending adjustments stay outside posted stock table');
    assert.equal(rows.get('stock_pending').status,'PENDING');
    assert.equal(rows.get('stock_pending').stockChanges[0].delta,-25);
    assert.equal(rows.get('stock_pending').reason,'Tumpah');
    assert.equal(rows.get('stock_pending').requestedBy.name,'history_cashier');
    assert.equal(rows.get('stock_pending').requestedAt,f.now);
    assert.equal(rows.get('unknown_snapshot').stockChanges[0].delta,null,'missing snapshot is not assumed zero');
    assert.equal(rows.get('cash_blocked').status,'APPROVED');
    assert.equal(rows.get('cash_blocked').executionStatus,'BLOCKED');
    assert.equal(rows.get('cash_blocked').executionDetail,'Mapping belum lengkap');
    assert.equal(rows.get('cash_blocked').cashDelta,-2000);
    assert.equal(rows.get('cash_blocked').decidedBy.name,f.owner.display_name);
    assert.equal(rows.get('cash_blocked').decidedAt,f.later);
    assert.equal(rows.get('asset_rejected').status,'REJECTED');
    assert.equal(rows.get('void_pending').status,'PENDING');
    assert.equal(rows.get('void_hold').executionStatus,'HOLD');
    assert.equal(rows.get('void_hold').executionDetail,'Stok belum dapat dibalik');
    assert.equal(rows.get('void_hold').cashDelta,-25000);
    assert.equal(rows.get('void_executed').executedAt,f.later);
    assert.deepEqual(rows.get('void_executed').stockChanges,[{productName:'Teh',unitSymbol:'ml',delta:50,recorded:null,actual:null}]);
    assert.deepEqual(rows.get('void_pending').stockChanges,[],'other permit stock changes must not be attributed to this permit');
    assert.equal(rows.get('void_failed').executionStatus,'FAILED');
    assert.equal(rows.get('void_rejected').status,'REJECTED');
    assert.equal(rows.get('void_cancelled').status,'CANCELLED');
    assert.equal(rows.get('void_cancelled').decidedBy.name,'history_cashier');
    assert.equal(rows.get('close_pending').executionStatus,'NOT_ATTEMPTED');
    assert.equal(rows.get('close_approved').executionStatus,'EXECUTED');
    assert.equal(rows.get('close_approved').depositAmount,50000);
    assert.equal(rows.get('close_rejected').status,'REJECTED');
    assert.equal(sql.prepare('SELECT approval_status FROM approval_permits WHERE id=?').get('void_hold').approval_status,'approved','read model never updates canonical decisions');
  } finally { f.sql.close(); }
});

test('drawer history follows current H policy, disappears on skin switch, and remains isolated by both store and drawer', async () => {
  const f=fixture();
  try {
    const {db,store,otherStore,tenant,approval,permit}=f;
    const baseline=await buildDrawerReport(db,store,'history_drawer');
    assert.equal(Object.hasOwn(baseline.sections,'permitHistory'),false);
    approval('linked');
    approval('same_store_other_drawer',{drawer:'history_second_drawer'});
    permit('other_store',{storeId:otherStore,drawer:'history_foreign_drawer',cashier:'history_other_cashier'});
    // Legacy malformed linkage is deliberately tested: both scope predicates are required.
    permit('foreign_store_same_drawer',{storeId:otherStore,drawer:'history_drawer',cashier:'history_other_cashier'});
    await setTenantPolicySetting(db,tenant,UI_SKIN_KEY,'H');
    const h=await buildDrawerReport(db,store,'history_drawer');
    assert.deepEqual(h.sections.permitHistory.map(row=>row.id),['linked']);
    assert.equal(await buildDrawerReport(db,otherStore,'history_drawer'),null);
    for (const choice of ['0','A','B','C','D','E','F','G']) {
      await setTenantPolicySetting(db,tenant,UI_SKIN_KEY,choice);
      const report=await buildDrawerReport(db,store,'history_drawer');
      assert.equal(Object.hasOwn(report.sections,'permitHistory'),false,'skin '+choice+' must not inherit H history output');
      assert.deepEqual(report,baseline,'normal report contract and numbers are unchanged for '+choice);
    }
    await setTenantPolicySetting(db,tenant,UI_SKIN_KEY,'H');
    assert.deepEqual((await buildDrawerReport(db,store,'history_drawer')).sections.permitHistory.map(row=>row.id),['linked']);
  } finally { f.sql.close(); }
});
