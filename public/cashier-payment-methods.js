(() => {
  const byId = id => document.getElementById(id);
  function methods() { return Array.isArray(state.paymentMethods) ? state.paymentMethods : []; }
  function defaultCode() { const list = methods(); return list.find(item => item.code === 'CASH')?.code || list[0]?.code || ''; }
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
    select.innerHTML = list.map(item => `<option value="${escapeHtml(item.code)}" ${item.code === selected ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
    select.disabled = !list.length;
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
  document.addEventListener('cashier:workspace-applied', renderSaleMethod);
  renderSaleMethod();
})();
