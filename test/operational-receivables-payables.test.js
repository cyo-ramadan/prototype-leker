import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { createContact } from '../src/ikan-master-contacts.js';
import { createProduct } from '../src/ikan-master-products.js';
import { createSale, getSale } from '../src/ikan-penjualan.js';
import { listPurchases } from '../src/ikan-pembelian-dropship.js';
import {
  addOperationalReceivablePayable,
  addOperationalPayment,
  getOperationalReceivablePayable,
} from '../src/operational-receivables-payables.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const migration = readFileSync(new URL('../migrations/0074_operational_receivables_payables.sql', import.meta.url), 'utf8');
const API_ROOT = '/api/ikan/operational-receivables-payables';

class D1Statement {
  constructor(sqlite, sql, params = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) { return new D1Statement(this.sqlite, this.sql, params); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.params) ?? null; }
  async all() { return { results: this.sqlite.prepare(this.sql).all(...this.params) }; }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}

class D1Database {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new D1Statement(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return { db: new D1Database(sqlite), sqlite };
}

async function seedSale(db, { status = 'INVOICE' } = {}) {
  const customer = await createContact(db, { contactName: 'Rudi', isCustomer: true });
  const petani = await createContact(db, { contactName: 'Pak Tani', isPetani: true });
  const kurir = await createContact(db, { contactName: 'JNE', isKurir: true });
  const product = await createProduct(db, {
    productName: 'Ikan Kembung',
    salePriceRupiah: 35000,
    purchasePriceRupiah: 22000,
  });
  const sale = await createSale(db, {
    contactId: customer.contactId,
    transactionDate: '2026-09-06',
    status,
    ...(status === 'INVOICE' ? { petaniContactId: petani.contactId } : {}),
    items: [{ productId: product.productId, quantity: 1 }],
  });
  return { customer, petani, kurir, sale };
}

function request(pathname, { method = 'GET', body } = {}) {
  return new Request(`https://leker.test${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function callWorker(db, pathname, options) {
  const response = await worker.fetch(request(pathname, options), { DB: db });
  return { response, body: await response.json() };
}

test('migration 0074 additive, entity-aware, dan seluruh query scope punya index', () => {
  const { sqlite } = freshDb();
  try {
    assert.doesNotMatch(migration, /ALTER\s+TABLE/i);
    const columns = new Map(sqlite.prepare('PRAGMA table_info(operational_receivables_payables)').all().map((row) => [row.name, row]));
    assert.equal(columns.get('store_id').notnull, 1);
    assert.equal(columns.get('entity_id').notnull, 1);
    assert.equal(columns.get('original_amount').type, 'INTEGER');
    assert.doesNotMatch(migration, /\bREAL\b/i);

    const paymentColumns = new Map(sqlite.prepare('PRAGMA table_info(operational_receivable_payable_payments)').all().map((row) => [row.name, row]));
    assert.equal(paymentColumns.get('store_id').notnull, 1);
    assert.equal(paymentColumns.get('entity_id').notnull, 1);
    assert.equal(paymentColumns.get('amount').type, 'INTEGER');
    assert.ok(paymentColumns.has('proof_reference'));
    assert.ok(paymentColumns.has('approval_status'));

    const parentPlan = sqlite.prepare(`
      EXPLAIN QUERY PLAN
      SELECT * FROM operational_receivables_payables
      WHERE store_id = 'store_ikan01' AND source_type = 'SALE_RECEIVABLE'
    `).all().map((row) => row.detail).join(' ');
    assert.match(parentPlan, /idx_operational_rp_store_source/);

    const paymentPlan = sqlite.prepare(`
      EXPLAIN QUERY PLAN
      SELECT amount FROM operational_receivable_payable_payments
      WHERE store_id = 'store_ikan01' AND receivable_payable_id = 'x' AND approval_status = 'approved'
    `).all().map((row) => row.detail).join(' ');
    assert.match(paymentPlan, /idx_operational_rp_payment_store_parent/);

    const triggers = sqlite.prepare(`
      SELECT DISTINCT tbl_name FROM sqlite_schema
      WHERE type = 'trigger'
        AND (name LIKE 'trg_%operational_rp%'
          OR name LIKE 'trg_employee_deposit_payment_%')
    `).all().map((row) => row.tbl_name);
    assert.deepEqual([...new Set(triggers)], ['operational_receivable_payable_payments']);
  } finally {
    sqlite.close();
  }
});

test('endpoint tambah, bayar, dan rekap melayani piutang Sale serta hutang Pembelian/Titipan Biaya', async () => {
  const { db, sqlite } = freshDb();
  try {
    const { sale, kurir } = await seedSale(db);
    const [purchase] = await listPurchases(db);

    const saleCreate = await callWorker(db, API_ROOT, {
      method: 'POST',
      body: { sourceType: 'SALE_RECEIVABLE', sourceId: sale.saleId, amountRupiah: 35000 },
    });
    assert.equal(saleCreate.response.status, 201);
    assert.equal(saleCreate.body.item.balanceType, 'RECEIVABLE');
    assert.equal(saleCreate.body.item.counterpartyName, 'Rudi');
    assert.equal(sqlite.prepare(`
      SELECT original_amount FROM operational_receivables_payables WHERE id = ?
    `).get(saleCreate.body.item.id).original_amount, 35000000000);

    const purchaseCreate = await callWorker(db, API_ROOT, {
      method: 'POST',
      body: { sourceType: 'PURCHASE_PAYABLE', sourceId: purchase.purchaseId, amountRupiah: 22000 },
    });
    assert.equal(purchaseCreate.response.status, 201);
    assert.equal(purchaseCreate.body.item.balanceType, 'PAYABLE');
    assert.equal(purchaseCreate.body.item.counterpartyName, 'Pak Tani');

    const totalBeforeCost = (await getSale(db, sale.saleId)).totalRupiah;
    const costCreate = await callWorker(db, API_ROOT, {
      method: 'POST',
      body: {
        sourceType: 'COST_PAYABLE',
        sourceId: sale.saleId,
        amountRupiah: 15000,
        counterpartyId: kurir.contactId,
        description: 'Ongkir JNE',
      },
    });
    assert.equal(costCreate.response.status, 201);
    assert.equal(costCreate.body.item.counterpartyName, 'JNE');
    assert.equal((await getSale(db, sale.saleId)).totalRupiah, totalBeforeCost + 15000);

    const costPayment = await callWorker(db, `${API_ROOT}/${costCreate.body.item.id}/payments`, {
      method: 'POST', body: { amountRupiah: 5000 },
    });
    assert.equal(costPayment.response.status, 201);
    assert.equal(costPayment.body.item.balanceRupiah, 10000);
    assert.equal((await getSale(db, sale.saleId)).totalRupiah, totalBeforeCost + 15000,
      'pelunasan vendor tidak boleh mengubah tagihan customer');

    const recap = await callWorker(db, `${API_ROOT}/recap`);
    assert.equal(recap.response.status, 200);
    assert.deepEqual(
      recap.body.items.map((row) => [row.sourceType, row.balanceRupiah]).sort(),
      [
        ['COST_PAYABLE', 10000],
        ['PURCHASE_PAYABLE', 22000],
        ['SALE_RECEIVABLE', 35000],
      ]
    );

    assert.equal(sqlite.prepare(`
      SELECT COUNT(*) AS count FROM operational_receivables_payables
      WHERE store_id <> 'store_ikan01'
    `).get().count, 0);
  } finally {
    sqlite.close();
  }
});

for (const status of ['DRAFT', 'INVOICE']) {
  test(`Titipan Biaya ${status} atomik menaikkan invoice, settlement tidak mengubahnya`, async () => {
    const { db, sqlite } = freshDb();
    try {
      const { sale } = await seedSale(db, { status });
      const before = (await getSale(db, sale.saleId)).totalRupiah;
      const item = await addOperationalReceivablePayable(db, {
        sourceType: 'COST_PAYABLE',
        sourceId: sale.saleId,
        amountRupiah: 7000,
        counterpartyName: 'Tukang Bongkar',
      });
      assert.equal((await getSale(db, sale.saleId)).totalRupiah, before + 7000);

      await addOperationalPayment(db, item.id, { amountRupiah: 7000 });
      assert.equal((await getSale(db, sale.saleId)).totalRupiah, before + 7000);
    } finally {
      sqlite.close();
    }
  });
}

test('Titipan Biaya rollback seluruh batch jika kenaikan invoice gagal', async () => {
  const { db, sqlite } = freshDb();
  try {
    const { sale } = await seedSale(db, { status: 'DRAFT' });
    const before = (await getSale(db, sale.saleId)).totalRupiah;
    sqlite.exec(`
      CREATE TRIGGER force_cost_invoice_failure
      BEFORE UPDATE OF total_amount ON ikan_sales
      WHEN NEW.sale_id = '${sale.saleId}'
      BEGIN
        SELECT RAISE(ABORT, 'FORCED_COST_INVOICE_FAILURE');
      END;
    `);

    await assert.rejects(addOperationalReceivablePayable(db, {
      sourceType: 'COST_PAYABLE',
      sourceId: sale.saleId,
      amountRupiah: 7000,
      counterpartyName: 'Tukang Bongkar',
    }), /FORCED_COST_INVOICE_FAILURE/);
    assert.equal((await getSale(db, sale.saleId)).totalRupiah, before);
    assert.equal(sqlite.prepare(`
      SELECT COUNT(*) AS count FROM operational_receivables_payables
      WHERE source_type = 'COST_PAYABLE' AND source_id = ?
    `).get(sale.saleId).count, 0);
  } finally {
    sqlite.close();
  }
});

test('saldo negatif dipertahankan saat pembayaran melebihi nominal', async () => {
  const { db, sqlite } = freshDb();
  try {
    const { sale } = await seedSale(db);
    const item = await addOperationalReceivablePayable(db, {
      sourceType: 'SALE_RECEIVABLE', sourceId: sale.saleId, amountRupiah: 10000,
    });
    const paid = await addOperationalPayment(db, item.id, { amountRupiah: 12000 });
    assert.equal(paid.item.paidAmountRupiah, 12000);
    assert.equal(paid.item.balanceRupiah, -2000);
  } finally {
    sqlite.close();
  }
});

test('EMPLOYEE_DEPOSIT tersedia sejak schema awal dan bukti pending belum mengurangi saldo', async () => {
  const { db, sqlite } = freshDb();
  try {
    sqlite.prepare(`
      INSERT INTO operational_receivables_payables (
        id, store_id, entity_id, source_type, balance_type, source_id,
        counterparty_id, counterparty_name_snapshot, description,
        original_amount, transaction_date
      ) VALUES (
        'orp-employee', 'store_ikan01', 'ENT-GALEH', 'EMPLOYEE_DEPOSIT', 'RECEIVABLE',
        'drawer-session-001', 'employee-001', 'Siti', 'Sisa setoran laci',
        25000000000, '2026-09-06'
      )
    `).run();
    const item = await getOperationalReceivablePayable(db, 'orp-employee');

    await assert.rejects(
      addOperationalPayment(db, item.id, { amountRupiah: 10000 }),
      /EMPLOYEE_DEPOSIT_PAYMENT_PROOF_REQUIRED/
    );
    const pending = await addOperationalPayment(db, item.id, {
      amountRupiah: 10000,
      proofReference: 'transfer://proof-001',
      submittedBy: 'emp-ikan',
    });
    assert.equal(pending.payment.approvalStatus, 'pending_approval');
    assert.equal(pending.item.balanceRupiah, 25000);

    assert.throws(() => sqlite.prepare(`
      UPDATE operational_receivable_payable_payments
      SET approval_status = 'approved'
      WHERE id = ?
    `).run(pending.payment.id), /EMPLOYEE_DEPOSIT_PAYMENT_REQUIRES_APPROVAL/);

    sqlite.prepare(`
      UPDATE operational_receivable_payable_payments
      SET approval_status = 'approved', reviewed_by = 'finance-01', reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(pending.payment.id);
    const approved = await getOperationalReceivablePayable(db, item.id);
    assert.equal(approved.balanceRupiah, 15000);
  } finally {
    sqlite.close();
  }
});
