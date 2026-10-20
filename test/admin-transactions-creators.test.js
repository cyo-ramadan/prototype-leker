import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { listStoreTransactions, handleAdminTransactionsApi, parseCursor } from '../src/admin-transactions.js';
import { handleCashierDataApi } from '../src/cashier-data-explorer.js';
import { transactionDetailByKindId, handleAdminTransactionDetailApi } from '../src/admin-transaction-detail.js';
import { hashCredential } from '../src/owner-auth.js';

class Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { assert.ok(args.length <= 100, `D1 bind cap: ${args.length}`); return new Statement(this.db, this.sql, args); }
  all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  first() { return this.db.prepare(this.sql).get(...this.args) || null; }
  run() { return { meta: { changes: this.db.prepare(this.sql).run(...this.args).changes } }; }
}
const request = (path, token) => new Request(`https://example.test${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test('transaction explorer combines source facts, payment and creator filters with store isolation', async t => {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(dir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(readFileSync(new URL(name, dir), 'utf8'));
  const d1 = { prepare: sql => new Statement(db, sql) };
  const env = { DB: d1 };
  const cashier = db.prepare("SELECT id FROM cashiers WHERE store_id = 'store_001' AND is_active = 1 ORDER BY id LIMIT 1").get();
  const entity = db.prepare("SELECT entity_id FROM stores WHERE id = 'store_001'").get().entity_id;
  // The same opaque ID belongs to two role namespaces: neither may be merged or numerically coerced.
  db.prepare("INSERT INTO store_admins(id,store_id,username,password_hash,display_name,is_active) VALUES(?,'store_001','creator-test','unused','Admin Pembuat',1)").run(cashier.id);
  const adminToken = 'transactions-admin-token';
  const cashierToken = 'transactions-cashier-token';
  db.prepare("INSERT INTO store_admin_sessions(token_hash,admin_id,created_at,expires_at) VALUES(?,?,'2026-01-01','2099-01-01')").run(await hashCredential(adminToken), cashier.id);
  db.prepare("INSERT INTO cashier_sessions(token_hash,cashier_id,created_at,expires_at) VALUES(?,?,'2026-01-01','2099-01-01')").run(await hashCredential(cashierToken), cashier.id);
  db.prepare("INSERT INTO cash_drawer_sessions(id,store_id,cashier_id,opening_amount,status,opened_at) VALUES('creator-drawer','store_001',?,0,'OPEN','2026-10-20T00:00:00.000Z')").run(cashier.id);
  const insertSale = db.prepare("INSERT INTO sales(id,store_id,cashier_id,drawer_session_id,customer_name,total_amount,payment_method,created_at) VALUES(?,'store_001',?,'creator-drawer','Pembeli',10000,?,?)");
  insertSale.run('creator-sale-cash',cashier.id,'CASH','2026-10-20T02:00:00.000Z');
  insertSale.run('creator-sale-qris',cashier.id,'QRIS','2026-10-20T01:00:00.000Z');
  const insertPayment = db.prepare(`INSERT INTO admin_payments(id,store_id,entity_id,kind,hutang_account,counterparty_name,amount,payment_method,shared_account_id,business_date,created_by_role,created_by_id,created_at)
    VALUES(?,?,?,'HUTANG','LAINNYA','Supplier Test',12000,?,?,'2026-10-20',?,?,?)`);
  insertPayment.run('creator-payment-bank','store_001',entity,'BANK',null,'ADMIN',cashier.id,'2026-10-20T03:00:00.000Z');
  insertPayment.run('creator-payment-old','store_001',entity,'BANK',null,'LEGACY_PIN','','2020-01-01T00:00:00.000Z');
  insertPayment.run('creator-other-store','store_002',null,'BANK',null,'ADMIN','outside-admin','2026-10-20T04:00:00.000Z');
  db.prepare("INSERT INTO entity_shared_accounts(id,entity_id,name) VALUES('creator-account',?,'Rekening Test')").run(entity);
  insertPayment.run('creator-payment-rekber','store_001',entity,'REKBER','creator-account','ADMIN',cashier.id,'2026-10-20T04:00:00.000Z');
  db.prepare(`INSERT INTO admin_operational_expenses(id,store_id,category,description,amount,business_date,created_by_role,created_by_id,created_at,payment_method)
    VALUES('creator-bea','store_001','BEA_LAINNYA','Biaya admin',10000,'2026-10-20','ADMIN',?,'2026-10-20T05:00:00.000Z','BANK')`).run(cashier.id);
  db.prepare(`INSERT INTO admin_payments(id,store_id,entity_id,kind,amount,payment_method,expense_id,business_date,created_by_role,created_by_id,created_at)
    VALUES('creator-linked-payment','store_001',?,'LAINNYA',10000,'BANK','creator-bea','2026-10-20','ADMIN',?,'2026-10-20T05:00:00.000Z')`).run(entity,cashier.id);
  try {
    await t.test('admin sees drawer-free bank/rekening sources once, with actual creator and no invented accounting status', async () => {
      const response = await handleAdminTransactionsApi(request('/api/admin/transactions?store=G001&bayar=REKENING',adminToken),env,'/api/admin/transactions');
      assert.equal(response.status,200);
      const body = await response.json();
      assert.ok(body.transactions.some(row => row.id === 'creator-payment-bank'));
      assert.ok(body.transactions.some(row => row.id === 'creator-payment-rekber'));
      assert.ok(body.transactions.some(row => row.id === 'creator-linked-payment'));
      assert.ok(!body.transactions.some(row => row.id === 'creator-bea' || row.id === 'creator-other-store'));
      const bank = body.transactions.find(row => row.id === 'creator-payment-bank');
      assert.equal(bank.drawerSessionId,null);
      assert.equal(bank.accounting,null);
      assert.equal(bank.createdBy.id,cashier.id);
      assert.equal(bank.creatorName,'Admin Pembuat');
      assert.ok(body.paymentMethods.length);
    });
    await t.test('creator options cover all dates and pages and preserve role/id namespaces', async () => {
      const first = await listStoreTransactions(d1,'store_001',{includeAdmin:true,limit:1,from:'2026-10-20T00:00:00.000Z'});
      assert.ok(first.creators.some(row => row.value === 'LEGACY_PIN:'));
      assert.ok(first.creators.some(row => row.value === `ADMIN:${cashier.id}`));
      assert.ok(first.creators.some(row => row.value === `CASHIER:${cashier.id}`));
      assert.ok(!first.creators.some(row => row.value.includes('outside-admin')));
      const ids = [];
      let before;
      do {
        const page = await listStoreTransactions(d1,'store_001',{includeAdmin:true,limit:2,before});
        ids.push(...page.transactions.map(row => row.id));
        before = page.nextCursor ? parseCursor(page.nextCursor) : null;
      } while (before);
      assert.ok(ids.includes('creator-payment-old'));
      assert.equal(new Set(ids).size,ids.length);
    });
    await t.test('payment, creator, search and date filters combine', async () => {
      const listing = await listStoreTransactions(d1,'store_001',{includeAdmin:true,bayar:'BANK',createdBy:`ADMIN:${cashier.id}`,q:'Supplier Test',from:'2026-10-01T00:00:00.000Z'});
      assert.deepEqual(listing.transactions.map(row => row.id),['creator-payment-bank']);
      const crossRole = await listStoreTransactions(d1,'store_001',{includeAdmin:true,bayar:'BANK',createdBy:`CASHIER:${cashier.id}`});
      assert.equal(crossRole.transactions.length,0);
      const named = await listStoreTransactions(d1,'store_001',{includeAdmin:true,q:'Admin Pembuat'});
      assert.ok(named.transactions.every(row => row.createdBy.role === 'ADMIN'));
    });
    await t.test('admin authentication and other-store isolation cover listing and detail', async () => {
      assert.equal((await handleAdminTransactionsApi(request('/api/admin/transactions?store=G001'),env,'/api/admin/transactions')).status,401);
      assert.equal((await handleAdminTransactionsApi(request('/api/admin/transactions?store=G002',adminToken),env,'/api/admin/transactions')).status,403);
      const path='/api/admin/transactions/detail/ADMIN_PAYMENT/creator-other-store';
      assert.equal((await handleAdminTransactionDetailApi(request(`${path}?store=G001`,adminToken),env,path)).status,404);
      const detail=await transactionDetailByKindId(d1,'store_001','ADMIN_PAYMENT','creator-payment-bank',{includeAdmin:true});
      assert.equal(detail.creatorName,'Admin Pembuat');
      assert.equal(detail.paymentMethod,'BANK');
      const expense=await transactionDetailByKindId(d1,'store_001','ADMIN_EXPENSE','creator-bea',{includeAdmin:true});
      assert.equal(expense.description,'Biaya admin');
    });
    await t.test('cashier retains store-scoped sale payment filters and gains creator filter without admin source access', async () => {
      const params=new URLSearchParams({store:'G002',bayar:'TUNAI',createdBy:`CASHIER:${cashier.id}`});
      const response=await handleCashierDataApi(request(`/api/cashier/data/transactions?${params}`,cashierToken),env,'/api/cashier/data/transactions');
      assert.equal(response.status,200);
      const body=await response.json();
      assert.deepEqual(body.transactions.map(row=>row.id),['creator-sale-cash']);
      assert.ok(body.creators.some(row=>row.value===`CASHIER:${cashier.id}`));
      assert.ok(!body.creators.some(row=>row.value===`ADMIN:${cashier.id}`));
      assert.equal(await transactionDetailByKindId(d1,'store_001','ADMIN_PAYMENT','creator-payment-bank'),null);
    });
    await t.test('filter/page requests can reuse creator options without rescanning history', async () => {
      let creatorQueries = 0;
      const tracked = { prepare(sql) { if (sql.includes('SELECT DISTINCT creator_role')) creatorQueries++; return new Statement(db, sql); } };
      const listing = await listStoreTransactions(tracked, 'store_001', { includeAdmin: true, includeCreators: false, createdBy: `ADMIN:${cashier.id}` });
      assert.equal(creatorQueries, 0);
      assert.equal(listing.creators, undefined);
      assert.ok(listing.transactions.length > 0);
      assert.ok(listing.transactions.every(row => row.createdBy.role === 'ADMIN'));
    });
    await t.test('standalone admin expense and voided payments remain visible with literal admin methods', async () => {
      db.prepare(`INSERT INTO admin_operational_expenses(id,store_id,category,description,amount,business_date,created_by_role,created_by_id,created_at,payment_method)
        VALUES('creator-standalone','store_001','BEA_LAINNYA','Biaya bank terpisah',1500,'2026-10-20','ADMIN',?,'2026-10-20T06:00:00.000Z','BANK')`).run(cashier.id);
      db.prepare("UPDATE admin_payments SET voided_at = '2026-10-20T07:00:00.000Z' WHERE id = 'creator-payment-bank'").run();
      const listing = await listStoreTransactions(d1, 'store_001', { includeAdmin: true, filter: 'OPERATIONS', bayar: 'REKENING' });
      assert.ok(listing.transactions.some(row => row.id === 'creator-standalone' && row.kind === 'ADMIN_EXPENSE'));
      assert.equal(listing.transactions.find(row => row.id === 'creator-payment-bank').status, 'voided');
      const response = await handleAdminTransactionsApi(request('/api/admin/transactions?store=G001&includeCreators=0',adminToken),env,'/api/admin/transactions');
      const body = await response.json();
      for (const method of ['BANK', 'REKBER', 'KAS', 'DEPOSIT']) assert.ok(body.paymentMethods.some(row => row.value === method));
      assert.equal(body.creators, undefined);
    });
    await t.test('100 mixed sales keep split-payment detail below D1 bind limit', async () => {
      for(let i=0;i<100;i++) {
        const id=`creator-mixed-${String(i).padStart(3,'0')}`;
        insertSale.run(id,cashier.id,'CAMPURAN','2026-10-21T00:00:00.000Z');
        db.prepare("INSERT INTO sale_payments(id,sale_id,store_id,payment_method_code,amount,created_at) VALUES(?,?,'store_001','QRIS',10000,'2026-10-21T00:00:00.000Z')").run(`${id}-qris`,id);
      }
      const listing=await listStoreTransactions(d1,'store_001',{limit:100,bayar:'QRIS',qrisCode:'QRIS',createdBy:`CASHIER:${cashier.id}`});
      assert.equal(listing.transactions.length,100);
      assert.ok(listing.transactions.every(row=>row.paymentLabel.includes('QRIS')));
    });
  } finally { db.close(); }
});
