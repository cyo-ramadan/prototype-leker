import { newId, newDocumentNumber } from './ikan-ids.js';
import { rupiahToScaled, scaledToRupiah } from './ikan-money.js';
import { qtyToScaled, scaledToQty, computeLineAmount } from './ikan-quantity.js';
import { getContact } from './ikan-master-contacts.js';
import { getProduct } from './ikan-master-products.js';
import { buildDropshipPurchaseStatements } from './ikan-pembelian-dropship.js';
import { IKAN_STORE_ID } from './ikan-config.js';

function mapSaleRow(row) {
  return {
    saleId: row.sale_id,
    saleNumber: row.sale_number,
    contactId: row.contact_id,
    customerNameSnapshot: row.customer_name_snapshot,
    transactionDate: row.transaction_date,
    saleStatus: row.sale_status,
    isDropship: Boolean(row.is_dropship),
    merchandiseRupiah: scaledToRupiah(row.merchandise_amount),
    discountRupiah: scaledToRupiah(row.discount_amount),
    totalRupiah: scaledToRupiah(row.total_amount),
    paidRupiah: scaledToRupiah(row.paid_amount),
    dueRupiah: scaledToRupiah(row.total_amount - row.paid_amount),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSaleItemRow(row) {
  return {
    saleItemId: row.sale_item_id,
    productId: row.product_id,
    productNameSnapshot: row.product_name_snapshot,
    quantity: scaledToQty(row.quantity),
    salePriceRupiah: scaledToRupiah(row.sale_price_at_time),
    purchasePriceRupiah: scaledToRupiah(row.purchase_price_at_time),
    purchasePriceSource: row.purchase_price_source,
    lineAmountRupiah: scaledToRupiah(row.line_amount),
  };
}

export async function getSale(db, saleId) {
  const row = await db.prepare('SELECT * FROM ikan_sales WHERE sale_id = ? AND store_id = ?').bind(saleId, IKAN_STORE_ID).first();
  if (!row) return null;
  const items = await db.prepare('SELECT * FROM ikan_sale_items WHERE sale_id = ? ORDER BY rowid ASC').bind(saleId).all();
  return { ...mapSaleRow(row), items: (items.results ?? []).map(mapSaleItemRow) };
}

export async function listSales(db, { status } = {}) {
  const conditions = ['store_id = ?'];
  const args = [IKAN_STORE_ID];
  if (status) {
    conditions.push('sale_status = ?');
    args.push(status);
  }
  const result = await db.prepare(`SELECT * FROM ikan_sales WHERE ${conditions.join(' AND ')} ORDER BY transaction_date DESC, created_at DESC`).bind(...args).all();
  return (result.results ?? []).map(mapSaleRow);
}

function validateSaleInput(input) {
  if (!input.contactId) throw new RangeError('contactId wajib diisi');
  if (!input.transactionDate) throw new RangeError('transactionDate wajib diisi');
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new RangeError('Invoice tidak boleh kosong -- minimal satu barang');
  }
  if (input.status && !['DRAFT', 'INVOICE'].includes(input.status)) {
    throw new RangeError('status harus DRAFT atau INVOICE');
  }
}

// Ini fungsi utama Penjualan: kunci harga jual & harga beli tiap barang saat itu
// juga (purchase_price_source='MASTER_PRODUCT' -- lihat CLAUDE.md invariant #3),
// lalu kalau statusnya INVOICE dan mode dropship nyala, otomatis siapkan Pembelian
// ke petani dalam TRANSAKSI YANG SAMA (db.batch) -- tidak ada momen di mana sale
// sudah invoice tapi purchase-nya belum ada.
export async function createSale(db, input) {
  validateSaleInput(input);

  const contact = await getContact(db, input.contactId);
  if (!contact) throw new RangeError('CONTACT_NOT_FOUND');
  if (!contact.isCustomer) throw new RangeError('CONTACT_IS_NOT_CUSTOMER');

  const isDropship = input.isDropship ?? true;
  const status = input.status ?? 'DRAFT';
  if (status === 'INVOICE' && isDropship && !input.petaniContactId) {
    throw new RangeError('petaniContactId wajib diisi untuk invoice dropship');
  }
  let petaniContact = null;
  if (input.petaniContactId) {
    petaniContact = await getContact(db, input.petaniContactId);
    if (!petaniContact || !petaniContact.isPetani) throw new RangeError('PETANI_CONTACT_INVALID');
  }

  const lockedItems = [];
  for (const raw of input.items) {
    const product = await getProduct(db, raw.productId);
    if (!product || !product.isActive) throw new RangeError(`PRODUCT_NOT_FOUND:${raw.productId}`);
    const qtyScaled = qtyToScaled(Number(raw.quantity));
    const salePriceScaled = raw.salePriceRupiah !== undefined
      ? rupiahToScaled(raw.salePriceRupiah)
      : rupiahToScaled(product.salePriceRupiah);
    const purchasePriceScaled = rupiahToScaled(product.purchasePriceRupiah); // selalu MASTER_PRODUCT hari ini
    lockedItems.push({
      saleItemId: newId('SI'),
      productId: product.productId,
      productNameSnapshot: product.productName,
      quantityScaled: qtyScaled,
      salePriceScaled,
      purchasePriceScaled,
      lineAmount: computeLineAmount(qtyScaled, salePriceScaled),
    });
  }

  const merchandiseAmount = lockedItems.reduce((sum, it) => sum + it.lineAmount, 0);
  const discountAmount = rupiahToScaled(input.discountRupiah ?? 0);
  if (discountAmount > merchandiseAmount) throw new RangeError('DISCOUNT_EXCEEDS_MERCHANDISE');
  const totalAmount = merchandiseAmount - discountAmount;

  const saleId = newId('S');
  const saleNumber = newDocumentNumber('INV', new Date(input.transactionDate));

  const statements = [
    db
      .prepare(
        `INSERT INTO ikan_sales (sale_id, store_id, sale_number, contact_id, customer_name_snapshot, transaction_date, sale_status,
           is_dropship, merchandise_amount, discount_amount, total_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(saleId, IKAN_STORE_ID, saleNumber, contact.contactId, contact.contactName, input.transactionDate, status, isDropship ? 1 : 0, merchandiseAmount, discountAmount, totalAmount),
    ...lockedItems.map((it) =>
      db
        .prepare(
          `INSERT INTO ikan_sale_items (sale_item_id, sale_id, product_id, product_name_snapshot, quantity, sale_price_at_time, purchase_price_at_time, purchase_price_source, line_amount)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'MASTER_PRODUCT', ?)`
        )
        .bind(it.saleItemId, saleId, it.productId, it.productNameSnapshot, it.quantityScaled, it.salePriceScaled, it.purchasePriceScaled, it.lineAmount)
    ),
  ];

  if (status === 'INVOICE' && isDropship) {
    const saleRowForPurchase = { sale_id: saleId, transaction_date: input.transactionDate };
    const itemsForPurchase = lockedItems.map((it) => ({
      product_id: it.productId,
      product_name_snapshot: it.productNameSnapshot,
      quantity: it.quantityScaled,
      purchase_price_at_time: it.purchasePriceScaled,
    }));
    const { statements: purchaseStatements } = buildDropshipPurchaseStatements(db, {
      sale: saleRowForPurchase,
      items: itemsForPurchase,
      petaniContactId: petaniContact.contactId,
    });
    statements.push(...purchaseStatements);
  }

  await db.batch(statements);
  return getSale(db, saleId);
}

// Draft -> Invoice belakangan (bukan langsung invoice). Kalau dropship, ini titik
// yang sama-sama memicu pembuatan Pembelian, persis seperti langsung invoice di atas.
export async function markSaleAsInvoice(db, saleId, { petaniContactId } = {}) {
  const sale = await getSale(db, saleId);
  if (!sale) throw new RangeError('SALE_NOT_FOUND');
  if (sale.saleStatus !== 'DRAFT') throw new RangeError('SALE_NOT_DRAFT');

  let petaniContact = null;
  if (sale.isDropship) {
    if (!petaniContactId) throw new RangeError('petaniContactId wajib diisi untuk invoice dropship');
    petaniContact = await getContact(db, petaniContactId);
    if (!petaniContact || !petaniContact.isPetani) throw new RangeError('PETANI_CONTACT_INVALID');
  }

  const statements = [
    db.prepare(`UPDATE ikan_sales SET sale_status = 'INVOICE', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE sale_id = ?`).bind(saleId),
  ];
  if (sale.isDropship) {
    const rawItems = await db.prepare('SELECT * FROM ikan_sale_items WHERE sale_id = ?').bind(saleId).all();
    const { statements: purchaseStatements } = buildDropshipPurchaseStatements(db, {
      sale: { sale_id: saleId, transaction_date: sale.transactionDate },
      items: rawItems.results ?? [],
      petaniContactId: petaniContact.contactId,
    });
    statements.push(...purchaseStatements);
  }
  await db.batch(statements);
  return getSale(db, saleId);
}

// Bayar invoice penjualan -- sale_payments + cash_ledger IN atomik. Overpay ditolak
// (bukan dipotong diam-diam) supaya kasir sadar salah input, bukan uangnya hilang
// tanpa jejak.
export async function paySale(db, saleId, amountRupiah) {
  const sale = await db.prepare('SELECT * FROM ikan_sales WHERE sale_id = ? AND store_id = ?').bind(saleId, IKAN_STORE_ID).first();
  if (!sale) throw new RangeError('SALE_NOT_FOUND');
  const amountScaled = rupiahToScaled(amountRupiah);
  const due = sale.total_amount - sale.paid_amount;
  if (amountScaled <= 0) throw new RangeError('AMOUNT_MUST_BE_POSITIVE');
  if (amountScaled > due) throw new RangeError('AMOUNT_EXCEEDS_DUE');

  const paymentId = newId('SP');
  const ledgerId = newId('CL');
  await db.batch([
    db.prepare('INSERT INTO ikan_sale_payments (sale_payment_id, sale_id, amount) VALUES (?, ?, ?)').bind(paymentId, saleId, amountScaled),
    db.prepare(`INSERT INTO ikan_cash_ledger (cash_ledger_id, store_id, direction, amount, source_type, source_id) VALUES (?, ?, 'IN', ?, 'SALE_PAYMENT', ?)`).bind(ledgerId, IKAN_STORE_ID, amountScaled, paymentId),
    db.prepare(`UPDATE ikan_sales SET paid_amount = paid_amount + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE sale_id = ?`).bind(amountScaled, saleId),
  ]);
  return getSale(db, saleId);
}

export async function handleSalesApi(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ['api','ikan','sales', id?, action?]
  const saleId = parts[3];
  const action = parts[4];

  try {
    if (request.method === 'GET' && !saleId) {
      const status = url.searchParams.get('status') ?? undefined;
      return Response.json(await listSales(env.DB, { status }));
    }
    if (request.method === 'GET' && saleId) {
      const sale = await getSale(env.DB, saleId);
      if (!sale) return Response.json({ error: 'SALE_NOT_FOUND' }, { status: 404 });
      return Response.json(sale);
    }
    if (request.method === 'POST' && !saleId) {
      const body = await request.json();
      const created = await createSale(env.DB, body);
      return Response.json(created, { status: 201 });
    }
    if (request.method === 'POST' && saleId && action === 'invoice') {
      const body = await request.json().catch(() => ({}));
      const updated = await markSaleAsInvoice(env.DB, saleId, body);
      return Response.json(updated);
    }
    if (request.method === 'POST' && saleId && action === 'payments') {
      const body = await request.json();
      const updated = await paySale(env.DB, saleId, body.amountRupiah);
      return Response.json(updated);
    }
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  } catch (err) {
    if (err instanceof RangeError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
