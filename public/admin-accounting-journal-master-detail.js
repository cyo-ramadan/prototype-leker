(() => {
  const STYLE_ID = 'accountingJournalMasterDetailStyle';
  const WRAP_CLASS = 'acct-journal-master-detail';
  let selectedJournalId = '';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${WRAP_CLASS}{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(320px,.85fr);gap:14px;align-items:start}
      .${WRAP_CLASS} #acctJournalList{min-width:0}
      .${WRAP_CLASS} #acctJournalDetail{position:sticky;top:12px;min-width:0}
      .${WRAP_CLASS} #acctJournalDetail .acct-detail{margin-top:0}
      .${WRAP_CLASS} #acctJournalList tbody tr{cursor:pointer;transition:background .15s ease,box-shadow .15s ease}
      .${WRAP_CLASS} #acctJournalList tbody tr:hover{background:#f7f6f2}
      .${WRAP_CLASS} #acctJournalList tbody tr.is-selected{background:#f0f4f1;box-shadow:inset 3px 0 0 #557564}
      .${WRAP_CLASS} #acctJournalList tbody tr:focus-visible{outline:2px solid #668d74;outline-offset:-2px}
      .acct-journal-detail-empty{min-height:180px;border:1px dashed #d8d4ca;border-radius:11px;background:#faf9f6;display:grid;place-items:center;padding:24px;text-align:center;color:#817d73;font-size:12px;line-height:1.55}
      .acct-journal-detail-empty b{display:block;color:#39362f;font-size:14px;margin-bottom:5px}
      @media(max-width:980px){.${WRAP_CLASS}{grid-template-columns:1fr}.${WRAP_CLASS} #acctJournalDetail{position:static}.acct-journal-detail-empty{min-height:120px}}
    `;
    document.head.appendChild(style);
  }

  function detailPlaceholder(detailHost) {
    if (!detailHost || detailHost.children.length) return;
    detailHost.innerHTML = '<div class="acct-journal-detail-empty"><div><b>Pilih jurnal</b>Klik baris jurnal di sebelah kiri untuk melihat pasangan Debit/Kredit dan sumber transaksinya.</div></div>';
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
    const detailHost = document.getElementById('acctJournalDetail');
    if (!listHost || !detailHost) return;

    injectStyles();
    let wrapper = listHost.parentElement?.classList.contains(WRAP_CLASS) ? listHost.parentElement : null;
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = WRAP_CLASS;
      listHost.parentNode.insertBefore(wrapper, listHost);
      wrapper.append(listHost, detailHost);
    }

    bindList(listHost);
    prepareRows(listHost);
    detailPlaceholder(detailHost);
  }

  const observer = new MutationObserver(() => enhanceJournalView());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  enhanceJournalView();
})();
