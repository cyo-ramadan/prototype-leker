(() => {
  const byId = id => document.getElementById(id);
  function methods() { return Array.isArray(state.paymentMethods) ? state.paymentMethods : []; }
  function components() { return Array.isArray(state.operationalAccountingComponents) ? state.operationalAccountingComponents : []; }
  function defaultCode() { const list = methods(); return list.find(item => item.isDefault)?.code || list.find(item => item.code === 'CASH')?.code || list[0]?.code || ''; }
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

  function replaceButton(id, marker, handler) {
    const current = byId(id);
    if (!current || current.dataset[marker] === '1') return;
    const replacement = current.cloneNode(true);
    replacement.dataset[marker] = '1';
    current.replaceWith(replacement);
    replacement.addEventListener('click', handler);
  }

  async function purchaseDialog() {
    try {
      if (!methods().length) throw new Error('Belum ada cara bayar aktif di Setting Akuntansi.');
      const [supplierPayload, purchasePayload] = await Promise.all([
        api('/api/cashier/suppliers'),
        api('/api/cashier/purchases/options')
      ]);
      const suppliers = supplierPayload.suppliers || [];
      const products = purchasePayload.products || [];
      if (!products.length) {
        openDialog({
          eyebrow: 'Laci · Pembelian',
          title: 'Beli Bahan',
          readOnly: true,
          body: '<p class="muted">Belum ada barang aktif yang boleh dibeli dan dilacak stoknya.</p>'
        });
        return;
      }

      const supplierOptions = ['<option value="">Tanpa supplier</option>', ...suppliers.map(supplier => `<option value="${escapeHtml(supplier.id)}">${escapeHtml(supplier.name)}</option>`)].join('');
      const productOptions = products.map(product => `<option value="${Number(product.productId)}" data-unit="${escapeHtml(product.unitSymbol || '')}">${escapeHtml(product.productName)}${product.unitSymbol ? ` · ${escapeHtml(product.unitSymbol)}` : ''}</option>`).join('');
      const lines = [];

      openDialog({
        eyebrow: 'Laci · Inventory Purchase',
        title: 'Beli Bahan',
        body: `
          <div class="field"><label>Supplier</label><select id="dialogSupplier" class="text-input">${supplierOptions}</select></div>
          <div class="field"><label>Cara bayar</label><select id="dialogPurchasePayment" class="text-input">${methodOptions()}</select></div>
          <div class="field"><label>Deskripsi <span class="muted">optional</span></label><input id="dialogPurchaseDescription" class="text-input" maxlength="220" placeholder="Otomatis dari nama barang jika kosong" /></div>
          <div class="cashier-lock-note"><b>Barang dari Master Barang</b><br><span class="muted">Product ID, qty, stock-in, HPP, dan snapshot biaya tetap atomic.</span></div>
          <div class="field"><label>Barang</label><select id="dialogPurchaseProduct" class="text-input">${productOptions}</select></div>
          <div class="field"><label>Qty <span id="dialogPurchaseUnit" class="muted"></span></label><input id="dialogPurchaseQty" class="text-input" type="number" min="1" step="1" value="1" required /></div>
          <div class="field"><label>Total baris</label><input id="dialogPurchaseLineTotal" class="text-input" type="number" min="1" step="1" required /></div>
          <button id="dialogPurchaseAddLine" class="secondary-btn" type="button">＋ Tambah Baris Barang</button>
          <div id="dialogPurchaseLines" class="cashier-detail-list"></div>
          <div id="dialogPurchaseGrandTotal" class="cashier-lock-note">Total pembelian · Rp0</div>
          <div class="field"><label>Catatan</label><textarea id="dialogPurchaseNote" rows="2" maxlength="500"></textarea></div>
          <p class="muted">Cara bayar berasal dari Setting Akuntansi. Hanya CASH memengaruhi kas fisik laci.</p>`,
        submitText: 'SIMPAN PEMBELIAN',
        onSubmit: async () => {
          if (!lines.length) throw new Error('Tambahkan minimal satu barang pembelian.');
          const result = await api('/api/cashier/purchases', {
            method: 'POST',
            body: JSON.stringify({
              supplierId: byId('dialogSupplier').value,
              paymentMethod: byId('dialogPurchasePayment').value,
              description: byId('dialogPurchaseDescription').value,
              note: byId('dialogPurchaseNote').value,
              items: lines.map(line => ({ productId: line.productId, quantity: line.quantity, lineTotal: line.lineTotal }))
            })
          });
          toast(`Pembelian tersimpan · ${lines.length} barang · ${rupiah(result.totalAmount)}`);
          return true;
        }
      });

      const renderUnit = () => {
        const option = byId('dialogPurchaseProduct')?.selectedOptions?.[0];
        const label = byId('dialogPurchaseUnit');
        if (label) label.textContent = option?.dataset.unit ? `(${option.dataset.unit})` : '';
      };
      const renderLines = () => {
        const host = byId('dialogPurchaseLines');
        const totalHost = byId('dialogPurchaseGrandTotal');
        if (host) {
          host.innerHTML = lines.length
            ? lines.map((line, index) => `<div class="cashier-detail-row"><span><b>${escapeHtml(line.productName)}</b><small>${line.quantity} ${escapeHtml(line.unitSymbol)} · ${rupiah(line.lineTotal / line.quantity)} / unit</small></span><span><b>${rupiah(line.lineTotal)}</b> <button type="button" class="text-btn" data-remove-configured-purchase-line="${index}">Hapus</button></span></div>`).join('')
            : '<div class="muted">Belum ada barang pembelian.</div>';
        }
        if (totalHost) totalHost.textContent = `Total pembelian · ${rupiah(lines.reduce((sum, line) => sum + line.lineTotal, 0))}`;
        document.querySelectorAll('[data-remove-configured-purchase-line]').forEach(button => {
          button.addEventListener('click', () => {
            lines.splice(Number(button.dataset.removeConfiguredPurchaseLine), 1);
            renderLines();
          });
        });
      };

      byId('dialogPurchaseProduct')?.addEventListener('change', renderUnit);
      byId('dialogPurchaseAddLine')?.addEventListener('click', () => {
        const productId = Number(byId('dialogPurchaseProduct').value);
        const quantity = Number(byId('dialogPurchaseQty').value);
        const lineTotal = Number(byId('dialogPurchaseLineTotal').value);
        const product = products.find(item => Number(item.productId) === productId);
        if (!product || !Number.isInteger(quantity) || quantity <= 0) return toast('Barang dan qty pembelian wajib valid.');
        if (!Number.isSafeInteger(lineTotal) || lineTotal <= 0) return toast('Total baris pembelian wajib valid.');
        if (lines.some(line => line.productId === productId)) return toast('Barang itu sudah ada di daftar pembelian.');
        lines.push({ productId, productName: product.productName, unitSymbol: product.unitSymbol || '', quantity, lineTotal });
        byId('dialogPurchaseQty').value = '1';
        byId('dialogPurchaseLineTotal').value = '';
        renderLines();
      });
      renderUnit();
      renderLines();
    } catch (error) {
      toast(error.message);
    }
  }

  function operationalDialog() {
    if (!methods().length) return toast('Belum ada cara bayar aktif di Setting Akuntansi.');
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
    replaceButton('purchaseBtn', 'configuredPurchaseBound', purchaseDialog);
    replaceButton('expenseBtn', 'accountingInputsBound', operationalDialog);
  }

  document.addEventListener('cashier:workspace-applied', mount);
  mount();
})();
