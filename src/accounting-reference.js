import { json } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';

export const ACCOUNTING_REFERENCE_CONTRACT = 'MAXI_ACCOUNTING_REFERENCE_V1';

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

export async function listAccountingAccountRefs(db, storeId) {
  const rows = await db.prepare(`
    SELECT id, code, name, account_type, is_postable, external_account_id,
           sync_status, is_active
    FROM accounting_account_refs
    WHERE store_id = ?
    ORDER BY
      CASE account_type
        WHEN 'ASSET' THEN 1
        WHEN 'LIABILITY' THEN 2
        WHEN 'EQUITY' THEN 3
        WHEN 'REVENUE' THEN 4
        WHEN 'EXPENSE' THEN 5
        ELSE 9
      END,
      code
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    id: row.id,
    code: row.code,
    name: row.name,
    accountType: row.account_type,
    isPostable: Boolean(row.is_postable),
    externalAccountId: row.external_account_id || null,
    syncStatus: row.sync_status || 'PROVISIONAL',
    isActive: Boolean(row.is_active)
  }));
}

export async function resolveProductAccountingRefs(db, storeId, value = {}) {
  const requested = {
    salesAccountRefId: value?.salesAccountRefId ? String(value.salesAccountRefId) : null,
    inventoryAccountRefId: value?.inventoryAccountRefId ? String(value.inventoryAccountRefId) : null,
    cogsAccountRefId: value?.cogsAccountRefId ? String(value.cogsAccountRefId) : null
  };
  const ids = [...new Set(Object.values(requested).filter(Boolean))];
  if (!ids.length) return { ok: true, ...requested };

  const placeholders = ids.map(() => '?').join(', ');
  const rows = await db.prepare(`
    SELECT id, account_type, is_active
    FROM accounting_account_refs
    WHERE store_id = ? AND id IN (${placeholders})
  `).bind(storeId, ...ids).all();
  const byId = new Map((rows.results ?? []).map(row => [row.id, row]));

  const checks = [
    ['salesAccountRefId', 'REVENUE', 'Akun penjualan'],
    ['inventoryAccountRefId', 'ASSET', 'Akun persediaan'],
    ['cogsAccountRefId', 'EXPENSE', 'Akun HPP']
  ];
  for (const [field, expectedType, label] of checks) {
    const id = requested[field];
    if (!id) continue;
    const account = byId.get(id);
    if (!account || !account.is_active || account.account_type !== expectedType) {
      return { ok: false, error: `${label} tidak valid untuk gerai ini.` };
    }
  }
  return { ok: true, ...requested };
}

export function productAccountingRefStatement(db, storeId, productId, refs) {
  return db.prepare(`
    INSERT INTO product_accounting_refs (
      store_id, product_id, sales_account_ref_id, inventory_account_ref_id,
      cogs_account_ref_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(store_id, product_id) DO UPDATE SET
      sales_account_ref_id = excluded.sales_account_ref_id,
      inventory_account_ref_id = excluded.inventory_account_ref_id,
      cogs_account_ref_id = excluded.cogs_account_ref_id,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    storeId,
    productId,
    refs.salesAccountRefId,
    refs.inventoryAccountRefId,
    refs.cogsAccountRefId
  );
}

export async function handleAccountingReferenceApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/accounting/reference')) return null;
  if (request.method !== 'GET') return json({ error: 'Portal referensi Accounting saat ini read-only.' }, 405);

  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (pathname === '/api/admin/accounting/reference/accounts') {
    return json({
      contract: ACCOUNTING_REFERENCE_CONTRACT,
      sourceProgram: 'PROTOTYPE_LEKER',
      accountingOwner: 'ACCOUNTING_MODULE',
      syncStatus: 'PROVISIONAL',
      store,
      accounts: await listAccountingAccountRefs(env.DB, store.id)
    });
  }

  return json({ error: 'Route referensi Accounting tidak ditemukan.' }, 404);
}
