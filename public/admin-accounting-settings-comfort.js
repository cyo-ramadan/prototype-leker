(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
  const state = {
    accounting: null,
    view: 'rules',
    selectedTransactionId: '',
    selectedChoiceGroupId: '',
    choiceMode: 'create',
    drafts: new Map()
  };

  const SOURCE_LABELS = {
    fixed_account: 'Akun tertentu',
    choice_group: 'Setting Transaksi → pilihan',
    payment_method: 'Cara pembayaran → akun',
    item_category_inventory: 'Jenis barang → Persediaan',
    item_category_cogs: 'Jenis barang → HPP',
    item_category_revenue: 'Jenis barang → Penjualan',
    cost_center_cash: 'Kas cost center'
  };

  const TYPE_LABELS = {
    ASSET: 'Aset', LIABILITY: 'Liabilitas', EQUITY: 'Ekuitas', REVENUE: 'Pendapatan', EXPENSE: 'Beban'
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
    toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
  }

  function injectStyles() {
    if (el('accountingComfortStyle')) return;
    const style = document.createElement('style');
    style.id = 'accountingComfortStyle';
    style.textContent = `
      #tab-accounting-settings-comfort{padding:0!important;background:#f7f6f3;overflow:hidden;border-radius:18px;border:1px solid #e4e1d8}
      .acc-comfort-shell{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:690px;color:#1c1b19}
      .acc-side{background:#12181b;color:#e8e6df;display:flex;flex-direction:column;min-height:690px}
      .acc-brand{padding:23px 20px;border-bottom:1px solid rgba(255,255,255,.09)}
      .acc-brand small{display:block;color:#7fa88f;font-size:10px;letter-spacing:.17em;font-weight:800;margin-bottom:5px}
      .acc-brand strong{font-size:18px}.acc-nav{padding:10px 0;display:grid;gap:1px}
      .acc-nav button{border:0;border-left:3px solid transparent;background:transparent;color:#aaa79e;padding:12px 18px;text-align:left;font:inherit;font-size:13px;cursor:pointer;display:flex;gap:11px;align-items:center}
      .acc-nav button:hover{background:rgba(255,255,255,.035);color:#eee}.acc-nav button.active{border-left-color:#7fa88f;background:rgba(255,255,255,.06);color:#fff}
      .acc-nav-icon{width:17px;text-align:center;color:#91a89a}.acc-boundary{margin-top:auto;padding:15px 18px;border-top:1px solid rgba(255,255,255,.09);color:#797b77;font-size:10.5px;line-height:1.5}
      .acc-main{min-width:0;background:#faf9f6}.acc-toolbar{display:flex;justify-content:flex-end;padding:14px 18px 0}.acc-refresh{border:1px solid #dedbd2;background:white;border-radius:8px;padding:7px 10px;cursor:pointer;color:#666}
      .acc-page{padding:10px 28px 28px}.acc-head{margin-bottom:22px}.acc-head h2{margin:0 0 5px;font-size:22px}.acc-head p{margin:0;max-width:720px;color:#6b6960;font-size:13px;line-height:1.55}
      .acc-card{background:#fff;border:1px solid #e4e1d8;border-radius:10px}.acc-table{width:100%;border-collapse:collapse;font-size:13px}.acc-table th{padding:10px 14px;text-align:left;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#8a8778;border-bottom:1px solid #e4e1d8}.acc-table td{padding:10px 14px;border-bottom:1px solid #efede6}.acc-table tr:last-child td{border-bottom:0}
      .acc-type{display:inline-flex;border:1px solid #dedbd2;border-radius:999px;padding:3px 8px;font-size:10px;background:#f6f5f1}.acc-muted{color:#8a8778;font-size:11px}.acc-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#6b6960}
      .acc-form-row{display:grid;grid-template-columns:minmax(150px,.8fr) minmax(220px,1.7fr) 90px 74px;gap:9px;align-items:center;padding:10px 12px;border-bottom:1px solid #efede6}.acc-form-row:last-child{border-bottom:0}
      .acc-input,.acc-select{width:100%;box-sizing:border-box;border:1px solid #e1ded5;border-radius:7px;background:#fff;padding:8px 9px;font:inherit;font-size:12px;color:#292722}.acc-input:focus,.acc-select:focus{outline:2px solid rgba(127,168,143,.22);border-color:#7fa88f}
      .acc-mini{border:1px solid #dcd8cf;background:#fff;border-radius:7px;padding:7px 9px;cursor:pointer;font-size:11px}.acc-mini.primary{background:#557564;color:#fff;border-color:#557564}.acc-mini.danger{color:#a04b4b}.acc-add{width:100%;border:0;border-top:1px solid #e4e1d8;background:#fff;padding:11px;color:#557564;cursor:pointer;font-weight:700}
      .acc-item-card{padding:14px;margin-bottom:10px}.acc-item-top{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}.acc-item-top b{font-size:13px}.acc-item-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.acc-field label{display:block;font-size:10px;color:#8a8778;margin-bottom:4px}
      .acc-rules-layout{display:grid;grid-template-columns:250px minmax(0,1fr);min-height:610px;border-top:1px solid #e4e1d8;margin:-10px -28px -28px}.acc-tx-list{background:#fbfaf7;border-right:1px solid #e4e1d8}.acc-tx-head{padding:16px 17px;border-bottom:1px solid #e4e1d8}.acc-tx-head b{font-size:13px}.acc-tx-head div{font-size:11px;color:#8a8778;margin-top:3px}.acc-tx{width:100%;border:0;border-bottom:1px solid #edebe3;background:transparent;text-align:left;padding:12px 16px;cursor:pointer}.acc-tx.active{background:#fff;box-shadow:inset 3px 0 #7fa88f}.acc-tx-line{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:12px}.acc-tx-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;color:#aaa79e;margin-top:3px}.acc-status-ok{color:#379463}.acc-status-warn{color:#d6962e}
      .acc-rules-editor{padding:24px;min-width:0}.acc-rule-title{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.acc-rule-title h2{margin:0;font-size:20px}.acc-chip{display:inline-flex;border-radius:999px;padding:3px 8px;font-size:10px;border:1px solid #dcd8cf}.acc-chip.ok{background:#edf8f1;color:#267348;border-color:#c7e6d2}.acc-chip.warn{background:#fff7e5;color:#94651a;border-color:#eed6a3}.acc-rule-desc{color:#6b6960;font-size:12px;margin:6px 0 18px}
      .acc-columns{display:grid;grid-template-columns:1fr 1fr;gap:15px}.acc-col{border-radius:10px;padding:13px}.acc-col.debit{border:1px solid #bfdcec;background:#f7fbfd}.acc-col.credit{border:1px solid #ead3a1;background:#fffaf0}.acc-col h3{margin:0 0 10px;font-size:11px;letter-spacing:.06em;text-transform:uppercase}.acc-col.debit h3{color:#39799e}.acc-col.credit h3{color:#a17219}
      .acc-rule{background:#fff;border:1px solid #e4e1d8;border-radius:8px;padding:10px;margin-bottom:8px}.acc-rule-top{display:flex;gap:7px;align-items:center;margin-bottom:7px}.acc-rule-top .acc-input{font-weight:650}.acc-trash{border:0;background:transparent;color:#b9b4aa;cursor:pointer;font-size:16px;padding:4px}.acc-trash:hover{color:#b75c5c}.acc-source-detail{margin-top:7px}.acc-add-rule{width:100%;border:1px dashed currentColor;background:transparent;border-radius:8px;padding:8px;cursor:pointer;font-size:11px}.debit .acc-add-rule{color:#39799e}.credit .acc-add-rule{color:#a17219}
      .acc-preview{margin-top:18px;padding:13px 15px}.acc-preview-title{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#8a8778;margin-bottom:8px}.acc-preview-row{display:grid;grid-template-columns:62px minmax(0,1fr);gap:8px;padding:6px 0;border-bottom:1px solid #efede6;font-size:11px}.acc-preview-row:last-child{border-bottom:0}.acc-preview-row.credit{padding-left:25px}.acc-new-tx{padding:10px 12px;border-bottom:1px solid #e4e1d8;background:#fff}.acc-new-tx summary{cursor:pointer;font-size:11px;font-weight:700;color:#557564}.acc-new-tx-fields{display:grid;gap:7px;margin-top:9px}.acc-checks{display:flex;gap:10px;flex-wrap:wrap;font-size:10px;color:#6b6960}
      @media(max-width:980px){.acc-comfort-shell{grid-template-columns:190px minmax(0,1fr)}.acc-columns,.acc-item-grid{grid-template-columns:1fr}.acc-rules-layout{grid-template-columns:210px minmax(0,1fr)}}
      @media(max-width:760px){.acc-comfort-shell{display:block}.acc-side{min-height:auto}.acc-nav{grid-template-columns:repeat(2,1fr)}.acc-boundary{display:none}.acc-rules-layout{display:block;margin:0}.acc-tx-list{border-right:0}.acc-form-row{grid-template-columns:1fr}.acc-page{padding:14px}.acc-rules-editor{padding:16px}}
    `;
    document.head.appendChild(style);
  }

  function accountOptions(type = '', selected = '', allowBlank = true) {
    const rows = (state.accounting?.accounts || []).filter(account => account.isActive && (!type || account.type === type));
    return `${allowBlank ? '<option value="">Pilih akun…</option>' : ''}${rows.map(account => `<option value="${esc(account.id)}" ${account.id === selected ? 'selected' : ''}>${esc(account.code)} — ${esc(account.name)}</option>`).join('')}`;
  }

  function navButton(key, icon, label) {
    return `<button type="button" data-acc-view="${key}" class="${state.view === key ? 'active' : ''}"><span class="acc-nav-icon">${icon}</span>${label}</button>`;
  }

  function shellHtml() {
    return `<div class="acc-comfort-shell">
      <aside class="acc-side">
        <div class="acc-brand"><small>MAXI · ACCOUNTING</small><strong>Setting Akuntansi</strong></div>
        <nav class="acc-nav">
          ${navButton('accounts','▤','Daftar Akun')}
          ${navButton('payment','◉','Metode Pembayaran')}
          ${navButton('items','▦','Jenis Barang')}
          ${navButton('choices','⌗','Setting Transaksi')}
          ${navButton('rules','⌘','Aturan Transaksi')}
        </nav>
        <div class="acc-boundary">Panel ini hanya mengatur mapping. Pembuatan akun, kode akun, jurnal, buku besar, laporan dan closing tetap dikerjakan di modul Akuntansi.</div>
      </aside>
      <main class="acc-main"><div class="acc-toolbar"><button id="accountingComfortRefresh" class="acc-refresh" type="button">↻ Refresh</button></div><div id="accountingComfortBody"></div></main>
    </div>`;
  }

  function render() {
    const host = el('accountingComfortBody');
    if (!host || !state.accounting) return;
    if (state.view === 'accounts') renderAccounts(host);
    else if (state.view === 'payment') renderPayment(host);
    else if (state.view === 'items') renderItems(host);
    else if (state.view === 'choices') renderChoiceGroups(host);
    else renderRules(host);
    document.querySelectorAll('[data-acc-view]').forEach(button => button.classList.toggle('active', button.dataset.accView === state.view));
  }

  function renderAccounts(host) {
    const accounts = state.accounting.accounts || [];
    host.innerHTML = `<div class="acc-page"><div class="acc-head"><h2>Daftar Akun</h2><p>Read-only dari modul Akuntansi. Akun baru dan kode akun dibuat otomatis di Akuntansi; di sini akun hanya dipilih untuk mapping transaksi.</p></div>
      <div class="acc-card"><table class="acc-table"><thead><tr><th>Kode</th><th>Nama Akun</th><th>Tipe</th><th>Status</th></tr></thead><tbody>${accounts.map(a => `<tr><td class="acc-code">${esc(a.code)}</td><td>${esc(a.name)}${a.reviewRequired ? ' <span class="acc-chip warn">REVIEW</span>' : ''}</td><td><span class="acc-type">${esc(TYPE_LABELS[a.type] || a.type)}</span></td><td class="acc-muted">${a.isActive ? 'Aktif' : 'Nonaktif'}</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  function renderPayment(host) {
    const rows = state.accounting.paymentMethods || [];
    host.innerHTML = `<div class="acc-page"><div class="acc-head"><h2>Metode Pembayaran</h2><p>Setiap cara bayar di transaksi diarahkan ke akun yang dipilih di sini. Satu metode aktif wajib menjadi default ketika kasir belum memilih. Contoh: Uang Laci → Kas, QRIS → Bank/Piutang Settlement.</p></div>
      <div class="acc-card"><div id="accPaymentRows">${rows.map(paymentRow).join('')}</div><button id="accAddPayment" class="acc-add" type="button">＋ Tambah Metode Pembayaran</button></div></div>`;
    bindPaymentRows(host);
  }

  function paymentRow(item, draft = false) {
    return `<div class="acc-form-row" data-payment-row="${esc(item.id)}" data-draft="${draft ? '1' : '0'}">
      <input class="acc-input" data-payment-name value="${esc(item.name || '')}" placeholder="Nama metode" />
      <select class="acc-select" data-payment-account>${accountOptions('', item.accountId || '', true)}</select>
      <label class="acc-muted"><input type="checkbox" data-payment-active ${item.isActive !== false ? 'checked' : ''}/> Aktif</label>
      <label class="acc-muted"><input type="checkbox" data-payment-default ${item.isDefault ? 'checked' : ''}/> Default</label>
      <button class="acc-mini primary" data-save-payment type="button">Simpan</button>
    </div>`;
  }

  function bindPaymentRows(host) {
    host.querySelectorAll('[data-save-payment]').forEach(button => button.addEventListener('click', async () => {
      const row = button.closest('[data-payment-row]');
      const id = row.dataset.paymentRow;
      const draft = row.dataset.draft === '1';
      try {
        await api(draft ? '/api/admin/settings/accounting/payment-methods' : `/api/admin/settings/accounting/payment-methods/${encodeURIComponent(id)}`, {
          method: draft ? 'POST' : 'PATCH',
          body: JSON.stringify({ name: row.querySelector('[data-payment-name]').value, accountId: row.querySelector('[data-payment-account]').value || null, isActive: row.querySelector('[data-payment-active]').checked, isDefault: row.querySelector('[data-payment-default]').checked })
        });
        await load(true); toast('Metode pembayaran tersimpan');
      } catch (error) { toast(error.message); }
    }));
    el('accAddPayment')?.addEventListener('click', () => {
      const id = `draft_${Date.now()}`;
      el('accPaymentRows').insertAdjacentHTML('beforeend', paymentRow({ id, name: '', accountId: '', isActive: true }, true));
      bindPaymentRows(host);
    }, { once: true });
  }

  function renderItems(host) {
    const mappings = state.accounting.itemCategories || [];
    const byKind = new Map(mappings.map(mapping => [mapping.productKindId, mapping]));
    const kinds = (state.accounting.productKinds || []).filter(kind => kind.isActive);
    host.innerHTML = `<div class="acc-page"><div class="acc-head"><h2>Jenis Barang</h2><p>Satu Jenis Barang punya referensi akun Persediaan, HPP, dan Penjualan. Barang/SKU cukup memilih Jenis Barang di Master Barang.</p></div>
      <div>${kinds.map(kind => itemKindCard(kind, byKind.get(kind.id))).join('') || '<div class="acc-card acc-item-card">Belum ada Jenis Barang aktif.</div>'}</div></div>`;
    host.querySelectorAll('[data-save-kind]').forEach(button => button.addEventListener('click', async () => {
      const card = button.closest('[data-kind-card]');
      const mappingId = card.dataset.mappingId;
      try {
        const payload = {
          productKindId: card.dataset.kindCard,
          name: card.dataset.kindName,
          inventoryAccountId: card.querySelector('[data-kind-inventory]').value,
          cogsAccountId: card.querySelector('[data-kind-cogs]').value,
          revenueAccountId: card.querySelector('[data-kind-revenue]').value || null,
          isActive: true
        };
        await api(mappingId ? `/api/admin/settings/accounting/item-categories/${encodeURIComponent(mappingId)}` : '/api/admin/settings/accounting/item-categories', { method: mappingId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
        await load(true); toast('Mapping Jenis Barang tersimpan');
      } catch (error) { toast(error.message); }
    }));
  }

  function itemKindCard(kind, mapping) {
    return `<div class="acc-card acc-item-card" data-kind-card="${esc(kind.id)}" data-kind-name="${esc(kind.name)}" data-mapping-id="${esc(mapping?.id || '')}">
      <div class="acc-item-top"><div><b>${esc(kind.name)}</b><div class="acc-muted acc-code">${esc(kind.code || '')}</div></div><button class="acc-mini primary" data-save-kind type="button">Simpan Mapping</button></div>
      <div class="acc-item-grid">
        <div class="acc-field"><label>Akun Persediaan</label><select class="acc-select" data-kind-inventory>${accountOptions('ASSET', mapping?.inventoryAccountId || '', true)}</select></div>
        <div class="acc-field"><label>Akun HPP</label><select class="acc-select" data-kind-cogs>${accountOptions('EXPENSE', mapping?.cogsAccountId || '', true)}</select></div>
        <div class="acc-field"><label>Akun Penjualan</label><select class="acc-select" data-kind-revenue>${accountOptions('REVENUE', mapping?.revenueAccountId || '', true)}</select></div>
      </div>
    </div>`;
  }

  function choiceGroupOptions(selected = '', onlyReady = false) {
    const groups = (state.accounting?.choiceGroups || []).filter(group => {
      if (!group.isActive) return false;
      return !onlyReady || group.accountingReady;
    });
    return `<option value="">Pilih Setting Transaksi…</option>${groups.map(group =>
      `<option value="${esc(group.id)}" ${group.id === selected ? 'selected' : ''}>${esc(group.name)} · ${esc(group.code)}</option>`
    ).join('')}`;
  }

  function renderChoiceGroups(host) {
    const groups = state.accounting.choiceGroups || [];
    if (!groups.some(group => group.id === state.selectedChoiceGroupId)) state.selectedChoiceGroupId = groups[0]?.id || '';
    const selected = groups.find(group => group.id === state.selectedChoiceGroupId) || null;
    host.innerHTML = `<div class="acc-page">
      <div class="acc-head"><h2>Setting Transaksi</h2><p>Bikin paket pilihan reusable. Link akun boleh kosong selama grup masih generic. Begitu dipasang ke Akuntansi, semua pilihan aktif wajib punya akun aktif.</p></div>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button id="accChoiceCreateMode" class="acc-mini ${state.choiceMode === 'create' ? 'primary' : ''}" type="button">＋ Bikin Grup</button>
        <button id="accChoiceAttachMode" class="acc-mini ${state.choiceMode === 'attach' ? 'primary' : ''}" type="button">↗ Pasang Grup</button>
      </div>
      ${state.choiceMode === 'attach' ? attachChoiceGroupHtml() : choiceGroupLibraryHtml(groups, selected)}
    </div>`;
    el('accChoiceCreateMode')?.addEventListener('click', () => { state.choiceMode = 'create'; renderChoiceGroups(host); });
    el('accChoiceAttachMode')?.addEventListener('click', () => { state.choiceMode = 'attach'; renderChoiceGroups(host); });
    if (state.choiceMode === 'attach') bindChoiceAttach();
    else bindChoiceLibrary(host, selected);
  }

  function choiceGroupLibraryHtml(groups, selected) {
    return `<div class="acc-rules-layout" style="margin:0;min-height:520px">
      <aside class="acc-tx-list">
        <div class="acc-new-tx" style="padding:12px">
          <input id="accNewChoiceGroupName" class="acc-input" placeholder="Nama grup, contoh: Beban Tetap" />
          <button id="accCreateChoiceGroup" class="acc-mini primary" style="margin-top:8px;width:100%" type="button">Bikin Grup</button>
        </div>
        ${groups.map(group => `<button type="button" class="acc-tx ${group.id === state.selectedChoiceGroupId ? 'active' : ''}" data-select-choice-group="${esc(group.id)}">
          <div class="acc-tx-line"><span>${esc(group.name)}</span><span class="${group.accountingReady ? 'acc-status-ok' : 'acc-status-warn'}">${group.accountingReady ? '●' : '▲'}</span></div>
          <div class="acc-tx-code">${esc(group.code)} · ${group.isActive ? 'aktif' : 'nonaktif'}</div>
        </button>`).join('') || '<div class="acc-muted" style="padding:14px">Belum ada grup.</div>'}
      </aside>
      <section class="acc-rules-editor">${selected ? choiceGroupDetailHtml(selected) : '<div class="acc-muted">Bikin grup pertama untuk mulai.</div>'}</section>
    </div>`;
  }

  function choiceGroupDetailHtml(group) {
    const usage = group.usedByCategories || [];
    return `<div class="acc-rule-title"><h2>${esc(group.name)}</h2><span class="acc-chip ${usage.length ? 'ok' : ''}">${usage.length ? 'Terhubung Akuntansi' : 'Generic'}</span><span class="acc-chip ${group.accountingReady ? 'ok' : 'warn'}">${group.accountingReady ? 'Account ready' : 'Perlu mapping akun'}</span></div>
      <div class="acc-rule-desc"><span class="acc-code">${esc(group.code)}</span> · ${group.journalLineCount} journal line historis.</div>
      <div style="display:flex;gap:8px;margin-bottom:12px"><button class="acc-mini ${group.isActive ? 'danger' : 'primary'}" data-toggle-choice-group type="button">${group.isActive ? 'Nonaktifkan Grup' : 'Aktifkan Grup'}</button></div>
      ${usage.length ? `<div class="acc-card" style="padding:10px;margin-bottom:12px"><div class="acc-muted">Dipakai oleh</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">${usage.map(item => `<span class="acc-chip">${esc(item.name)} · ${esc(item.side)}</span>`).join('')}</div></div>` : ''}
      <div class="acc-card">
        <div id="accChoiceOptionRows">${(group.options || []).map(choiceOptionRow).join('')}</div>
        <button id="accAddChoiceOption" class="acc-add" type="button">＋ Tambah Pilihan</button>
      </div>`;
  }

  function choiceOptionRow(option) {
    const draft = String(option.id).startsWith('draft_choice_');
    return `<div class="acc-form-row" data-choice-option="${esc(option.id)}" data-draft="${draft ? '1' : '0'}" style="grid-template-columns:minmax(130px,1fr) minmax(220px,1.4fr) 78px 86px 70px">
      <div><input class="acc-input" data-choice-option-name value="${esc(option.name || '')}" placeholder="Nama pilihan" /><div class="acc-muted" style="margin-top:4px">${draft ? 'kode otomatis saat simpan' : `${esc(option.code)} · ${Number(option.journalLineCount || 0)} jurnal`}</div></div>
      <div><select class="acc-select" data-choice-option-account>${accountOptions('', option.accountId || '', true).replace('Pilih akun…','Belum dilink ke Akuntansi')}</select><div class="acc-muted" style="margin-top:4px">${option.accountingReady ? 'Siap Accounting' : 'Link akun optional selama generic'}</div></div>
      <label class="acc-muted"><input type="checkbox" data-choice-option-active ${option.isActive !== false ? 'checked' : ''}/> Aktif</label>
      <label class="acc-muted"><input type="checkbox" data-choice-option-default ${option.isDefault ? 'checked' : ''}/> Default</label>
      <button class="acc-mini primary" data-save-choice-option type="button">Simpan</button>
    </div>`;
  }

  function attachChoiceGroupHtml() {
    const categories = (state.accounting.transactionCategories || []).filter(tx => tx.isActive);
    const readyGroups = (state.accounting.choiceGroups || []).filter(group => group.isActive && group.accountingReady);
    return `<div class="acc-card" style="padding:16px;max-width:800px">
      <div class="acc-head" style="margin-bottom:14px"><h2 style="font-size:17px">Pasang Grup ke Akuntansi</h2><p>Setelah dipasang, group menjadi resolver akun untuk sisi Debit/Kredit yang dipilih. Group yang belum Accounting-ready tidak ditawarkan.</p></div>
      ${readyGroups.length ? `<div class="acc-item-grid">
        <div class="acc-field"><label>Jenis Transaksi</label><select id="accAttachChoiceTx" class="acc-select">${categories.map(tx => `<option value="${esc(tx.id)}">${esc(tx.name)} · ${esc(tx.code)}</option>`).join('')}</select></div>
        <div class="acc-field"><label>Sisi</label><select id="accAttachChoiceSide" class="acc-select"><option>DEBIT</option><option>CREDIT</option></select></div>
        <div class="acc-field"><label>Setting Transaksi</label><select id="accAttachChoiceGroup" class="acc-select">${choiceGroupOptions('', true)}</select></div>
      </div>
      <div class="acc-field" style="margin-top:10px"><label>Label journal rule</label><input id="accAttachChoiceLabel" class="acc-input" placeholder="contoh: Beban Operasional" /></div>
      <button id="accAttachChoiceSave" class="acc-mini primary" style="margin-top:12px" type="button">Pasang Grup</button>` : '<div class="acc-muted">Belum ada group yang siap Accounting. Buka Bikin Grup dan lengkapi akun semua pilihan aktif dulu.</div>'}
    </div>`;
  }

  function bindChoiceLibrary(host, selected) {
    host.querySelectorAll('[data-select-choice-group]').forEach(button => button.addEventListener('click', () => {
      state.selectedChoiceGroupId = button.dataset.selectChoiceGroup;
      renderChoiceGroups(host);
    }));
    el('accCreateChoiceGroup')?.addEventListener('click', async () => {
      const name = el('accNewChoiceGroupName')?.value.trim();
      if (!name) return toast('Nama grup wajib diisi');
      try {
        const result = await api('/api/admin/settings/accounting/choice-groups', { method: 'POST', body: JSON.stringify({ name }) });
        state.selectedChoiceGroupId = result.id;
        await load(true); toast('Grup dibuat');
      } catch (error) { toast(error.message); }
    });
    el('accAddChoiceOption')?.addEventListener('click', () => {
      if (!selected) return;
      selected.options = [...(selected.options || []), {
        id: `draft_choice_${Date.now()}`,
        name: '', accountId: null, accountingReady: false,
        isActive: true, isDefault: false,
        sortOrder: (selected.options || []).length * 10 + 10,
        journalLineCount: 0
      }];
      renderChoiceGroups(host);
    });
    el('accountingComfortBody')?.querySelector('[data-toggle-choice-group]')?.addEventListener('click', async () => {
      if (!selected) return;
      try {
        await api(`/api/admin/settings/accounting/choice-groups/${encodeURIComponent(selected.id)}`, {
          method: 'PATCH', body: JSON.stringify({ name: selected.name, isActive: !selected.isActive })
        });
        await load(true); toast(selected.isActive ? 'Grup dinonaktifkan' : 'Grup diaktifkan');
      } catch (error) { toast(error.message); }
    });
    host.querySelectorAll('[data-save-choice-option]').forEach(button => button.addEventListener('click', async () => {
      const row = button.closest('[data-choice-option]');
      const draft = row.dataset.draft === '1';
      try {
        await api(draft ? '/api/admin/settings/accounting/choice-options' : `/api/admin/settings/accounting/choice-options/${encodeURIComponent(row.dataset.choiceOption)}`, {
          method: draft ? 'POST' : 'PATCH',
          body: JSON.stringify({
            choiceGroupId: selected.id,
            name: row.querySelector('[data-choice-option-name]').value,
            accountId: row.querySelector('[data-choice-option-account]').value || null,
            isActive: row.querySelector('[data-choice-option-active]').checked,
            isDefault: row.querySelector('[data-choice-option-default]').checked,
            sortOrder: draft ? (selected.options || []).findIndex(item => item.id === row.dataset.choiceOption) * 10 + 10 : undefined
          })
        });
        await load(true); toast('Pilihan tersimpan');
      } catch (error) { toast(error.message); }
    }));
  }

  function bindChoiceAttach() {
    el('accAttachChoiceSave')?.addEventListener('click', async () => {
      const transactionCategoryId = el('accAttachChoiceTx')?.value || '';
      const choiceGroupId = el('accAttachChoiceGroup')?.value || '';
      const side = el('accAttachChoiceSide')?.value || 'DEBIT';
      const group = (state.accounting.choiceGroups || []).find(item => item.id === choiceGroupId);
      if (!transactionCategoryId || !group) return toast('Pilih transaksi dan group yang siap Accounting');
      try {
        await api('/api/admin/settings/accounting/journal-rules', {
          method: 'POST',
          body: JSON.stringify({
            transactionCategoryId,
            label: el('accAttachChoiceLabel')?.value.trim() || group.name,
            side,
            sourceType: 'choice_group',
            choiceGroupId,
            sortOrder: 10,
            isActive: true
          })
        });
        await load(true); toast('Grup terpasang ke Akuntansi');
      } catch (error) { toast(error.message); }
    });
  }

  function renderRules(host) {
    const categories = state.accounting.transactionCategories || [];
    if (!categories.some(tx => tx.id === state.selectedTransactionId)) state.selectedTransactionId = categories[0]?.id || '';
    const tx = categories.find(item => item.id === state.selectedTransactionId);
    host.innerHTML = `<div class="acc-page"><div class="acc-head"><h2>Aturan Transaksi & Jurnal</h2><p>Pilih transaksi di kiri. Atur komponen Debit dan Kredit di kanan. Komponen boleh lebih dari dua; engine jurnal nanti membaca konfigurasi ini.</p></div>
      <div class="acc-rules-layout"><aside class="acc-tx-list"><div class="acc-tx-head"><b>Jenis Transaksi</b><div>Pilih untuk atur mapping jurnalnya</div></div>
        <details class="acc-new-tx"><summary>＋ Tambah Jenis Transaksi</summary><div class="acc-new-tx-fields"><input id="accNewTxName" class="acc-input" placeholder="Nama transaksi"/><textarea id="accNewTxDesc" class="acc-input" rows="2" placeholder="Deskripsi"></textarea><div class="acc-checks"><label><input id="accNewTxPayment" type="checkbox"/> Ada pembayaran</label><label><input id="accNewTxItem" type="checkbox"/> Ada jenis barang</label></div><button id="accSaveNewTx" class="acc-mini primary" type="button">Tambah</button></div></details>
        <div>${categories.map(txButton).join('')}</div></aside><section class="acc-rules-editor">${tx ? ruleEditor(tx) : '<div class="acc-muted">Belum ada jenis transaksi.</div>'}</section></div></div>`;
    host.querySelectorAll('[data-select-tx]').forEach(button => button.addEventListener('click', () => { state.selectedTransactionId = button.dataset.selectTx; renderRules(host); }));
    bindRuleEditor(host, tx);
    el('accSaveNewTx')?.addEventListener('click', () => saveNewTransaction());
  }

  function txButton(tx) {
    const complete = tx.completeness === 'COMPLETE';
    return `<button type="button" class="acc-tx ${tx.id === state.selectedTransactionId ? 'active' : ''}" data-select-tx="${esc(tx.id)}"><div class="acc-tx-line"><span>${esc(tx.name)}</span><span class="${complete ? 'acc-status-ok' : 'acc-status-warn'}">${complete ? '●' : '▲'}</span></div><div class="acc-tx-code">${esc(tx.code)}</div></button>`;
  }

  function ruleEditor(tx) {
    const rules = (tx.rules || []).filter(rule => rule.isActive || String(rule.id).startsWith('draft_'));
    const debits = rules.filter(rule => rule.side === 'DEBIT');
    const credits = rules.filter(rule => rule.side === 'CREDIT');
    const complete = debits.length > 0 && credits.length > 0;
    return `<div class="acc-code acc-muted">${esc(tx.code)}</div><div class="acc-rule-title"><h2>${esc(tx.name)}</h2><span class="acc-chip ${complete ? 'ok' : 'warn'}">${complete ? '✓ Lengkap' : '▲ Belum lengkap'}</span></div><div class="acc-rule-desc">${esc(tx.description || '')}</div>
      <div class="acc-columns"><div class="acc-col debit"><h3>Debit</h3>${debits.map(ruleCard).join('') || '<div class="acc-muted" style="margin:8px 0">Belum ada baris debit.</div>'}<button class="acc-add-rule" data-add-rule="DEBIT" type="button">＋ Tambah Baris Debit</button></div>
      <div class="acc-col credit"><h3>Kredit</h3>${credits.map(ruleCard).join('') || '<div class="acc-muted" style="margin:8px 0">Belum ada baris kredit.</div>'}<button class="acc-add-rule" data-add-rule="CREDIT" type="button">＋ Tambah Baris Kredit</button></div></div>
      <div class="acc-card acc-preview"><div class="acc-preview-title">› Pratinjau saat transaksi berjalan</div>${[...debits,...credits].map(previewRow).join('') || '<div class="acc-muted">Belum ada aturan.</div>'}</div>`;
  }

  function ruleCard(rule) {
    return `<div class="acc-rule" data-rule-id="${esc(rule.id)}" data-rule-side="${esc(rule.side)}" data-draft="${String(rule.id).startsWith('draft_') ? '1' : '0'}"><div class="acc-rule-top"><input class="acc-input" data-rule-label value="${esc(rule.label || '')}"/><button class="acc-trash" data-disable-rule type="button" title="Nonaktifkan">×</button></div><select class="acc-select" data-rule-source>${(state.accounting.sourceTypes || []).map(source => `<option value="${esc(source)}" ${source === rule.sourceType ? 'selected' : ''}>${esc(SOURCE_LABELS[source] || source)}</option>`).join('')}</select><div class="acc-source-detail" data-rule-fixed-wrap ${rule.sourceType === 'fixed_account' ? '' : 'hidden'}><select class="acc-select" data-rule-fixed>${accountOptions('', rule.fixedAccountId || '', true)}</select></div><div class="acc-source-detail" data-rule-choice-wrap ${rule.sourceType === 'choice_group' ? '' : 'hidden'}><select class="acc-select" data-rule-choice>${choiceGroupOptions(rule.choiceGroupId || '', true)}</select></div><button class="acc-mini primary" data-save-rule type="button" style="margin-top:8px">Simpan</button></div>`;
  }

  function previewRow(rule) {
    const source = rule.sourceType === 'fixed_account' && rule.fixedAccount
      ? `${rule.fixedAccount.code} ${rule.fixedAccount.name}`
      : rule.sourceType === 'choice_group' && rule.choiceGroup
        ? `${rule.choiceGroup.name} · ${rule.choiceGroup.code}`
        : (SOURCE_LABELS[rule.sourceType] || rule.sourceType);
    return `<div class="acc-preview-row ${rule.side === 'CREDIT' ? 'credit' : ''}"><b>${rule.side}</b><span>${esc(rule.label)} ← ${esc(source)}</span></div>`;
  }

  function bindRuleEditor(host, tx) {
    if (!tx) return;
    host.querySelectorAll('[data-rule-source]').forEach(select => select.addEventListener('change', () => {
      const card = select.closest('[data-rule-id]');
      card.querySelector('[data-rule-fixed-wrap]').hidden = select.value !== 'fixed_account';
      card.querySelector('[data-rule-choice-wrap]').hidden = select.value !== 'choice_group';
    }));
    host.querySelectorAll('[data-save-rule]').forEach(button => button.addEventListener('click', async () => {
      const card = button.closest('[data-rule-id]');
      const draft = card.dataset.draft === '1';
      const sourceType = card.querySelector('[data-rule-source]').value;
      try {
        await api(draft ? '/api/admin/settings/accounting/journal-rules' : `/api/admin/settings/accounting/journal-rules/${encodeURIComponent(card.dataset.ruleId)}`, {
          method: draft ? 'POST' : 'PATCH',
          body: JSON.stringify({
            transactionCategoryId: tx.id,
            label: card.querySelector('[data-rule-label]').value,
            side: card.dataset.ruleSide,
            sourceType,
            fixedAccountId: sourceType === 'fixed_account' ? (card.querySelector('[data-rule-fixed]').value || null) : null,
            choiceGroupId: sourceType === 'choice_group' ? (card.querySelector('[data-rule-choice]').value || null) : null,
            sortOrder: 10,
            isActive: true
          })
        });
        await load(true); toast('Aturan transaksi tersimpan');
      } catch (error) { toast(error.message); }
    }));
    host.querySelectorAll('[data-disable-rule]').forEach(button => button.addEventListener('click', async () => {
      const card = button.closest('[data-rule-id]');
      if (card.dataset.draft === '1') { card.remove(); return; }
      const sourceType = card.querySelector('[data-rule-source]').value;
      try {
        await api(`/api/admin/settings/accounting/journal-rules/${encodeURIComponent(card.dataset.ruleId)}`, { method: 'PATCH', body: JSON.stringify({
          transactionCategoryId: tx.id,
          label: card.querySelector('[data-rule-label]').value,
          side: card.dataset.ruleSide,
          sourceType,
          fixedAccountId: sourceType === 'fixed_account' ? (card.querySelector('[data-rule-fixed]').value || null) : null,
          choiceGroupId: sourceType === 'choice_group' ? (card.querySelector('[data-rule-choice]').value || null) : null,
          isActive: false
        }) });
        await load(true); toast('Baris aturan dinonaktifkan');
      } catch (error) { toast(error.message); }
    }));
    host.querySelectorAll('[data-add-rule]').forEach(button => button.addEventListener('click', () => {
      const side = button.dataset.addRule;
      const draft = { id: `draft_${Date.now()}_${side}`, label: 'Baris Baru', side, sourceType: defaultSource(tx, side), fixedAccountId: null, isActive: true, sortOrder: 10 };
      tx.rules = [...(tx.rules || []), draft];
      renderRules(host);
    }));
  }

  function defaultSource(tx, side) {
    if (tx.code === 'sale') return side === 'DEBIT' ? 'payment_method' : 'item_category_revenue';
    if (tx.code === 'purchase_material') return side === 'DEBIT' ? 'item_category_inventory' : 'payment_method';
    if (['operational','payroll'].includes(tx.code)) return side === 'DEBIT' ? 'fixed_account' : 'payment_method';
    if (tx.involvesPayment && side === 'CREDIT') return 'payment_method';
    if (tx.involvesItemCategory) return 'item_category_inventory';
    return 'fixed_account';
  }

  async function saveNewTransaction() {
    const name = el('accNewTxName')?.value.trim();
    if (!name) return toast('Nama transaksi wajib diisi');
    const code = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    try {
      const result = await api('/api/admin/settings/accounting/transaction-categories', { method: 'POST', body: JSON.stringify({ code, name, description: el('accNewTxDesc')?.value || '', involvesPayment: Boolean(el('accNewTxPayment')?.checked), involvesItemCategory: Boolean(el('accNewTxItem')?.checked) }) });
      state.selectedTransactionId = result.id;
      await load(true); toast('Jenis transaksi ditambahkan');
    } catch (error) { toast(error.message); }
  }

  async function load(force = false) {
    if (!state.accounting || force) state.accounting = await api('/api/admin/settings/accounting');
    render();
  }

  function activateComfort(button) {
    document.querySelectorAll('.admin-tab').forEach(tab => tab.classList.toggle('active', tab === button));
    document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === 'tab-accounting-settings-comfort'));
    load(true).catch(error => toast(error.message));
  }

  function mount() {
    const oldButton = el('accountingSettingsTab');
    const oldPanel = el('tab-accounting-settings');
    const toastNode = el('adminToast');
    if (!oldButton || !oldPanel || !toastNode || el('tab-accounting-settings-comfort')) return false;
    injectStyles();
    const replacement = oldButton.cloneNode(true);
    replacement.textContent = 'Setting Akuntansi';
    oldButton.replaceWith(replacement);
    const section = document.createElement('section');
    section.id = 'tab-accounting-settings-comfort';
    section.className = 'admin-section';
    section.innerHTML = shellHtml();
    oldPanel.insertAdjacentElement('afterend', section);
    replacement.addEventListener('click', () => activateComfort(replacement));
    section.querySelectorAll('[data-acc-view]').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.accView; render(); }));
    el('accountingComfortRefresh')?.addEventListener('click', () => load(true).catch(error => toast(error.message)));
    return true;
  }

  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (mount() || tries > 30) clearInterval(timer);
  }, 100);
})();
