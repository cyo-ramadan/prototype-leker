import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { listProductKinds } from './product-kinds.js';

export const ACCOUNT_TYPES = Object.freeze(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);
export const JOURNAL_SIDES = Object.freeze(['DEBIT', 'CREDIT']);
export const JOURNAL_SOURCE_TYPES = Object.freeze([
  'fixed_account',
  'payment_method',
  'item_category_inventory',
  'item_category_cogs',
  'item_category_revenue',
  'cost_center_cash'
]);

const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const flag = value => value === false ? 0 : 1;

function codeText(value, max = 40) {
  return text(value, max)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

async function managementContext(request, env) {
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth;
  const store = await selectedStore(env.DB, request);
  if (!store) return { ok: false, response: json({ error: 'Gerai tidak ditemukan.' }, 404) };
  return { ok: true, auth, store };
}

function accountDto(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    subtype: row.subtype || '',
    isActive: Boolean(row.is_active),
    reviewRequired: Boolean(row.review_required)
  };
}

async function listAccounts(db, storeId) {
  const rows = await db.prepare(`
    SELECT id, code, name, type, subtype, is_active, review_required
    FROM chart_of_accounts
    WHERE store_id = ?
    ORDER BY CASE type
      WHEN 'ASSET' THEN 1 WHEN 'LIABILITY' THEN 2 WHEN 'EQUITY' THEN 3
      WHEN 'REVENUE' THEN 4 WHEN 'EXPENSE' THEN 5 ELSE 9 END, code
  `).bind(storeId).all();
  return (rows.results ?? []).map(accountDto);
}

async function listPaymentMethods(db, storeId) {
  const rows = await db.prepare(`
    SELECT p.id, p.code, p.name, p.account_id, p.is_active,
           a.code AS account_code, a.name AS account_name, a.type AS account_type
    FROM payment_methods p
    LEFT JOIN chart_of_accounts a ON a.id = p.account_id AND a.store_id = p.store_id
    WHERE p.store_id = ?
    ORDER BY p.name COLLATE NOCASE, p.code
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    id: row.id,
    code: row.code,
    name: row.name,
    accountId: row.account_id || null,
    account: row.account_id ? { id: row.account_id, code: row.account_code || '', name: row.account_name || '', type: row.account_type || '' } : null,
    isActive: Boolean(row.is_active)
  }));
}

async function listItemCategories(db, storeId) {
  const rows = await db.prepare(`
    SELECT c.id, c.product_kind_id, c.name, c.inventory_account_id, c.cogs_account_id,
           c.revenue_account_id, c.is_active,
           k.code AS product_kind_code, k.name AS product_kind_name,
           ia.code AS inventory_code, ia.name AS inventory_name,
           ca.code AS cogs_code, ca.name AS cogs_name,
           ra.code AS revenue_code, ra.name AS revenue_name
    FROM item_categories c
    JOIN product_kinds k ON k.id = c.product_kind_id AND k.store_id = c.store_id
    JOIN chart_of_accounts ia ON ia.id = c.inventory_account_id AND ia.store_id = c.store_id
    JOIN chart_of_accounts ca ON ca.id = c.cogs_account_id AND ca.store_id = c.store_id
    LEFT JOIN chart_of_accounts ra ON ra.id = c.revenue_account_id AND ra.store_id = c.store_id
    WHERE c.store_id = ?
    ORDER BY c.name COLLATE NOCASE, c.id
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    id: row.id,
    productKindId: row.product_kind_id,
    productKindCode: row.product_kind_code,
    productKindName: row.product_kind_name,
    name: row.name,
    inventoryAccountId: row.inventory_account_id,
    inventoryAccount: { code: row.inventory_code, name: row.inventory_name },
    cogsAccountId: row.cogs_account_id,
    cogsAccount: { code: row.cogs_code, name: row.cogs_name },
    revenueAccountId: row.revenue_account_id || null,
    revenueAccount: row.revenue_account_id ? { code: row.revenue_code || '', name: row.revenue_name || '' } : null,
    isActive: Boolean(row.is_active)
  }));
}

async function listTransactionCategories(db, storeId) {
  const [categories, rules] = await db.batch([
    db.prepare(`
      SELECT id, code, name, involves_payment, involves_item_category,
             is_active, description, registered_by_module
      FROM transaction_categories
      WHERE store_id = ?
      ORDER BY CASE registered_by_module WHEN 'ACCOUNTING' THEN 1 ELSE 2 END, name COLLATE NOCASE, code
    `).bind(storeId),
    db.prepare(`
      SELECT r.id, r.transaction_category_id, r.label, r.side, r.source_type,
             r.fixed_account_id, r.is_active, r.is_default, r.sort_order,
             a.code AS fixed_account_code, a.name AS fixed_account_name
      FROM journal_rules r
      LEFT JOIN chart_of_accounts a ON a.id = r.fixed_account_id AND a.store_id = r.store_id
      WHERE r.store_id = ?
      ORDER BY r.transaction_category_id, r.sort_order, r.id
    `).bind(storeId)
  ]);
  const grouped = new Map();
  for (const row of rules.results ?? []) {
    if (!grouped.has(row.transaction_category_id)) grouped.set(row.transaction_category_id, []);
    grouped.get(row.transaction_category_id).push({
      id: row.id,
      label: row.label,
      side: row.side,
      sourceType: row.source_type,
      fixedAccountId: row.fixed_account_id || null,
      fixedAccount: row.fixed_account_id ? { code: row.fixed_account_code || '', name: row.fixed_account_name || '' } : null,
      isActive: Boolean(row.is_active),
      isDefault: Boolean(row.is_default),
      sortOrder: Number(row.sort_order || 0)
    });
  }
  return (categories.results ?? []).map(row => {
    const categoryRules = grouped.get(row.id) ?? [];
    const active = categoryRules.filter(rule => rule.isActive);
    const debitCount = active.filter(rule => rule.side === 'DEBIT').length;
    const creditCount = active.filter(rule => rule.side === 'CREDIT').length;
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      involvesPayment: Boolean(row.involves_payment),
      involvesItemCategory: Boolean(row.involves_item_category),
      isActive: Boolean(row.is_active),
      description: row.description || '',
      registeredByModule: row.registered_by_module || 'ACCOUNTING',
      completeness: debitCount >= 1 && creditCount >= 1 ? 'COMPLETE' : 'INCOMPLETE',
      debitCount,
      creditCount,
      rules: categoryRules
    };
  });
}

export async function getAccountingSettingsBootstrap(db, store) {
  const [accounts, paymentMethods, itemCategories, transactionCategories, productKinds] = await Promise.all([
    listAccounts(db, store.id),
    listPaymentMethods(db, store.id),
    listItemCategories(db, store.id),
    listTransactionCategories(db, store.id),
    listProductKinds(db, store.id)
  ]);
  return {
    contract: 'MAXI_ACCOUNTING_SETTINGS_V1',
    journalGeneration: 'OUT_OF_SCOPE',
    accountMaintenance: 'ACCOUNTING_MODULE_ONLY',
    accountCodePolicy: 'AUTO_UNIQUE_BY_ACCOUNTING_MODULE',
    store,
    accountTypes: ACCOUNT_TYPES,
    sourceTypes: JOURNAL_SOURCE_TYPES,
    accounts,
    paymentMethods,
    itemCategories,
    productKinds,
    transactionCategories
  };
}

async function activeAccount(db, storeId, accountId, expectedType = null) {
  if (!accountId) return null;
  const row = await db.prepare(`
    SELECT id, type FROM chart_of_accounts
    WHERE id = ? AND store_id = ? AND is_active = 1
  `).bind(accountId, storeId).first();
  if (!row || (expectedType && row.type !== expectedType)) return null;
  return row;
}

async function accountReferenceCount(db, storeId, accountId) {
  const row = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM payment_methods WHERE store_id = ? AND account_id = ? AND is_active = 1) +
      (SELECT COUNT(*) FROM item_categories WHERE store_id = ? AND is_active = 1 AND (inventory_account_id = ? OR cogs_account_id = ? OR revenue_account_id = ?)) +
      (SELECT COUNT(*) FROM journal_rules WHERE store_id = ? AND fixed_account_id = ? AND is_active = 1) AS count
  `).bind(storeId, accountId, storeId, accountId, accountId, accountId, storeId, accountId).first();
  return Number(row?.count || 0);
}

async function createAccount(db, store, body) {
  const code = text(body?.code, 24).toUpperCase();
  const name = text(body?.name, 100);
  const type = text(body?.type, 20).toUpperCase();
  const subtype = text(body?.subtype, 60).toUpperCase();
  if (!code || !name || !ACCOUNT_TYPES.includes(type)) return json({ error: 'Kode, nama, dan tipe akun wajib valid.' }, 400);
  const id = `coa_${store.id}_${crypto.randomUUID()}`;
  try {
    await db.prepare(`
      INSERT INTO chart_of_accounts (id, store_id, code, name, type, subtype, is_active, review_required)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, store.id, code, name, type, subtype, flag(body?.isActive), body?.reviewRequired === true ? 1 : 0).run();
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) return json({ error: 'Kode akun sudah dipakai pada gerai ini.' }, 409);
    throw error;
  }
  return json({ ok: true, id }, 201);
}

async function updateAccount(db, store, id, body) {
  const current = await db.prepare(`SELECT * FROM chart_of_accounts WHERE id = ? AND store_id = ?`).bind(id, store.id).first();
  if (!current) return json({ error: 'Akun tidak ditemukan.' }, 404);
  const name = text(body?.name ?? current.name, 100);
  const subtype = text(body?.subtype ?? current.subtype, 60).toUpperCase();
  const isActive = body?.isActive === undefined ? Number(current.is_active) : flag(body.isActive);
  if (!name) return json({ error: 'Nama akun wajib diisi.' }, 400);
  if (!isActive && Number(current.is_active) === 1 && await accountReferenceCount(db, store.id, id) > 0) {
    return json({ error: 'Akun masih direferensikan konfigurasi aktif. Nonaktifkan link terkait lebih dulu.' }, 409);
  }
  await db.prepare(`
    UPDATE chart_of_accounts
    SET name = ?, subtype = ?, is_active = ?, review_required = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND store_id = ?
  `).bind(name, subtype, isActive, body?.reviewRequired === undefined ? Number(current.review_required) : (body.reviewRequired ? 1 : 0), id, store.id).run();
  return json({ ok: true });
}

async function savePaymentMethod(db, store, body, id = null) {
  const current = id ? await db.prepare(`SELECT * FROM payment_methods WHERE id = ? AND store_id = ?`).bind(id, store.id).first() : null;
  if (id && !current) return json({ error: 'Metode pembayaran tidak ditemukan.' }, 404);
  const code = current?.code || codeText(body?.code || body?.name, 32).toUpperCase();
  const name = text(body?.name ?? current?.name, 80);
  const accountId = body?.accountId === undefined ? (current?.account_id || null) : (text(body.accountId, 180) || null);
  const isActive = body?.isActive === undefined ? Number(current?.is_active ?? 1) : flag(body.isActive);
  if (!code || !name) return json({ error: 'Kode dan nama metode pembayaran wajib valid.' }, 400);
  if (accountId && !await activeAccount(db, store.id, accountId)) return json({ error: 'Akun metode pembayaran harus akun aktif di gerai ini.' }, 400);
  if (current) {
    await db.prepare(`UPDATE payment_methods SET name = ?, account_id = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?`)
      .bind(name, accountId, isActive, id, store.id).run();
    return json({ ok: true });
  }
  const nextId = `payment_${store.id}_${crypto.randomUUID()}`;
  try {
    await db.prepare(`INSERT INTO payment_methods (id, store_id, code, name, account_id, is_active) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(nextId, store.id, code, name, accountId, isActive).run();
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) return json({ error: 'Kode/nama metode pembayaran sudah dipakai.' }, 409);
    throw error;
  }
  return json({ ok: true, id: nextId }, 201);
}

async function saveItemCategory(db, store, body, id = null) {
  const current = id ? await db.prepare(`SELECT * FROM item_categories WHERE id = ? AND store_id = ?`).bind(id, store.id).first() : null;
  if (id && !current) return json({ error: 'Item Category tidak ditemukan.' }, 404);
  const productKindId = text(body?.productKindId ?? current?.product_kind_id, 180);
  const kind = await db.prepare(`SELECT id, name FROM product_kinds WHERE id = ? AND store_id = ? AND is_active = 1`).bind(productKindId, store.id).first();
  if (!kind) return json({ error: 'Jenis Barang aktif wajib dipilih.' }, 400);
  const inventoryAccountId = text(body?.inventoryAccountId ?? current?.inventory_account_id, 180);
  const cogsAccountId = text(body?.cogsAccountId ?? current?.cogs_account_id, 180);
  const revenueAccountId = text(body?.revenueAccountId ?? current?.revenue_account_id, 180) || null;
  if (!await activeAccount(db, store.id, inventoryAccountId, 'ASSET')) return json({ error: 'Akun Persediaan wajib akun ASSET aktif.' }, 400);
  if (!await activeAccount(db, store.id, cogsAccountId, 'EXPENSE')) return json({ error: 'Akun HPP wajib akun EXPENSE aktif.' }, 400);
  if (revenueAccountId && !await activeAccount(db, store.id, revenueAccountId, 'REVENUE')) return json({ error: 'Akun Penjualan wajib akun REVENUE aktif.' }, 400);
  const name = text(body?.name ?? current?.name ?? kind.name, 100) || kind.name;
  const isActive = body?.isActive === undefined ? Number(current?.is_active ?? 1) : flag(body.isActive);
  if (current) {
    await db.prepare(`
      UPDATE item_categories
      SET product_kind_id = ?, name = ?, inventory_account_id = ?, cogs_account_id = ?, revenue_account_id = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(productKindId, name, inventoryAccountId, cogsAccountId, revenueAccountId, isActive, id, store.id).run();
    return json({ ok: true });
  }
  const nextId = `itemcat_${store.id}_${crypto.randomUUID()}`;
  try {
    await db.prepare(`
      INSERT INTO item_categories (id, store_id, product_kind_id, name, inventory_account_id, cogs_account_id, revenue_account_id, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(nextId, store.id, productKindId, name, inventoryAccountId, cogsAccountId, revenueAccountId, isActive).run();
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) return json({ error: 'Jenis Barang itu sudah memiliki Item Category Accounting.' }, 409);
    throw error;
  }
  return json({ ok: true, id: nextId }, 201);
}

async function saveTransactionCategory(db, store, body, id = null) {
  const current = id ? await db.prepare(`SELECT * FROM transaction_categories WHERE id = ? AND store_id = ?`).bind(id, store.id).first() : null;
  if (id && !current) return json({ error: 'Kategori transaksi tidak ditemukan.' }, 404);
  const code = current?.code || codeText(body?.code, 40);
  const name = text(body?.name ?? current?.name, 100);
  const description = text(body?.description ?? current?.description, 500);
  const involvesPayment = body?.involvesPayment === undefined ? Number(current?.involves_payment ?? 0) : flag(body.involvesPayment);
  const involvesItemCategory = body?.involvesItemCategory === undefined ? Number(current?.involves_item_category ?? 0) : flag(body.involvesItemCategory);
  const isActive = body?.isActive === undefined ? Number(current?.is_active ?? 1) : flag(body.isActive);
  if (!code || !name) return json({ error: 'Kode dan nama kategori transaksi wajib valid.' }, 400);
  if (current) {
    await db.prepare(`
      UPDATE transaction_categories
      SET name = ?, description = ?, involves_payment = ?, involves_item_category = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(name, description, involvesPayment, involvesItemCategory, isActive, id, store.id).run();
    return json({ ok: true });
  }
  const nextId = `txcat_${store.id}_${crypto.randomUUID()}`;
  try {
    await db.prepare(`
      INSERT INTO transaction_categories (
        id, store_id, code, name, involves_payment, involves_item_category, is_active, description, registered_by_module
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACCOUNTING')
    `).bind(nextId, store.id, code, name, involvesPayment, involvesItemCategory, isActive, description).run();
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) return json({ error: 'Kode kategori transaksi sudah dipakai.' }, 409);
    throw error;
  }
  return json({ ok: true, id: nextId }, 201);
}

async function saveJournalRule(db, store, body, id = null) {
  const current = id ? await db.prepare(`SELECT * FROM journal_rules WHERE id = ? AND store_id = ?`).bind(id, store.id).first() : null;
  if (id && !current) return json({ error: 'Baris journal rule tidak ditemukan.' }, 404);
  const transactionCategoryId = text(body?.transactionCategoryId ?? current?.transaction_category_id, 180);
  const category = await db.prepare(`SELECT id FROM transaction_categories WHERE id = ? AND store_id = ?`).bind(transactionCategoryId, store.id).first();
  if (!category) return json({ error: 'Kategori transaksi tidak ditemukan.' }, 400);
  const label = text(body?.label ?? current?.label, 140);
  const side = text(body?.side ?? current?.side, 12).toUpperCase();
  const sourceType = text(body?.sourceType ?? current?.source_type, 60);
  const fixedAccountId = sourceType === 'fixed_account'
    ? (text(body?.fixedAccountId ?? current?.fixed_account_id, 180) || null)
    : null;
  const isActive = body?.isActive === undefined ? Number(current?.is_active ?? 1) : flag(body.isActive);
  const isDefault = sourceType === 'fixed_account'
    ? (body?.isDefault === undefined ? Number(current?.is_default ?? 0) : flag(body.isDefault))
    : 0;
  const sortOrder = Number.isInteger(Number(body?.sortOrder ?? current?.sort_order ?? 0)) ? Number(body?.sortOrder ?? current?.sort_order ?? 0) : 0;
  if (!label || !JOURNAL_SIDES.includes(side) || !JOURNAL_SOURCE_TYPES.includes(sourceType)) return json({ error: 'Label, sisi, atau source type journal rule tidak valid.' }, 400);
  if (sourceType === 'fixed_account' && !await activeAccount(db, store.id, fixedAccountId)) return json({ error: 'Fixed account wajib akun aktif di gerai ini.' }, 400);
  if (isDefault) {
    await db.prepare(`UPDATE journal_rules SET is_default = 0, updated_at = CURRENT_TIMESTAMP WHERE store_id = ? AND transaction_category_id = ? AND source_type = 'fixed_account' AND id <> ?`).bind(store.id, transactionCategoryId, id || '').run();
  }
  if (current) {
    await db.prepare(`
      UPDATE journal_rules
      SET transaction_category_id = ?, label = ?, side = ?, source_type = ?, fixed_account_id = ?, is_active = ?, is_default = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(transactionCategoryId, label, side, sourceType, fixedAccountId, isActive, isDefault, sortOrder, id, store.id).run();
    return json({ ok: true });
  }
  const nextId = `jrule_${store.id}_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO journal_rules (
      id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, is_active, is_default, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(nextId, store.id, transactionCategoryId, label, side, sourceType, fixedAccountId, isActive, isDefault, sortOrder).run();
  return json({ ok: true, id: nextId }, 201);
}

export async function handleAccountingSettingsApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/settings/accounting')) return null;
  const ctx = await managementContext(request, env);
  if (!ctx.ok) return ctx.response;
  const { store } = ctx;

  if (request.method === 'GET' && pathname === '/api/admin/settings/accounting') {
    return json(await getAccountingSettingsBootstrap(env.DB, store));
  }

  const accountMaintenancePath = pathname === '/api/admin/settings/accounting/accounts'
    || /^\/api\/admin\/settings\/accounting\/accounts\/[^/]+$/.test(pathname);
  if (accountMaintenancePath) {
    return json({
      error: 'Pembuatan dan pemeliharaan akun dimiliki modul Akuntansi. Setting Akuntansi hanya membaca akun untuk mapping.',
      code: 'ACCOUNT_MAINTENANCE_OWNED_BY_ACCOUNTING'
    }, 405);
  }

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload Accounting Settings tidak valid.' }, 400);

  if (request.method === 'POST' && pathname === '/api/admin/settings/accounting/payment-methods') return savePaymentMethod(env.DB, store, body.value);
  const paymentMatch = pathname.match(/^\/api\/admin\/settings\/accounting\/payment-methods\/([^/]+)$/);
  if (request.method === 'PATCH' && paymentMatch) return savePaymentMethod(env.DB, store, body.value, decodeURIComponent(paymentMatch[1]));

  if (request.method === 'POST' && pathname === '/api/admin/settings/accounting/item-categories') return saveItemCategory(env.DB, store, body.value);
  const itemCategoryMatch = pathname.match(/^\/api\/admin\/settings\/accounting\/item-categories\/([^/]+)$/);
  if (request.method === 'PATCH' && itemCategoryMatch) return saveItemCategory(env.DB, store, body.value, decodeURIComponent(itemCategoryMatch[1]));

  if (request.method === 'POST' && pathname === '/api/admin/settings/accounting/transaction-categories') return saveTransactionCategory(env.DB, store, body.value);
  const transactionMatch = pathname.match(/^\/api\/admin\/settings\/accounting\/transaction-categories\/([^/]+)$/);
  if (request.method === 'PATCH' && transactionMatch) return saveTransactionCategory(env.DB, store, body.value, decodeURIComponent(transactionMatch[1]));

  if (request.method === 'POST' && pathname === '/api/admin/settings/accounting/journal-rules') return saveJournalRule(env.DB, store, body.value);
  const ruleMatch = pathname.match(/^\/api\/admin\/settings\/accounting\/journal-rules\/([^/]+)$/);
  if (request.method === 'PATCH' && ruleMatch) return saveJournalRule(env.DB, store, body.value, decodeURIComponent(ruleMatch[1]));

  return json({ error: 'Route Accounting Settings tidak ditemukan.' }, 404);
}
