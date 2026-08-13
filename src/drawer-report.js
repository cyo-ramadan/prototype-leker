const number = value => Number(value || 0);

function mapDrawer(row) {
  if (!row) return null;
  return {
    id: row.id,
    storeId: row.store_id,
    cashierId: row.cashier_id,
    cashierName: row.employee_name,
    cashierUsername: row.username,
    openingAmount: number(row.opening_amount),
    closingAmount: row.closing_amount == null ? null : number(row.closing_amount),
    incentiveAmount: number(row.incentive_amount),
    shiftLabel: row.shift_label || '',
    closingNote: row.closing_note || '',
    status: row.status,
    openedAt: row.opened_at,
    closedAt: row.closed_at
  };
}

export async function listStoreDrawers(db, storeId, limit = 100) {
  const rows = await db.prepare(`
    SELECT d.id, d.store_id, d.cashier_id, d.opening_amount, d.closing_amount,
           d.incentive_amount, d.shift_label, d.closing_note,
           d.status, d.opened_at, d.closed_at, c.employee_name, c.username
    FROM cash_drawer_sessions d
    JOIN cashiers c ON c.id = d.cashier_id
    WHERE d.store_id = ?
    ORDER BY d.opened_at DESC
    LIMIT ?
  `).bind(storeId, limit).all();
  return (rows.results ?? []).map(mapDrawer);
}

export async function getStoreDrawer(db, storeId, drawerId) {
  const row = await db.prepare(`
    SELECT d.id, d.store_id, d.cashier_id, d.opening_amount, d.closing_amount,
           d.incentive_amount, d.shift_label, d.closing_note,
           d.status, d.opened_at, d.closed_at, c.employee_name, c.username
    FROM cash_drawer_sessions d
    JOIN cashiers c ON c.id = d.cashier_id
    WHERE d.store_id = ? AND d.id = ?
    LIMIT 1
  `).bind(storeId, drawerId).first();
  return mapDrawer(row);
}

export async function buildDrawerReport(db, storeId, drawerId) {
  const drawer = await getStoreDrawer(db, storeId, drawerId);
  if (!drawer) return null;

  const [saleRows, purchaseRows, expenseRows, incomeRows, operationalCashRows] = await Promise.all([
    db.prepare(`
      SELECT s.payment_method, si.product_name, si.unit_price,
             SUM(si.quantity) AS quantity, SUM(si.line_total) AS line_total
      FROM sales s
      JOIN sale_items si ON si.sale_id = s.id AND si.store_id = s.store_id
      WHERE s.store_id = ? AND s.drawer_session_id = ? AND s.voided_at IS NULL
      GROUP BY s.payment_method, si.product_name, si.unit_price
      ORDER BY s.payment_method, si.product_name COLLATE NOCASE, si.unit_price
    `).bind(storeId, drawerId).all(),
    db.prepare(`
      SELECT p.id, p.payment_method, p.description, p.total_amount, p.note,
             p.created_at, s.name AS supplier_name
      FROM purchases p
      LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.store_id = p.store_id
      WHERE p.store_id = ? AND p.drawer_session_id = ? AND p.voided_at IS NULL
      ORDER BY p.created_at
    `).bind(storeId, drawerId).all(),
    db.prepare(`
      SELECT id, payment_method, description, amount, created_at
      FROM expenses
      WHERE store_id = ? AND drawer_session_id = ? AND voided_at IS NULL
      ORDER BY created_at
    `).bind(storeId, drawerId).all(),
    db.prepare(`
      SELECT id, description, amount, cash_account_label, income_account_label, created_at
      FROM other_income
      WHERE store_id = ? AND drawer_session_id = ?
      ORDER BY created_at
    `).bind(storeId, drawerId).all(),
    db.prepare(`
      SELECT id, approval_request_id, direction, amount, description, note, posted_at
      FROM cash_ledger_entries
      WHERE store_id = ? AND drawer_session_id = ?
      ORDER BY posted_at
    `).bind(storeId, drawerId).all()
  ]);

  const sales = (saleRows.results ?? []).map(row => ({
    paymentMethod: row.payment_method === 'NON_CASH' ? 'NON_CASH' : 'CASH',
    productName: row.product_name,
    unitPrice: number(row.unit_price),
    quantity: number(row.quantity),
    total: number(row.line_total)
  }));
  const purchases = (purchaseRows.results ?? []).map(row => ({
    id: row.id,
    paymentMethod: row.payment_method || 'CASH',
    description: row.description,
    totalAmount: number(row.total_amount),
    note: row.note || '',
    supplierName: row.supplier_name || '',
    createdAt: row.created_at
  }));
  const expenses = (expenseRows.results ?? []).map(row => ({
    id: row.id,
    paymentMethod: row.payment_method === 'NON_CASH' ? 'NON_CASH' : 'CASH',
    description: row.description,
    amount: number(row.amount),
    createdAt: row.created_at
  }));
  const cashIn = (incomeRows.results ?? []).map(row => ({
    id: row.id,
    description: row.description,
    amount: number(row.amount),
    cashAccount: row.cash_account_label || '',
    incomeAccount: row.income_account_label || '',
    createdAt: row.created_at
  }));
  const operationalCash = (operationalCashRows.results ?? []).map(row => ({
    id: row.id,
    approvalRequestId: row.approval_request_id,
    direction: row.direction === 'OUT' ? 'OUT' : 'IN',
    amount: number(row.amount),
    description: row.description,
    note: row.note || '',
    postedAt: row.posted_at
  }));

  const cashSales = sales.filter(row => row.paymentMethod === 'CASH');
  const nonCashSales = sales.filter(row => row.paymentMethod === 'NON_CASH');
  const cashPurchases = purchases.filter(row => row.paymentMethod === 'CASH');
  const nonCashPurchases = purchases.filter(row => row.paymentMethod !== 'CASH');
  const cashExpenses = expenses.filter(row => row.paymentMethod === 'CASH');
  const nonCashExpenses = expenses.filter(row => row.paymentMethod === 'NON_CASH');

  const sum = (rows, key) => rows.reduce((total, row) => total + number(row[key]), 0);
  const cashSalesTotal = sum(cashSales, 'total');
  const nonCashSalesTotal = sum(nonCashSales, 'total');
  const cashPurchaseTotal = sum(cashPurchases, 'totalAmount');
  const nonCashPurchaseTotal = sum(nonCashPurchases, 'totalAmount');
  const cashExpenseTotal = sum(cashExpenses, 'amount');
  const nonCashExpenseTotal = sum(nonCashExpenses, 'amount');
  const cashInTotal = sum(cashIn, 'amount');
  const operationalCashInTotal = operationalCash.reduce((total, row) => total + (row.direction === 'IN' ? row.amount : 0), 0);
  const operationalCashOutTotal = operationalCash.reduce((total, row) => total + (row.direction === 'OUT' ? row.amount : 0), 0);
  const cashSalesItems = cashSales.reduce((total, row) => total + row.quantity, 0);
  const nonCashSalesItems = nonCashSales.reduce((total, row) => total + row.quantity, 0);

  const promotions = [];
  const cooking = [];
  const stockRemaining = [];
  const stockAdjustments = [];
  const promotionTotal = 0;
  const realCashRevenue = cashSalesTotal - promotionTotal;
  const expectedCash = drawer.openingAmount + realCashRevenue + cashInTotal + operationalCashInTotal
    - cashPurchaseTotal - cashExpenseTotal - operationalCashOutTotal;

  return {
    drawer,
    sections: {
      cashSales,
      promotions,
      cashPurchases,
      cashExpenses,
      nonCashExpenses,
      cooking,
      stockRemaining,
      nonCashSales,
      nonCashPurchases,
      stockAdjustments,
      cashIn,
      operationalCash
    },
    totals: {
      cashSales: cashSalesTotal,
      cashSalesItems,
      nonCashSales: nonCashSalesTotal,
      nonCashSalesItems,
      promotions: promotionTotal,
      cashPurchases: cashPurchaseTotal,
      nonCashPurchases: nonCashPurchaseTotal,
      cashExpenses: cashExpenseTotal,
      nonCashExpenses: nonCashExpenseTotal,
      cashIn: cashInTotal,
      operationalCashIn: operationalCashInTotal,
      operationalCashOut: operationalCashOutTotal,
      realCashRevenue,
      expectedCash,
      closingAmount: drawer.closingAmount,
      cashDifference: drawer.closingAmount == null ? null : drawer.closingAmount - expectedCash
    }
  };
}
