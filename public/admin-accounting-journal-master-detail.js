(() => {
  const STYLE_ID = 'accountingJournalMasterDetailStyle';
  let selectedJournalId = '';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #acctJournalList tbody tr{cursor:pointer;transition:background .15s ease,box-shadow .15s ease}
      #acctJournalList tbody tr:hover{background:#f7f6f2}
      #acctJournalList tbody tr.is-selected{background:#f0f4f1;box-shadow:inset 3px 0 0 #557564}
      #acctJournalList tbody tr:focus-visible{outline:2px solid #668d74;outline-offset:-2px}
    `;
    document.head.appendChild(style);
  }

  function markSelected(listHost, journalId) {
    selectedJournalId = String(journalId || '');
    listHost.querySelectorAll('tbody tr').forEach(row => {
      const rowId = row.querySelector('[data-journal-detail]')?.dataset.journalDetail || '';
      const selected = rowId === selectedJournalId;
      row.classList.toggle('is-selected', selected);
      row.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  function activateRow(row, listHost) {
    const button = row?.querySelector('[data-journal-detail]');
    if (!button) return;
    markSelected(listHost, button.dataset.journalDetail);
    button.click();
  }

  function bindList(listHost) {
    if (!listHost || listHost.dataset.masterDetailBound === '1') return;
    listHost.dataset.masterDetailBound = '1';

    listHost.addEventListener('click', event => {
      const row = event.target.closest('tbody tr');
      if (!row || !listHost.contains(row)) return;
      const button = row.querySelector('[data-journal-detail]');
      if (!button) return;
      markSelected(listHost, button.dataset.journalDetail);
      if (!event.target.closest('[data-journal-detail]')) button.click();
    });

    listHost.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('tbody tr');
      if (!row || !listHost.contains(row)) return;
      event.preventDefault();
      activateRow(row, listHost);
    });
  }

  function prepareRows(listHost) {
    listHost?.querySelectorAll('tbody tr').forEach(row => {
      if (!row.querySelector('[data-journal-detail]')) return;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
    });
    if (selectedJournalId) markSelected(listHost, selectedJournalId);
  }

  function enhanceJournalView() {
    const listHost = document.getElementById('acctJournalList');
    if (!listHost) return;

    injectStyles();
    bindList(listHost);
    prepareRows(listHost);
  }

  const observer = new MutationObserver(() => enhanceJournalView());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  enhanceJournalView();
})();
