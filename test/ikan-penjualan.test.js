import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createContact } from '../src/ikan-master-contacts.js';
import { createProduct } from '../src/ikan-master-products.js';
import { createSale, markSaleAsInvoice, paySale, getSale } from '../src/ikan-penjualan.js';
import { getPurchase, listPurchases, payPurchase } from '../src/ikan-pembelian-dropship.js';

const migrationDir = new URL('../migrations/', import.meta.url);

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
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return new D1Database(sqlite);
}

async function seedBasics(db) {
  const customer = await createContact(db, { contactName: 'Rudi', isCustomer: true });
  const petani = await createContact(db, { contactName: 'Pak Tani', isPetani: true });
  const product = await createProduct(db, { productName: 'Ikan Kembung', unitLabel: 'kg', salePriceRupiah: 35000, purchasePriceRupiah: 22000 });
  return { customer, petani, product };
}

test('createSale menolak kontak yang bukan customer -- petani tidak boleh nyasar jadi pembeli', async () => {
  const db = freshDb();
  const { petani, product } = await seedBasics(db);
  await assert.rejects(
    createSale(db, {
      contactId: petani.contactId,
      transactionDate: '2026-08-20',
      items: [{ productId: product.productId, quantity: 1 }],
    }),
    RangeError
  );
});

test('createSale draft: harga dikunci dari master, belum ada Pembelian', async () => {
  const db = freshDb();
  const { customer, product } = await seedBasics(db);

  const sale = await createSale(db, {
    contactId: customer.contactId,
    transactionDate: '2026-08-20',
    items: [{ productId: product.productId, quantity: 1.5 }],
  });

  assert.equal(sale.saleStatus, 'DRAFT');
  assert.equal(sale.items[0].quantity, 1.5);
  assert.equal(sale.items[0].salePriceRupiah, 35000);
  assert.equal(sale.items[0].lineAmountRupiah, 52500);
  assert.equal(sale.merchandiseRupiah, 52500);
  assert.equal((await listPurchases(db)).length, 0);
});

test('createSale invoice + dropship: otomatis bikin Pembelian di transaksi yang sama', async () => {
  const db = freshDb();
  const { customer, petani, product } = await seedBasics(db);

  const sale = await createSale(db, {
    contactId: customer.contactId,
    transactionDate: '2026-08-20',
    status: 'INVOICE',
    petaniContactId: petani.contactId,
    items: [{ productId: product.productId, quantity: 2 }],
  });

  assert.equal(sale.saleStatus, 'INVOICE');
  const purchases = await listPurchases(db);
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].saleId, sale.saleId);
  assert.equal(purchases[0].petaniContactId, petani.contactId);
  assert.equal(purchases[0].totalRupiah, 44000);

  const purchaseDetail = await getPurchase(db, purchases[0].purchaseId);
  assert.equal(purchaseDetail.items.length, 1);
  assert.equal(purchaseDetail.items[0].quantity, 2);
});

test('createSale invoice dropship tanpa petaniContactId ditolak', async () => {
  const db = freshDb();
  const { customer, product } = await seedBasics(db);
  await assert.rejects(
    createSale(db, {
      contactId: customer.contactId,
      transactionDate: '2026-08-20',
      status: 'INVOICE',
      items: [{ productId: product.productId, quantity: 1 }],
    }),
    RangeError
  );
});

test('markSaleAsInvoice: draft dropship yang di-invoice belakangan tetap bikin Pembelian', async () => {
  const db = freshDb();
  const { customer, petani, product } = await seedBasics(db);
  const draft = await createSale(db, {
    contactId: customer.contactId,
    transactionDate: '2026-08-20',
    items: [{ productId: product.productId, quantity: 1 }],
  });
  assert.equal((await listPurchases(db)).length, 0);

  const invoiced = await markSaleAsInvoice(db, draft.saleId, { petaniContactId: petani.contactId });
  assert.equal(invoiced.saleStatus, 'INVOICE');
  assert.equal((await listPurchases(db)).length, 1);
});

test('paySale: pembayaran menambah paid_amount dan nulis cash_ledger IN', async () => {
  const db = freshDb();
  const { customer, petani, product } = await seedBasics(db);
  const sale = await createSale(db, {
    contactId: customer.contactId,
    transactionDate: '2026-08-20',
    status: 'INVOICE',
    petaniContactId: petani.contactId,
    items: [{ productId: product.productId, quantity: 1 }],
  });

  const paid = await paySale(db, sale.saleId, 20000);
  assert.equal(paid.paidRupiah, 20000);
  assert.equal(paid.dueRupiah, 15000);

  const ledger = await db.prepare("SELECT * FROM ikan_cash_ledger WHERE source_type = 'SALE_PAYMENT'").all();
  assert.equal(ledger.results.length, 1);
  assert.equal(ledger.results[0].direction, 'IN');
  assert.equal(ledger.results[0].amount, 20000 * 1_000_000);
});

test('paySale menolak overpay', async () => {
  const db = freshDb();
  const { customer, petani, product } = await seedBasics(db);
  const sale = await createSale(db, {
    contactId: customer.contactId,
    transactionDate: '2026-08-20',
    status: 'INVOICE',
    petaniContactId: petani.contactId,
    items: [{ productId: product.productId, quantity: 1 }],
  });
  await assert.rejects(paySale(db, sale.saleId, 999999), RangeError);
});

test('payPurchase: bayar ke petani menambah paid_amount dan nulis cash_ledger OUT', async () => {
  const db = freshDb();
  const { customer, petani, product } = await seedBasics(db);
  const sale = await createSale(db, {
    contactId: customer.contactId,
    transactionDate: '2026-08-20',
    status: 'INVOICE',
    petaniContactId: petani.contactId,
    items: [{ productId: product.productId, quantity: 1 }],
  });
  const purchases = await listPurchases(db);
  const paid = await payPurchase(db, purchases[0].purchaseId, 22000);
  assert.equal(paid.paidRupiah, 22000);
  assert.equal(paid.dueRupiah, 0);

  const ledger = await db.prepare("SELECT * FROM ikan_cash_ledger WHERE source_type = 'PURCHASE_PAYMENT'").all();
  assert.equal(ledger.results.length, 1);
  assert.equal(ledger.results[0].direction, 'OUT');
});
