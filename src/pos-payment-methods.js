// POS Core owns payment identity, active status, and default selection. Keep
// Accounting account mapping out of this runtime boundary.
const text = (value, max = 300) => String(value ?? '').trim().slice(0, max);

async function paymentMethodDefaultsAvailable(db) {
  const schema = await db.prepare(`PRAGMA table_info(payment_methods)`).bind().all();
  return (schema.results ?? []).some(column => column.name === 'is_default');
}

export async function listPosPaymentMethods(db, storeId) {
  const hasConfiguredDefault = await paymentMethodDefaultsAvailable(db);
  const defaultSelect = hasConfiguredDefault
    ? 'is_default'
    : `CASE WHEN code = 'CASH' THEN 1 ELSE 0 END AS is_default`;
  const rows = await db.prepare(`
    SELECT id, code, name, ${defaultSelect}
    FROM payment_methods
    WHERE store_id = ? AND is_active = 1
    ORDER BY is_default DESC, name COLLATE NOCASE, code
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    paymentMethodId: row.id,
    code: row.code,
    name: row.name,
    isDefault: Boolean(row.is_default),
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
