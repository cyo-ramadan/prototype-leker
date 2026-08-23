import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createContact } from '../src/ikan-master-contacts.js';
import { createProduct } from '../src/ikan-master-products.js';
import { createSale, getSale } from '../src/ikan-penjualan.js';
import { addCostPayable, settleCostPayable, listCostPayables, recapByPayee } from '../src/ikan-titipan-biaya.js';

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

async function seedSale(db, { status = 'INVOICE' } = {}) {
  const customer = await createContact(db, { contactName: 'Rudi', isCustomer: true });
  const petani = await createContact(db, { contactName: 'Pak Tani', isPetani: true });
  const kurir = await createContact(db, { contactName: 'JNE', isKurir: true });
  const product = await createProduct(db, { productName: 'Ikan Kembung', salePriceRupiah: 35000, purchasePriceRupiah: 22000 });
  const sale = await createSale(db, {
    contactId: customer.contactId,
    transactionDate: '2026-08-20',
    status,
    ...(status === 'INVOICE' ? { petaniContactId: petani.contactId } : {}),
    items: [{ productId: product.productId, quantity: 1 }],
  });
  return { sale, kurir };
}

test('addCostPayable: butuh sale yang beneran ada', async () => {
  const db = freshDb();
  await assert.rejects(
    addCostPayable(db, { saleId: 'S-TIDAK-ADA', costName: 'Ongkir', amountRupiah: 15000, payeeName: 'JNE' }),
    RangeError
  );
});

for (const status of ['DRAFT', 'INVOICE']) {
  test(`addCostPayable: ${status} menaikkan total invoice persis sebesar titipan biaya`, async () => {
    const db = freshDb();
    const { sale, kurir } = await seedSale(db, { status });

    await addCostPayable(db, {
      saleId: sale.saleId,
      costName: 'Ongkir JNE',
      amountRupiah: 15000,
      payeeContactId: kurir.contactId,
      payeeName: 'JNE',
    });

    const updatedSale = await getSale(db, sale.saleId);
    assert.equal(updatedSale.totalRupiah, sale.totalRupiah + 15000);
    assert.equal(updatedSale.dueRupiah, sale.dueRupiah + 15000);
  });
}

test('addCostPayable + settle: due vendor berkurang tanpa mengubah total invoice customer', async () => {
  const db = freshDb();
  const { sale, kurir } = await seedSale(db);

  const cp = await addCostPayable(db, { saleId: sale.saleId, costName: 'Ongkir JNE', amountRupiah: 15000, payeeContactId: kurir.contactId, payeeName: 'JNE' });
  assert.equal(cp.dueRupiah, 15000);
  const totalAfterAdd = (await getSale(db, sale.saleId)).totalRupiah;
  assert.equal(totalAfterAdd, sale.totalRupiah + 15000);

  const partial = await settleCostPayable(db, cp.costPayableId, 5000);
  assert.equal(partial.paidRupiah, 5000);
  assert.equal(partial.dueRupiah, 10000);
  assert.equal((await getSale(db, sale.saleId)).totalRupiah, totalAfterAdd);

  const lunas = await settleCostPayable(db, cp.costPayableId, 10000);
  assert.equal(lunas.dueRupiah, 0);
  assert.equal((await getSale(db, sale.saleId)).totalRupiah, totalAfterAdd);
});

test('settleCostPayable menolak overpay', async () => {
  const db = freshDb();
  const { sale, kurir } = await seedSale(db);
  const cp = await addCostPayable(db, { saleId: sale.saleId, costName: 'Ongkir', amountRupiah: 15000, payeeContactId: kurir.contactId, payeeName: 'JNE' });
  await assert.rejects(settleCostPayable(db, cp.costPayableId, 20000), RangeError);
});

test('listCostPayables dueOnly cuma nunjukkin yang belum lunas', async () => {
  const db = freshDb();
  const { sale, kurir } = await seedSale(db);
  const cp1 = await addCostPayable(db, { saleId: sale.saleId, costName: 'Ongkir', amountRupiah: 15000, payeeContactId: kurir.contactId, payeeName: 'JNE' });
  await addCostPayable(db, { saleId: sale.saleId, costName: 'Bongkar', amountRupiah: 5000, payeeName: 'Tukang Bongkar' });
  await settleCostPayable(db, cp1.costPayableId, 15000);

  const due = await listCostPayables(db, { dueOnly: true });
  assert.equal(due.length, 1);
  assert.equal(due[0].costName, 'Bongkar');
});

test('recapByPayee: gabung per pihak ketiga', async () => {
  const db = freshDb();
  const { sale, kurir } = await seedSale(db);
  await addCostPayable(db, { saleId: sale.saleId, costName: 'Ongkir 1', amountRupiah: 10000, payeeContactId: kurir.contactId, payeeName: 'JNE' });
  await addCostPayable(db, { saleId: sale.saleId, costName: 'Ongkir 2', amountRupiah: 8000, payeeContactId: kurir.contactId, payeeName: 'JNE' });

  const recap = await recapByPayee(db);
  assert.equal(recap.length, 1);
  assert.equal(recap[0].totalRupiah, 18000);
  assert.equal(recap[0].items.length, 2);
});
