import { requireCashier } from './cashier-auth.js';
import { requireDrawerOwner } from './cashier-drawer.js';
import { postVoucherRedemptionJournal } from './accounting-voucher-bridge.js';
import { resolveCustomerScope } from './customer-sharing.js';
import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { prepareSaleStockProduction, stockPostingFailure } from './stock-production.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getJakartaBusinessDate } from './time.js';

const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const placeholders = count => Array.from({ length: count }, () => '?').join(', ');
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
  const normalized = text(value, 10);
  if (!DATE_PATTERN.test(normalized)) return '';
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== normalized ? '' : normalized;
}

function actorFromManagement(auth) {
  if (auth.owner) return { role: 'OWNER', id: auth.owner.id };
  if (auth.entityAdmin) return { role: 'ENTITY_ADMIN', id: auth.entityAdmin.id };
  if (auth.admin) return { role: 'ADMIN', id: auth.admin.id };
  return { role: 'LEGACY_PIN', id: 'legacy-pin' };
}

function voucherStatus(row, businessDate) {
  if (row.status !== 'UNUSED') return row.status;
  if (businessDate > row.active_until) return 'EXPIRED';
  if (Number(row.redeemed_count) >= Number(row.usage_quota)) return 'QUOTA_EXHAUSTED';
  return 'UNUSED';
}

function mapMaster(row, products = []) {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    activeFrom: row.active_from,
    activeUntil: row.active_until,
    usageQuota: Number(row.usage_quota),
    redeemedCount: Number(row.redeemed_count),
    isActive: Boolean(row.is_active),
    createdByRole: row.created_by_role,
    createdById: row.created_by_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    products
  };
}

function mapInstance(row, products, businessDate) {
  return {
    id: row.id,
    code: row.code,
    masterId: row.voucher_master_id,
    masterName: row.master_name,
    customerId: row.customer_id,
    customerName: row.customer_name_snapshot,
    customerStoreId: row.store_id,
    distributedStoreId: row.distributed_store_id,
    distributedByCashierId: row.distributed_by_cashier_id,
    distributedAt: row.distributed_at,
    redeemedAt: row.redeemed_at || null,
    activeFrom: row.active_from,
    activeUntil: row.active_until,
    usageQuota: Number(row.usage_quota),
    redeemedCount: Number(row.redeemed_count),
    status: voucherStatus(row, businessDate),
    products
  };
}

async function selectedAdminStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

async function availableProducts(db, storeId) {
  const rows = await db.prepare(`
    SELECT p.id, p.name, p.is_active, u.symbol AS unit_symbol
    FROM products p
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    WHERE p.store_id = ? AND p.is_active = 1
    ORDER BY p.display_order, p.name COLLATE NOCASE, p.id
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    id: Number(row.id),
    name: row.name,
    unitSymbol: row.unit_symbol || '',
    isActive: Boolean(row.is_active)
  }));
}

async function masterProducts(db, storeId, masterIds) {
  const grouped = new Map(masterIds.map(id => [id, []]));
  if (!masterIds.length) return grouped;
  const rows = await db.prepare(`
    SELECT vp.voucher_master_id, p.id, p.name, p.is_active, u.symbol AS unit_symbol
    FROM voucher_master_products vp
    JOIN products p ON p.id = vp.product_id AND p.store_id = vp.store_id
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    WHERE vp.store_id = ? AND vp.voucher_master_id IN (${placeholders(masterIds.length)})
    ORDER BY vp.sort_order, p.name COLLATE NOCASE, p.id
  `).bind(storeId, ...masterIds).all();
  for (const row of rows.results ?? []) {
    grouped.get(row.voucher_master_id)?.push({
      id: Number(row.id),
      name: row.name,
      unitSymbol: row.unit_symbol || '',
      isActive: Boolean(row.is_active)
    });
  }
  return grouped;
}

async function listMasters(db, storeId) {
  const rows = await db.prepare(`
    SELECT id, store_id, name, active_from, active_until, usage_quota,
           redeemed_count, is_active, created_by_role, created_by_id,
           created_at, updated_at
    FROM voucher_masters
    WHERE store_id = ?
    ORDER BY is_active DESC, active_until DESC, created_at DESC, id
  `).bind(storeId).all();
  const masterRows = rows.results ?? [];
  const products = await masterProducts(db, storeId, masterRows.map(row => row.id));
  return masterRows.map(row => mapMaster(row, products.get(row.id) ?? []));
}

function normalizeMasterPayload(payload, current = null) {
  const name = text(payload?.name ?? current?.name, 100);
  const activeFrom = validDate(payload?.activeFrom ?? current?.active_from);
  const activeUntil = validDate(payload?.activeUntil ?? current?.active_until);
  const usageQuota = Number(payload?.usageQuota ?? current?.usage_quota);
  const rawProductIds = payload?.productIds;
  const productIds = rawProductIds === undefined && current
    ? null
    : [...new Set((Array.isArray(rawProductIds) ? rawProductIds : []).map(Number))];
  const isActive = payload?.isActive === undefined ? Boolean(current?.is_active ?? true) : payload.isActive !== false;

  if (!name) return { ok: false, error: 'Nama Master Voucher wajib diisi.' };
  if (!activeFrom || !activeUntil || activeUntil < activeFrom) {
    return { ok: false, error: 'Rentang tanggal aktif Master Voucher tidak valid.' };
  }
  if (!Number.isSafeInteger(usageQuota) || usageQuota < 1 || usageQuota > 1_000_000_000) {
    return { ok: false, error: 'Kuota pemakaian wajib bilangan bulat positif.' };
  }
  if (current && usageQuota < Number(current.redeemed_count || 0)) {
    return { ok: false, status: 409, error: 'Kuota tidak boleh lebih kecil dari jumlah voucher yang sudah ditukar.' };
  }
  if (productIds !== null && (!productIds.length || productIds.length > 100 || productIds.some(id => !Number.isSafeInteger(id) || id < 1))) {
    return { ok: false, error: 'Pilih minimal satu barang valid dari Master Barang.' };
  }
  return { ok: true, value: { name, activeFrom, activeUntil, usageQuota, productIds, isActive } };
}

async function validateProductIds(db, storeId, productIds) {
  if (productIds === null) return true;
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM products p
    WHERE p.store_id = ? AND p.id IN (${placeholders(productIds.length)})
      AND p.is_active = 1
  `).bind(storeId, ...productIds).first();
  return Number(row?.count || 0) === productIds.length;
}

function replaceMasterProducts(db, masterId, storeId, productIds, now) {
  const statements = [db.prepare('DELETE FROM voucher_master_products WHERE voucher_master_id = ? AND store_id = ?').bind(masterId, storeId)];
  productIds.forEach((productId, index) => statements.push(db.prepare(`
    INSERT INTO voucher_master_products (voucher_master_id, store_id, product_id, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(masterId, storeId, productId, index, now)));
  return statements;
}

async function customerInScope(db, storeId, customerId) {
  const scope = await resolveCustomerScope(db, storeId);
  const customer = await db.prepare(`
    SELECT c.id, c.store_id, c.customer_name, c.is_active, s.entity_id
    FROM customers c
    JOIN stores s ON s.id = c.store_id
    WHERE c.id = ? AND c.store_id IN (${placeholders(scope.storeIds.length)})
      AND c.is_active = 1 AND s.is_active = 1
    LIMIT 1
  `).bind(customerId, ...scope.storeIds).first();
  return { customer, scope };
}

async function listCustomerVouchers(db, storeId, customerId, businessDate) {
  const rows = await db.prepare(`
    SELECT i.*, v.name AS master_name, v.active_from, v.active_until,
           v.usage_quota, v.redeemed_count, v.is_active
    FROM voucher_instances i
    JOIN voucher_masters v ON v.id = i.voucher_master_id AND v.store_id = i.master_store_id
    WHERE i.master_store_id = ? AND i.customer_id = ?
    ORDER BY CASE i.status WHEN 'UNUSED' THEN 0 ELSE 1 END, i.distributed_at DESC, i.id
  `).bind(storeId, customerId).all();
  const instanceRows = rows.results ?? [];
  const ids = [...new Set(instanceRows.map(row => row.voucher_master_id))];
  const products = await masterProducts(db, storeId, ids);
  return instanceRows.map(row => mapInstance(row, products.get(row.voucher_master_id) ?? [], businessDate));
}

async function distributableMasters(db, storeId, businessDate) {
  const masters = (await listMasters(db, storeId)).filter(master =>
    master.isActive
    && master.activeFrom <= businessDate
    && master.activeUntil >= businessDate
    && master.redeemedCount < master.usageQuota
  );
  return masters;
}

// Returns one canonical insert statement so callers can compose Voucher
// creation atomically with their own business fact (for example, one official
// Roda Puter spin) without copying Voucher identity/scope rules.
export async function prepareVoucherInstanceDistribution(db, {
  masterId,
  masterStoreId,
  customerId,
  distributedStoreId,
  distributedStoreCode,
  distributedByCashierId,
  businessDate,
  now = new Date().toISOString()
} = {}) {
  const normalizedMasterId = text(masterId, 180);
  const normalizedMasterStoreId = text(masterStoreId, 180);
  const normalizedCustomerId = text(customerId, 180);
  const normalizedDistributedStoreId = text(distributedStoreId, 180);
  const normalizedStoreCode = text(distributedStoreCode, 40).toUpperCase();
  const normalizedCashierId = text(distributedByCashierId, 180);
  const normalizedBusinessDate = validDate(businessDate);
  const normalizedNow = text(now, 40);
  if (
    !normalizedMasterId
    || !normalizedMasterStoreId
    || !normalizedCustomerId
    || !normalizedDistributedStoreId
    || !normalizedStoreCode
    || !normalizedCashierId
    || !normalizedBusinessDate
    || !normalizedNow
  ) {
    return { ok: false, status: 400, code: 'VOUCHER_DISTRIBUTION_FACT_INVALID', error: 'Fakta distribusi Voucher tidak lengkap atau tidak valid.' };
  }

  const [master, scoped] = await Promise.all([
    db.prepare(`
      SELECT id, store_id, name, active_from, active_until, usage_quota, redeemed_count, is_active
      FROM voucher_masters WHERE id = ? AND store_id = ? LIMIT 1
    `).bind(normalizedMasterId, normalizedMasterStoreId).first(),
    customerInScope(db, normalizedDistributedStoreId, normalizedCustomerId)
  ]);
  if (!master || !master.is_active) {
    return { ok: false, status: 404, code: 'VOUCHER_MASTER_UNAVAILABLE', error: 'Master Voucher tidak aktif atau bukan milik gerai distribusi.' };
  }
  if (master.store_id !== normalizedDistributedStoreId) {
    return { ok: false, status: 403, code: 'VOUCHER_DISTRIBUTION_STORE_MISMATCH', error: 'Master Voucher hanya boleh dibagikan oleh gerai pemiliknya.' };
  }
  if (!scoped.customer) {
    return { ok: false, status: 404, code: 'CUSTOMER_OUT_OF_SCOPE', error: 'Customer tidak ditemukan di jaringan berbagi pelanggan gerai ini.' };
  }
  if (
    normalizedBusinessDate < master.active_from
    || normalizedBusinessDate > master.active_until
    || Number(master.redeemed_count) >= Number(master.usage_quota)
  ) {
    return { ok: false, status: 409, code: 'VOUCHER_MASTER_UNAVAILABLE', error: 'Master Voucher belum aktif, kadaluarsa, atau kuotanya sudah habis.' };
  }

  const id = `voucher_${crypto.randomUUID()}`;
  const code = `VCR-${normalizedStoreCode}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
  return {
    ok: true,
    voucher: {
      id,
      code,
      masterId: master.id,
      masterName: master.name,
      masterStoreId: normalizedMasterStoreId,
      customerId: scoped.customer.id,
      customerName: scoped.customer.customer_name,
      customerStoreId: scoped.customer.store_id,
      entityId: scoped.customer.entity_id,
      distributedStoreId: normalizedDistributedStoreId,
      distributedByCashierId: normalizedCashierId,
      distributedAt: normalizedNow
    },
    statement: db.prepare(`
      INSERT INTO voucher_instances (
        id, code, voucher_master_id, master_store_id, store_id, entity_id,
        customer_id, customer_name_snapshot, distributed_store_id,
        distributed_by_cashier_id, status, distributed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNUSED', ?, ?)
    `).bind(
      id,
      code,
      master.id,
      normalizedMasterStoreId,
      scoped.customer.store_id,
      scoped.customer.entity_id,
      scoped.customer.id,
      scoped.customer.customer_name,
      normalizedDistributedStoreId,
      normalizedCashierId,
      normalizedNow,
      normalizedNow
    )
  };
}

function constraintResponse(error) {
  const message = String(error?.message ?? error).toLowerCase();
  if (message.includes('voucher_redemption_not_allowed')) {
    return json({ error: 'Voucher sudah dipakai, kadaluarsa, kuota habis, atau barang tidak diizinkan.', code: 'VOUCHER_NOT_REDEEMABLE' }, 409);
  }
  if (message.includes('unique') || message.includes('constraint')) {
    return json({ error: 'Voucher berubah atau sudah diproses oleh request lain.', code: 'VOUCHER_CONFLICT' }, 409);
  }
  return null;
}

async function handleAdminVoucherApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/vouchers')) return null;
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;
  const store = await selectedAdminStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (request.method === 'GET' && pathname === '/api/admin/vouchers') {
    return json({ store, products: await availableProducts(env.DB, store.id), vouchers: await listMasters(env.DB, store.id) });
  }

  if (request.method === 'POST' && pathname === '/api/admin/vouchers') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload Master Voucher tidak valid.' }, 400);
    const normalized = normalizeMasterPayload(body.value);
    if (!normalized.ok) return json({ error: normalized.error }, normalized.status || 400);
    if (!await validateProductIds(env.DB, store.id, normalized.value.productIds)) {
      return json({ error: 'Barang Voucher tidak ditemukan atau tidak aktif di gerai ini.', code: 'VOUCHER_PRODUCT_OUT_OF_SCOPE' }, 400);
    }
    const actor = actorFromManagement(auth);
    const id = `voucher_master_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO voucher_masters (
          id, store_id, entity_id, name, active_from, active_until, usage_quota,
          redeemed_count, is_active, created_by_role, created_by_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
      `).bind(
        id, store.id, store.entityId, normalized.value.name,
        normalized.value.activeFrom, normalized.value.activeUntil, normalized.value.usageQuota,
        normalized.value.isActive ? 1 : 0, actor.role, actor.id, now, now
      ),
      ...replaceMasterProducts(env.DB, id, store.id, normalized.value.productIds, now)
    ]);
    const masters = await listMasters(env.DB, store.id);
    return json({ ok: true, voucher: masters.find(master => master.id === id) }, 201);
  }

  const match = pathname.match(/^\/api\/admin\/vouchers\/([^/]+)$/);
  if (!match) return json({ error: 'Route Master Voucher tidak ditemukan.' }, 404);
  const id = decodeURIComponent(match[1]);
  const current = await env.DB.prepare('SELECT * FROM voucher_masters WHERE id = ? AND store_id = ?').bind(id, store.id).first();
  if (!current) return json({ error: 'Master Voucher tidak ditemukan di gerai ini.' }, 404);

  if (request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload Master Voucher tidak valid.' }, 400);
    const normalized = normalizeMasterPayload(body.value, current);
    if (!normalized.ok) return json({ error: normalized.error }, normalized.status || 400);
    if (!await validateProductIds(env.DB, store.id, normalized.value.productIds)) {
      return json({ error: 'Barang Voucher tidak ditemukan atau tidak aktif di gerai ini.', code: 'VOUCHER_PRODUCT_OUT_OF_SCOPE' }, 400);
    }
    const now = new Date().toISOString();
    const statements = [env.DB.prepare(`
      UPDATE voucher_masters
      SET name = ?, active_from = ?, active_until = ?, usage_quota = ?, is_active = ?, updated_at = ?
      WHERE id = ? AND store_id = ?
    `).bind(
      normalized.value.name, normalized.value.activeFrom, normalized.value.activeUntil,
      normalized.value.usageQuota, normalized.value.isActive ? 1 : 0, now, id, store.id
    )];
    if (normalized.value.productIds !== null) {
      statements.push(...replaceMasterProducts(env.DB, id, store.id, normalized.value.productIds, now));
    }
    await env.DB.batch(statements);
    const masters = await listMasters(env.DB, store.id);
    return json({ ok: true, voucher: masters.find(master => master.id === id) });
  }

  if (request.method === 'DELETE') {
    const used = await env.DB.prepare('SELECT 1 FROM voucher_instances WHERE voucher_master_id = ? LIMIT 1').bind(id).first();
    if (used) {
      await env.DB.prepare('UPDATE voucher_masters SET is_active = 0, updated_at = ? WHERE id = ? AND store_id = ?')
        .bind(new Date().toISOString(), id, store.id).run();
      return json({ ok: true, deactivated: true });
    }
    await env.DB.prepare('DELETE FROM voucher_masters WHERE id = ? AND store_id = ?').bind(id, store.id).run();
    return json({ ok: true, deleted: true });
  }

  return json({ error: 'Method Master Voucher tidak didukung.' }, 405);
}

async function handleCashierVoucherApi(request, env, pathname) {
  if (!pathname.startsWith('/api/cashier/vouchers')) return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const cashier = auth.cashier;
  const storeId = cashier.store.id;
  const businessDate = getJakartaBusinessDate();

  if (request.method === 'GET' && pathname === '/api/cashier/vouchers') {
    const customerId = text(new URL(request.url).searchParams.get('customerId'), 180);
    if (!customerId) {
      return json({ cashier, masters: await distributableMasters(env.DB, storeId, businessDate), vouchers: [] });
    }
    const scoped = await customerInScope(env.DB, storeId, customerId);
    if (!scoped.customer) return json({ error: 'Customer tidak ditemukan di jaringan berbagi pelanggan gerai ini.', code: 'CUSTOMER_OUT_OF_SCOPE' }, 404);
    return json({
      cashier,
      customer: {
        id: scoped.customer.id,
        customerName: scoped.customer.customer_name,
        storeId: scoped.customer.store_id
      },
      sharing: scoped.scope.group,
      masters: await distributableMasters(env.DB, storeId, businessDate),
      vouchers: await listCustomerVouchers(env.DB, storeId, customerId, businessDate)
    });
  }

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload Voucher tidak valid.' }, 400);
  const drawerAuth = await requireDrawerOwner(env.DB, cashier);
  if (!drawerAuth.ok) return drawerAuth.response;

  if (request.method === 'POST' && pathname === '/api/cashier/vouchers/distribute') {
    const masterId = text(body.value?.masterId, 180);
    const customerId = text(body.value?.customerId, 180);
    const now = new Date().toISOString();
    const prepared = await prepareVoucherInstanceDistribution(env.DB, {
      masterId,
      masterStoreId: storeId,
      customerId,
      distributedStoreId: storeId,
      distributedStoreCode: cashier.store.code,
      distributedByCashierId: cashier.id,
      businessDate,
      now
    });
    if (!prepared.ok) return json({ error: prepared.error, code: prepared.code }, prepared.status);
    await prepared.statement.run();
    const vouchers = await listCustomerVouchers(env.DB, storeId, customerId, businessDate);
    return json({ ok: true, voucher: vouchers.find(voucher => voucher.id === prepared.voucher.id) }, 201);
  }

  if (request.method === 'POST' && pathname === '/api/cashier/vouchers/redeem') {
    const voucherId = text(body.value?.voucherId, 180);
    const customerId = text(body.value?.customerId, 180);
    const productId = Number(body.value?.productId);
    if (!voucherId || !customerId || !Number.isSafeInteger(productId) || productId < 1) {
      return json({ error: 'Voucher, customer, dan barang penukaran wajib valid.' }, 400);
    }
    const scoped = await customerInScope(env.DB, storeId, customerId);
    if (!scoped.customer) return json({ error: 'Customer tidak ditemukan di jaringan berbagi pelanggan gerai ini.', code: 'CUSTOMER_OUT_OF_SCOPE' }, 404);
    const redemption = await env.DB.prepare(`
      SELECT i.id AS voucher_instance_id, i.voucher_master_id, i.master_store_id,
             i.store_id AS customer_store_id, i.customer_id, i.status,
             v.name AS master_name, v.active_from, v.active_until, v.usage_quota,
             v.redeemed_count, v.is_active, v.entity_id AS master_entity_id,
             p.id AS product_id, p.name AS product_name, p.average_cost
      FROM voucher_instances i
      JOIN voucher_masters v ON v.id = i.voucher_master_id AND v.store_id = i.master_store_id
      JOIN voucher_master_products vp
        ON vp.voucher_master_id = v.id AND vp.store_id = v.store_id AND vp.product_id = ?
      JOIN products p ON p.id = vp.product_id AND p.store_id = vp.store_id AND p.is_active = 1
      WHERE i.id = ? AND i.master_store_id = ?
      LIMIT 1
    `).bind(productId, voucherId, storeId).first();
    if (!redemption) return json({ error: 'Voucher atau barang penukaran tidak ditemukan di gerai ini.', code: 'VOUCHER_NOT_FOUND' }, 404);
    if (redemption.customer_id !== customerId) {
      return json({ error: 'Voucher ini terikat ke customer lain dan tidak boleh dipakai.', code: 'VOUCHER_CUSTOMER_MISMATCH' }, 403);
    }
    if (
      redemption.status !== 'UNUSED'
      || !redemption.is_active
      || businessDate < redemption.active_from
      || businessDate > redemption.active_until
      || Number(redemption.redeemed_count) >= Number(redemption.usage_quota)
    ) {
      return json({ error: 'Voucher sudah dipakai, belum aktif, kadaluarsa, atau kuotanya habis.', code: 'VOUCHER_NOT_REDEEMABLE' }, 409);
    }
    const amountScaled = Number(redemption.average_cost);
    if (!Number.isSafeInteger(amountScaled) || amountScaled < 0) {
      return json({ error: 'Average Cost barang tidak valid untuk penukaran Voucher.', code: 'VOUCHER_COST_INVALID' }, 409);
    }
    const redemptionId = `voucher_redemption_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const stock = await prepareSaleStockProduction(env.DB, {
      storeId,
      drawerId: drawerAuth.drawer.id,
      cashierId: cashier.id,
      saleId: redemptionId,
      lines: [{ productId, quantity: 1, productionMode: 'STOCK' }],
      now
    });
    if (!stock.ok) return json({ error: stock.error }, stock.status || 409);

    const storeEdition = await env.DB.prepare('SELECT edition FROM stores WHERE id = ? LIMIT 1').bind(storeId).first();
    try {
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO voucher_redemptions (
            id, voucher_instance_id, voucher_master_id, store_id, entity_id,
            customer_id, customer_store_id, product_id, product_name, quantity,
            unit_cost_snapshot_scaled, total_cost_snapshot_scaled,
            drawer_session_id, cashier_id, redeemed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
        `).bind(
          redemptionId, redemption.voucher_instance_id, redemption.voucher_master_id,
          storeId, redemption.master_entity_id, customerId, redemption.customer_store_id,
          productId, redemption.product_name, amountScaled, amountScaled,
          drawerAuth.drawer.id, cashier.id, now
        ),
        ...stock.statements
      ]);
    } catch (error) {
      const stockFailure = stockPostingFailure(error);
      if (stockFailure) return json({ error: stockFailure.error, code: 'VOUCHER_STOCK_REJECTED' }, stockFailure.status);
      const conflict = constraintResponse(error);
      if (conflict) return conflict;
      throw error;
    }

    const redemptionResult = {
      id: redemptionId,
      voucherId,
      customerId,
      productId,
      productName: redemption.product_name,
      quantity: 1,
      unitCostSnapshotScaled: amountScaled,
      totalCostSnapshotScaled: amountScaled,
      redeemedAt: now
    };
    let accounting;
    try {
      accounting = await postVoucherRedemptionJournal(env.DB, {
        id: storeId,
        edition: storeEdition?.edition || ''
      }, {
        redemptionId,
        businessDate,
        costScaled: amountScaled,
        occurredAt: now
      });
    } catch (error) {
      console.error('voucher accounting bridge failed after redemption commit', { storeId, redemptionId, error });
      return json({
        error: 'Voucher sudah ditukar, tetapi jurnal Accounting gagal diproses.',
        code: 'VOUCHER_ACCOUNTING_POST_FAILED',
        redemptionCommitted: true,
        redemption: redemptionResult
      }, 503);
    }
    if (!accounting.ok) {
      return json({
        error: accounting.error,
        code: accounting.code || 'VOUCHER_ACCOUNTING_POST_FAILED',
        redemptionCommitted: true,
        redemption: redemptionResult
      }, accounting.status || 409);
    }
    return json({
      ok: true,
      redemption: redemptionResult,
      accounting: accounting.skipped
        ? { status: accounting.status }
        : { status: 'POSTED', journalId: accounting.journal?.journalId || null, duplicate: Boolean(accounting.duplicate) }
    }, 201);
  }

  return json({ error: 'Route Voucher kasir tidak ditemukan.' }, 404);
}

export async function handleVoucherApi(request, env, pathname) {
  const admin = await handleAdminVoucherApi(request, env, pathname);
  if (admin) return admin;
  return handleCashierVoucherApi(request, env, pathname);
}
