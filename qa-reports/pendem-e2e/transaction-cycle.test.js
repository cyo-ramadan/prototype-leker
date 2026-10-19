import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://prototype-leker-v2.daily-napkin.workers.dev';
const TARGET_BRANCH = 'karen15/pendem-transaction-cycle-qa';
const RUN_MARKER = 'QA-PENDEM-E2E-KAREN15';
const resultPath = fileURLToPath(new URL('./RESULT.md', import.meta.url));
const pilotMigrationPath = fileURLToPath(new URL('../../migrations/0054_kantor_pendem_mandala_pilot_accounts.sql', import.meta.url));

function pilotCredential() {
  const migration = readFileSync(pilotMigrationPath, 'utf8');
  const match = migration.match(/Pendem: kasir_pendem \/ ([^\s]+)/);
  assert.ok(match, 'Pendem cashier pilot credential must remain discoverable from migration 0054');
  return { username: 'kasir_pendem', password: match[1] };
}

function activeRun() {
  return process.env.GITHUB_ACTIONS === 'true'
    && process.env.GITHUB_HEAD_REF === TARGET_BRANCH
    && !existsSync(resultPath);
}

async function call(path, { method = 'GET', token = null, body = undefined } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  return { status: response.status, ok: response.ok, payload };
}

function mustOk(label, result, expected = null) {
  if (expected !== null) {
    assert.equal(result.status, expected, `${label} expected HTTP ${expected}, got ${result.status}: ${JSON.stringify(result.payload)}`);
  } else {
    assert.ok(result.ok, `${label} failed HTTP ${result.status}: ${JSON.stringify(result.payload)}`);
  }
  return result.payload;
}

function purchaseRows(report) {
  return [
    ...(report?.sections?.cashPurchases || []),
    ...(report?.sections?.nonCashPurchases || [])
  ];
}

function expenseRows(report) {
  return [
    ...(report?.sections?.cashExpenses || []),
    ...(report?.sections?.nonCashExpenses || [])
  ];
}

test('Pendem production transaction cycle: 2 purchases + 2 expenses + 2 linked sales', {
  skip: activeRun() ? false : 'one-shot production QA runs only on its dedicated PR before RESULT.md exists'
}, async () => {
  const credential = pilotCredential();
  const login = mustOk('cashier login', await call('/api/cashier/login', {
    method: 'POST',
    body: credential
  }), 200);
  assert.equal(login.cashier?.store?.code, 'PENDEM');
  const token = login.token;
  assert.ok(token, 'login must return bearer token');

  try {
    let workspace = mustOk('cashier workspace', await call('/api/cashier/workspace', { token }));
    assert.equal(workspace.cashier?.store?.code, 'PENDEM');

    if (workspace.drawer && workspace.drawer.cashierId !== workspace.cashier.id) {
      assert.fail(`DRAWER_OWNED_BY_OTHER: ${workspace.drawer.cashierName || workspace.drawer.cashierId}`);
    }

    if (!workspace.drawer) {
      mustOk('open drawer', await call('/api/cashier/drawer/open', {
        method: 'POST',
        token,
        body: { openingAmount: 0, shiftLabel: RUN_MARKER }
      }));
      workspace = mustOk('workspace after drawer open', await call('/api/cashier/workspace', { token }));
    }

    const drawerId = workspace.drawer?.id;
    assert.ok(drawerId, 'Pendem cashier must own an open drawer before transaction writes');
    assert.equal(workspace.drawer.cashierId, workspace.cashier.id);

    const paymentMethods = Array.isArray(workspace.paymentMethods) ? workspace.paymentMethods : [];
    const cashMethod = paymentMethods.find(row => row.code === 'CASH' && row.isActive !== false)
      || paymentMethods.find(row => row.isDefault && row.isActive !== false)
      || paymentMethods.find(row => row.isActive !== false);
    assert.ok(cashMethod?.code, `No active POS payment method: ${JSON.stringify(paymentMethods)}`);
    const paymentMethod = cashMethod.code;

    const options = mustOk('purchase options', await call('/api/cashier/purchases/options', { token }));
    const purchasable = Array.isArray(options.products) ? options.products : [];
    const requiredMaterials = ['Bubuk Rasa Mangga', 'Bubuk Rasa Apel'];
    const materialByName = new Map(purchasable.map(row => [row.productName, row]));
    for (const name of requiredMaterials) {
      assert.ok(materialByName.has(name), `RECIPE_MATERIAL_NOT_PURCHASABLE: ${name}; warehouseEnabled=${options.warehouseEnabled}; purchasable=${purchasable.map(row => row.productName).join(', ')}`);
    }

    let drawerReport = mustOk('drawer details preflight', await call('/api/cashier/drawer/details', { token })).report;
    const purchaseSpecs = requiredMaterials.map((name, index) => ({
      marker: `${RUN_MARKER}-PURCHASE-${index + 1}-${name}`,
      material: materialByName.get(name),
      lineTotal: index === 0 ? 12000 : 14000
    }));
    const purchases = [];

    for (const spec of purchaseSpecs) {
      const existing = purchaseRows(drawerReport).find(row => row.description === spec.marker);
      if (existing) {
        purchases.push({ id: existing.id, marker: spec.marker, skippedExisting: true });
        continue;
      }
      const payload = mustOk(`purchase ${spec.material.productName}`, await call('/api/cashier/purchases', {
        method: 'POST',
        token,
        body: {
          description: spec.marker,
          note: `${RUN_MARKER} recipe-linked material purchase`,
          paymentMethod,
          items: [{
            productId: spec.material.productId,
            quantity: 2,
            lineTotal: spec.lineTotal
          }]
        }
      }), 201);
      purchases.push({ id: payload.id, marker: spec.marker, skippedExisting: false, totalAmount: payload.totalAmount });
      drawerReport = mustOk('drawer details after purchase', await call('/api/cashier/drawer/details', { token })).report;
    }

    const expenseSpecs = [
      { marker: `${RUN_MARKER}-EXPENSE-1`, amount: 2500, quantity: '1' },
      { marker: `${RUN_MARKER}-EXPENSE-2`, amount: 3500, quantity: '1' }
    ];
    const expenses = [];
    for (const spec of expenseSpecs) {
      const existing = expenseRows(drawerReport).find(row => row.description === spec.marker);
      if (existing) {
        expenses.push({ id: existing.id, marker: spec.marker, skippedExisting: true });
        continue;
      }
      const payload = mustOk(spec.marker, await call('/api/cashier/expenses', {
        method: 'POST',
        token,
        body: {
          description: spec.marker,
          amount: spec.amount,
          quantity: spec.quantity,
          paymentMethod
        }
      }), 201);
      expenses.push({ id: payload.id, marker: spec.marker, skippedExisting: false, amount: payload.amount });
      drawerReport = mustOk('drawer details after expense', await call('/api/cashier/drawer/details', { token })).report;
    }

    workspace = mustOk('workspace before sales', await call('/api/cashier/workspace', { token }));
    const sellableByName = new Map((workspace.products || []).map(row => [row.name, row]));
    const saleSpecs = [
      { productName: 'Es Teh Mangga Besar', marker: `${RUN_MARKER}-SALE-1-MANGGA` },
      { productName: 'Es Teh Apel Besar', marker: `${RUN_MARKER}-SALE-2-APEL` }
    ];
    const sales = [];

    for (const spec of saleSpecs) {
      workspace = mustOk(`workspace pre ${spec.marker}`, await call('/api/cashier/workspace', { token }));
      const existing = (workspace.orders || []).find(order => order.generalNote === spec.marker && order.source === 'cashier');
      if (existing) {
        sales.push({ orderId: existing.id, marker: spec.marker, skippedExisting: true, total: existing.total });
        continue;
      }
      const product = sellableByName.get(spec.productName);
      assert.ok(product, `SALE_PRODUCT_NOT_AVAILABLE: ${spec.productName}`);
      const payload = mustOk(spec.marker, await call('/api/cashier/sales', {
        method: 'POST',
        token,
        body: {
          customerName: 'QA Pendem',
          note: spec.marker,
          paymentMethod,
          items: [{ productId: Number(product.id), quantity: 1 }]
        }
      }), 201);
      sales.push({
        id: payload.sale?.id,
        orderId: payload.order?.id || payload.sale?.orderId,
        marker: spec.marker,
        skippedExisting: false,
        total: payload.sale?.total,
        productName: spec.productName
      });
    }

    const finalWorkspace = mustOk('final workspace', await call('/api/cashier/workspace', { token }));
    const finalDrawer = mustOk('final drawer details', await call('/api/cashier/drawer/details', { token })).report;

    for (const spec of purchaseSpecs) {
      assert.ok(purchaseRows(finalDrawer).some(row => row.description === spec.marker), `Missing committed purchase marker ${spec.marker}`);
    }
    for (const spec of expenseSpecs) {
      assert.ok(expenseRows(finalDrawer).some(row => row.description === spec.marker), `Missing committed expense marker ${spec.marker}`);
    }
    for (const spec of saleSpecs) {
      assert.ok((finalWorkspace.orders || []).some(order => order.generalNote === spec.marker && order.status === 'COMPLETED'), `Missing completed sale/order marker ${spec.marker}`);
    }

    const evidence = {
      task: 'karen-LEKER-QA-PENDEM-TRANSACTION-CYCLE',
      marker: RUN_MARKER,
      store: finalWorkspace.cashier?.store,
      cashier: {
        id: finalWorkspace.cashier?.id,
        username: finalWorkspace.cashier?.username,
        employeeName: finalWorkspace.cashier?.employeeName
      },
      drawerId,
      paymentMethod,
      warehouseEnabled: options.warehouseEnabled,
      purchases,
      expenses,
      sales,
      finalTotals: finalDrawer?.totals || null
    };
    console.log(`PENDEM_E2E_RESULT=${JSON.stringify(evidence)}`);
  } finally {
    await call('/api/cashier/logout', { method: 'POST', token }).catch(() => null);
  }
});
