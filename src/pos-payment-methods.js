// POS Core owns payment identity, active status, and default selection. Keep
// Accounting account mapping out of this runtime boundary.
const text = (value, max = 300) => String(value ?? '').trim().slice(0, max);

// Bos Cyo, 2026-10-18 (migration 0169): cara bayar yang tidak dipakai untuk penjualan (mis. REKBER) tetap
// tampil untuk pembelian/pengeluaran. Kolom dicek dulu supaya kode aman sebelum migration jalan.
async function allowSaleAvailable(db) {
  const schema = await db.prepare(`PRAGMA table_info(payment_methods)`).bind().all();
  return (schema.results ?? []).some(column => column.name === 'allow_sale');
}

export async function paymentMethodAllowedForSale(db, storeId, code) {
  if (!await allowSaleAvailable(db)) return true;
  const row = await db.prepare(`SELECT allow_sale FROM payment_methods WHERE store_id = ? AND code = ? LIMIT 1`).bind(storeId, code).first();
  return !row || Number(row.allow_sale) !== 0;
}

async function paymentMethodDefaultsAvailable(db) {
  const schema = await db.prepare(`PRAGMA table_info(payment_methods)`).bind().all();
  return (schema.results ?? []).some(column => column.name === 'is_default');
}

export async function listPosPaymentMethods(db, storeId) {
  const hasConfiguredDefault = await paymentMethodDefaultsAvailable(db);
  const defaultSelect = hasConfiguredDefault
    ? 'is_default'
    : `CASE WHEN code = 'CASH' THEN 1 ELSE 0 END AS is_default`;
  const allowSaleSelect = await allowSaleAvailable(db) ? 'allow_sale' : '1 AS allow_sale';
  const rows = await db.prepare(`
    SELECT id, code, name, ${allowSaleSelect}, ${defaultSelect}
    FROM payment_methods
    WHERE store_id = ? AND is_active = 1
    ORDER BY is_default DESC, name COLLATE NOCASE, code
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    paymentMethodId: row.id,
    code: row.code,
    name: row.name,
    isDefault: Boolean(row.is_default),
    allowSale: Number(row.allow_sale) !== 0,
    usesCashDrawer: row.code === 'CASH'
  }));
}

export async function resolvePosPaymentMethod(db, storeId, requestedCode, fallbackCode = 'CASH') {
  const requested = text(requestedCode, 32).toUpperCase();
  let code = requested;
  if (!code) {
    const hasConfiguredDefault = await paymentMethodDefaultsAvailable(db);
    const configuredDefault = hasConfiguredDefault ? await db.prepare(`
        SELECT code FROM payment_methods
        WHERE store_id = ? AND is_active = 1 AND is_default = 1
        LIMIT 1
      `).bind(storeId).first() : null;
    code = text(configuredDefault?.code || fallbackCode, 32).toUpperCase();
  }
  const row = await db.prepare(`
    SELECT id, code, name
    FROM payment_methods
    WHERE store_id = ? AND code = ? AND is_active = 1
    LIMIT 1
  `).bind(storeId, code).first();
  return row ? {
    paymentMethodId: row.id,
    code: row.code,
    name: row.name,
    usesCashDrawer: row.code === 'CASH'
  } : null;
}
