(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
  const integerFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
  const SCALE = 1000000n;
  const state = {
    bootstrap: null,
    view: 'accounts',
    editingAccountId: '',
    journalLines: [{ key: 'l1', accountId: '', debit: '', credit: '', description: '' }, { key: 'l2', accountId: '', debit: '', credit: '', description: '' }],
    journalDetail: null,
    ledger: null,
    profitLoss: null,
    balanceSheet: null
  };

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: { ...(options.headers || {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  function toast(message) {
    const node = el('adminToast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 2800);
  }

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

  function inputToScaled(value) {
    const raw = String(value ?? '').trim().replace(',', '.');
    const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
    if (!match) return null;
    const whole = BigInt(match[1]);
    const fraction = match[2] || '';
    const kept = fraction.slice(0, 6).padEnd(6, '0');
    let scaled = whole * SCALE + BigInt(kept || '0');
    if (fraction.length > 6 && Number(fraction[6]) >= 5) scaled += 1n;
    return scaled;
  }

  function scaledToExact(value) {
    const amount = BigInt(value || 0);
    const negative = amount < 0n;
    const unsigned = negative ? -amount : amount;
    const whole = unsigned / SCALE;
    const fraction = String(unsigned % SCALE).padStart(6, '0').replace(/0+$/, '');
    return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
  }

  function sourceLabel(source) {
    if (source === 'MANUAL') return 'Manual';
    if (source === 'LEKER_POS') return 'POS';
    if (source === 'WAREHOUSE') return 'Warehouse';
    return source || '-';
  }

  function injectStyles() {
    if (el('accountingWorkspaceStyle')) return;
    const style = document.createElement('style');
    style.id = 'accountingWorkspaceStyle';
    style.textContent = `
      #tab-accounting-workspace{padding:0!important;background:#f6f5f1;border:1px solid #e3e0d6;border-radius:18px;overflow:hidden}
      .acct-shell{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:720px;color:#211f1b}
      .acct-side{background:#17201c;color:#e9ece8;display:flex;flex-direction:column}.acct-brand{padding:22px 18px;border-bottom:1px solid rgba(255,255,255,.09)}
      .acct-brand small{display:block;color:#80aa91;font-size:10px;letter-spacing:.16em;font-weight:800;margin-bottom:5px}.acct-brand strong{font-size:20px}
      .acct-nav{display:grid;padding:10px 0}.acct-nav button{border:0;border-left:3px solid transparent;background:transparent;color:#a9b0aa;text-align:left;padding:12px 16px;cursor:pointer;font:inherit;font-size:13px}
      .acct-nav button:hover{background:rgba(255,255,255,.04);color:#fff}.acct-nav button.active{border-left-color:#80aa91;background:rgba(255,255,255,.07);color:#fff;font-weight:700}
      .acct-note{margin-top:auto;padding:14px 16px;border-top:1px solid rgba(255,255,255,.09);font-size:10.5px;line-height:1.55;color:#7f8b83}
      .acct-main{min-width:0;background:#faf9f6}.acct-toolbar{display:flex;align-items:center;justify-content:space-between;padding:15px 22px;border-bottom:1px solid #e7e3da;background:#fff}
      .acct-toolbar b{font-size:13px}.acct-refresh{border:1px solid #ddd9cf;background:#fff;border-radius:8px;padding:7px 10px;cursor:pointer}
      .acct-page{padding:22px}.acct-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:18px}.acct-head h2{margin:0 0 5px;font-size:22px}.acct-head p{margin:0;color:#716d64;font-size:13px;max-width:720px;line-height:1.5}
      .acct-grid{display:grid;grid-template-columns:minmax(260px,.7fr) minmax(0,1.6fr);gap:14px;align-items:start}.acct-card{background:#fff;border:1px solid #e2dfd6;border-radius:11px;padding:15px}
      .acct-card h3{margin:0 0 12px;font-size:15px}.acct-field{display:grid;gap:4px;margin-bottom:10px}.acct-field span{font-size:10px;color:#817d73;text-transform:uppercase;letter-spacing:.05em}
      .acct-input,.acct-select{box-sizing:border-box;width:100%;border:1px solid #ddd9cf;border-radius:8px;background:#fff;padding:9px 10px;font:inherit;font-size:13px;color:#26231e}.acct-input:focus,.acct-select:focus{outline:2px solid rgba(91,133,107,.18);border-color:#668d74}
      .acct-btn{border:1px solid #d7d3c8;border-radius:8px;background:#fff;padding:8px 11px;cursor:pointer;font-size:12px}.acct-btn.primary{background:#557564;border-color:#557564;color:#fff;font-weight:700}.acct-btn.danger{color:#a74d4d}.acct-btn:disabled{opacity:.45;cursor:not-allowed}
      .acct-actions{display:flex;gap:8px;flex-wrap:wrap}.acct-table-wrap{overflow:auto}.acct-table{width:100%;border-collapse:collapse;font-size:12px}.acct-table th{text-align:left;padding:9px 10px;color:#817d73;font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #e6e2d9;white-space:nowrap}.acct-table td{padding:9px 10px;border-bottom:1px solid #eeece5;vertical-align:top}.acct-table tr:last-child td{border-bottom:0}
      .acct-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#656158}.acct-chip{display:inline-flex;border-radius:999px;border:1px solid #dad6cc;padding:3px 7px;font-size:9.5px;background:#f5f3ee}.acct-chip.manual{background:#eef5ff;color:#315f91;border-color:#c9dbef}.acct-chip.pos{background:#edf8f1;color:#2b724a;border-color:#c7e4d1}.acct-chip.inactive{background:#f3f1ed;color:#8b877e}
      .acct-journal-lines{display:grid;gap:8px}.acct-journal-line{display:grid;grid-template-columns:minmax(170px,1.4fr) 130px 130px minmax(140px,1fr) 36px;gap:7px;align-items:center;padding:9px;background:#faf9f6;border:1px solid #e8e4da;border-radius:9px}.acct-line-head{font-size:9px;text-transform:uppercase;color:#89857c;letter-spacing:.06em}
      .acct-total{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.acct-total div{border:1px solid #dfdbd1;border-radius:9px;padding:10px;background:#faf9f6}.acct-total small{display:block;color:#888379;margin-bottom:4px}.acct-total b{font-size:16px}.acct-total .balanced{color:#287347}.acct-total .unbalanced{color:#a55a30}
      .acct-filters{display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:12px}.acct-filters .acct-field{margin:0;min-width:150px}.acct-detail{margin-top:14px}.acct-detail-head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px}
      .acct-report-section{margin-bottom:16px}.acct-report-section h3{font-size:13px;margin:0 0 8px}.acct-report-total{display:flex;justify-content:space-between;border-top:1px solid #dedad0;padding-top:9px;margin-top:8px;font-weight:800}.acct-report-total.grand{font-size:16px;border-top:2px solid #bbb4a8}
      .acct-empty{padding:24px;text-align:center;color:#8a867c;font-size:12px}.acct-balance-ok{color:#2c7b4d}.acct-balance-bad{color:#ad573f}
      @media(max-width:900px){.acct-shell{grid-template-columns:170px minmax(0,1fr)}.acct-grid{grid-template-columns:1fr}.acct-journal-line{grid-template-columns:1fr 1fr}.acct-line-account,.acct-line-desc{grid-column:1/-1}}
      @media(max-width:660px){.acct-shell{display:block}.acct-side{min-height:auto}.acct-nav{display:flex;overflow:auto;padding:4px}.acct-nav button{border-left:0;border-bottom:3px solid transparent;white-space:nowrap;padding:10px}.acct-nav button.active{border-bottom-color:#80aa91}.acct-note{display:none}.acct-page{padding:14px}.acct-toolbar{padding:12px 14px}.acct-journal-line{grid-template-columns:1fr 1fr}.acct-total{grid-template-columns:1fr 1fr}}
    `;
    document.head.appendChild(style);
  }

  function navButton(key, label) {
    return `<button type="button" data-acct-view="${key}" class="${state.view === key ? 'active' : ''}">${label}</button>`;
  }

  function shellHtml() {
    return `<div class="acct-shell">
      <aside class="acct-side">
        <div class="acct-brand"><small>MAXI · ACCOUNTING</small><strong>Akuntansi</strong></div>
        <nav class="acct-nav">
          ${navButton('accounts','Data Akun')}
          ${navButton('journal-create','Buat Jurnal')}
          ${navButton('journals','Data Jurnal')}
          ${navButton('ledger','Buku Besar')}
          ${navButton('profit-loss','Rugi Laba')}
          ${navButton('balance-sheet','Neraca')}
        </nav>
        <div class="acct-note">Akuntansi adalah pemilik akun, jurnal, ledger, dan laporan. Nominal jurnal disimpan exact sampai 6 desimal; jurnal sistem boleh memakai akun Penyesuaian untuk selisih maksimal Rp100.</div>
      </aside>
      <main class="acct-main"><div class="acct-toolbar"><b>Gerai <span data-store-code>${esc(window.LEKER_STORE_CODE || 'G001')}</span></b><button id="accountingWorkspaceRefresh" class="acct-refresh" type="button">↻ Refresh</button></div><div id="accountingWorkspaceBody"></div></main>
    </div>`;
  }

  function accountOptions(selected = '', activeOnly = true) {
    const rows = (state.bootstrap?.accounts || []).filter(account => !activeOnly || account.isActive);
    return `<option value="">Pilih akun…</option>${rows.map(account => `<option value="${esc(account.accountId)}" ${account.accountId === selected ? 'selected' : ''}>${esc(account.accountCode)} — ${esc(account.accountName)}</option>`).join('')}`;
  }

  function period() {
    return state.bootstrap?.defaultPeriod || { from: '', to: '' };
  }

  async function load(force = false) {
    if (!state.bootstrap || force) state.bootstrap = await api('/api/admin/accounting');
    render();
  }

  function render() {
    const host = el('accountingWorkspaceBody');
    if (!host || !state.bootstrap) return;
    if (state.view === 'accounts') renderAccounts(host);
    else if (state.view === 'journal-create') renderJournalCreate(host);
    else if (state.view === 'journals') renderJournals(host);
    else if (state.view === 'ledger') renderLedger(host);
    else if (state.view === 'profit-loss') renderProfitLoss(host);
    else renderBalanceSheet(host);
    document.querySelectorAll('[data-acct-view]').forEach(button => button.classList.toggle('active', button.dataset.acctView === state.view));
  }

  function renderAccounts(host) {
    const editing = state.bootstrap.accounts.find(account => account.accountId === state.editingAccountId) || null;
    host.innerHTML = `<div class="acct-page"><div class="acct-head"><div><h2>Data Akun</h2><p>Buat dan kelola akun di sini. Kode akun dibuat otomatis oleh program dan tidak diedit manual. Akun sistem Penyesuaian dikunci oleh Accounting.</p></div></div>
      <div class="acct-grid">
        <form id="acctAccountForm" class="acct-card">
          <h3>${editing ? `Atur ${esc(editing.accountCode)}` : 'Buat Akun Baru'}</h3>
          ${editing ? `<div class="acct-field"><span>Kode otomatis</span><input class="acct-input" value="${esc(editing.accountCode)}" disabled /></div>` : '<div class="acct-field"><span>Kode Akun</span><input class="acct-input" value="Dibuat otomatis saat simpan" disabled /></div>'}
          <label class="acct-field"><span>Nama Akun</span><input id="acctAccountName" class="acct-input" maxlength="100" value="${esc(editing?.accountName || '')}" required /></label>
          <label class="acct-field"><span>Tipe</span><select id="acctAccountType" class="acct-select" ${editing ? 'disabled' : ''}>${state.bootstrap.accountTypes.map(type => `<option ${editing?.accountType === type ? 'selected' : ''}>${type}</option>`).join('')}</select></label>
          <label class="acct-field"><span>Subtype / Kelompok</span><input id="acctAccountSubtype" class="acct-input" maxlength="60" value="${esc(editing?.subtype || '')}" placeholder="optional" /></label>
          ${editing ? `<label class="acct-field"><span>Status</span><select id="acctAccountActive" class="acct-select"><option value="1" ${editing.isActive ? 'selected' : ''}>Aktif</option><option value="0" ${!editing.isActive ? 'selected' : ''}>Nonaktif</option></select></label>` : ''}
          <div class="acct-actions"><button class="acct-btn primary" type="submit">${editing ? 'Simpan Perubahan' : 'Buat Akun'}</button>${editing ? '<button id="acctCancelAccountEdit" class="acct-btn" type="button">Batal</button>' : ''}</div>
        </form>
        <div class="acct-card"><h3>Chart of Accounts</h3><div class="acct-table-wrap"><table class="acct-table"><thead><tr><th>Kode</th><th>Nama</th><th>Tipe</th><th>Status</th><th></th></tr></thead><tbody>${state.bootstrap.accounts.map(account => `<tr><td class="acct-code">${esc(account.accountCode)}</td><td>${esc(account.accountName)}${account.isSystemManaged ? ' <span class="acct-chip">System</span>' : account.reviewRequired ? ' <span class="acct-chip">Review</span>' : ''}</td><td>${esc(account.accountType)}</td><td><span class="acct-chip ${account.isActive ? '' : 'inactive'}">${account.isActive ? 'Aktif' : 'Nonaktif'}</span></td><td>${account.isSystemManaged ? '<span class="acct-code">Dikelola sistem</span>' : `<button class="acct-btn" data-edit-acct-account="${esc(account.accountId)}" type="button">Atur</button>`}</td></tr>`).join('')}</tbody></table></div></div>
      </div></div>`;
    el('acctAccountForm').addEventListener('submit', saveAccount);
    el('acctCancelAccountEdit')?.addEventListener('click', () => { state.editingAccountId = ''; renderAccounts(host); });
    host.querySelectorAll('[data-edit-acct-account]').forEach(button => button.addEventListener('click', () => { state.editingAccountId = button.dataset.editAcctAccount; renderAccounts(host); }));
  }

  async function saveAccount(event) {
    event.preventDefault();
    const editing = state.bootstrap.accounts.find(account => account.accountId === state.editingAccountId) || null;
    const payload = { accountName: el('acctAccountName').value, subtype: el('acctAccountSubtype').value };
    if (editing) payload.isActive = el('acctAccountActive').value === '1';
    else payload.accountType = el('acctAccountType').value;
    try {
      const result = await api(editing ? `/api/admin/accounting/accounts/${encodeURIComponent(editing.accountId)}` : '/api/admin/accounting/accounts', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      state.editingAccountId = '';
      await load(true);
      toast(editing ? 'Akun diperbarui' : `Akun dibuat · ${result.accountCode}`);
    } catch (error) { toast(error.message); }
  }

  function journalLineHtml(line) {
    return `<div class="acct-journal-line" data-journal-line="${esc(line.key)}">
      <div class="acct-line-account"><div class="acct-line-head">Akun</div><select class="acct-select" data-line-account>${accountOptions(line.accountId)}</select></div>
      <div><div class="acct-line-head">Debit (Rp)</div><input class="acct-input" data-line-debit type="number" min="0" step="0.000001" value="${esc(line.debit)}" placeholder="0" /></div>
      <div><div class="acct-line-head">Kredit (Rp)</div><input class="acct-input" data-line-credit type="number" min="0" step="0.000001" value="${esc(line.credit)}" placeholder="0" /></div>
      <div class="acct-line-desc"><div class="acct-line-head">Keterangan baris</div><input class="acct-input" data-line-desc value="${esc(line.description)}" /></div>
      <button class="acct-btn danger" data-remove-line type="button" ${state.journalLines.length <= 2 ? 'disabled' : ''}>×</button>
    </div>`;
  }

  function journalTotals() {
    let debitScaled = 0n;
    let creditScaled = 0n;
    for (const line of state.journalLines) {
      const debit = inputToScaled(line.debit);
      const credit = inputToScaled(line.credit);
      if (debit && debit > 0n) debitScaled += debit;
      if (credit && credit > 0n) creditScaled += credit;
    }
    return {
      debitScaled,
      creditScaled,
      debitExact: scaledToExact(debitScaled),
      creditExact: scaledToExact(creditScaled),
      balanced: debitScaled > 0n && debitScaled === creditScaled
    };
  }

  function renderJournalCreate(host) {
    const totals = journalTotals();
    host.innerHTML = `<div class="acct-page"><div class="acct-head"><div><h2>Buat Jurnal</h2><p>Jurnal manual wajib balance exact. Nominal menerima sampai 6 desimal; digit selebihnya dibulatkan half-up oleh server. Auto Penyesuaian Rp100 hanya berlaku untuk jurnal sistem.</p></div></div>
      <form id="acctJournalForm" class="acct-card">
        <div class="acct-grid" style="grid-template-columns:180px minmax(0,1fr)"><label class="acct-field"><span>Tanggal</span><input id="acctJournalDate" class="acct-input" type="date" value="${esc(state.bootstrap.currentBusinessDate)}" required /></label><label class="acct-field"><span>Keterangan Jurnal</span><input id="acctJournalDescription" class="acct-input" maxlength="300" placeholder="Contoh: Setoran modal tambahan" required /></label></div>
        <h3 style="margin-top:14px">Baris Jurnal</h3><div id="acctJournalLines" class="acct-journal-lines">${state.journalLines.map(journalLineHtml).join('')}</div>
        <button id="acctAddJournalLine" class="acct-btn" type="button" style="margin-top:9px">＋ Tambah Baris</button>
        <div class="acct-total"><div><small>Total Debit</small><b id="acctDebitTotal">${rpExact(totals.debitExact)}</b></div><div><small>Total Kredit</small><b id="acctCreditTotal" class="${totals.balanced ? 'balanced' : 'unbalanced'}">${rpExact(totals.creditExact)}</b></div></div>
        <div class="acct-actions"><button id="acctPostJournal" class="acct-btn primary" type="submit" ${totals.balanced ? '' : 'disabled'}>Posting Jurnal</button><span id="acctJournalBalanceHelp" class="acct-chip ${totals.balanced ? '' : 'inactive'}">${totals.balanced ? 'Debit = Kredit exact' : 'Jurnal manual belum balance'}</span></div>
      </form></div>`;
    bindJournalLines(host);
    el('acctAddJournalLine').addEventListener('click', () => { state.journalLines.push({ key: `l_${crypto.randomUUID()}`, accountId: '', debit: '', credit: '', description: '' }); renderJournalCreate(host); });
    el('acctJournalForm').addEventListener('submit', postManualJournal);
  }

  function bindJournalLines(host) {
    host.querySelectorAll('[data-journal-line]').forEach(row => {
      const line = state.journalLines.find(item => item.key === row.dataset.journalLine);
      if (!line) return;
      row.querySelector('[data-line-account]').addEventListener('change', event => { line.accountId = event.target.value; });
      row.querySelector('[data-line-debit]').addEventListener('input', event => { line.debit = event.target.value; if ((inputToScaled(event.target.value) || 0n) > 0n) { line.credit = ''; row.querySelector('[data-line-credit]').value = ''; } refreshJournalTotals(); });
      row.querySelector('[data-line-credit]').addEventListener('input', event => { line.credit = event.target.value; if ((inputToScaled(event.target.value) || 0n) > 0n) { line.debit = ''; row.querySelector('[data-line-debit]').value = ''; } refreshJournalTotals(); });
      row.querySelector('[data-line-desc]').addEventListener('input', event => { line.description = event.target.value; });
      row.querySelector('[data-remove-line]').addEventListener('click', () => { if (state.journalLines.length > 2) { state.journalLines = state.journalLines.filter(item => item.key !== line.key); renderJournalCreate(host); } });
    });
  }

  function refreshJournalTotals() {
    const totals = journalTotals();
    el('acctDebitTotal').textContent = rpExact(totals.debitExact);
    el('acctCreditTotal').textContent = rpExact(totals.creditExact);
    el('acctCreditTotal').className = totals.balanced ? 'balanced' : 'unbalanced';
    el('acctPostJournal').disabled = !totals.balanced;
    el('acctJournalBalanceHelp').textContent = totals.balanced ? 'Debit = Kredit exact' : 'Jurnal manual belum balance';
  }

  async function postManualJournal(event) {
    event.preventDefault();
    const journalLines = [];
    for (const line of state.journalLines) {
      const debit = inputToScaled(line.debit);
      const credit = inputToScaled(line.credit);
      if (!line.accountId) return toast('Semua baris jurnal wajib memilih akun');
      if (debit && debit > 0n) journalLines.push({ accountId: line.accountId, side: 'DEBIT', amountExact: String(line.debit).replace(',', '.'), description: line.description });
      else if (credit && credit > 0n) journalLines.push({ accountId: line.accountId, side: 'CREDIT', amountExact: String(line.credit).replace(',', '.'), description: line.description });
      else return toast('Setiap baris wajib memiliki Debit atau Kredit');
    }
    try {
      const result = await api('/api/admin/accounting/journals', { method: 'POST', body: JSON.stringify({ businessDate: el('acctJournalDate').value, description: el('acctJournalDescription').value, sourceReferenceId: `manual_${crypto.randomUUID()}`, journalLines }) });
      state.journalLines = [{ key: 'l1', accountId: '', debit: '', credit: '', description: '' }, { key: 'l2', accountId: '', debit: '', credit: '', description: '' }];
      state.view = 'journals';
      await load(true);
      toast(`Jurnal ${result.journal?.journalNumber || ''} terposting`);
    } catch (error) { toast(error.message); }
  }

  function renderJournals(host) {
    const p = period();
    host.innerHTML = `<div class="acct-page"><div class="acct-head"><div><h2>Data Jurnal</h2><p>Semua posted journal ada di sini: jurnal manual dan jurnal hasil transaksi sistem melalui bridge.</p></div></div>
      <div class="acct-card"><div class="acct-filters"><label class="acct-field"><span>Dari</span><input id="acctJournalFrom" class="acct-input" type="date" value="${esc(p.from)}" /></label><label class="acct-field"><span>Sampai</span><input id="acctJournalTo" class="acct-input" type="date" value="${esc(p.to)}" /></label><button id="acctLoadJournals" class="acct-btn primary" type="button">Tampilkan</button></div><div id="acctJournalList"></div></div></div>`;
    el('acctLoadJournals').addEventListener('click', loadJournals);
    renderJournalList(state.bootstrap.recentJournals || []);
  }

  async function loadJournals() {
    try {
      const params = new URLSearchParams({ from: el('acctJournalFrom').value, to: el('acctJournalTo').value });
      const result = await api(`/api/admin/accounting/journals?${params}`);
      renderJournalList(result.journals || []);
    } catch (error) { toast(error.message); }
  }

  function renderJournalList(rows) {
    const host = el('acctJournalList');
    if (!host) return;
    host.innerHTML = rows.length ? `<div class="acct-table-wrap"><table class="acct-table"><thead><tr><th>No Jurnal</th><th>Tanggal</th><th>Sumber</th><th>Keterangan</th><th>Debit</th><th>Kredit</th><th></th></tr></thead><tbody>${rows.map(row => `<tr><td class="acct-code">${esc(row.journalNumber)}</td><td>${esc(row.businessDate)}</td><td><span class="acct-chip ${row.sourceSystem === 'MANUAL' ? 'manual' : 'pos'}">${esc(sourceLabel(row.sourceSystem))}</span></td><td>${esc(row.description)}</td><td>${rpExact(row.totalDebitExact ?? row.totalDebitMinor)}</td><td>${rpExact(row.totalCreditExact ?? row.totalCreditMinor)}</td><td><button class="acct-btn" data-journal-detail="${esc(row.journalId)}" type="button">Detail</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="acct-empty">Belum ada jurnal pada periode ini.</div>';
    host.querySelectorAll('[data-journal-detail]').forEach(button => button.addEventListener('click', () => loadJournalDetail(button.dataset.journalDetail)));
  }

  async function loadJournalDetail(journalId) {
    try {
      const result = await api(`/api/admin/accounting/journals/${encodeURIComponent(journalId)}`);
      state.journalDetail = result.journal;
      const j = result.journal;
      window.openAdminDetailModal({
        head: `<div><div class="admin-eyebrow">Journal Detail</div><h2>${esc(j.journalNumber)}</h2><div class="muted">${esc(j.sourceSystem)} · ${esc(j.sourceReferenceId)} · ${esc(j.businessDate)}</div></div>`,
        body: `<div class="acct-detail"><div class="acct-detail-head"><div>${esc(j.description)}</div><span class="acct-chip">POSTED · immutable</span></div><div class="acct-table-wrap" style="margin-top:10px"><table class="acct-table"><thead><tr><th>Akun</th><th>Debit</th><th>Kredit</th><th>Keterangan</th></tr></thead><tbody>${j.lines.map(line => `<tr><td>${esc(line.accountCode)} — ${esc(line.accountName)}${line.isSystemGenerated ? ' <span class="acct-chip">System</span>' : ''}</td><td>${line.side === 'DEBIT' ? rpExact(line.amountExact ?? line.amountMinor) : ''}</td><td>${line.side === 'CREDIT' ? rpExact(line.amountExact ?? line.amountMinor) : ''}</td><td>${esc(line.description)}</td></tr>`).join('')}</tbody></table></div></div>`
      });
    } catch (error) { toast(error.message); }
  }

  function renderLedger(host) {
    const p = period();
    host.innerHTML = `<div class="acct-page"><div class="acct-head"><div><h2>Buku Besar</h2><p>Pilih akun dan periode untuk melihat mutasi Debit/Kredit serta saldo berjalan exact.</p></div></div><div class="acct-card"><div class="acct-filters"><label class="acct-field" style="min-width:260px"><span>Akun</span><select id="acctLedgerAccount" class="acct-select">${accountOptions('', false)}</select></label><label class="acct-field"><span>Dari</span><input id="acctLedgerFrom" class="acct-input" type="date" value="${esc(p.from)}" /></label><label class="acct-field"><span>Sampai</span><input id="acctLedgerTo" class="acct-input" type="date" value="${esc(p.to)}" /></label><button id="acctLoadLedger" class="acct-btn primary" type="button">Tampilkan</button></div><div id="acctLedgerResult" class="acct-empty">Pilih akun untuk membuka buku besar.</div></div></div>`;
    el('acctLoadLedger').addEventListener('click', loadLedger);
  }

  async function loadLedger() {
    try {
      const params = new URLSearchParams({ accountId: el('acctLedgerAccount').value, from: el('acctLedgerFrom').value, to: el('acctLedgerTo').value });
      const result = await api(`/api/admin/accounting/ledger?${params}`);
      const ledger = result.ledger;
      el('acctLedgerResult').className = '';
      el('acctLedgerResult').innerHTML = `<div style="margin:12px 0"><b>${esc(ledger.account.accountCode)} — ${esc(ledger.account.accountName)}</b><div class="acct-code">Saldo awal: ${rpExact(ledger.openingBalanceExact ?? ledger.openingBalanceMinor)} · Normal ${esc(ledger.account.normalSide)}</div></div><div class="acct-table-wrap"><table class="acct-table"><thead><tr><th>Tanggal</th><th>Jurnal</th><th>Keterangan</th><th>Debit</th><th>Kredit</th><th>Saldo</th></tr></thead><tbody>${ledger.entries.map(row => `<tr><td>${esc(row.businessDate)}</td><td class="acct-code">${esc(row.journalNumber)}</td><td>${esc(row.description)}</td><td>${row.debitScaled ? rpExact(row.debitExact) : ''}</td><td>${row.creditScaled ? rpExact(row.creditExact) : ''}</td><td>${rpExact(row.balanceExact ?? row.balanceMinor)}</td></tr>`).join('') || '<tr><td colspan="6">Tidak ada mutasi.</td></tr>'}</tbody></table></div><div class="acct-report-total"><span>Saldo akhir</span><span>${rpExact(ledger.closingBalanceExact ?? ledger.closingBalanceMinor)}</span></div>`;
    } catch (error) { toast(error.message); }
  }

  function renderProfitLoss(host) {
    const p = period();
    host.innerHTML = `<div class="acct-page"><div class="acct-head"><div><h2>Rugi Laba</h2><p>Pendapatan dikurangi beban dari posted journal pada periode yang dipilih.</p></div></div><div class="acct-card"><div class="acct-filters"><label class="acct-field"><span>Dari</span><input id="acctPlFrom" class="acct-input" type="date" value="${esc(p.from)}" /></label><label class="acct-field"><span>Sampai</span><input id="acctPlTo" class="acct-input" type="date" value="${esc(p.to)}" /></label><button id="acctLoadPl" class="acct-btn primary" type="button">Tampilkan</button></div><div id="acctPlResult" class="acct-empty">Klik Tampilkan untuk menghitung laporan.</div></div></div>`;
    el('acctLoadPl').addEventListener('click', loadProfitLoss);
  }

  async function loadProfitLoss() {
    try {
      const params = new URLSearchParams({ from: el('acctPlFrom').value, to: el('acctPlTo').value });
      const { report } = await api(`/api/admin/accounting/profit-loss?${params}`);
      el('acctPlResult').className = '';
      el('acctPlResult').innerHTML = `${reportSection('Pendapatan', report.revenue)}<div class="acct-report-total"><span>Total Pendapatan</span><span>${rpExact(report.totalRevenueExact ?? report.totalRevenueMinor)}</span></div>${reportSection('Beban', report.expenses)}<div class="acct-report-total"><span>Total Beban</span><span>${rpExact(report.totalExpenseExact ?? report.totalExpenseMinor)}</span></div><div class="acct-report-total grand"><span>${report.netIncomeScaled >= 0 ? 'Laba Bersih' : 'Rugi Bersih'}</span><span>${rpExact(report.netIncomeExact ?? report.netIncomeMinor)}</span></div>`;
    } catch (error) { toast(error.message); }
  }

  function reportSection(title, rows) {
    return `<div class="acct-report-section"><h3>${esc(title)}</h3><div class="acct-table-wrap"><table class="acct-table"><tbody>${rows.map(row => `<tr><td class="acct-code">${esc(row.accountCode)}</td><td>${esc(row.accountName)}</td><td style="text-align:right">${rpExact(row.balanceExact ?? row.balanceMinor)}</td></tr>`).join('') || '<tr><td>Tidak ada saldo.</td></tr>'}</tbody></table></div></div>`;
  }

  function renderBalanceSheet(host) {
    host.innerHTML = `<div class="acct-page"><div class="acct-head"><div><h2>Neraca</h2><p>Posisi aset, liabilitas, ekuitas, dan laba berjalan berdasarkan seluruh posted journal sampai tanggal laporan.</p></div></div><div class="acct-card"><div class="acct-filters"><label class="acct-field"><span>Per Tanggal</span><input id="acctBsDate" class="acct-input" type="date" value="${esc(state.bootstrap.currentBusinessDate)}" /></label><button id="acctLoadBs" class="acct-btn primary" type="button">Tampilkan</button></div><div id="acctBsResult" class="acct-empty">Klik Tampilkan untuk menghitung neraca.</div></div></div>`;
    el('acctLoadBs').addEventListener('click', loadBalanceSheet);
  }

  async function loadBalanceSheet() {
    try {
      const params = new URLSearchParams({ asOf: el('acctBsDate').value });
      const { report } = await api(`/api/admin/accounting/balance-sheet?${params}`);
      el('acctBsResult').className = '';
      el('acctBsResult').innerHTML = `${reportSection('Aset', report.assets)}<div class="acct-report-total"><span>Total Aset</span><span>${rpExact(report.totalAssetsExact ?? report.totalAssetsMinor)}</span></div>${reportSection('Liabilitas', report.liabilities)}<div class="acct-report-total"><span>Total Liabilitas</span><span>${rpExact(report.totalLiabilitiesExact ?? report.totalLiabilitiesMinor)}</span></div>${reportSection('Ekuitas', report.equity)}<div class="acct-report-total"><span>Ekuitas Akun</span><span>${rpExact(report.totalEquityExact ?? report.totalEquityMinor)}</span></div><div class="acct-report-total"><span>Laba Berjalan</span><span>${rpExact(report.currentEarningsExact ?? report.currentEarningsMinor)}</span></div><div class="acct-report-total grand"><span>Total Liabilitas + Ekuitas</span><span>${rpExact(report.totalLiabilitiesAndEquityExact ?? report.totalLiabilitiesAndEquityMinor)}</span></div><div style="margin-top:10px" class="${report.isBalanced ? 'acct-balance-ok' : 'acct-balance-bad'}"><b>${report.isBalanced ? '✓ Neraca balance' : '⚠ Neraca belum balance'}</b></div>`;
    } catch (error) { toast(error.message); }
  }

  function activate(button) {
    document.querySelectorAll('.admin-tab').forEach(tab => tab.classList.toggle('active', tab === button));
    document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === 'tab-accounting-workspace'));
    load(true).catch(error => toast(error.message));
  }

  function mount() {
    const tabs = document.querySelector('.admin-tabs');
    const toastNode = el('adminToast');
    if (!tabs || !toastNode || el('accountingWorkspaceTab')) return false;
    injectStyles();
    const button = document.createElement('button');
    button.id = 'accountingWorkspaceTab';
    button.className = 'admin-tab';
    button.type = 'button';
    button.textContent = 'Akuntansi';
    const settingsButton = el('accountingSettingsTab');
    if (settingsButton) tabs.insertBefore(button, settingsButton);
    else tabs.appendChild(button);
    const section = document.createElement('section');
    section.id = 'tab-accounting-workspace';
    section.className = 'admin-section';
    section.innerHTML = shellHtml();
    const settingsPanel = el('tab-accounting-settings-comfort') || el('tab-accounting-settings');
    if (settingsPanel) settingsPanel.insertAdjacentElement('beforebegin', section);
    else toastNode.insertAdjacentElement('beforebegin', section);
    button.addEventListener('click', () => activate(button));
    section.querySelectorAll('[data-acct-view]').forEach(nav => nav.addEventListener('click', () => { state.view = nav.dataset.acctView; render(); }));
    el('accountingWorkspaceRefresh')?.addEventListener('click', () => load(true).catch(error => toast(error.message)));
    return true;
  }

  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (mount() || tries > 40) clearInterval(timer);
  }, 100);
})();