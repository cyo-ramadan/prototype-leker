import { json } from './http.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';

export const DEBUGGER_IDENTITY = Object.freeze({
  id: 'debugger',
  role: 'DEBUGGER',
  authType: 'DEBUG_TOKEN'
});

const table = (columns, scopeColumn = null) => Object.freeze({ columns: Object.freeze(columns), scopeColumn });

export const DEBUG_MODULES = Object.freeze({
  DEBUGGER: Object.freeze({
    label: 'Debugger Control Plane',
    tables: Object.freeze({
      debugger_audit_log: table(['id', 'actor_id', 'request_id', 'request_method', 'request_path', 'module_code', 'store_code', 'result_status', 'result_code', 'occurred_at'])
    })
  }),
  CORE: Object.freeze({
    label: 'Core / Gerai',
    tables: Object.freeze({
      stores: table(['id', 'code', 'store_name', 'is_active'], 'id')
    })
  }),
  CUSTOMER: Object.freeze({
    label: 'Customer',
    tables: Object.freeze({
      customers: table(['id', 'store_id', 'customer_code', 'is_active'], 'store_id'),
      customer_sessions: table(['token_hash', 'customer_id', 'expires_at']),
      customer_point_ledger: table(['id', 'customer_id', 'source_store_id', 'points_delta', 'reference_type', 'reference_id'], 'source_store_id')
    })
  }),
  CUSTOMER_FEEDBACK: Object.freeze({
    label: 'Customer Feedback',
    tables: Object.freeze({
      customer_feedback_reports: table(['id', 'feedback_code', 'store_id', 'customer_id', 'category', 'reward_points', 'created_at'], 'store_id'),
      customer_feedback_report_issues: table(['id', 'report_id', 'issue_code', 'issue_label_snapshot'])
    })
  }),
  STAFF_AUTH: Object.freeze({
    label: 'Staff Auth',
    tables: Object.freeze({
      owner_accounts: table(['id', 'username', 'is_active']),
      owner_sessions: table(['token_hash', 'owner_id', 'expires_at']),
      store_admins: table(['id', 'store_id', 'username', 'is_active'], 'store_id'),
      store_admin_sessions: table(['token_hash', 'admin_id', 'expires_at']),
      cashiers: table(['id', 'store_id', 'username', 'is_active'], 'store_id'),
      cashier_sessions: table(['token_hash', 'cashier_id', 'expires_at'])
    })
  }),
  CASHIER: Object.freeze({
    label: 'Cashier / Drawer',
    tables: Object.freeze({
      cash_drawer_sessions: table(['id', 'store_id', 'cashier_id', 'status', 'opened_at', 'closed_at'], 'store_id')
    })
  }),
  TRANSACTIONS: Object.freeze({
    label: 'Transactions',
    tables: Object.freeze({
      orders: table(['id', 'store_id', 'status', 'created_at'], 'store_id'),
      sales: table(['id', 'store_id', 'drawer_session_id', 'cashier_id', 'total_amount', 'created_at'], 'store_id'),
      sale_items: table(['id', 'sale_id', 'store_id', 'product_id', 'line_total'], 'store_id'),
      purchases: table(['id', 'store_id', 'drawer_session_id', 'cashier_id', 'total_amount', 'created_at'], 'store_id'),
      expenses: table(['id', 'store_id', 'drawer_session_id', 'cashier_id', 'amount', 'created_at'], 'store_id'),
      other_income: table(['id', 'store_id', 'drawer_session_id', 'cashier_id', 'amount', 'created_at'], 'store_id')
    })
  }),
  APPROVALS: Object.freeze({
    label: 'Approvals / Corrections',
    tables: Object.freeze({
      approval_requests: table(['id', 'store_id', 'request_type', 'approval_status', 'posting_status', 'created_at'], 'store_id'),
      approval_permits: table(['id', 'store_id', 'subject_type', 'subject_id', 'approval_status', 'execution_status'], 'store_id')
    })
  }),
  INVENTORY: Object.freeze({
    label: 'Inventory / Production',
    tables: Object.freeze({
      products: table(['id', 'store_id', 'name', 'stock_tracking_enabled'], 'store_id'),
      inventory_stock_balances: table(['store_id', 'product_id', 'quantity', 'updated_at'], 'store_id'),
      stock_movements: table(['id', 'store_id', 'product_id', 'direction', 'quantity', 'source_type', 'source_id', 'occurred_at'], 'store_id'),
      manufacturing_recipes: table(['id', 'store_id', 'output_product_id', 'revision', 'status'], 'store_id'),
      production_runs: table(['id', 'store_id', 'sale_id', 'status', 'created_at'], 'store_id')
    })
  }),
  ACCOUNTING: Object.freeze({
    label: 'Accounting',
    tables: Object.freeze({
      chart_of_accounts: table(['id', 'store_id', 'code', 'name', 'type', 'is_active'], 'store_id'),
      accounting_journal_headers: table(['id', 'store_id', 'journal_number', 'business_date', 'source_system', 'source_reference_id', 'idempotency_key'], 'store_id'),
      accounting_journal_lines: table(['id', 'store_id', 'journal_id', 'account_id', 'side', 'amount_minor'], 'store_id')
    })
  }),
  ACCOUNTING_SETTINGS: Object.freeze({
    label: 'Accounting Settings',
    tables: Object.freeze({
      payment_methods: table(['id', 'store_id', 'code', 'name', 'account_id', 'is_active'], 'store_id'),
      item_categories: table(['id', 'store_id', 'product_kind_id', 'inventory_account_id', 'cogs_account_id', 'revenue_account_id'], 'store_id'),
      transaction_categories: table(['id', 'store_id', 'code', 'registered_by_module', 'is_active'], 'store_id'),
      journal_rules: table(['id', 'store_id', 'transaction_category_id', 'side', 'source_type', 'is_active'], 'store_id')
    })
  }),
  WAREHOUSE: Object.freeze({
    label: 'Warehouse',
    tables: Object.freeze({
      warehouses: table(['id', 'store_id', 'code', 'name', 'is_active'], 'store_id'),
      warehouse_access: table(['id', 'store_id', 'warehouse_id', 'principal_type', 'principal_id', 'is_active'], 'store_id'),
      warehouse_stock_opname_settings: table(['warehouse_id', 'store_id', 'requires_approval'], 'store_id')
    })
  })
});

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value ?? ''))));
}

export async function secureTokenEqual(left, right) {
  if (!left || !right) return false;
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function requireDebugger(request, env) {
  const configuredToken = String(env.DEBUG_SUPERADMIN_TOKEN || '').trim();
  if (configuredToken.length < 32) {
    return {
      ok: false,
      response: json({ error: 'Debugger token belum dikonfigurasi.', code: 'DEBUGGER_NOT_CONFIGURED' }, 503)
    };
  }
  const supplied = bearerToken(request);
  if (!supplied || !await secureTokenEqual(supplied, configuredToken)) {
    return {
      ok: false,
      response: json({ error: 'Debugger token tidak valid.', code: 'DEBUGGER_AUTH_REQUIRED' }, 401)
    };
  }
  return { ok: true, principal: DEBUGGER_IDENTITY };
}

function quoteIdentifier(value) {
  const identifier = String(value || '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error('Unsafe SQL identifier');
  return `"${identifier}"`;
}

async function schemaTableNames(db) {
  const rows = await db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all();
  return new Set((rows.results || []).map(row => String(row.name || '')));
}

async function tableColumns(db, tableName) {
  const rows = await db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all();
  return new Set((rows.results || []).map(row => String(row.name || '')));
}

async function countRows(db, tableName, scopeColumn, storeId) {
  const tableSql = quoteIdentifier(tableName);
  if (!scopeColumn || !storeId) {
    const row = await db.prepare(`SELECT COUNT(*) AS row_count FROM ${tableSql}`).first();
    return Number(row?.row_count || 0);
  }
  const columnSql = quoteIdentifier(scopeColumn);
  const row = await db.prepare(`SELECT COUNT(*) AS row_count FROM ${tableSql} WHERE ${columnSql} = ?`).bind(storeId).first();
  return Number(row?.row_count || 0);
}

export async function probeDebugModule(db, moduleCode, store = null, knownTables = null) {
  const code = String(moduleCode || '').trim().toUpperCase();
  const module = DEBUG_MODULES[code];
  if (!module) return null;
  const existingTables = knownTables || await schemaTableNames(db);
  const tables = [];

  for (const [tableName, spec] of Object.entries(module.tables)) {
    const exists = existingTables.has(tableName);
    if (!exists) {
      tables.push({ table: tableName, status: 'FAIL', exists: false, missingColumns: [...spec.columns], rowCount: null });
      continue;
    }

    try {
      const columns = await tableColumns(db, tableName);
      const missingColumns = spec.columns.filter(column => !columns.has(column));
      const rowCount = await countRows(db, tableName, spec.scopeColumn, store?.id || null);
      tables.push({
        table: tableName,
        status: missingColumns.length ? 'FAIL' : 'PASS',
        exists: true,
        missingColumns,
        rowCount
      });
    } catch (error) {
      tables.push({
        table: tableName,
        status: 'FAIL',
        exists: true,
        missingColumns: [],
        rowCount: null,
        error: String(error?.message || error)
      });
    }
  }

  return {
    code,
    label: module.label,
    status: tables.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL',
    tables
  };
}

async function resolveDebugStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

async function safeFirst(db, sql, params = []) {
  try {
    const row = await db.prepare(sql).bind(...params).first();
    return { ok: true, row: row || null };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function safeAll(db, sql, params = []) {
  try {
    const rows = await db.prepare(sql).bind(...params).all();
    return { ok: true, rows: rows.results || [] };
  } catch (error) {
    return { ok: false, error: String(error?.message || error), rows: [] };
  }
}

async function traceTransaction(db, store, referenceId) {
  const id = String(referenceId || '').trim();
  const storeId = store.id;
  const [sale, purchase, expense, income, order, permits, journals, stockMovements] = await Promise.all([
    safeFirst(db, `SELECT id, total_amount, payment_method, customer_id, voided_at, created_at FROM sales WHERE store_id = ? AND id = ? LIMIT 1`, [storeId, id]),
    safeFirst(db, `SELECT id, total_amount, payment_method, supplier_id, voided_at, created_at FROM purchases WHERE store_id = ? AND id = ? LIMIT 1`, [storeId, id]),
    safeFirst(db, `SELECT id, amount, payment_method, voided_at, created_at FROM expenses WHERE store_id = ? AND id = ? LIMIT 1`, [storeId, id]),
    safeFirst(db, `SELECT id, amount, payment_method, created_at FROM other_income WHERE store_id = ? AND id = ? LIMIT 1`, [storeId, id]),
    safeFirst(db, `SELECT id, status, customer_id, created_at FROM orders WHERE store_id = ? AND id = ? LIMIT 1`, [storeId, id]),
    safeAll(db, `SELECT id, subject_type, subject_id, approval_status, execution_status, execution_code FROM approval_permits WHERE store_id = ? AND subject_id = ? ORDER BY requested_at DESC`, [storeId, id]),
    safeAll(db, `SELECT id, journal_number, business_date, source_system, source_reference_id, idempotency_key, journal_status FROM accounting_journal_headers WHERE store_id = ? AND source_reference_id = ? ORDER BY occurred_at DESC`, [storeId, id]),
    safeAll(db, `SELECT id, product_id, direction, quantity, source_type, source_id, occurred_at FROM stock_movements WHERE store_id = ? AND source_id = ? ORDER BY occurred_at DESC`, [storeId, id])
  ]);

  return {
    referenceId: id,
    store: { id: store.id, code: store.code, storeName: store.storeName },
    operationalFacts: { sale, purchase, expense, otherIncome: income, order },
    correctionPermits: permits,
    accountingJournals: journals,
    stockMovements
  };
}

async function traceFeedback(db, store, feedbackCode) {
  const code = String(feedbackCode || '').trim().toUpperCase();
  const report = await safeFirst(db, `
    SELECT id, feedback_code, store_id, category, manual_note, reward_points, entitlement_type, qualifying_sale_id, created_at
    FROM customer_feedback_reports
    WHERE store_id = ? AND feedback_code = ?
    LIMIT 1
  `, [store.id, code]);
  if (!report.ok || !report.row) return { feedbackCode: code, report, issues: [], pointReward: null };

  const [issues, pointReward] = await Promise.all([
    safeAll(db, `SELECT issue_code, issue_label_snapshot FROM customer_feedback_report_issues WHERE report_id = ? ORDER BY created_at, id`, [report.row.id]),
    safeFirst(db, `
      SELECT id, points_delta, activity_type, reference_type, reference_id, source_store_id, created_at
      FROM customer_point_ledger
      WHERE reference_type = 'CUSTOMER_FEEDBACK' AND reference_id = ?
      LIMIT 1
    `, [report.row.id])
  ]);
  return {
    feedbackCode: code,
    store: { id: store.id, code: store.code, storeName: store.storeName },
    report,
    issues,
    pointReward,
    managementSourcePresent: true
  };
}

function moduleFromPath(pathname) {
  const explicit = pathname.match(/^\/api\/debug\/modules\/([^/]+)$/);
  if (explicit) return decodeURIComponent(explicit[1]).toUpperCase();
  if (pathname.startsWith('/api/debug/transactions/')) return 'TRANSACTIONS';
  if (pathname.startsWith('/api/debug/customer-feedback/')) return 'CUSTOMER_FEEDBACK';
  if (pathname === '/api/debug/audit') return 'DEBUGGER';
  return 'DEBUGGER';
}

async function writeAudit(db, request, moduleCode, store, responseStatus, resultCode = '') {
  const requestId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO debugger_audit_log (
      id, actor_id, request_id, request_method, request_path,
      module_code, store_code, result_status, result_code, occurred_at
    ) VALUES (?, 'debugger', ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    `debug_audit_${crypto.randomUUID()}`,
    requestId,
    request.method,
    new URL(request.url).pathname,
    String(moduleCode || 'DEBUGGER').slice(0, 80),
    store?.code || '',
    Number(responseStatus || 0),
    String(resultCode || '').slice(0, 120),
    now
  ).run();
}

async function auditedResponse(db, request, moduleCode, store, response, resultCode = '') {
  try {
    await writeAudit(db, request, moduleCode, store, response.status, resultCode);
    return response;
  } catch (error) {
    console.error('debugger audit write failed', error);
    return json({ error: 'Audit Debugger tidak dapat ditulis.', code: 'DEBUGGER_AUDIT_UNAVAILABLE' }, 503);
  }
}

export async function handleDebuggerApi(request, env, pathname) {
  if (!pathname.startsWith('/api/debug/')) return null;

  const auth = await requireDebugger(request, env);
  if (!auth.ok) return auth.response;
  if (request.method !== 'GET') {
    return auditedResponse(env.DB, request, moduleFromPath(pathname), null,
      json({ error: 'Debugger Control Plane V1 hanya mengizinkan diagnostic read.', code: 'DEBUGGER_READ_ONLY' }, 405),
      'DEBUGGER_READ_ONLY');
  }

  const url = new URL(request.url);
  const needsStore = pathname !== '/api/debug/me' && pathname !== '/api/debug/modules' && pathname !== '/api/debug/audit';
  const store = needsStore ? await resolveDebugStore(env.DB, request) : null;
  if (needsStore && !store) {
    return auditedResponse(env.DB, request, moduleFromPath(pathname), null,
      json({ error: 'Gerai debug tidak ditemukan.', code: 'DEBUG_STORE_NOT_FOUND' }, 404),
      'DEBUG_STORE_NOT_FOUND');
  }

  let response;
  let resultCode = 'OK';

  if (pathname === '/api/debug/me') {
    response = json({ principal: auth.principal, readOnly: true, modules: Object.keys(DEBUG_MODULES) });
  } else if (pathname === '/api/debug/modules') {
    response = json({
      modules: Object.entries(DEBUG_MODULES).map(([code, module]) => ({
        code,
        label: module.label,
        tables: Object.keys(module.tables)
      }))
    });
  } else if (pathname === '/api/debug/health') {
    const existingTables = await schemaTableNames(env.DB);
    const modules = [];
    for (const code of Object.keys(DEBUG_MODULES)) {
      modules.push(await probeDebugModule(env.DB, code, store, existingTables));
    }
    const status = modules.every(module => module.status === 'PASS') ? 'PASS' : 'FAIL';
    resultCode = status;
    response = json({
      status,
      principal: auth.principal,
      store: { id: store.id, code: store.code, storeName: store.storeName },
      modules
    });
  } else if (pathname === '/api/debug/audit') {
    const requested = Number(url.searchParams.get('limit') || 50);
    const limit = Number.isInteger(requested) ? Math.min(100, Math.max(1, requested)) : 50;
    const rows = await env.DB.prepare(`
      SELECT request_id, actor_id, request_method, request_path, module_code, store_code,
             result_status, result_code, occurred_at
      FROM debugger_audit_log
      ORDER BY occurred_at DESC, id DESC
      LIMIT ?
    `).bind(limit).all();
    response = json({ audit: rows.results || [] });
  } else {
    const moduleMatch = pathname.match(/^\/api\/debug\/modules\/([^/]+)$/);
    const transactionMatch = pathname.match(/^\/api\/debug\/transactions\/([^/]+)$/);
    const feedbackMatch = pathname.match(/^\/api\/debug\/customer-feedback\/([^/]+)$/);

    if (moduleMatch) {
      const code = decodeURIComponent(moduleMatch[1]).toUpperCase();
      const probe = await probeDebugModule(env.DB, code, store);
      if (!probe) {
        resultCode = 'DEBUG_MODULE_NOT_FOUND';
        response = json({ error: 'Module debug tidak dikenal.', code: resultCode }, 404);
      } else {
        resultCode = probe.status;
        response = json({ store: { id: store.id, code: store.code, storeName: store.storeName }, module: probe });
      }
    } else if (transactionMatch) {
      response = json(await traceTransaction(env.DB, store, decodeURIComponent(transactionMatch[1])));
    } else if (feedbackMatch) {
      response = json(await traceFeedback(env.DB, store, decodeURIComponent(feedbackMatch[1])));
    } else {
      resultCode = 'DEBUG_ROUTE_NOT_FOUND';
      response = json({ error: 'Route Debugger tidak ditemukan.', code: resultCode }, 404);
    }
  }

  return auditedResponse(env.DB, request, moduleFromPath(pathname), store, response, resultCode);
}
