import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createContact } from '../src/ikan-master-contacts.js';
import { createProduct } from '../src/ikan-master-products.js';
import { createSale, paySale } from '../src/ikan-penjualan.js';
import { payPurchase, listPurchases } from '../src/ikan-pembelian-dropship.js';
import { addCostPayable, settleCostPayable } from '../src/ikan-titipan-biaya.js';
import { getCashPosition, getPiutangUtangSummary, getProfitLossReport } from '../src/ikan-laporan.js';

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

async function seed(db) {
  const customer = await createContact(db, { contactName: 'Rudi', isCustomer: true });
  const petani = await createContact(db, { contactName: 'Pak Tani', isPetani: true });
  const product = await createProduct(db, { productName: 'Ikan Kembung', salePriceRupiah: 35000, purchasePriceRupiah: 22000 });
  return { customer, petani, product };
}

test('getProfitLossReport: omzet, hpp, dan profit dihitung benar untuk satu sale', async () => {
  const db = freshDb();
  const { customer, petani, product } = await seed(db);
  await createSale(db, {
    contactId: customer.contactId,
    transactionDate: '2026-08-20',
    status: 'INVOICE',
    petaniContactId: petani.contactId,
    discountRupiah: 2000,
    items: [{ productId: product.productId, quantity: 2 }],
  });

  const report = await getProfitLossReport(db, { period: 'daily', startDate: '2026-08-01', endDate: '2026-08-31' });
  assert.equal(report.buckets.length, 1);
  const bucket = report.buckets[0];
  assert.equal(bucket.period, '2026-08-20');
  assert.equal(bucket.omzetRupiah, 70000);
  assert.equal(bucket.discountRupiah, 2000);
  assert.equal(bucket.netSalesRupiah, 68000);
  assert.equal(bucket.hppRupiah, 44000);
  assert.equal(bucket.grossProfitRupiah, 24000);
});

test('getProfitLossReport: draft (belum invoice) tidak ikut dihitung', async () => {
  const db = freshDb();
  const { customer, product } = await seed(db);
  await createSale(db, {
    contactId: customer.contactId,
    transactionDate: '2026-08-20',
    items: [{ productId: product.productId, quantity: 1 }],
  });
  const report = await getProfitLossReport(db, { period: 'daily' });
  assert.equal(report.buckets.length, 0);
});

test('getProfitLossReport: bucket bulanan menggabungkan beberapa tanggal', async () => {
  const db = freshDb();
  const { customer, petani, product } = await seed(db);
  for (const date of ['2026-08-01', '2026-08-15', '2026-09-01']) {
    await createSale(db, {
      contactId: customer.contactId,
      transactionDate: date,
      status: 'INVOICE',
      petaniContactId: petani.contactId,
      items: [{ productId: product.productId, quantity: 1 }],
    });
  }
  const report = await getProfitLossReport(db, { period: 'monthly' });
  assert.equal(report.buckets.length, 2);
  const august = report.buckets.find((b) => b.period === '2026-08');
  assert.equal(august.omzetRupiah, 70000);
});

test('getCashPosition + getPiutangUtangSummary: kas turun waktu bayar petani, piutang berkurang waktu customer bayar', async () => {
  const db = freshDb();
  const { customer, petani, product } = await seed(db);
  const sale = await createSale(db, {
    contactId: customer.contactId,
    transactionDate: '2026-08-20',
    status: 'INVOICE',
    petaniContactId: petani.contactId,
    items: [{ productId: product.productId, quantity: 1 }],
  });

  let summary = await getPiutangUtangSummary(db);
  assert.equal(summary.piutangRupiah, 35000);
  assert.equal(summary.utangPetaniRupiah, 22000);
  assert.equal(summary.cashRupiah, 0);

  await paySale(db, sale.saleId, 35000);
  const purchases = await listPurchases(db);
  await payPurchase(db, purchases[0].purchaseId, 22000);

  summary = await getPiutangUtangSummary(db);
  assert.equal(summary.piutangRupiah, 0);
  assert.equal(summary.utangPetaniRupiah, 0);
  assert.equal(summary.cashRupiah, 13000);
  assert.equal(await getCashPosition(db), 13000);
});

test('getPiutangUtangSummary ikut hitung utang Titipan Biaya yang belum settle', async () => {
  const db = freshDb();
  const { customer, petani, product } = await seed(db);
  const sale = await createSale(db, {
    contactId: customer.contactId,
    transactionDate: '2026-08-20',
    status: 'INVOICE',
    petaniContactId: petani.contactId,
    items: [{ productId: product.productId, quantity: 1 }],
  });
  const cp = await addCostPayable(db, { saleId: sale.saleId, costName: 'Ongkir', amountRupiah: 15000, payeeName: 'JNE' });
  await settleCostPayable(db, cp.costPayableId, 5000);

  const summary = await getPiutangUtangSummary(db);
  assert.equal(summary.utangTitipanBiayaRupiah, 10000);
  assert.equal(summary.totalUtangRupiah, summary.utangPetaniRupiah + 10000);
});
