import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { resolveStore } from './stores.js';
import { ACCOUNT_TYPES, PAYMENT_METHODS, TRANSACTION_TYPES, reconcileOpeningBalances } from './integration-contracts.js';

const text = (value, max = 180) => String(value ?? '').trim().slice(0, max);
const bool = value => value === false ? 0 : 1;
const storeToken = request => new URL(request.url).searchParams.get('store') || 'G001';

async function context(request, env) {
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth;
  const store = await resolveStore(env.DB, storeToken(request), { includeInactive: true });
  if (!store) return { ok: false, response: json({ error: 'Gerai tidak ditemukan.', code: 'STORE_NOT_FOUND' }, 404) };
  return { ok: true, auth, store, tenantId: 'tenant_leker' };
}

const accountDto = row => ({
  id: row.id, code: row.code, name: row.name, accountType: row.account_type,
  parentId: row.parent_id || '', isPostable: Boolean(row.is_postable), isActive: Boolean(row.is_active)
});

async function bootstrap(db, store) {
  const [accounts, mappings, products, warehouseMappings, dimensions, openingBalances, settings, outbox] = await Promise.all([
    db.prepare('SELECT * FROM accounting_accounts WHERE store_id = ? ORDER BY code').bind(store.id).all(),
    db.prepare('SELECT * FROM accounting_transaction_mappings WHERE store_id = ? ORDER BY transaction_type, payment_method').bind(store.id).all(),
    db.prepare('SELECT id, name, is_active FROM products WHERE store_id = ? ORDER BY name COLLATE NOCASE').bind(store.id).all(),
    db.prepare('SELECT * FROM warehouse_item_mappings WHERE store_id = ? ORDER BY product_id').bind(store.id).all(),
    db.prepare('SELECT * FROM accounting_dimensions WHERE store_id = ? ORDER BY dimension_type, code').bind(store.id).all(),
    db.prepare('SELECT * FROM accounting_opening_balances WHERE store_id = ? ORDER BY effective_date DESC').bind(store.id).all(),
    db.prepare('SELECT * FROM pos_integration_settings WHERE store_id = ?').bind(store.id).first(),
    db.prepare(`SELECT status, destination, COUNT(*) AS count FROM integration_outbox WHERE store_id = ? GROUP BY status, destination`).bind(store.id).all()
  ]);
  return {
    store,
    contracts: { accounting: '@maxi/accounting@1.3.0', warehouse: '@maxi/warehouse@2.0.0', pos: '@maxi/pos-core@1.0.0' },
    accounts: (accounts.results || []).map(accountDto),
    mappings: (mappings.results || []).map(row => ({ id: row.id, transactionType: row.transaction_type, paymentMethod: row.payment_method, debitAccountId: row.debit_account_id || '', creditAccountId: row.credit_account_id || '', status: row.status })),
    products: (products.results || []).map(row => ({ id: row.id, name: row.name, isActive: Boolean(row.is_active) })),
    warehouseMappings: (warehouseMappings.results || []).map(row => ({ productId: row.product_id, warehouseId: row.warehouse_id, warehouseItemId: row.warehouse_item_id, deductionQuantity: row.deduction_quantity, status: row.status })),
    dimensions: dimensions.results || [], openingBalances: openingBalances.results || [],
    openingBalanceReconciliation: reconcileOpeningBalances(openingBalances.results || []),
    settings: settings || { tenant_id: 'tenant_leker', terminal_id: '', warehouse_id: '', retained_earnings_account_id: '' },
    outboxSummary: outbox.results || []
  };
}

export async function handleIntegrationSettingsApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/integrations')) return null;
  const ctx = await context(request, env);
  if (!ctx.ok) return ctx.response;
  const { store, tenantId } = ctx;
  const db = env.DB;

  if (request.method === 'GET' && pathname === '/api/admin/integrations') return json(await bootstrap(db, store));

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload konfigurasi tidak valid.', code: 'INVALID_JSON' }, 400);

  if (request.method === 'POST' && pathname === '/api/admin/integrations/accounts') {
    const code = text(body.value?.code, 24);
    const name = text(body.value?.name, 100);
    const accountType = text(body.value?.accountType, 20).toUpperCase();
    const parentId = text(body.value?.parentId, 160) || null;
    const isPostable = body.value?.isPostable === true ? 1 : 0;
    if (!code || !name || !ACCOUNT_TYPES.includes(accountType)) return json({ error: 'Kode, nama, dan tipe akun wajib valid.', code: 'ACCOUNT_INVALID' }, 400);
    if (parentId) {
      const parent = await db.prepare('SELECT id, account_type, is_postable FROM accounting_accounts WHERE id = ? AND store_id = ?').bind(parentId, store.id).first();
      if (!parent || parent.is_postable || parent.account_type !== accountType) return json({ error: 'Parent harus akun grup dengan tipe yang sama.', code: 'ACCOUNT_PARENT_INVALID' }, 409);
    }
    const id = `coa_${store.id}_${crypto.randomUUID()}`;
    try {
      await db.prepare(`INSERT INTO accounting_accounts (id, tenant_id, store_id, code, name, account_type, parent_id, is_postable) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, tenantId, store.id, code, name, accountType, parentId, isPostable).run();
    } catch { return json({ error: 'Kode akun sudah dipakai pada gerai ini.', code: 'ACCOUNT_CODE_DUPLICATE' }, 409); }
    return json({ ok: true, id }, 201);
  }

  if (request.method === 'POST' && pathname === '/api/admin/integrations/dimensions') {
    const dimensionType = text(body.value?.dimensionType, 40).toUpperCase();
    const code = text(body.value?.code, 40).toUpperCase();
    const name = text(body.value?.name, 100);
    if (!dimensionType || !code || !name) return json({ error: 'Tipe, kode, dan nama dimensi wajib diisi.', code: 'DIMENSION_INVALID' }, 400);
    const id = `dim_${store.id}_${crypto.randomUUID()}`;
    try {
      await db.prepare(`INSERT INTO accounting_dimensions (id, tenant_id, store_id, dimension_type, code, name) VALUES (?, ?, ?, ?, ?, ?)`).bind(id, tenantId, store.id, dimensionType, code, name).run();
    } catch { return json({ error: 'Kode dimensi sudah dipakai untuk tipe tersebut.', code: 'DIMENSION_DUPLICATE' }, 409); }
    return json({ ok: true, id }, 201);
  }

  if (request.method === 'POST' && pathname === '/api/admin/integrations/opening-balances') {
    const accountId = text(body.value?.accountId, 180);
    const effectiveDate = text(body.value?.effectiveDate, 10);
    const debitAmount = Math.round(Number(body.value?.debitAmount || 0));
    const creditAmount = Math.round(Number(body.value?.creditAmount || 0));
    const account = await db.prepare('SELECT id FROM accounting_accounts WHERE id = ? AND store_id = ? AND is_postable = 1 AND is_active = 1').bind(accountId, store.id).first();
    const amountsValid = Number.isSafeInteger(debitAmount) && Number.isSafeInteger(creditAmount) && debitAmount >= 0 && creditAmount >= 0 && (debitAmount > 0) !== (creditAmount > 0);
    if (!account || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || !amountsValid) return json({ error: 'Saldo awal memerlukan subakun postable, tanggal, dan tepat satu sisi debit/kredit.', code: 'OPENING_BALANCE_INVALID' }, 400);
    const id = `opening_${store.id}_${crypto.randomUUID()}`;
    try {
      await db.prepare(`INSERT INTO accounting_opening_balances (id, tenant_id, store_id, account_id, effective_date, debit_amount, credit_amount, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, tenantId, store.id, accountId, effectiveDate, debitAmount, creditAmount, text(body.value?.note, 300)).run();
    } catch { return json({ error: 'Saldo awal akun pada tanggal tersebut sudah ada.', code: 'OPENING_BALANCE_DUPLICATE' }, 409); }
    return json({ ok: true, id, status: 'NEEDS_RECONCILIATION' }, 201);
  }

  const accountMatch = pathname.match(/^\/api\/admin\/integrations\/accounts\/([^/]+)$/);
  if (accountMatch && request.method === 'PATCH') {
    const id = decodeURIComponent(accountMatch[1]);
    const current = await db.prepare('SELECT * FROM accounting_accounts WHERE id = ? AND store_id = ?').bind(id, store.id).first();
    if (!current) return json({ error: 'Akun tidak ditemukan.', code: 'ACCOUNT_NOT_FOUND' }, 404);
    const name = text(body.value?.name ?? current.name, 100);
    const isActive = bool(body.value?.isActive);
    const referenced = await db.prepare(`SELECT COUNT(*) AS count FROM accounting_transaction_mappings WHERE store_id = ? AND status = 'ACTIVE' AND (debit_account_id = ? OR credit_account_id = ?)`).bind(store.id, id, id).first();
    if (!isActive && Number(referenced?.count || 0) > 0) return json({ error: 'Akun masih dipakai mapping aktif.', code: 'ACCOUNT_IN_USE' }, 409);
    await db.prepare('UPDATE accounting_accounts SET name = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?').bind(name, isActive, id, store.id).run();
    return json({ ok: true });
  }

  if (request.method === 'PUT' && pathname === '/api/admin/integrations/account-mapping') {
    const transactionType = text(body.value?.transactionType, 40).toUpperCase();
    const method = text(body.value?.paymentMethod || 'ANY', 20).toUpperCase();
    const debitId = text(body.value?.debitAccountId, 180);
    const creditId = text(body.value?.creditAccountId, 180);
    if (!TRANSACTION_TYPES.includes(transactionType) || !PAYMENT_METHODS.includes(method)) return json({ error: 'Jenis transaksi atau pembayaran tidak dikenal.', code: 'MAPPING_KIND_INVALID' }, 400);
    const accounts = await db.prepare(`SELECT id, is_postable, is_active FROM accounting_accounts WHERE store_id = ? AND id IN (?, ?)`).bind(store.id, debitId, creditId).all();
    const valid = (accounts.results || []).length === 2 && accounts.results.every(row => row.is_postable && row.is_active);
    if (!valid || debitId === creditId) return json({ error: 'Debit dan kredit harus berbeda serta memakai subakun postable aktif.', code: 'MAPPING_ACCOUNT_INVALID' }, 409);
    const id = `map_${store.id}_${transactionType}_${method}`;
    await db.prepare(`INSERT INTO accounting_transaction_mappings (id, tenant_id, store_id, transaction_type, payment_method, debit_account_id, credit_account_id, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP)
      ON CONFLICT(store_id, transaction_type, payment_method) DO UPDATE SET debit_account_id=excluded.debit_account_id, credit_account_id=excluded.credit_account_id, status='ACTIVE', updated_at=CURRENT_TIMESTAMP`)
      .bind(id, tenantId, store.id, transactionType, method, debitId, creditId).run();
    return json({ ok: true, status: 'ACTIVE' });
  }

  if (request.method === 'PUT' && pathname === '/api/admin/integrations/warehouse-mapping') {
    const productId = Number(body.value?.productId);
    const warehouseId = text(body.value?.warehouseId, 120);
    const warehouseItemId = text(body.value?.warehouseItemId, 160);
    const deductionQuantity = Number(body.value?.deductionQuantity);
    const product = await db.prepare('SELECT id FROM products WHERE id = ? AND store_id = ?').bind(productId, store.id).first();
    if (!product || !warehouseId || !warehouseItemId || !Number.isInteger(deductionQuantity) || deductionQuantity < 1) return json({ error: 'Mapping item warehouse tidak valid.', code: 'WAREHOUSE_MAPPING_INVALID' }, 400);
    const id = `whmap_${store.id}_${productId}`;
    await db.prepare(`INSERT INTO warehouse_item_mappings (id, tenant_id, store_id, product_id, warehouse_id, warehouse_item_id, deduction_quantity, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP)
      ON CONFLICT(store_id, product_id) DO UPDATE SET warehouse_id=excluded.warehouse_id, warehouse_item_id=excluded.warehouse_item_id, deduction_quantity=excluded.deduction_quantity, status='ACTIVE', updated_at=CURRENT_TIMESTAMP`)
      .bind(id, tenantId, store.id, productId, warehouseId, warehouseItemId, deductionQuantity).run();
    return json({ ok: true, status: 'ACTIVE' });
  }

  if (request.method === 'PUT' && pathname === '/api/admin/integrations/settings') {
    const terminalId = text(body.value?.terminalId, 160);
    const warehouseId = text(body.value?.warehouseId, 120);
    const retained = text(body.value?.retainedEarningsAccountId, 180) || null;
    if (!terminalId) return json({ error: 'Terminal wajib dipilih.', code: 'TERMINAL_REQUIRED' }, 400);
    if (retained) {
      const account = await db.prepare(`SELECT id FROM accounting_accounts WHERE id = ? AND store_id = ? AND account_type = 'EQUITY' AND is_postable = 1 AND is_active = 1`).bind(retained, store.id).first();
      if (!account) return json({ error: 'Laba ditahan harus memakai subakun Ekuitas postable.', code: 'RETAINED_EARNINGS_INVALID' }, 409);
    }
    await db.prepare(`INSERT INTO pos_integration_settings (store_id, tenant_id, terminal_id, warehouse_id, retained_earnings_account_id, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(store_id) DO UPDATE SET terminal_id=excluded.terminal_id, warehouse_id=excluded.warehouse_id, retained_earnings_account_id=excluded.retained_earnings_account_id, updated_at=CURRENT_TIMESTAMP`)
      .bind(store.id, tenantId, terminalId, warehouseId, retained).run();
    return json({ ok: true });
  }

  return json({ error: 'Route konfigurasi integrasi tidak ditemukan.', code: 'INTEGRATION_ROUTE_NOT_FOUND' }, 404);
}
