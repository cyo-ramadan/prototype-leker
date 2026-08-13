import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getJakartaBusinessDate } from './time.js';
import {
  ACCOUNT_TYPES,
  createAccountingAccount,
  getAccountingJournal,
  getBalanceSheet,
  getGeneralLedger,
  getProfitLoss,
  listAccountingAccounts,
  listAccountingJournals,
  postAccountingJournal,
  updateAccountingAccount,
  validateBusinessDate
} from './accounting-ledger.js';

const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);

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

function monthStart(businessDate) {
  return `${businessDate.slice(0, 7)}-01`;
}

async function bootstrap(db, store) {
  const businessDate = getJakartaBusinessDate();
  const [accounts, journals] = await Promise.all([
    listAccountingAccounts(db, store.id),
    listAccountingJournals(db, store.id, { limit: 12 })
  ]);
  return {
    contract: 'MAXI_ACCOUNTING_WORKSPACE_V1',
    compositionMode: 'PROTOTYPE_LOCAL_ACCOUNTING_HOST',
    canonicalTarget: '@maxi/accounting@1.3.0',
    bridgeBoundary: 'BUSINESS_FACT_TO_ACCOUNTING_COMMAND',
    store,
    currentBusinessDate: businessDate,
    defaultPeriod: { from: monthStart(businessDate), to: businessDate },
    accountTypes: ACCOUNT_TYPES,
    accountCodePolicy: 'AUTO_UNIQUE_SERVER_SEQUENCE',
    postedJournalPolicy: 'IMMUTABLE_REVERSAL_ONLY',
    accounts,
    recentJournals: journals
  };
}

function resultResponse(result, successStatus = 200) {
  if (result?.ok === false) {
    return json({ error: result.error, code: result.code, ...(result.totalDebitMinor !== undefined ? {
      totalDebitMinor: result.totalDebitMinor,
      totalCreditMinor: result.totalCreditMinor
    } : {}) }, result.status || 400);
  }
  return json(result, successStatus);
}

async function createAccount(request, env, store) {
  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload akun tidak valid.' }, 400);
  return resultResponse(await createAccountingAccount(env.DB, store, body.value), 201);
}

async function updateAccount(request, env, store, accountId) {
  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload akun tidak valid.' }, 400);
  return resultResponse(await updateAccountingAccount(env.DB, store, accountId, body.value));
}

async function createManualJournal(request, env, store) {
  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload jurnal tidak valid.' }, 400);
  const sourceReferenceId = text(body.value?.sourceReferenceId, 180) || `manual_${crypto.randomUUID()}`;
  const command = {
    businessDate: body.value?.businessDate,
    occurredAt: new Date().toISOString(),
    sourceSystem: 'MANUAL',
    sourceReferenceId,
    correlationId: text(body.value?.correlationId, 180) || sourceReferenceId,
    idempotencyKey: `MANUAL:${store.id}:${sourceReferenceId}`,
    description: body.value?.description,
    journalLines: body.value?.journalLines
  };
  const result = await postAccountingJournal(env.DB, store, command);
  return resultResponse(result, result?.duplicate ? 200 : 201);
}

export async function handleAccountingWorkspaceApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/accounting')) return null;
  const ctx = await managementContext(request, env);
  if (!ctx.ok) return ctx.response;
  const { store } = ctx;
  const url = new URL(request.url);

  if (request.method === 'GET' && pathname === '/api/admin/accounting') {
    return json(await bootstrap(env.DB, store));
  }

  if (pathname === '/api/admin/accounting/accounts') {
    if (request.method === 'GET') return json({ accounts: await listAccountingAccounts(env.DB, store.id) });
    if (request.method === 'POST') return createAccount(request, env, store);
  }
  const accountMatch = pathname.match(/^\/api\/admin\/accounting\/accounts\/([^/]+)$/);
  if (request.method === 'PATCH' && accountMatch) {
    return updateAccount(request, env, store, decodeURIComponent(accountMatch[1]));
  }

  if (pathname === '/api/admin/accounting/journals') {
    if (request.method === 'GET') {
      return json({
        journals: await listAccountingJournals(env.DB, store.id, {
          from: url.searchParams.get('from') || '',
          to: url.searchParams.get('to') || '',
          limit: url.searchParams.get('limit') || 200
        })
      });
    }
    if (request.method === 'POST') return createManualJournal(request, env, store);
  }
  const journalMatch = pathname.match(/^\/api\/admin\/accounting\/journals\/([^/]+)$/);
  if (request.method === 'GET' && journalMatch) {
    const journal = await getAccountingJournal(env.DB, store.id, decodeURIComponent(journalMatch[1]));
    return journal ? json({ journal }) : json({ error: 'Jurnal tidak ditemukan.', code: 'JOURNAL_NOT_FOUND' }, 404);
  }

  if (request.method === 'GET' && pathname === '/api/admin/accounting/ledger') {
    const accountId = text(url.searchParams.get('accountId'), 180);
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    if (!accountId) return json({ error: 'Akun buku besar wajib dipilih.', code: 'ACCOUNT_REQUIRED' }, 400);
    const ledger = await getGeneralLedger(env.DB, store.id, accountId, from, to);
    if (!ledger) return json({ error: 'Akun buku besar tidak ditemukan.', code: 'ACCOUNT_NOT_FOUND' }, 404);
    if (ledger.error) return json({ error: ledger.error, code: ledger.code }, 400);
    return json({ ledger });
  }

  if (request.method === 'GET' && pathname === '/api/admin/accounting/profit-loss') {
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    const report = await getProfitLoss(env.DB, store.id, from, to);
    if (report.error) return json({ error: report.error, code: report.code }, 400);
    return json({ report });
  }

  if (request.method === 'GET' && pathname === '/api/admin/accounting/balance-sheet') {
    const asOf = url.searchParams.get('asOf') || '';
    const report = await getBalanceSheet(env.DB, store.id, asOf);
    if (report.error) return json({ error: report.error, code: report.code }, 400);
    return json({ report });
  }

  if (request.method === 'GET' && pathname === '/api/admin/accounting/validate-date') {
    const value = url.searchParams.get('date') || '';
    return json({ valid: Boolean(validateBusinessDate(value)) });
  }

  return json({ error: 'Route Akuntansi tidak ditemukan.' }, 404);
}
