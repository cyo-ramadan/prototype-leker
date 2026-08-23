import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createContact, listContacts, updateContact, deleteContact } from '../src/ikan-master-contacts.js';
import { createProduct, listProducts, updateProduct, deleteProduct } from '../src/ikan-master-products.js';

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

test('createContact wajib punya minimal satu peran', async () => {
  const db = freshDb();
  await assert.rejects(
    createContact(db, { contactName: 'Tanpa Peran', isCustomer: false, isPetani: false, isKurir: false }),
    RangeError
  );
});

test('createContact + listContacts: kontak baru muncul dan filter role jalan', async () => {
  const db = freshDb();
  await createContact(db, { contactName: 'Budi Petani', isPetani: true });
  await createContact(db, { contactName: 'Sri Customer', isCustomer: true });

  const petaniOnly = await listContacts(db, { role: 'petani' });
  assert.equal(petaniOnly.length, 1);
  assert.equal(petaniOnly[0].contactName, 'Budi Petani');

  const all = await listContacts(db, {});
  assert.equal(all.length, 2);
});

test('deleteContact: kontak yang belum dipakai transaksi beneran dihapus', async () => {
  const db = freshDb();
  const created = await createContact(db, { contactName: 'Belum Dipakai', isCustomer: true });
  const result = await deleteContact(db, created.contactId);
  assert.equal(result.deleted, true);
  assert.equal((await listContacts(db, {})).length, 0);
});

test('deleteContact: kontak yang sudah direferensikan sales dinonaktifkan, bukan dihapus', async () => {
  const db = freshDb();
  const created = await createContact(db, { contactName: 'Sudah Order', isCustomer: true });
  await db
    .prepare(
      `INSERT INTO ikan_sales (sale_id, store_id, sale_number, contact_id, customer_name_snapshot, transaction_date, merchandise_amount, total_amount)
       VALUES ('S1', 'store_ikan01', 'INV-1', ?, 'Sudah Order', '2026-08-20', 0, 0)`
    )
    .bind(created.contactId)
    .run();

  const result = await deleteContact(db, created.contactId);
  assert.equal(result.deleted, false);
  assert.equal(result.deactivated, true);

  const stillThere = await listContacts(db, { activeOnly: false });
  assert.equal(stillThere.length, 1);
  assert.equal(stillThere[0].isActive, false);
});

test('updateContact: patch sparse, field yang tidak dikirim tetap nilai lama', async () => {
  const db = freshDb();
  const created = await createContact(db, { contactName: 'Nama Awal', whatsappNumber: '628123', isCustomer: true });
  const updated = await updateContact(db, created.contactId, { whatsappNumber: '628999' });
  assert.equal(updated.contactName, 'Nama Awal');
  assert.equal(updated.whatsappNumber, '628999');
  assert.equal(updated.isCustomer, true);
});

test('createProduct: harga disimpan berskala tapi dibaca balik sebagai rupiah utuh', async () => {
  const db = freshDb();
  const created = await createProduct(db, {
    productName: 'Ikan Kembung',
    unitLabel: 'kg',
    salePriceRupiah: 35000,
    purchasePriceRupiah: 22000,
  });
  assert.equal(created.salePriceRupiah, 35000);
  assert.equal(created.purchasePriceRupiah, 22000);

  const raw = await db.prepare('SELECT sale_price_amount, purchase_price_amount FROM ikan_products WHERE product_id = ?')
    .bind(created.productId)
    .first();
  assert.equal(raw.sale_price_amount, 35000 * 1_000_000);
  assert.equal(raw.purchase_price_amount, 22000 * 1_000_000);
});

test('createProduct menolak harga negatif atau bukan bilangan bulat', async () => {
  const db = freshDb();
  await assert.rejects(
    createProduct(db, { productName: 'X', salePriceRupiah: -1, purchasePriceRupiah: 0 }),
    RangeError
  );
  await assert.rejects(
    createProduct(db, { productName: 'X', salePriceRupiah: 1000.5, purchasePriceRupiah: 0 }),
    RangeError
  );
});

test('deleteProduct: barang yang sudah dipakai sale_items dinonaktifkan bukan dihapus', async () => {
  const db = freshDb();
  const product = await createProduct(db, { productName: 'Ikan Tongkol', salePriceRupiah: 40000, purchasePriceRupiah: 25000 });
  const contact = await createContact(db, { contactName: 'Cust', isCustomer: true });
  await db
    .prepare(
      `INSERT INTO ikan_sales (sale_id, store_id, sale_number, contact_id, customer_name_snapshot, transaction_date, merchandise_amount, total_amount)
       VALUES ('S1', 'store_ikan01', 'INV-1', ?, 'Cust', '2026-08-20', 0, 0)`
    )
    .bind(contact.contactId)
    .run();
  await db
    .prepare(
      `INSERT INTO ikan_sale_items (sale_item_id, sale_id, product_id, product_name_snapshot, quantity, sale_price_at_time, purchase_price_at_time, line_amount)
       VALUES ('SI1', 'S1', ?, 'Ikan Tongkol', 1, 40000000000, 25000000000, 40000000000)`
    )
    .bind(product.productId)
    .run();

  const result = await deleteProduct(db, product.productId);
  assert.equal(result.deleted, false);
  assert.equal(result.deactivated, true);
  assert.equal((await listProducts(db, { activeOnly: true })).length, 0);
});

test('updateProduct: patch sebagian harga saja', async () => {
  const db = freshDb();
  const created = await createProduct(db, { productName: 'Ikan Bandeng', salePriceRupiah: 30000, purchasePriceRupiah: 18000 });
  const updated = await updateProduct(db, created.productId, { salePriceRupiah: 32000 });
  assert.equal(updated.salePriceRupiah, 32000);
  assert.equal(updated.purchasePriceRupiah, 18000);
});
