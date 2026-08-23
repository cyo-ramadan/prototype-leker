import { newId } from './ikan-ids.js';
import { rupiahToScaled, scaledToRupiah } from './ikan-money.js';
import { IKAN_STORE_ID } from './ikan-config.js';

function mapProductRow(row) {
  return {
    productId: row.product_id,
    productName: row.product_name,
    unitLabel: row.unit_label,
    salePriceRupiah: scaledToRupiah(row.sale_price_amount),
    purchasePriceRupiah: scaledToRupiah(row.purchase_price_amount),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listProducts(db, { activeOnly = true } = {}) {
  const conditions = ['store_id = ?'];
  const args = [IKAN_STORE_ID];
  if (activeOnly) conditions.push('is_active = 1');
  const result = await db
    .prepare(`SELECT * FROM ikan_products WHERE ${conditions.join(' AND ')} ORDER BY product_name ASC`)
    .bind(...args)
    .all();
  return (result.results ?? []).map(mapProductRow);
}

export async function getProduct(db, productId) {
  const row = await db.prepare('SELECT * FROM ikan_products WHERE product_id = ? AND store_id = ?').bind(productId, IKAN_STORE_ID).first();
  return row ? mapProductRow(row) : null;
}

function validateProductInput(input) {
  if (!input || typeof input.productName !== 'string' || input.productName.trim() === '') {
    throw new RangeError('productName wajib diisi');
  }
  if (!Number.isInteger(input.salePriceRupiah) || input.salePriceRupiah < 0) {
    throw new RangeError('salePriceRupiah harus bilangan bulat >= 0');
  }
  if (!Number.isInteger(input.purchasePriceRupiah) || input.purchasePriceRupiah < 0) {
    throw new RangeError('purchasePriceRupiah harus bilangan bulat >= 0');
  }
}

export async function createProduct(db, input) {
  validateProductInput(input);
  const productId = newId('PRD');
  await db
    .prepare(
      `INSERT INTO ikan_products (product_id, store_id, product_name, unit_label, sale_price_amount, purchase_price_amount)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      productId,
      IKAN_STORE_ID,
      input.productName.trim(),
      input.unitLabel?.trim() || 'kg',
      rupiahToScaled(input.salePriceRupiah),
      rupiahToScaled(input.purchasePriceRupiah)
    )
    .run();
  return getProduct(db, productId);
}

export async function updateProduct(db, productId, patch) {
  const existing = await getProduct(db, productId);
  if (!existing) throw new RangeError('PRODUCT_NOT_FOUND');

  const merged = {
    productName: patch.productName ?? existing.productName,
    unitLabel: patch.unitLabel ?? existing.unitLabel,
    salePriceRupiah: patch.salePriceRupiah ?? existing.salePriceRupiah,
    purchasePriceRupiah: patch.purchasePriceRupiah ?? existing.purchasePriceRupiah,
    isActive: patch.isActive ?? existing.isActive,
  };
  validateProductInput(merged);

  await db
    .prepare(
      `UPDATE ikan_products SET product_name = ?, unit_label = ?, sale_price_amount = ?, purchase_price_amount = ?,
        is_active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE product_id = ? AND store_id = ?`
    )
    .bind(
      merged.productName.trim(),
      merged.unitLabel.trim(),
      rupiahToScaled(merged.salePriceRupiah),
      rupiahToScaled(merged.purchasePriceRupiah),
      merged.isActive ? 1 : 0,
      productId,
      IKAN_STORE_ID
    )
    .run();
  return getProduct(db, productId);
}

async function isProductReferenced(db, productId) {
  const row = await db.prepare('SELECT 1 FROM ikan_sale_items WHERE product_id = ? LIMIT 1').bind(productId).first();
  if (row) return true;
  const row2 = await db.prepare('SELECT 1 FROM ikan_purchase_items WHERE product_id = ? LIMIT 1').bind(productId).first();
  return Boolean(row2);
}

// Sama seperti kontak: barang yang sudah pernah dipakai transaksi TIDAK dihapus
// diam-diam -- baris sale_items/purchase_items lama menyimpan snapshot nama+harga
// sendiri, jadi hapus barang master tidak merusak histori, tapi kita tetap pilih
// nonaktifkan (bukan hapus) supaya id-nya tidak bisa dipakai ulang secara tidak sengaja.
export async function deleteProduct(db, productId) {
  const existing = await getProduct(db, productId);
  if (!existing) throw new RangeError('PRODUCT_NOT_FOUND');
  if (await isProductReferenced(db, productId)) {
    await db
      .prepare(`UPDATE ikan_products SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE product_id = ? AND store_id = ?`)
      .bind(productId, IKAN_STORE_ID)
      .run();
    return { deleted: false, deactivated: true };
  }
  await db.prepare('DELETE FROM ikan_products WHERE product_id = ? AND store_id = ?').bind(productId, IKAN_STORE_ID).run();
  return { deleted: true, deactivated: false };
}

export async function handleMasterProductsApi(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'ikan', 'products', maybe id]
  const productId = parts[3];

  try {
    if (request.method === 'GET' && !productId) {
      const activeOnly = url.searchParams.get('all') !== '1';
      return Response.json(await listProducts(env.DB, { activeOnly }));
    }
    if (request.method === 'GET' && productId) {
      const product = await getProduct(env.DB, productId);
      if (!product) return Response.json({ error: 'PRODUCT_NOT_FOUND' }, { status: 404 });
      return Response.json(product);
    }
    if (request.method === 'POST' && !productId) {
      const body = await request.json();
      const created = await createProduct(env.DB, body);
      return Response.json(created, { status: 201 });
    }
    if (request.method === 'PATCH' && productId) {
      const body = await request.json();
      const updated = await updateProduct(env.DB, productId, body);
      return Response.json(updated);
    }
    if (request.method === 'DELETE' && productId) {
      const result = await deleteProduct(env.DB, productId);
      return Response.json(result);
    }
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  } catch (err) {
    if (err.message === 'PRODUCT_NOT_FOUND') return Response.json({ error: err.message }, { status: 404 });
    if (err instanceof RangeError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
