(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));

  const FLOW_PRESETS = Object.freeze({
    cash_flow_in: {
      name: 'Arus Kas Masuk',
      description: 'Kas/settlement bertambah. Debit mengikuti Metode Pembayaran; akun lawan Credit dipilih dari Akuntansi.',
      involvesPayment: true,
      involvesItemCategory: false,
      rules: [
        { side: 'DEBIT', sourceType: 'payment_method', label: 'Kas / settlement masuk', sortOrder: 10 },
        { side: 'CREDIT', sourceType: 'fixed_account', label: 'Akun lawan arus kas masuk', sortOrder: 20 }
      ]
    },
    cash_flow_out: {
      name: 'Arus Kas Keluar',
      description: 'Kas/settlement berkurang. Debit memakai akun lawan; Credit mengikuti Metode Pembayaran.',
      involvesPayment: true,
      involvesItemCategory: false,
      rules: [
        { side: 'DEBIT', sourceType: 'fixed_account', label: 'Akun lawan arus kas keluar', sortOrder: 10 },
        { side: 'CREDIT', sourceType: 'payment_method', label: 'Kas / settlement keluar', sortOrder: 20 }
      ]
    },
    goods_flow_in: {
      name: 'Arus Barang Masuk',
      description: 'Nilai persediaan bertambah. Debit mengikuti Jenis Barang → Persediaan; Credit memakai akun lawan yang dipilih.',
      involvesPayment: false,
      involvesItemCategory: true,
      rules: [
        { side: 'DEBIT', sourceType: 'item_category_inventory', label: 'Persediaan barang masuk', sortOrder: 10 },
        { side: 'CREDIT', sourceType: 'fixed_account', label: 'Akun lawan barang masuk', sortOrder: 20 }
      ]
    },
    goods_flow_out: {
      name: 'Arus Barang Keluar',
      description: 'Nilai persediaan berkurang. Debit memakai akun lawan yang dipilih; Credit mengikuti Jenis Barang → Persediaan.',
      involvesPayment: false,
      involvesItemCategory: true,
      rules: [
        { side: 'DEBIT', sourceType: 'fixed_account', label: 'Akun lawan barang keluar', sortOrder: 10 },
        { side: 'CREDIT', sourceType: 'item_category_inventory', label: 'Persediaan barang keluar', sortOrder: 20 }
      ]
    }
  });

  let accounting = null;
  let warehouse = null;

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: { ...(options.headers || {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error || `Request gagal (${response.status})`), { status: response.status, payload });
    return payload;
  }

  function notify(message) {
    const node = el('adminToast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => node.classList.remove('show'), 3200);
  }

  function activeAccounts() {
    return (accounting?.accounts || []).filter(account => account.isActive);
  }

  function accountOptions() {
    return '<option value="">Pilih akun lawan…</option>' + activeAccounts().map(account =>
      `<option value="${esc(account.id)}">${esc(account.code)} — ${esc(account.name)} · ${esc(account.type)}</option>`
    ).join('');
  }

  function accountImpact(accountId) {
    const account = activeAccounts().find(item => item.id === accountId);
    if (!account) return { className: '', text: 'Pilih akun lawan untuk melihat dampak.' };
    if (account.type === 'REVENUE' || account.type === 'EXPENSE') {
      return { className: 'warn', text: `${account.code} ${account.name} mempengaruhi Rugi Laba (${account.type}).` };
    }
    return { className: 'ok', text: `${account.code} ${account.name} adalah akun Neraca (${account.type}); pairing ini tidak langsung menjadi pendapatan/beban.` };
  }

  async function loadData() {
    [accounting, warehouse] = await Promise.all([
      api('/api/admin/settings/accounting'),
      api('/api/admin/settings/warehouse').catch(() => ({ warehouses: [] }))
    ]);
  }

  function presetStatus(code) {
    const tx = (accounting?.transactionCategories || []).find(item => item.code === code);
    if (!tx) return '<span class="acc-chip warn">Belum dibuat</span>';
    return `<span class="acc-chip ${tx.completeness === 'COMPLETE' ? 'ok' : 'warn'}">${tx.completeness === 'COMPLETE' ? '✓ Lengkap' : '▲ Belum lengkap'}</span>`;
  }

  function warehouseReference() {
    const rows = (warehouse?.warehouses || []).filter(item => item.isActive);
    const chips = rows.length
      ? rows.map(item => `<span class="acc-chip">${esc(item.code)} · ${esc(item.name)}</span>`).join(' ')
      : '<span class="acc-muted">Belum ada Warehouse aktif.</span>';
    return `<div class="acc-card" style="padding:14px;margin-top:16px">
      <div class="acc-item-top"><div><b>Warehouse reference</b><div class="acc-muted">Source of truth tetap Warehouse Settings.</div></div><span class="acc-chip warn">ROUTING HOLD</span></div>
      <div style="display:flex;gap:7px;flex-wrap:wrap">${chips}</div>
      <p class="acc-muted" style="line-height:1.55;margin:12px 0 0">Pilihan gudang sudah direuse dari modul Warehouse. Eksekusi source/destination pada Arus Barang belum diaktifkan karena canonical <code>inventory_stock_balances</code> masih store-level, belum warehouse-level. Karen sengaja tidak membuat stok lokasi bayangan.</p>
    </div>`;
  }

  function render() {
    const host = el('accountingComfortBody');
    if (!host || !accounting) return;
    host.innerHTML = `<div class="acc-page">
      <div class="acc-head"><h2>Template Arus & Counterpart</h2><p>Shortcut ini memakai registry Setting Akuntansi yang sama: <b>transaction_categories</b> + <b>journal_rules</b>. Tidak ada mapping engine baru. Pilih akun lawan lalu apply; setelah itu rule tetap bisa diedit dari Aturan Transaksi.</p></div>
      <div class="acc-card" style="padding:14px">
        <div class="acc-field"><label>Akun lawan</label><select id="accFlowCounterpart" class="acc-select">${accountOptions()}</select></div>
        <div id="accFlowImpact" class="acc-chip" style="margin-top:10px">Pilih akun lawan untuk melihat dampak.</div>
        <div class="acc-item-grid" style="margin-top:14px">${Object.entries(FLOW_PRESETS).map(([code, preset]) => `
          <div class="acc-card acc-item-card" style="margin:0">
            <div class="acc-item-top"><div><b>${esc(preset.name)}</b><div class="acc-muted acc-code">${esc(code)}</div></div>${presetStatus(code)}</div>
            <p class="acc-muted" style="min-height:46px;line-height:1.45">${esc(preset.description)}</p>
            <div class="acc-preview">${preset.rules.map(rule => `<div class="acc-preview-row ${rule.side === 'CREDIT' ? 'credit' : ''}"><b>${rule.side}</b><span>${esc(rule.label)} ← ${esc(rule.sourceType === 'fixed_account' ? 'akun lawan pilihan' : rule.sourceType)}</span></div>`).join('')}</div>
            <button class="acc-mini primary" style="margin-top:10px;width:100%" type="button" data-apply-flow-preset="${esc(code)}">Apply / Update Counterpart</button>
          </div>`).join('')}</div>
        <div class="acc-card" style="padding:13px;margin-top:14px"><b>Rule baca cepat</b><div class="acc-muted" style="line-height:1.6;margin-top:5px">Kas masuk: Debit Kas, Credit lawan. Kas keluar: Debit lawan, Credit Kas. Barang masuk: Debit Persediaan, Credit lawan. Barang keluar: Debit lawan, Credit Persediaan. Jika akun lawan bertipe Revenue/Expense, transaksi memang akan masuk Rugi Laba; jika ASSET/LIABILITY/EQUITY, pairing bersifat balance-sheet / non-P&L.</div></div>
      </div>
      ${warehouseReference()}
    </div>`;

    const counterpart = el('accFlowCounterpart');
    const impact = el('accFlowImpact');
    const syncImpact = () => {
      const info = accountImpact(counterpart?.value || '');
      if (impact) {
        impact.className = `acc-chip ${info.className}`.trim();
        impact.textContent = info.text;
      }
    };
    counterpart?.addEventListener('change', syncImpact);
    syncImpact();
    host.querySelectorAll('[data-apply-flow-preset]').forEach(button => button.addEventListener('click', () => applyPreset(button.dataset.applyFlowPreset)));
  }

  async function ensureCategory(code, preset) {
    let tx = (accounting.transactionCategories || []).find(item => item.code === code);
    if (tx) return tx;
    try {
      const created = await api('/api/admin/settings/accounting/transaction-categories', {
        method: 'POST',
        body: JSON.stringify({
          code,
          name: preset.name,
          description: preset.description,
          involvesPayment: preset.involvesPayment,
          involvesItemCategory: preset.involvesItemCategory,
          isActive: true
        })
      });
      return { id: created.id, code, name: preset.name, rules: [] };
    } catch (error) {
      if (error.status !== 409) throw error;
      accounting = await api('/api/admin/settings/accounting');
      tx = (accounting.transactionCategories || []).find(item => item.code === code);
      if (!tx) throw error;
      return tx;
    }
  }

  function matchesManagedShape(activeRules, preset) {
    if (activeRules.length !== 2) return false;
    return preset.rules.every(expected => activeRules.some(rule =>
      rule.side === expected.side
      && (expected.sourceType === 'fixed_account' ? rule.sourceType === 'fixed_account' : rule.sourceType === expected.sourceType)
    ));
  }

  async function applyPreset(code) {
    const preset = FLOW_PRESETS[code];
    const counterpartId = el('accFlowCounterpart')?.value || '';
    if (!preset || !counterpartId) return notify('Pilih akun lawan dulu, bos.');
    const counterpart = activeAccounts().find(account => account.id === counterpartId);
    if (!counterpart) return notify('Akun lawan tidak aktif / tidak ditemukan.');

    try {
      const tx = await ensureCategory(code, preset);
      accounting = await api('/api/admin/settings/accounting');
      const current = (accounting.transactionCategories || []).find(item => item.id === tx.id || item.code === code);
      const activeRules = (current?.rules || []).filter(rule => rule.isActive);
      if (activeRules.length && !matchesManagedShape(activeRules, preset)) {
        throw new Error('Kategori ini sudah dikustomisasi di Aturan Transaksi. Karen tidak overwrite rule custom; edit manual dari sana.');
      }

      if (!activeRules.length) {
        for (const rule of preset.rules) {
          await api('/api/admin/settings/accounting/journal-rules', {
            method: 'POST',
            body: JSON.stringify({
              transactionCategoryId: current?.id || tx.id,
              label: rule.label,
              side: rule.side,
              sourceType: rule.sourceType,
              fixedAccountId: rule.sourceType === 'fixed_account' ? counterpartId : null,
              sortOrder: rule.sortOrder,
              isActive: true
            })
          });
        }
      } else {
        for (const expected of preset.rules) {
          const existing = activeRules.find(rule => rule.side === expected.side && (expected.sourceType === 'fixed_account' ? rule.sourceType === 'fixed_account' : rule.sourceType === expected.sourceType));
          if (!existing) throw new Error('Shape preset tidak cocok dengan rule aktif. Edit manual dari Aturan Transaksi.');
          await api(`/api/admin/settings/accounting/journal-rules/${encodeURIComponent(existing.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({
              transactionCategoryId: current.id,
              label: expected.label,
              side: expected.side,
              sourceType: expected.sourceType,
              fixedAccountId: expected.sourceType === 'fixed_account' ? counterpartId : null,
              sortOrder: expected.sortOrder,
              isActive: true
            })
          });
        }
      }

      await loadData();
      render();
      notify(`${preset.name} siap · akun lawan ${counterpart.code} ${counterpart.name}`);
    } catch (error) {
      notify(error.message);
    }
  }

  async function activate(button) {
    document.querySelectorAll('#tab-accounting-settings-comfort .acc-nav button').forEach(item => item.classList.toggle('active', item === button));
    try {
      await loadData();
      render();
    } catch (error) {
      notify(error.message);
    }
  }

  function mount() {
    const section = el('tab-accounting-settings-comfort');
    const nav = section?.querySelector('.acc-nav');
    if (!section || !nav || el('accountingFlowPresetNav')) return false;
    const button = document.createElement('button');
    button.id = 'accountingFlowPresetNav';
    button.type = 'button';
    button.innerHTML = '<span class="acc-nav-icon">⇄</span>Arus & Counterpart';
    nav.appendChild(button);
    button.addEventListener('click', () => activate(button));

    nav.querySelectorAll('[data-acc-view]').forEach(existing => existing.addEventListener('click', () => {
      button.classList.remove('active');
      setTimeout(() => el('accountingComfortRefresh')?.click(), 0);
    }));
    return true;
  }

  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (mount() || tries > 40) clearInterval(timer);
  }, 100);
})();
