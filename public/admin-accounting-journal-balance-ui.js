(() => {
  const integerFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
  let scheduled = false;
  let activeRun = 0;

  function normalizeExact(value) {
    const raw = String(value ?? '0').trim().replace(',', '.');
    const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(raw);
    if (!match) return null;
    const fraction = (match[3] || '').replace(/0+$/, '');
    return `${match[1]}${BigInt(match[2])}${fraction ? `.${fraction}` : ''}`;
  }

  function rpExact(value) {
    const normalized = normalizeExact(value) || '0';
    const negative = normalized.startsWith('-');
    const unsigned = negative ? normalized.slice(1) : normalized;
    const [whole, fraction = ''] = unsigned.split('.');
    return `${negative ? '- ' : ''}Rp ${integerFormat.format(BigInt(whole || '0'))}${fraction ? `,${fraction}` : ''}`;
  }

  async function api(path) {
    const response = await fetch(path, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  function currentJournalListPath() {
    const params = new URLSearchParams();
    const from = document.getElementById('acctJournalFrom')?.value || '';
    const to = document.getElementById('acctJournalTo')?.value || '';
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('limit', '500');
    return `/api/admin/accounting/journals?${params}`;
  }

  function ensureCreditColumn(table) {
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return;
    if (!headerRow.querySelector('[data-journal-credit-total]')) {
      const th = document.createElement('th');
      th.dataset.journalCreditTotal = 'true';
      th.textContent = 'Kredit';
      headerRow.insertBefore(th, headerRow.lastElementChild);
    }
    table.querySelectorAll('tbody tr').forEach(row => {
      if (row.querySelector('[data-journal-credit-total]')) return;
      const td = document.createElement('td');
      td.dataset.journalCreditTotal = 'true';
      td.textContent = '…';
      row.insertBefore(td, row.lastElementChild);
    });
  }

  async function hydrate() {
    const host = document.getElementById('acctJournalList');
    const table = host?.querySelector('table.acct-table');
    if (!table) return;
    ensureCreditColumn(table);

    const runId = ++activeRun;
    try {
      const payload = await api(currentJournalListPath());
      if (runId !== activeRun) return;
      const byId = new Map((payload.journals || []).map(row => [row.journalId, row]));
      table.querySelectorAll('tbody tr').forEach(row => {
        const button = row.querySelector('[data-journal-detail]');
        const cell = row.querySelector('td[data-journal-credit-total]');
        if (!button || !cell) return;
        const journal = byId.get(button.dataset.journalDetail);
        cell.textContent = journal ? rpExact(journal.totalCreditExact ?? journal.totalCreditMinor) : '—';
      });
    } catch {
      table.querySelectorAll('td[data-journal-credit-total]').forEach(cell => {
        if (cell.textContent === '…') cell.textContent = '—';
      });
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      hydrate();
    });
  }

  const observer = new MutationObserver(mutations => {
    if (mutations.some(mutation => mutation.target.closest?.('#acctJournalList') || document.getElementById('acctJournalList'))) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-acct-view="journals"], #acctLoadJournals, #accountingWorkspaceRefresh')) setTimeout(schedule, 0);
  });
  schedule();
})();
