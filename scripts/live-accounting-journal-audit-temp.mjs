const BASE = 'https://prototype-leker-v2.daily-napkin.workers.dev';
const STORE = 'G001';
const TARGET_JOURNAL_ID = 'journal_d3b5b5f6-9f7a-4f97-a4ae-72098458446a';
const TARGET_FACT_ID = 'expense_d895a181-870e-4a6c-937b-2988fe6748b7';

async function req(path, { method = 'GET', token = '', body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(BASE + path, {
      method,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${JSON.stringify(payload)}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function assert(condition, message, detail) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(detail || {})}`);
}

const login = await req('/api/store-admin/login', {
  method: 'POST',
  body: { username: 'bablil', password: 'bablil123' }
});
assert(login.token, 'Admin token missing', login);

const bootstrap = await req(`/api/admin/accounting?store=${STORE}`, { token: login.token });
const list = await req(`/api/admin/accounting/journals?store=${STORE}&from=2026-08-16&to=2026-08-16&limit=200`, { token: login.token });
const detail = await req(`/api/admin/accounting/journals/${encodeURIComponent(TARGET_JOURNAL_ID)}?store=${STORE}`, { token: login.token });

const targetRow = (list.journals || []).find(row => row.journalId === TARGET_JOURNAL_ID || row.sourceReferenceId === TARGET_FACT_ID);
assert(targetRow, 'Target transaction journal not present in Data Jurnal API list', { targetJournalId: TARGET_JOURNAL_ID, targetFactId: TARGET_FACT_ID, journals: list.journals });
assert(String(targetRow.totalDebitExact ?? targetRow.totalDebitMinor) === String(targetRow.totalCreditExact ?? targetRow.totalCreditMinor), 'Data Jurnal aggregate is unbalanced', targetRow);

const journal = detail.journal;
assert(journal?.journalId === TARGET_JOURNAL_ID, 'Journal detail missing', detail);
const debitLines = (journal.lines || []).filter(line => line.side === 'DEBIT');
const creditLines = (journal.lines || []).filter(line => line.side === 'CREDIT');
assert(debitLines.length > 0, 'Journal detail has no Debit lines', journal);
assert(creditLines.length > 0, 'Journal detail has no Credit lines', journal);

const debitScaled = debitLines.reduce((sum, line) => sum + BigInt(line.amountScaled || 0), 0n);
const creditScaled = creditLines.reduce((sum, line) => sum + BigInt(line.amountScaled || 0), 0n);
assert(debitScaled === creditScaled, 'Journal detail Debit/Credit totals differ', { debitScaled: String(debitScaled), creditScaled: String(creditScaled), lines: journal.lines });

console.log('=== LIVE ACCOUNTING JOURNAL AUDIT PASS ===');
console.log(JSON.stringify({
  targetFactId: TARGET_FACT_ID,
  targetJournalId: TARGET_JOURNAL_ID,
  recentJournals: (bootstrap.recentJournals || []).slice(0, 12),
  dataJurnalRow: targetRow,
  journalDetail: journal,
  observation: 'The API stores both Debit and Credit. The current Data Jurnal list UI renders only the Debit aggregate column; Credit appears only in journal Detail.'
}, null, 2));
