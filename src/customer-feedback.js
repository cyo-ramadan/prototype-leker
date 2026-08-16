import { json, readJson } from './http.js';
import { optionalCustomerFromRequest } from './customers.js';
import { resolveCustomerScope } from './customer-sharing.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getJakartaBusinessDate, isoNow } from './time.js';

export const CUSTOMER_FEEDBACK_REWARD_POINTS = 500;
const QUALIFYING_SALE_AMOUNT = 50000;
const MAX_MANUAL_NOTE_LENGTH = 1200;
const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const placeholders = count => Array.from({ length: count }, () => '?').join(', ');

export const CUSTOMER_FEEDBACK_CATALOG = Object.freeze({
  PRODUCT_QUALITY: Object.freeze({
    label: 'Mutu Produk',
    issues: Object.freeze([
      Object.freeze({ code: 'TASTE_NOT_GOOD', label: 'Produknya kurang enak' }),
      Object.freeze({ code: 'PRICE_TOO_HIGH', label: 'Harga terasa terlalu mahal' }),
      Object.freeze({ code: 'POSSIBLY_EXPIRED', label: 'Saya mendapat produk yang kemungkinan sudah expired' }),
      Object.freeze({ code: 'TASTE_INCONSISTENT', label: 'Rasa produk tidak seperti biasanya' }),
      Object.freeze({ code: 'BELOW_OTHER_BRANCH_STANDARD', label: 'Standarnya terasa di bawah produk cabang lain' }),
      Object.freeze({ code: 'PORTION_INCONSISTENT', label: 'Porsi atau ukuran produk tidak konsisten' }),
      Object.freeze({ code: 'TEXTURE_OR_DONENESS', label: 'Tekstur atau tingkat kematangan kurang pas' }),
      Object.freeze({ code: 'PACKAGING_ISSUE', label: 'Kemasan kurang rapi atau kurang aman' })
    ])
  }),
  SERVICE: Object.freeze({
    label: 'Pelayanan',
    issues: Object.freeze([
      Object.freeze({ code: 'CASHIER_UNFRIENDLY', label: 'Pelayan atau kasir kurang ramah' }),
      Object.freeze({ code: 'CASHIER_NOT_TRANSPARENT', label: 'Saya merasa pelayanan atau transaksi kasir tidak jujur / tidak transparan' }),
      Object.freeze({ code: 'STAFF_CHATTING_DELAY', label: 'Kasir atau staf mengobrol saat melayani sehingga pesanan menjadi lama' }),
      Object.freeze({ code: 'SERVICE_TOO_SLOW', label: 'Pelayanan atau pembuatan pesanan terlalu lama' }),
      Object.freeze({ code: 'ORDER_MISTAKE', label: 'Pesanan atau permintaan saya tidak ditangani sesuai order' }),
      Object.freeze({ code: 'COMMUNICATION_UNCLEAR', label: 'Informasi dari staf kurang jelas' }),
      Object.freeze({ code: 'QUEUE_NOT_MANAGED', label: 'Antrean kurang tertib atau kurang dikelola' })
    ])
  }),
  CLEANLINESS: Object.freeze({
    label: 'Kebersihan',
    issues: Object.freeze([
      Object.freeze({ code: 'CUSTOMER_AREA_DIRTY', label: 'Area pelanggan terlihat kotor' }),
      Object.freeze({ code: 'COUNTER_DIRTY', label: 'Meja atau area kasir terlihat kotor' }),
      Object.freeze({ code: 'EQUIPMENT_DIRTY', label: 'Peralatan produksi terlihat kurang bersih' }),
      Object.freeze({ code: 'STAFF_HYGIENE', label: 'Kebersihan staf saat menangani produk kurang baik' }),
      Object.freeze({ code: 'TRASH_FULL', label: 'Tempat sampah penuh atau area sampah kurang terawat' }),
      Object.freeze({ code: 'UNPLEASANT_SMELL', label: 'Ada bau yang mengganggu di area gerai' }),
      Object.freeze({ code: 'PEST_SIGHTING', label: 'Saya melihat serangga atau hama di area gerai' })
    ])
  })
});

function catalogPayload() {
  return Object.entries(CUSTOMER_FEEDBACK_CATALOG).map(([code, config]) => ({
    code,
    label: config.label,
    issues: config.issues.map(issue => ({ ...issue }))
  }));
}

function storeTokenFrom(request) {
  return new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
}

async function selectedStore(db, request, includeInactive = false) {
  return resolveStore(db, storeTokenFrom(request), { includeInactive });
}

export function normalizeFeedbackSubmission(value) {
  const category = text(value?.category, 40).toUpperCase();
  const config = CUSTOMER_FEEDBACK_CATALOG[category];
  if (!config) return { ok: false, error: 'Pilih kategori saran terlebih dahulu.' };

  const allowedIssues = new Map(config.issues.map(issue => [issue.code, issue]));
  const requested = Array.isArray(value?.issues) ? value.issues : [];
  const uniqueCodes = [...new Set(requested.map(item => text(item, 80).toUpperCase()).filter(Boolean))];
  const issues = [];

  for (const code of uniqueCodes) {
    const issue = allowedIssues.get(code);
    if (!issue) return { ok: false, error: 'Pilihan saran tidak valid untuk kategori yang dipilih.' };
    issues.push(issue);
  }

  const manualNote = text(value?.manualNote, MAX_MANUAL_NOTE_LENGTH);
  if (!issues.length && !manualNote) {
    return { ok: false, error: 'Centang minimal satu poin atau tulis saran manual.' };
  }

  return {
    ok: true,
    value: {
      category,
      categoryLabel: config.label,
      issues,
      manualNote
    }
  };
}

export function buildMonthlyFeedbackEntitlementKey(customerId, businessDate) {
  const month = String(businessDate || '').slice(0, 7);
  return `MONTHLY:${customerId}:${month}`;
}

function buildSaleFeedbackEntitlementKey(saleId) {
  return `SALE:${saleId}`;
}

export async function findFeedbackAccess(db, storeId, customerId, businessDate = getJakartaBusinessDate()) {
  const latestReport = await db.prepare(`
    SELECT created_at
    FROM customer_feedback_reports
    WHERE customer_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(customerId).first();

  const saleParams = [storeId, customerId, QUALIFYING_SALE_AMOUNT];
  let saleSql = `
    SELECT s.id, s.created_at
    FROM sales s
    LEFT JOIN customer_feedback_reports f ON f.qualifying_sale_id = s.id
    WHERE s.store_id = ?
      AND s.customer_id = ?
      AND s.total_amount >= ?
      AND s.voided_at IS NULL
      AND f.id IS NULL
  `;
  if (latestReport?.created_at) {
    saleSql += ' AND s.created_at > ?';
    saleParams.push(latestReport.created_at);
  }
  saleSql += ' ORDER BY s.created_at DESC LIMIT 1';

  let qualifyingSale = null;
  try {
    qualifyingSale = await db.prepare(saleSql).bind(...saleParams).first();
  } catch (error) {
    // Sale-backed entitlement is an additional unlock, not the baseline path.
    // If a legacy/partial sale schema cannot answer this query, fail closed for
    // the sale unlock and continue with the unique monthly entitlement guard.
    console.error('customer feedback sale entitlement lookup failed; using monthly fallback', { storeId, error });
  }
  if (qualifyingSale) {
    return {
      available: true,
      entitlementType: 'QUALIFYING_SALE',
      entitlementKey: buildSaleFeedbackEntitlementKey(qualifyingSale.id),
      qualifyingSaleId: qualifyingSale.id
    };
  }

  const businessMonth = String(businessDate).slice(0, 7);
  const reportThisMonth = await db.prepare(`
    SELECT id
    FROM customer_feedback_reports
    WHERE customer_id = ? AND business_month = ?
    LIMIT 1
  `).bind(customerId, businessMonth).first();

  if (!reportThisMonth) {
    return {
      available: true,
      entitlementType: 'MONTHLY',
      entitlementKey: buildMonthlyFeedbackEntitlementKey(customerId, businessDate),
      qualifyingSaleId: null
    };
  }

  return { available: false };
}

function feedbackCode(storeCode, businessDate) {
  const datePart = String(businessDate).replaceAll('-', '');
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  return `FDB-${storeCode}-${datePart}-${suffix}`;
}

function unavailableResponse() {
  return json({
    error: 'Kotak saran belum tersedia untuk akun ini saat ini.',
    code: 'CUSTOMER_FEEDBACK_UNAVAILABLE'
  }, 403);
}

function isEntitlementConflict(error) {
  const message = String(error?.message ?? error).toLowerCase();
  return message.includes('unique') && (
    message.includes('entitlement_key') ||
    message.includes('qualifying_sale_id') ||
    message.includes('customer_feedback_reports')
  );
}

function mapManagementFeedback(row, issueRows) {
  const issues = issueRows.filter(issue => issue.report_id === row.id).map(issue => ({
    code: issue.issue_code,
    label: issue.issue_label_snapshot
  }));
  return {
    id: row.id,
    feedbackCode: row.feedback_code,
    category: row.category,
    categoryLabel: CUSTOMER_FEEDBACK_CATALOG[row.category]?.label || row.category,
    issues,
    manualNote: row.manual_note || '',
    rewardPoints: Number(row.reward_points || 0),
    createdAt: row.created_at,
    store: {
      id: row.store_id,
      code: row.store_code,
      storeName: row.store_name
    },
    reporter: {
      verifiedCustomer: true,
      label: 'Pelanggan terverifikasi · identitas dilindungi'
    }
  };
}

async function customerContext(request, env) {
  const store = await selectedStore(env.DB, request);
  if (!store) return { response: json({ error: 'Gerai tidak ditemukan atau sedang nonaktif.' }, 404) };
  const customer = await optionalCustomerFromRequest(request, env.DB, store.id);
  if (!customer) {
    return {
      response: json({
        error: 'Login pelanggan diperlukan untuk mengirim kotak saran.',
        code: 'CUSTOMER_LOGIN_REQUIRED'
      }, 401)
    };
  }
  return { store, customer };
}

async function handleCustomerAccess(request, env) {
  const context = await customerContext(request, env);
  if (context.response) return context.response;
  const access = await findFeedbackAccess(env.DB, context.store.id, context.customer.id);
  return json({
    available: Boolean(access.available),
    rewardPoints: CUSTOMER_FEEDBACK_REWARD_POINTS
  });
}

async function submitCustomerFeedback(request, env) {
  const context = await customerContext(request, env);
  if (context.response) return context.response;

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload kotak saran tidak valid.' }, 400);
  const normalized = normalizeFeedbackSubmission(body.value);
  if (!normalized.ok) return json({ error: normalized.error }, 400);

  const businessDate = getJakartaBusinessDate();
  const businessMonth = businessDate.slice(0, 7);
  const access = await findFeedbackAccess(env.DB, context.store.id, context.customer.id, businessDate);
  if (!access.available) return unavailableResponse();

  const reportId = `feedback_${crypto.randomUUID()}`;
  const code = feedbackCode(context.store.code, businessDate);
  const now = isoNow();
  const customerScope = await resolveCustomerScope(env.DB, context.store.id);
  const statements = [
    env.DB.prepare(`
      INSERT INTO customer_feedback_reports (
        id, feedback_code, store_id, customer_id, category, manual_note,
        business_month, entitlement_type, entitlement_key, qualifying_sale_id,
        reward_points, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      reportId,
      code,
      context.store.id,
      context.customer.id,
      normalized.value.category,
      normalized.value.manualNote,
      businessMonth,
      access.entitlementType,
      access.entitlementKey,
      access.qualifyingSaleId,
      CUSTOMER_FEEDBACK_REWARD_POINTS,
      now
    )
  ];

  for (const issue of normalized.value.issues) {
    statements.push(env.DB.prepare(`
      INSERT INTO customer_feedback_report_issues (
        id, report_id, issue_code, issue_label_snapshot, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).bind(
      `feedback_issue_${crypto.randomUUID()}`,
      reportId,
      issue.code,
      issue.label,
      now
    ));
  }

  statements.push(env.DB.prepare(`
    INSERT INTO customer_point_ledger (
      id, customer_id, share_group_id, source_store_id, points_delta,
      activity_type, reference_type, reference_id, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, 'EARN', 'CUSTOMER_FEEDBACK', ?, ?, ?)
  `).bind(
    `point_feedback_${crypto.randomUUID()}`,
    context.customer.id,
    customerScope.group?.id || null,
    context.store.id,
    CUSTOMER_FEEDBACK_REWARD_POINTS,
    reportId,
    `Bonus apresiasi kotak saran ${code}`,
    now
  ));

  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (isEntitlementConflict(error)) return unavailableResponse();
    throw error;
  }

  return json({
    ok: true,
    feedbackCode: code,
    rewardPoints: CUSTOMER_FEEDBACK_REWARD_POINTS,
    message: 'Saran sudah diterima. Terima kasih sudah membantu evaluasi MAXI Leker.'
  }, 201);
}

async function handleManagementFeedback(request, env) {
  const management = await requireManagement(request, env.DB);
  if (!management.ok) return management.response;

  const url = new URL(request.url);
  const params = [];
  const filters = [];

  if (management.admin) {
    filters.push('r.store_id = ?');
    params.push(management.admin.store.id);
  } else {
    const requestedStore = url.searchParams.get('store');
    if (requestedStore) {
      const store = await resolveStore(env.DB, requestedStore, { includeInactive: true });
      if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
      filters.push('r.store_id = ?');
      params.push(store.id);
    }
  }

  const category = text(url.searchParams.get('category'), 40).toUpperCase();
  if (category && CUSTOMER_FEEDBACK_CATALOG[category]) {
    filters.push('r.category = ?');
    params.push(category);
  }

  const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = await env.DB.prepare(`
    SELECT r.id, r.feedback_code, r.store_id, r.category, r.manual_note,
           r.reward_points, r.created_at,
           s.code AS store_code, s.store_name
    FROM customer_feedback_reports r
    JOIN stores s ON s.id = r.store_id
    ${whereSql}
    ORDER BY r.created_at DESC
    LIMIT 100
  `).bind(...params).all();

  const reports = rows.results ?? [];
  let issueRows = [];
  if (reports.length) {
    const issueResult = await env.DB.prepare(`
      SELECT report_id, issue_code, issue_label_snapshot
      FROM customer_feedback_report_issues
      WHERE report_id IN (${placeholders(reports.length)})
      ORDER BY created_at, issue_code
    `).bind(...reports.map(report => report.id)).all();
    issueRows = issueResult.results ?? [];
  }

  return json({
    privacy: 'Identitas pelanggan tidak ditampilkan pada list evaluasi.',
    feedback: reports.map(row => mapManagementFeedback(row, issueRows))
  });
}

export async function handleCustomerFeedbackApi(request, env, pathname) {
  if (request.method === 'GET' && pathname === '/api/customer/feedback/catalog') {
    return json({
      rewardPoints: CUSTOMER_FEEDBACK_REWARD_POINTS,
      categories: catalogPayload()
    });
  }

  if (request.method === 'GET' && pathname === '/api/customer/feedback/access') {
    return handleCustomerAccess(request, env);
  }

  if (request.method === 'POST' && pathname === '/api/customer/feedback') {
    return submitCustomerFeedback(request, env);
  }

  if (request.method === 'GET' && pathname === '/api/admin/customer-feedback') {
    return handleManagementFeedback(request, env);
  }

  if (pathname.startsWith('/api/customer/feedback') || pathname.startsWith('/api/admin/customer-feedback')) {
    return json({ error: 'Route kotak saran tidak ditemukan.' }, 404);
  }

  return null;
}
