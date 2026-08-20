import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { listProductKinds } from './product-kinds.js';

export const ACCOUNT_TYPES = Object.freeze(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);
export const JOURNAL_SIDES = Object.freeze(['DEBIT', 'CREDIT']);
export const JOURNAL_SOURCE_TYPES = Object.freeze([
  'fixed_account',
  'choice_group',
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

function choiceCodeText(value, max = 48) {
  return text(value, max)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
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

async function paymentMethodDefaultsAvailable(db) {
  const schema = await db.prepare(`PRAGMA table_info(payment_methods)`).bind().all();
  return (schema.results ?? []).some(column => column.name === 'is_default');
}

async function listPaymentMethods(db, storeId) {
  const hasConfiguredDefault = await paymentMethodDefaultsAvailable(db);
  const defaultSelect = hasConfiguredDefault ? 'p.is_default' : `CASE WHEN p.code = 'CASH' THEN 1 ELSE 0 END AS is_default`;
  const rows = await db.prepare(`
    SELECT p.id, p.code, p.name, p.account_id, p.is_active, ${defaultSelect},
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
    isActive: Boolean(row.is_active),
    isDefault: Boolean(row.is_default)
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

async function listChoiceGroups(db, storeId) {
  const [groups, options, usages] = await db.batch([
    db.prepare(`
      SELECT g.id, g.code, g.name, g.is_active,
             (SELECT COUNT(*) FROM accounting_journal_lines l
              WHERE l.store_id = g.store_id AND l.choice_group_code = g.code) AS journal_line_count
      FROM accounting_choice_groups g
      WHERE g.store_id = ?
      ORDER BY g.name COLLATE NOCASE, g.code
    `).bind(storeId),
    db.prepare(`
      SELECT o.id, o.choice_group_id, o.code, o.name, o.account_id,
             o.is_default, o.sort_order, o.is_active,
             a.code AS account_code, a.name AS account_name, a.type AS account_type,
             a.is_active AS account_active, g.code AS group_code,
             (SELECT COUNT(*) FROM accounting_journal_lines l
              WHERE l.store_id = o.store_id
                AND l.choice_group_code = g.code
                AND l.choice_option_code = o.code) AS journal_line_count
      FROM accounting_choice_options o
      JOIN accounting_choice_groups g
        ON g.id = o.choice_group_id AND g.store_id = o.store_id
      LEFT JOIN chart_of_accounts a
        ON a.id = o.account_id AND a.store_id = o.store_id
      WHERE o.store_id = ?
      ORDER BY o.choice_group_id, o.sort_order, o.name COLLATE NOCASE, o.code
    `).bind(storeId),
    db.prepare(`
      SELECT r.choice_group_id, c.id AS category_id, c.code AS category_code,
             c.name AS category_name, r.side
      FROM journal_rules r
      JOIN transaction_categories c
        ON c.id = r.transaction_category_id AND c.store_id = r.store_id
      WHERE r.store_id = ?
        AND r.source_type = 'choice_group'
        AND r.is_active = 1
      ORDER BY c.name COLLATE NOCASE, r.side, r.id
    `).bind(storeId)
  ]);

  const optionsByGroup = new Map();
  for (const row of options.results ?? []) {
    if (!optionsByGroup.has(row.choice_group_id)) optionsByGroup.set(row.choice_group_id, []);
    optionsByGroup.get(row.choice_group_id).push({
      id: row.id,
      code: row.code,
      name: row.name,
      accountId: row.account_id || null,
      account: row.account_id ? {
        id: row.account_id,
        code: row.account_code || '',
        name: row.account_name || '',
        type: row.account_type || '',
        isActive: Boolean(row.account_active)
      } : null,
      accountingReady: Boolean(row.account_id && row.account_active),
      isDefault: Boolean(row.is_default),
      sortOrder: Number(row.sort_order || 0),
      isActive: Boolean(row.is_active),
      journalLineCount: Number(row.journal_line_count || 0)
    });
  }

  const usageByGroup = new Map();
  for (const row of usages.results ?? []) {
    if (!usageByGroup.has(row.choice_group_id)) usageByGroup.set(row.choice_group_id, []);
    usageByGroup.get(row.choice_group_id).push({
      id: row.category_id,
      code: row.category_code,
      name: row.category_name,
      side: row.side
    });
  }

  return (groups.results ?? []).map(row => {
    const groupOptions = optionsByGroup.get(row.id) ?? [];
    const activeOptions = groupOptions.filter(option => option.isActive);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      isActive: Boolean(row.is_active),
      accountingReady: activeOptions.length > 0 && activeOptions.every(option => option.accountingReady),
      usedByCategories: usageByGroup.get(row.id) ?? [],
      journalLineCount: Number(row.journal_line_count || 0),
      options: groupOptions
    };
  });
}

// What the POS→Accounting resolver actually needs before a fact of this category
// can produce a journal.
//
// Having one active Debit rule and one active Credit rule is necessary but far
// from sufficient: a rule sourced from a payment method still needs that payment
// method linked to an account, and a rule sourced from Jenis Barang still needs
// the kind mapped and the product carrying a kind at all. Reporting COMPLETE on
// the rule shape alone told admins their setup was done while every sale failed
// closed — silently, because the failure only appeared at posting time.
async function postingBlockers(db, storeId) {
  const [payments, unmappedKinds, kindsMissingRevenue, kindlessProducts, choiceGroups] = await db.batch([
    db.prepare(`
      SELECT code FROM payment_methods
      WHERE store_id = ? AND is_active = 1 AND (account_id IS NULL OR account_id = '')
      ORDER BY code
    `).bind(storeId),
    db.prepare(`
      SELECT DISTINCT k.code AS code
      FROM products p
      JOIN product_kinds k ON k.id = p.product_kind_id AND k.store_id = p.store_id
      WHERE p.store_id = ? AND p.is_active = 1
        AND NOT EXISTS (
          SELECT 1 FROM item_categories c
          WHERE c.store_id = p.store_id AND c.product_kind_id = p.product_kind_id AND c.is_active = 1
        )
      ORDER BY k.code
    `).bind(storeId),
    db.prepare(`
      SELECT DISTINCT k.code AS code
      FROM item_categories c
      JOIN product_kinds k ON k.id = c.product_kind_id AND k.store_id = c.store_id
      WHERE c.store_id = ? AND c.is_active = 1
        AND (c.revenue_account_id IS NULL OR c.revenue_account_id = '')
      ORDER BY k.code
    `).bind(storeId),
    db.prepare(`
      SELECT COUNT(*) AS count FROM products
      WHERE store_id = ? AND is_active = 1 AND (product_kind_id IS NULL OR product_kind_id = '')
    `).bind(storeId),
    db.prepare(`
      SELECT r.id AS rule_id, r.transaction_category_id,
             COALESCE(g.code, '') AS group_code,
             CASE WHEN g.id IS NOT NULL AND g.is_active = 1 THEN 1 ELSE 0 END AS group_active,
             SUM(CASE WHEN o.id IS NOT NULL AND o.is_active = 1 THEN 1 ELSE 0 END) AS active_option_count,
             SUM(CASE WHEN o.id IS NOT NULL AND o.is_active = 1
                       AND (o.account_id IS NULL OR a.id IS NULL) THEN 1 ELSE 0 END) AS unmapped_option_count
      FROM journal_rules r
      LEFT JOIN accounting_choice_groups g
        ON g.id = r.choice_group_id AND g.store_id = r.store_id
      LEFT JOIN accounting_choice_options o
        ON o.choice_group_id = g.id AND o.store_id = g.store_id
      LEFT JOIN chart_of_accounts a
        ON a.id = o.account_id AND a.store_id = o.store_id AND a.is_active = 1
      WHERE r.store_id = ? AND r.is_active = 1 AND r.source_type = 'choice_group'
      GROUP BY r.id, r.transaction_category_id, g.id, g.code, g.is_active
      ORDER BY r.transaction_category_id, r.id
    `).bind(storeId)
  ]);
  return {
    unmappedPaymentMethods: (payments.results ?? []).map(row => row.code),
    unmappedProductKinds: (unmappedKinds.results ?? []).map(row => row.code),
    productKindsWithoutRevenue: (kindsMissingRevenue.results ?? []).map(row => row.code),
    productsWithoutKind: Number((kindlessProducts.results ?? [])[0]?.count || 0),
    choiceGroups: (choiceGroups.results ?? []).map(row => ({
      ruleId: row.rule_id,
      transactionCategoryId: row.transaction_category_id,
      groupCode: row.group_code || '',
      groupActive: Boolean(row.group_active),
      activeOptionCount: Number(row.active_option_count || 0),
      unmappedOptionCount: Number(row.unmapped_option_count || 0)
    }))
  };
}

// Blockers are matched to a category by the source types its own active rules
// use, rather than hard-coded per category code, so a category configured
// differently is judged by what it actually asks the resolver to do.
function blockersForCategory(activeRules, facts, transactionCategoryId) {
  const sourceTypes = new Set(activeRules.map(rule => rule.sourceType));
  const blockers = [];

  if (sourceTypes.has('payment_method') && facts.unmappedPaymentMethods.length) {
    blockers.push({
      code: 'PAYMENT_METHOD_UNMAPPED',
      detail: `Cara bayar belum dilink ke akun: ${facts.unmappedPaymentMethods.join(', ')}.`
    });
  }

  const usesItemCategory = [...sourceTypes].some(type => String(type).startsWith('item_category_'));
  if (usesItemCategory) {
    if (facts.productsWithoutKind > 0) {
      blockers.push({
        code: 'PRODUCT_WITHOUT_KIND',
        detail: `${facts.productsWithoutKind} barang aktif belum punya Jenis Barang.`
      });
    }
    if (facts.unmappedProductKinds.length) {
      blockers.push({
        code: 'PRODUCT_KIND_UNMAPPED',
        detail: `Jenis Barang belum dipetakan ke akun: ${facts.unmappedProductKinds.join(', ')}.`
      });
    }
  }
  if (sourceTypes.has('item_category_revenue') && facts.productKindsWithoutRevenue.length) {
    blockers.push({
      code: 'PRODUCT_KIND_REVENUE_UNMAPPED',
      detail: `Jenis Barang belum punya akun Pendapatan: ${facts.productKindsWithoutRevenue.join(', ')}.`
    });
  }

  for (const issue of facts.choiceGroups.filter(item => item.transactionCategoryId === transactionCategoryId)) {
    if (!issue.groupActive) {
      blockers.push({ code: 'NEEDS_CHOICE_GROUP', detail: 'Setting Transaksi yang dipasang tidak aktif / tidak ditemukan.' });
      continue;
    }
    if (issue.activeOptionCount === 0) {
      blockers.push({ code: 'CHOICE_GROUP_EMPTY', detail: `Setting Transaksi ${issue.groupCode} belum punya pilihan aktif.` });
      continue;
    }
    if (issue.unmappedOptionCount > 0) {
      blockers.push({
        code: 'NEEDS_CHOICE_ACCOUNT',
        detail: `Setting Transaksi ${issue.groupCode} punya ${issue.unmappedOptionCount} pilihan aktif tanpa akun Accounting aktif.`
      });
    }
  }
  return blockers;
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
             r.fixed_account_id, r.choice_group_id, r.is_active, r.is_default, r.sort_order,
             a.code AS fixed_account_code, a.name AS fixed_account_name,
             g.code AS choice_group_code, g.name AS choice_group_name, g.is_active AS choice_group_active
      FROM journal_rules r
      LEFT JOIN chart_of_accounts a ON a.id = r.fixed_account_id AND a.store_id = r.store_id
      LEFT JOIN accounting_choice_groups g ON g.id = r.choice_group_id AND g.store_id = r.store_id
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
      choiceGroupId: row.choice_group_id || null,
      choiceGroup: row.choice_group_id ? {
        code: row.choice_group_code || '',
        name: row.choice_group_name || '',
        isActive: Boolean(row.choice_group_active)
      } : null,
      isActive: Boolean(row.is_active),
      isDefault: Boolean(row.is_default),
      sortOrder: Number(row.sort_order || 0)
    });
  }
  const facts = await postingBlockers(db, storeId);
  return (categories.results ?? []).map(row => {
    const categoryRules = grouped.get(row.id) ?? [];
    const active = categoryRules.filter(rule => rule.isActive);
    const debitCount = active.filter(rule => rule.side === 'DEBIT').length;
    const creditCount = active.filter(rule => rule.side === 'CREDIT').length;
    const hasBothSides = debitCount >= 1 && creditCount >= 1;
    const blockers = hasBothSides
      ? blockersForCategory(active, facts, row.id)
      : [{ code: 'NO_ACTIVE_DEBIT_CREDIT', detail: 'Butuh minimal satu rule Debit dan satu rule Kredit aktif.' }];
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      involvesPayment: Boolean(row.involves_payment),
      involvesItemCategory: Boolean(row.involves_item_category),
      isActive: Boolean(row.is_active),
      description: row.description || '',
      registeredByModule: row.registered_by_module || 'ACCOUNTING',
      // COMPLETE now means "a fact of this category can actually post", not
      // merely "the rules have two sides".
      completeness: blockers.length === 0 ? 'COMPLETE' : 'INCOMPLETE',
      blockers,
      debitCount,
      creditCount,
      rules: categoryRules
    };
  });
}

export async function getAccountingSettingsBootstrap(db, store) {
  const [accounts, paymentMethods, itemCategories, transactionCategories, productKinds, choiceGroups] = await Promise.all([
    listAccounts(db, store.id),
    listPaymentMethods(db, store.id),
    listItemCategories(db, store.id),
    listTransactionCategories(db, store.id),
    listProductKinds(db, store.id),
    listChoiceGroups(db, store.id)
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
    choiceGroups,
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
  const isDefault = body?.isDefault === undefined ? Number(current?.is_default ?? 0) : flag(body.isDefault);
  if (!code || !name) return json({ error: 'Kode dan nama metode pembayaran wajib valid.' }, 400);
  if (accountId && !await activeAccount(db, store.id, accountId)) return json({ error: 'Akun metode pembayaran harus akun aktif di gerai ini.' }, 400);
  if (isDefault && !isActive) return json({ error: 'Cara bayar default harus aktif.' }, 400);
  if (current?.is_default && !isDefault) return json({ error: 'Pilih cara bayar lain sebagai default sebelum melepas default ini.' }, 400);
  if (isDefault) {
    await db.prepare(`UPDATE payment_methods SET is_default = 0, updated_at = CURRENT_TIMESTAMP WHERE store_id = ? AND id <> ?`).bind(store.id, id || '').run();
  }
  if (current) {
    await db.prepare(`UPDATE payment_methods SET name = ?, account_id = ?, is_active = ?, is_default = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?`)
      .bind(name, accountId, isActive, isDefault, id, store.id).run();
    return json({ ok: true });
  }
  const nextId = `payment_${store.id}_${crypto.randomUUID()}`;
  try {
    await db.prepare(`INSERT INTO payment_methods (id, store_id, code, name, account_id, is_active, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(nextId, store.id, code, name, accountId, isActive, isDefault).run();
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

async function choiceGroupUsage(db, storeId, groupId) {
  const rows = await db.prepare(`
    SELECT c.id, c.code, c.name, r.side
    FROM journal_rules r
    JOIN transaction_categories c
      ON c.id = r.transaction_category_id AND c.store_id = r.store_id
    WHERE r.store_id = ? AND r.choice_group_id = ?
      AND r.source_type = 'choice_group' AND r.is_active = 1
    ORDER BY c.code, r.side, r.id
  `).bind(storeId, groupId).all();
  return rows.results ?? [];
}

async function choiceGroupAccountingReadiness(db, storeId, groupId, categoryCode = '') {
  const group = await db.prepare(`
    SELECT id, code, name
    FROM accounting_choice_groups
    WHERE id = ? AND store_id = ? AND is_active = 1
    LIMIT 1
  `).bind(groupId, storeId).first();
  if (!group) return { ok: false, code: 'NEEDS_CHOICE_GROUP', error: 'Setting Transaksi tidak aktif / tidak ditemukan.' };

  const rows = await db.prepare(`
    SELECT o.id, o.code, o.name, o.account_id,
           a.id AS active_account_id, a.type AS account_type
    FROM accounting_choice_options o
    LEFT JOIN chart_of_accounts a
      ON a.id = o.account_id AND a.store_id = o.store_id AND a.is_active = 1
    WHERE o.store_id = ? AND o.choice_group_id = ? AND o.is_active = 1
    ORDER BY o.sort_order, o.code, o.id
  `).bind(storeId, groupId).all();
  const options = rows.results ?? [];
  if (!options.length) return { ok: false, code: 'CHOICE_GROUP_EMPTY', error: 'Setting Transaksi belum punya pilihan aktif.' };
  if (options.some(row => !row.account_id || !row.active_account_id)) {
    return { ok: false, code: 'NEEDS_CHOICE_ACCOUNT', error: 'Semua pilihan aktif wajib dilink ke akun aktif sebelum grup dipasang ke Akuntansi.' };
  }
  if (['wh_transfer', 'wh_production'].includes(categoryCode)
      && options.some(row => ['REVENUE', 'EXPENSE'].includes(row.account_type))) {
    return { ok: false, error: 'Transfer/Produksi tidak boleh memakai akun Pendapatan atau Beban.' };
  }
  return { ok: true, group, options };
}

async function saveChoiceGroup(db, store, body, id = null) {
  const current = id ? await db.prepare(`SELECT * FROM accounting_choice_groups WHERE id = ? AND store_id = ?`).bind(id, store.id).first() : null;
  if (id && !current) return json({ error: 'Setting Transaksi tidak ditemukan.' }, 404);
  const code = current?.code || choiceCodeText(body?.code || body?.name);
  const name = text(body?.name ?? current?.name, 100);
  const isActive = body?.isActive === undefined ? Number(current?.is_active ?? 1) : flag(body.isActive);
  if (!code || !name) return json({ error: 'Nama Setting Transaksi wajib valid.' }, 400);
  if (!isActive && Number(current?.is_active || 0) === 1 && (await choiceGroupUsage(db, store.id, id)).length) {
    return json({ error: 'Setting Transaksi masih dipasang ke aturan Akuntansi aktif. Lepas/nonaktifkan rule terkait lebih dulu.' }, 409);
  }
  if (current) {
    await db.prepare(`
      UPDATE accounting_choice_groups
      SET name = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(name, isActive, id, store.id).run();
    return json({ ok: true, id, code: current.code });
  }
  const nextId = `choice_group_${store.id}_${crypto.randomUUID()}`;
  try {
    await db.prepare(`
      INSERT INTO accounting_choice_groups (id, store_id, code, name, is_active)
      VALUES (?, ?, ?, ?, ?)
    `).bind(nextId, store.id, code, name, isActive).run();
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) return json({ error: 'Kode Setting Transaksi sudah dipakai.' }, 409);
    throw error;
  }
  return json({ ok: true, id: nextId, code }, 201);
}

async function saveChoiceOption(db, store, body, id = null) {
  const current = id ? await db.prepare(`SELECT * FROM accounting_choice_options WHERE id = ? AND store_id = ?`).bind(id, store.id).first() : null;
  if (id && !current) return json({ error: 'Pilihan Setting Transaksi tidak ditemukan.' }, 404);
  const choiceGroupId = current?.choice_group_id || text(body?.choiceGroupId, 180);
  const group = await db.prepare(`SELECT id, code FROM accounting_choice_groups WHERE id = ? AND store_id = ?`).bind(choiceGroupId, store.id).first();
  if (!group) return json({ error: 'Setting Transaksi induk tidak ditemukan.' }, 400);

  const code = current?.code || choiceCodeText(body?.code || body?.name);
  const name = text(body?.name ?? current?.name, 100);
  const accountId = body?.accountId === undefined ? (current?.account_id || null) : (text(body.accountId, 180) || null);
  const isActive = body?.isActive === undefined ? Number(current?.is_active ?? 1) : flag(body.isActive);
  const isDefault = body?.isDefault === undefined ? Number(current?.is_default ?? 0) : flag(body.isDefault);
  const sortOrder = Number.isInteger(Number(body?.sortOrder ?? current?.sort_order ?? 0)) ? Number(body?.sortOrder ?? current?.sort_order ?? 0) : 0;
  if (!code || !name) return json({ error: 'Nama pilihan wajib valid.' }, 400);
  if (isDefault && !isActive) return json({ error: 'Pilihan default harus aktif.' }, 400);

  const account = accountId ? await activeAccount(db, store.id, accountId) : null;
  if (accountId && !account) return json({ error: 'Akun pilihan harus akun aktif di gerai ini.' }, 400);
  const usages = await choiceGroupUsage(db, store.id, choiceGroupId);
  if (usages.length && isActive && !accountId) {
    return json({ error: 'Pilihan aktif boleh tanpa akun selama grup masih generic. Grup ini sudah terhubung ke Akuntansi, jadi akun wajib dilink.', code: 'NEEDS_CHOICE_ACCOUNT' }, 409);
  }
  if (usages.some(row => ['wh_transfer', 'wh_production'].includes(row.code))
      && isActive && account && ['REVENUE', 'EXPENSE'].includes(account.type)) {
    return json({ error: 'Transfer/Produksi tidak boleh memakai akun Pendapatan atau Beban.' }, 409);
  }
  if (!isActive && Number(current?.is_active || 0) === 1 && usages.length) {
    const count = await db.prepare(`
      SELECT COUNT(*) AS count
      FROM accounting_choice_options
      WHERE store_id = ? AND choice_group_id = ? AND is_active = 1
    `).bind(store.id, choiceGroupId).first();
    if (Number(count?.count || 0) <= 1) {
      return json({ error: 'Pilihan aktif terakhir tidak bisa dinonaktifkan selama grup masih dipasang ke Akuntansi.' }, 409);
    }
  }

  if (isDefault) {
    await db.prepare(`
      UPDATE accounting_choice_options
      SET is_default = 0, updated_at = CURRENT_TIMESTAMP
      WHERE store_id = ? AND choice_group_id = ? AND id <> ?
    `).bind(store.id, choiceGroupId, id || '').run();
  }
  if (current) {
    await db.prepare(`
      UPDATE accounting_choice_options
      SET name = ?, account_id = ?, is_default = ?, sort_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(name, accountId, isDefault, sortOrder, isActive, id, store.id).run();
    return json({ ok: true, id, code: current.code });
  }

  const nextId = `choice_option_${store.id}_${crypto.randomUUID()}`;
  try {
    await db.prepare(`
      INSERT INTO accounting_choice_options (
        id, choice_group_id, store_id, code, name, account_id, is_default, sort_order, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(nextId, choiceGroupId, store.id, code, name, accountId, isDefault, sortOrder, isActive).run();
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) return json({ error: 'Kode pilihan sudah dipakai dalam grup ini.' }, 409);
    throw error;
  }
  return json({ ok: true, id: nextId, code }, 201);
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
  const category = await db.prepare(`SELECT id, code FROM transaction_categories WHERE id = ? AND store_id = ?`).bind(transactionCategoryId, store.id).first();
  if (!category) return json({ error: 'Kategori transaksi tidak ditemukan.' }, 400);
  const label = text(body?.label ?? current?.label, 140);
  const side = text(body?.side ?? current?.side, 12).toUpperCase();
  const sourceType = text(body?.sourceType ?? current?.source_type, 60);
  const fixedAccountId = sourceType === 'fixed_account'
    ? (text(body?.fixedAccountId ?? current?.fixed_account_id, 180) || null)
    : null;
  const choiceGroupId = sourceType === 'choice_group'
    ? (text(body?.choiceGroupId ?? current?.choice_group_id, 180) || null)
    : null;
  const isActive = body?.isActive === undefined ? Number(current?.is_active ?? 1) : flag(body.isActive);
  const isDefault = sourceType === 'fixed_account'
    ? (body?.isDefault === undefined ? Number(current?.is_default ?? 0) : flag(body.isDefault))
    : 0;
  const sortOrder = Number.isInteger(Number(body?.sortOrder ?? current?.sort_order ?? 0)) ? Number(body?.sortOrder ?? current?.sort_order ?? 0) : 0;
  if (!label || !JOURNAL_SIDES.includes(side) || !JOURNAL_SOURCE_TYPES.includes(sourceType)) {
    return json({ error: 'Label, sisi, atau source type journal rule tidak valid.' }, 400);
  }
  if (sourceType === 'fixed_account' && !await activeAccount(db, store.id, fixedAccountId)) {
    return json({ error: 'Fixed account wajib akun aktif di gerai ini.' }, 400);
  }
  if (sourceType === 'choice_group' && isActive) {
    const readiness = await choiceGroupAccountingReadiness(db, store.id, choiceGroupId, category.code);
    if (!readiness.ok) return json({ error: readiness.error, ...(readiness.code ? { code: readiness.code } : {}) }, 409);
  }
  if (isDefault) {
    await db.prepare(`
      UPDATE journal_rules
      SET is_default = 0, updated_at = CURRENT_TIMESTAMP
      WHERE store_id = ? AND transaction_category_id = ?
        AND source_type = 'fixed_account' AND id <> ?
    `).bind(store.id, transactionCategoryId, id || '').run();
  }
  if (current) {
    await db.prepare(`
      UPDATE journal_rules
      SET transaction_category_id = ?, label = ?, side = ?, source_type = ?,
          fixed_account_id = ?, choice_group_id = ?, is_active = ?, is_default = ?,
          sort_order = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(
      transactionCategoryId, label, side, sourceType, fixedAccountId, choiceGroupId,
      isActive, isDefault, sortOrder, id, store.id
    ).run();
    return json({ ok: true, id });
  }
  const nextId = `jrule_${store.id}_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO journal_rules (
      id, store_id, transaction_category_id, label, side, source_type,
      fixed_account_id, choice_group_id, is_active, is_default, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    nextId, store.id, transactionCategoryId, label, side, sourceType,
    fixedAccountId, choiceGroupId, isActive, isDefault, sortOrder
  ).run();
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

  if (request.method === 'POST' && pathname === '/api/admin/settings/accounting/choice-groups') return saveChoiceGroup(env.DB, store, body.value);
  const choiceGroupMatch = pathname.match(/^\/api\/admin\/settings\/accounting\/choice-groups\/([^/]+)$/);
  if (request.method === 'PATCH' && choiceGroupMatch) return saveChoiceGroup(env.DB, store, body.value, decodeURIComponent(choiceGroupMatch[1]));

  if (request.method === 'POST' && pathname === '/api/admin/settings/accounting/choice-options') return saveChoiceOption(env.DB, store, body.value);
  const choiceOptionMatch = pathname.match(/^\/api\/admin\/settings\/accounting\/choice-options\/([^/]+)$/);
  if (request.method === 'PATCH' && choiceOptionMatch) return saveChoiceOption(env.DB, store, body.value, decodeURIComponent(choiceOptionMatch[1]));

  if (request.method === 'POST' && pathname === '/api/admin/settings/accounting/transaction-categories') return saveTransactionCategory(env.DB, store, body.value);
  const transactionMatch = pathname.match(/^\/api\/admin\/settings\/accounting\/transaction-categories\/([^/]+)$/);
  if (request.method === 'PATCH' && transactionMatch) return saveTransactionCategory(env.DB, store, body.value, decodeURIComponent(transactionMatch[1]));

  if (request.method === 'POST' && pathname === '/api/admin/settings/accounting/journal-rules') return saveJournalRule(env.DB, store, body.value);
  const ruleMatch = pathname.match(/^\/api\/admin\/settings\/accounting\/journal-rules\/([^/]+)$/);
  if (request.method === 'PATCH' && ruleMatch) return saveJournalRule(env.DB, store, body.value, decodeURIComponent(ruleMatch[1]));

  return json({ error: 'Route Accounting Settings tidak ditemukan.' }, 404);
}
