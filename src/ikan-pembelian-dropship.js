import { newId, newDocumentNumber } from './ikan-ids.js';
import { computeLineAmount, scaledToQty } from './ikan-quantity.js';
import { rupiahToScaled, scaledToRupiah } from './ikan-money.js';
import { IKAN_STORE_ID } from './ikan-config.js';

// Dipanggil dari ikan-penjualan.js begitu satu sale jadi INVOICE dan is_dropship=1.
// items di sini adalah baris sale_items yang SUDAH tersimpan -- purchase_price_at_time
// sudah terkunci di sana, jadi tidak query ulang ke products.
export function buildDropshipPurchaseStatements(db, { sale, items, petaniContactId }) {
  const purchaseId = newId('PO');
  const purchaseNumber = newDocumentNumber('PO', new Date(sale.transaction_date));

  const purchaseItemRows = items.map((item) => ({
    purchaseItemId: newId('POI'),
    productId: item.product_id,
    productNameSnapshot: item.product_name_snapshot,
    quantity: item.quantity,
    purchasePriceAtTime: item.purchase_price_at_time,
    lineAmount: computeLineAmount(item.quantity, item.purchase_price_at_time),
  }));
  const totalAmount = purchaseItemRows.reduce((sum, row) => sum + row.lineAmount, 0);

  const statements = [
    db
      .prepare(
        `INSERT INTO ikan_purchases (purchase_id, store_id, purchase_number, sale_id, source, petani_contact_id, transaction_date, total_amount)
         VALUES (?, ?, ?, ?, 'DROPSHIP', ?, ?, ?)`
      )
      .bind(purchaseId, IKAN_STORE_ID, purchaseNumber, sale.sale_id, petaniContactId, sale.transaction_date, totalAmount),
    ...purchaseItemRows.map((row) =>
      db
        .prepare(
          `INSERT INTO ikan_purchase_items (purchase_item_id, purchase_id, product_id, product_name_snapshot, quantity, purchase_price_at_time, line_amount)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(row.purchaseItemId, purchaseId, row.productId, row.productNameSnapshot, row.quantity, row.purchasePriceAtTime, row.lineAmount)
    ),
  ];

  return { purchaseId, purchaseNumber, totalAmount, statements };
}

function mapPurchaseRow(row) {
  return {
    purchaseId: row.purchase_id,
    purchaseNumber: row.purchase_number,
    saleId: row.sale_id,
    source: row.source,
    petaniContactId: row.petani_contact_id,
    transactionDate: row.transaction_date,
    totalRupiah: scaledToRupiah(row.total_amount),
    paidRupiah: scaledToRupiah(row.paid_amount),
    dueRupiah: scaledToRupiah(row.total_amount - row.paid_amount),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPurchaseItemRow(row) {
  return {
    purchaseItemId: row.purchase_item_id,
    productId: row.product_id,
    productNameSnapshot: row.product_name_snapshot,
    quantity: scaledToQty(row.quantity),
    purchasePriceRupiah: scaledToRupiah(row.purchase_price_at_time),
    lineAmountRupiah: scaledToRupiah(row.line_amount),
  };
}

export async function getPurchase(db, purchaseId) {
  const purchase = await db.prepare('SELECT * FROM ikan_purchases WHERE purchase_id = ? AND store_id = ?').bind(purchaseId, IKAN_STORE_ID).first();
  if (!purchase) return null;
  const items = await db
    .prepare('SELECT * FROM ikan_purchase_items WHERE purchase_id = ? ORDER BY rowid ASC')
    .bind(purchaseId)
    .all();
  return { ...mapPurchaseRow(purchase), items: (items.results ?? []).map(mapPurchaseItemRow) };
}

export async function listPurchases(db) {
  const result = await db.prepare('SELECT * FROM ikan_purchases WHERE store_id = ? ORDER BY transaction_date DESC, created_at DESC').bind(IKAN_STORE_ID).all();
  return (result.results ?? []).map(mapPurchaseRow);
}

// Endpoint bayar pembelian ke petani -- purchase_payments + cash_ledger OUT atomik.
export async function payPurchase(db, purchaseId, amountRupiah) {
  const purchase = await db.prepare('SELECT * FROM ikan_purchases WHERE purchase_id = ? AND store_id = ?').bind(purchaseId, IKAN_STORE_ID).first();
  if (!purchase) throw new RangeError('PURCHASE_NOT_FOUND');
  const amountScaled = rupiahToScaled(amountRupiah);
  const due = purchase.total_amount - purchase.paid_amount;
  if (amountScaled <= 0) throw new RangeError('AMOUNT_MUST_BE_POSITIVE');
  if (amountScaled > due) throw new RangeError('AMOUNT_EXCEEDS_DUE');

  const paymentId = newId('POP');
  const ledgerId = newId('CL');
  await db.batch([
    db.prepare('INSERT INTO ikan_purchase_payments (purchase_payment_id, purchase_id, amount) VALUES (?, ?, ?)').bind(paymentId, purchaseId, amountScaled),
    db.prepare(
      `INSERT INTO ikan_cash_ledger (cash_ledger_id, store_id, direction, amount, source_type, source_id) VALUES (?, ?, 'OUT', ?, 'PURCHASE_PAYMENT', ?)`
    ).bind(ledgerId, IKAN_STORE_ID, amountScaled, paymentId),
    db.prepare('UPDATE ikan_purchases SET paid_amount = paid_amount + ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE purchase_id = ?').bind(amountScaled, purchaseId),
  ]);
  return getPurchase(db, purchaseId);
}

export async function handlePurchasesApi(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ['api','ikan','purchases', id?, action?]
  const purchaseId = parts[3];
  const action = parts[4];

  try {
    if (request.method === 'GET' && !purchaseId) {
      return Response.json(await listPurchases(env.DB));
    }
    if (request.method === 'GET' && purchaseId) {
      const purchase = await getPurchase(env.DB, purchaseId);
      if (!purchase) return Response.json({ error: 'PURCHASE_NOT_FOUND' }, { status: 404 });
      return Response.json(purchase);
    }
    if (request.method === 'POST' && purchaseId && action === 'payments') {
      const body = await request.json();
      const updated = await payPurchase(env.DB, purchaseId, body.amountRupiah);
      return Response.json(updated);
    }
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  } catch (err) {
    if (err instanceof RangeError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
