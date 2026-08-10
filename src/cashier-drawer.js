import { json, readJson } from './http.js';
import { listProducts } from './db-multistore.js';
import { requireCashier } from './cashier-auth.js';

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const money = value => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
};

function mapDrawer(row) {
  return row ? {
    id: row.id,
    storeId: row.store_id,
    cashierId: row.cashier_id,
    cashierName: row.employee_name,
    cashierUsername: row.username,
    openingAmount: Number(row.opening_amount || 0),
    closingAmount: row.closing_amount == null ? null : Number(row.closing_amount),
    status: row.status,
    openedAt: row.opened_at,
    closedAt: row.closed_at
  } : null;
}

export async function getOpenDrawer(db, storeId) {
  const row = await db.prepare(`
    SELECT d.id, d.store_id, d.cashier_id, d.opening_amount, d.closing_amount,
           d.status, d.opened_at, d.closed_at, c.employee_name, c.username
    FROM cash_drawer_sessions d
    JOIN cashiers c ON c.id = d.cashier_id
    WHERE d.store_id = ? AND d.status = 'OPEN'
    LIMIT 1
  `).bind(storeId).first();
  return mapDrawer(row);
}

export async function requireDrawerOwner(db, cashier) {
  const drawer = await getOpenDrawer(db, cashier.store.id);
  if (!drawer) {
    return { ok: false, response: json({ error: 'Laci kas belum dibuka.', code: 'DRAWER_NOT_OPEN' }, 409) };
  }
  if (drawer.cashierId !== cashier.id) {
    return {
      ok: false,
      response: json({
        error: `Laci sedang dibuka oleh ${drawer.cashierName}. Akun ini hanya mode lihat.`,
        code: 'DRAWER_OWNED_BY_OTHER',
        drawer
      }, 403)
    };
  }
  return { ok: true, drawer };
}

async function drawerDetails(db, drawer) {
  if (!drawer) return null;
  const [salesTotal, purchasesTotal, expensesTotal, incomeTotal, sales, purchases, expenses, incomes] = await Promise.all([
    db.prepare('SELECT COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS count FROM sales WHERE drawer_session_id = ?').bind(drawer.id).first(),
    db.prepare('SELECT COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS count FROM purchases WHERE drawer_session_id = ?').bind(drawer.id).first(),
    db.prepare('SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM expenses WHERE drawer_session_id = ?').bind(drawer.id).first(),
    db.prepare('SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM other_income WHERE drawer_session_id = ?').bind(drawer.id).first(),
    db.prepare('SELECT id, customer_name, total_amount, note, created_at FROM sales WHERE drawer_session_id = ? ORDER BY created_at DESC LIMIT 50').bind(drawer.id).all(),
    db.prepare(`SELECT p.id, p.description, p.total_amount, p.note, p.created_at, s.name AS supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.drawer_session_id = ? ORDER BY p.created_at DESC LIMIT 50`).bind(drawer.id).all(),
    db.prepare('SELECT id, description, amount, created_at FROM expenses WHERE drawer_session_id = ? ORDER BY created_at DESC LIMIT 50').bind(drawer.id).all(),
    db.prepare('SELECT id, description, amount, created_at FROM other_income WHERE drawer_session_id = ? ORDER BY created_at DESC LIMIT 50').bind(drawer.id).all()
  ]);

  const totals = {
    sales: Number(salesTotal?.total || 0),
    purchases: Number(purchasesTotal?.total || 0),
    expenses: Number(expensesTotal?.total || 0),
    otherIncome: Number(incomeTotal?.total || 0),
    salesCount: Number(salesTotal?.count || 0),
    purchasesCount: Number(purchasesTotal?.count || 0),
    expensesCount: Number(expensesTotal?.count || 0),
    otherIncomeCount: Number(incomeTotal?.count || 0)
  };
  totals.expectedCash = drawer.openingAmount + totals.sales + totals.otherIncome - totals.purchases - totals.expenses;

  return {
    drawer,
    totals,
    sales: sales.results ?? [],
    purchases: purchases.results ?? [],
    expenses: expenses.results ?? [],
    otherIncome: incomes.results ?? []
  };
}

async function createSale(db, cashier, drawer, payload) {
  const requested = Array.isArray(payload?.items) ? payload.items : [];
  if (!requested.length) return { ok: false, response: json({ error: 'Draft penjualan masih kosong.' }, 400) };

  const products = await listProducts(db, cashier.store.id);
  const productMap = new Map(products.filter(item => item.isActive !== false).map(item => [Number(item.id), item]));
  const lines = [];
  let total = 0;

  for (const item of requested) {
    const productId = Number(item?.productId ?? item?.id);
    const quantity = Number(item?.quantity ?? item?.qty);
    const product = productMap.get(productId);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      return { ok: false, response: json({ error: 'Item draft penjualan tidak valid atau bukan milik gerai kasir.' }, 400) };
    }
    const unitPrice = Number(product.price);
    const lineTotal = unitPrice * quantity;
    total += lineTotal;
    lines.push({ productId, productName: product.name, unitPrice, quantity, lineTotal });
  }

  const saleId = `sale_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const statements = [
    db.prepare(`
      INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, customer_name, total_amount, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      saleId,
      cashier.store.id,
      drawer.id,
      cashier.id,
      text(payload?.customerName, 100),
      total,
      text(payload?.note, 500),
      now
    )
  ];
  for (const line of lines) {
    statements.push(db.prepare(`
      INSERT INTO sale_items (id, sale_id, store_id, product_id, product_name, unit_price, quantity, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(`sale_item_${crypto.randomUUID()}`, saleId, cashier.store.id, line.productId, line.productName, line.unitPrice, line.quantity, line.lineTotal));
  }
  await db.batch(statements);
  return { ok: true, response: json({ ok: true, sale: { id: saleId, total, items: lines, createdAt: now } }, 201) };
}

export async function handleCashierDrawerApi(request, env, pathname) {
  if (!pathname.startsWith('/api/cashier/')) return null;
  const db = env.DB;
  const auth = await requireCashier(request, db);
  if (!auth.ok) return auth.response;
  const cashier = auth.cashier;

  if (request.method === 'GET' && pathname === '/api/cashier/drawer') {
    const drawer = await getOpenDrawer(db, cashier.store.id);
    return json({ cashier, drawer, canWrite: Boolean(drawer && drawer.cashierId === cashier.id) });
  }

  if (request.method === 'POST' && pathname === '/api/cashier/drawer/open') {
    const existing = await getOpenDrawer(db, cashier.store.id);
    if (existing) {
      if (existing.cashierId === cashier.id) return json({ ok: true, drawer: existing, canWrite: true });
      return json({ error: `Laci sudah dibuka oleh ${existing.cashierName}.`, code: 'DRAWER_ALREADY_OPEN', drawer: existing }, 409);
    }
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload buka laci tidak valid.' }, 400);
    const openingAmount = money(body.value?.openingAmount ?? 0);
    if (openingAmount === null) return json({ error: 'Saldo awal laci tidak valid.' }, 400);
    const id = `drawer_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, closing_amount, status, opened_at, closed_at)
      VALUES (?, ?, ?, ?, NULL, 'OPEN', ?, NULL)
    `).bind(id, cashier.store.id, cashier.id, openingAmount, now).run();
    return json({ ok: true, drawer: await getOpenDrawer(db, cashier.store.id), canWrite: true }, 201);
  }

  if (request.method === 'POST' && pathname === '/api/cashier/drawer/close') {
    const ownership = await requireDrawerOwner(db, cashier);
    if (!ownership.ok) return ownership.response;
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload tutup laci tidak valid.' }, 400);
    const closingAmount = money(body.value?.closingAmount);
    if (closingAmount === null) return json({ error: 'Saldo akhir laci wajib berupa angka valid.' }, 400);
    const now = new Date().toISOString();
    await db.prepare(`
      UPDATE cash_drawer_sessions
      SET closing_amount = ?, status = 'CLOSED', closed_at = ?
      WHERE id = ? AND cashier_id = ? AND status = 'OPEN'
    `).bind(closingAmount, now, ownership.drawer.id, cashier.id).run();
    return json({ ok: true, drawerId: ownership.drawer.id, closedAt: now });
  }

  if (request.method === 'GET' && pathname === '/api/cashier/menu') {
    return json({ cashier, products: await listProducts(db, cashier.store.id) });
  }

  if (request.method === 'GET' && pathname === '/api/cashier/suppliers') {
    const rows = await db.prepare(`
      SELECT id, name, phone, address
      FROM suppliers
      WHERE store_id = ? AND is_active = 1
      ORDER BY name COLLATE NOCASE
    `).bind(cashier.store.id).all();
    return json({ suppliers: rows.results ?? [] });
  }

  if (request.method === 'GET' && pathname === '/api/cashier/drawer/details') {
    const drawer = await getOpenDrawer(db, cashier.store.id);
    if (!drawer) return json({ error: 'Belum ada laci aktif di gerai ini.', code: 'DRAWER_NOT_OPEN' }, 409);
    return json(await drawerDetails(db, drawer));
  }

  const writeRoute = request.method === 'POST' && [
    '/api/cashier/sales',
    '/api/cashier/purchases',
    '/api/cashier/expenses',
    '/api/cashier/other-income'
  ].includes(pathname);
  if (!writeRoute) return null;

  const ownership = await requireDrawerOwner(db, cashier);
  if (!ownership.ok) return ownership.response;
  const drawer = ownership.drawer;

  if (pathname === '/api/cashier/sales') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload penjualan tidak valid.' }, 400);
    return (await createSale(db, cashier, drawer, body.value)).response;
  }

  if (pathname === '/api/cashier/purchases') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload pembelian tidak valid.' }, 400);
    const description = text(body.value?.description, 220);
    const totalAmount = money(body.value?.totalAmount);
    const supplierId = text(body.value?.supplierId, 120) || null;
    const note = text(body.value?.note, 500);
    if (!description || totalAmount === null || totalAmount <= 0) return json({ error: 'Deskripsi dan nominal pembelian wajib valid.' }, 400);
    if (supplierId) {
      const supplier = await db.prepare('SELECT id FROM suppliers WHERE id = ? AND store_id = ? AND is_active = 1').bind(supplierId, cashier.store.id).first();
      if (!supplier) return json({ error: 'Supplier tidak ditemukan di gerai kasir.' }, 400);
    }
    const id = `purchase_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO purchases (id, store_id, drawer_session_id, cashier_id, supplier_id, description, total_amount, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, cashier.store.id, drawer.id, cashier.id, supplierId, description, totalAmount, note, now).run();
    return json({ ok: true, id, createdAt: now }, 201);
  }

  if (pathname === '/api/cashier/expenses') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload pengeluaran tidak valid.' }, 400);
    const description = text(body.value?.description, 220);
    const amount = money(body.value?.amount);
    if (!description || amount === null || amount <= 0) return json({ error: 'Deskripsi dan nominal pengeluaran wajib valid.' }, 400);
    const id = `expense_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO expenses (id, store_id, drawer_session_id, cashier_id, description, amount, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, cashier.store.id, drawer.id, cashier.id, description, amount, now).run();
    return json({ ok: true, id, createdAt: now }, 201);
  }

  if (pathname === '/api/cashier/other-income') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload pendapatan lain tidak valid.' }, 400);
    const description = text(body.value?.description, 220);
    const amount = money(body.value?.amount);
    if (!description || amount === null || amount <= 0) return json({ error: 'Deskripsi dan nominal pendapatan wajib valid.' }, 400);
    const id = `income_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO other_income (id, store_id, drawer_session_id, cashier_id, description, amount, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, cashier.store.id, drawer.id, cashier.id, description, amount, now).run();
    return json({ ok: true, id, createdAt: now }, 201);
  }

  return null;
}
