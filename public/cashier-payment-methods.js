(() => {
  const byId = id => document.getElementById(id);
  function methods() { return Array.isArray(state.paymentMethods) ? state.paymentMethods : []; }
  function components() { return Array.isArray(state.operationalAccountingComponents) ? state.operationalAccountingComponents : []; }
  function defaultCode() { const list = methods(); return list.find(item => item.code === 'CASH')?.code || list[0]?.code || ''; }
  function methodOptions(selectedCode = '') {
    const selected = selectedCode || defaultCode();
    return methods().map(item => `<option value="${escapeHtml(item.code)}" ${item.code === selected ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
  }

  function renderSaleMethod() {
    const note = byId('saleNote');
    if (!note) return;
    let select = byId('salePaymentMethod');
    const previous = select?.value || defaultCode();
    if (!select) {
      const field = document.createElement('div');
      field.className = 'field';
      field.innerHTML = '<label>Cara bayar</label><select id="salePaymentMethod" class="text-input"></select><div class="muted">Hanya CASH memengaruhi kas fisik laci.</div>';
      note.closest('.field')?.insertAdjacentElement('beforebegin', field);
      select = byId('salePaymentMethod');
    }
    const list = methods();
    const selected = list.some(item => item.code === previous) ? previous : defaultCode();
    select.innerHTML = methodOptions(selected);
    select.disabled = !list.length;
  }

  function bindOperationalButton() {
    const current = byId('expenseBtn');
    if (!current || current.dataset.accountingInputsBound === '1') return;
    const replacement = current.cloneNode(true);
    replacement.dataset.accountingInputsBound = '1';
    current.replaceWith(replacement);
    replacement.addEventListener('click', () => {
      const list = methods();
      if (!list.length) return toast('Belum ada cara bayar aktif di Setting Akuntansi.');
      const expenseComponents = components();
      const componentField = expenseComponents.length > 1
        ? `<div class="field"><label>Komponen beban</label><select id="dialogOperationalComponent" class="text-input" required><option value="">Pilih komponen…</option>${expenseComponents.map(component => `<option value="${escapeHtml(component.journalRuleId)}">${escapeHtml(component.label)}${component.accountCode ? ` · ${escapeHtml(component.accountCode)} ${escapeHtml(component.accountName)}` : ''}</option>`).join('')}</select></div>`
        : expenseComponents.length === 1
          ? `<div class="cashier-lock-note"><b>Komponen beban</b><br>${escapeHtml(expenseComponents[0].label)}${expenseComponents[0].accountCode ? ` · ${escapeHtml(expenseComponents[0].accountCode)} ${escapeHtml(expenseComponents[0].accountName)}` : ''}</div>`
          : '<div class="cashier-lock-note"><b>Accounting belum lengkap</b><br><span class="muted">Belum ada komponen Debit Operasional aktif. Transaksi tetap tersimpan, Accounting akan fail-closed sampai setting dilengkapi.</span></div>';

      openDialog({
        eyebrow: 'Laci · Operasional',
        title: 'Pengeluaran Operasional',
        body: `
          <div class="field"><label>Deskripsi</label><input id="dialogOperationalDescription" class="text-input" maxlength="220" required /></div>
          <div class="field"><label>Qty</label><input id="dialogOperationalQty" class="text-input" type="number" min="0.000001" step="any" value="1" required /></div>
          <div class="field"><label>Total nominal</label><input id="dialogOperationalAmount" class="text-input" type="number" min="1" step="1" required /></div>
          <div class="field"><label>Cara bayar</label><select id="dialogOperationalPayment" class="text-input">${methodOptions()}</select></div>
          ${componentField}
          <p class="muted">Qty adalah metadata perilaku transaksi dan tidak mengubah stok. Hanya CASH memengaruhi kas fisik laci.</p>`,
        submitText: 'SIMPAN OPERASIONAL',
        onSubmit: async () => {
          const quantity = byId('dialogOperationalQty').value.trim();
          const amount = Number(byId('dialogOperationalAmount').value);
          if (!quantity) throw new Error('Qty operasional wajib diisi.');
          if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Total nominal operasional wajib valid.');
          const accountingComponentRuleId = expenseComponents.length > 1
            ? byId('dialogOperationalComponent').value
            : expenseComponents[0]?.journalRuleId || null;
          if (expenseComponents.length > 1 && !accountingComponentRuleId) throw new Error('Pilih komponen beban Accounting.');
          const result = await api('/api/cashier/expenses', {
            method: 'POST',
            body: JSON.stringify({
              description: byId('dialogOperationalDescription').value,
              quantity,
              amount,
              paymentMethod: byId('dialogOperationalPayment').value,
              accountingComponentRuleId
            })
          });
          toast(`Operasional tersimpan · qty ${result.quantity} · ${rupiah(result.amount)}`);
          return true;
        }
      });
    });
  }

  if (!window.__cashierPaymentApiWrapped) {
    window.__cashierPaymentApiWrapped = true;
    const baseApi = api;
    api = async function cashierPaymentAwareApi(path, options = {}) {
      if (path === '/api/cashier/sales' && String(options.method || 'GET').toUpperCase() === 'POST' && options.body) {
        try {
          const payload = JSON.parse(options.body);
          if (!payload.paymentMethod) payload.paymentMethod = byId('salePaymentMethod')?.value || defaultCode() || 'CASH';
          options = { ...options, body: JSON.stringify(payload) };
        } catch {}
      }
      return baseApi(path, options);
    };
  }

  function mount() {
    renderSaleMethod();
    bindOperationalButton();
  }

  document.addEventListener('cashier:workspace-applied', mount);
  mount();
})();
