(() => {
  const byId = id => document.getElementById(id);

  function methods() {
    return Array.isArray(state.paymentMethods) ? state.paymentMethods : [];
  }

  function defaultCode() {
    const list = methods();
    return list.find(item => item.isDefault)?.code
      || list.find(item => item.code === 'CASH')?.code
      || list[0]?.code
      || '';
  }

  function methodOptions(selectedCode = '') {
    const selected = selectedCode || defaultCode();
    return methods().map(item => `<option value="${escapeHtml(item.code)}" ${item.code === selected ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
  }

  function accountingLabel(result) {
    const accounting = result?.accounting;
    if (!accounting) return 'Accounting belum memberi status';
    if (Array.isArray(accounting.deliveries)) {
      const statuses = accounting.deliveries.map(item => item.bridgeStatus).filter(Boolean);
      if (statuses.length && statuses.every(status => status === 'POSTED')) return 'Accounting POSTED';
      if (statuses.some(status => status === 'NEEDS_CONFIGURATION')) return 'Accounting perlu konfigurasi';
      if (statuses.some(status => status === 'FAILED')) return 'Accounting delivery gagal';
      return statuses.length ? `Accounting ${statuses.join('/')}` : 'Accounting belum memberi status';
    }
    if (accounting.bridgeStatus === 'POSTED') return 'Accounting POSTED';
    if (accounting.bridgeStatus === 'NEEDS_CONFIGURATION') return 'Accounting perlu konfigurasi';
    if (accounting.bridgeStatus === 'FAILED') return 'Accounting delivery gagal';
    return accounting.bridgeStatus ? `Accounting ${accounting.bridgeStatus}` : 'Accounting belum memberi status';
  }

  async function canonicalFactPost(path, payload) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const request = new Request(new URL(path, location.origin), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const response = await fetch(request);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Request gagal (${response.status})`);
      error.status = response.status;
      error.code = data.code;
      error.payload = data;
      throw error;
    }
    return data;
  }

  async function refreshAccountingSettings() {
    if (typeof window.refreshCashierWorkspace !== 'function') return;
    try {
      await window.refreshCashierWorkspace({ includeMenu: false });
    } catch (error) {
      console.warn('cashier accounting settings refresh failed; using current workspace snapshot', error);
    }
  }

  let purchaseDataPromise;
  let costMasterPromise;

  function loadPurchaseData() {
    if (!purchaseDataPromise) {
      purchaseDataPromise = Promise.all([
        api('/api/cashier/purchases/options'),
        api('/api/cashier/suppliers').catch(error => ({ suppliers: [], warning: error }))
      ]).then(([purchase, suppliers]) => {
        window.__cashierPurchaseOptions = purchase;
        return { purchase, suppliers };
      }).catch(error => {
        purchaseDataPromise = null;
        throw error;
      });
    }
    return purchaseDataPromise;
  }

  function loadCostMasters() {
    if (!costMasterPromise) {
      costMasterPromise = api('/api/cashier/cost-masters/options').catch(error => {
        costMasterPromise = null;
        throw error;
      });
    }
    return costMasterPromise;
  }

  function renderSaleMethod() {
    const note = byId('saleNote');
    if (!note) return;
    let select = byId('salePaymentMethod');
    const previous = select?.value || defaultCode();
    if (!select) {
      const field = document.createElement('div');
      field.className = 'field';
      field.innerHTML = '<label>Cara bayar</label><select id="salePaymentMethod" class="text-input"></select><div class="muted">Berasal dari metode bayar POS. Hanya CASH memengaruhi kas fisik laci.</div>';
      note.closest('.field')?.insertAdjacentElement('beforebegin', field);
      select = byId('salePaymentMethod');
    }
    const list = methods();
    const selected = list.some(item => item.code === previous) ? previous : defaultCode();
    select.innerHTML = methodOptions(selected);
    select.disabled = !list.length;
  }

  function renderSaleDialogMethod() {
    const note = byId('saleDialogNote');
    if (!note) return;
    let field = byId('saleDialogPaymentField');
    let select = byId('saleDialogPaymentMethod');
    const previous = select?.value || byId('salePaymentMethod')?.value || defaultCode();
    if (!field) {
      field = document.createElement('div');
      field.id = 'saleDialogPaymentField';
      field.className = 'field';
      field.innerHTML = '<label>Cara bayar</label><select id="saleDialogPaymentMethod" class="text-input"></select><div class="muted">Berasal dari metode bayar POS. Hanya CASH memengaruhi kas fisik laci.</div>';
      note.closest('.field')?.insertAdjacentElement('beforebegin', field);
      select = byId('saleDialogPaymentMethod');
    }
    const list = methods();
    const selected = list.some(item => item.code === previous) ? previous : defaultCode();
    select.innerHTML = methodOptions(selected);
    select.disabled = !list.length;
    select.onchange = () => {
      const base = byId('salePaymentMethod');
      if (base) base.value = select.value;
    };
    if (selected && byId('salePaymentMethod')) byId('salePaymentMethod').value = selected;
  }

  async function syncSaleDialogAccounting() {
    await refreshAccountingSettings();
    renderSaleMethod();
    renderSaleDialogMethod();
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
      if (!state.canWrite) {
        toast(state.drawer
          ? `Beli Bahan terkunci. Laci sedang dipegang ${state.drawer.cashierName}.`
          : 'Buka Laci dulu untuk mencatat pembelian bahan.');
        return;
      }

      await refreshAccountingSettings();
      if (!methods().length) throw new Error('Belum ada cara bayar POS yang aktif.');

      let purchasePayload, supplierPayload;
      try {
        ({ purchase: purchasePayload, suppliers: supplierPayload } = await loadPurchaseData());
      } catch (error) {
        openDialog({
          eyebrow: 'Laci · Beli Bahan',
          title: 'Beli Bahan · Transaksi',
          readOnly: true,
          body: `<div class="cashier-lock-note"><b>Master Barang gagal dimuat</b><br><span class="muted">${escapeHtml(error.message)}${error.code ? ` · ${escapeHtml(error.code)}` : ''}</span></div>`
        });
        return;
      }

      if (supplierPayload.warning) toast('Supplier gagal dimuat. Pembelian dilanjutkan tanpa supplier.');
      const suppliers = supplierPayload.suppliers || [];
      const products = purchasePayload.products || [];
      if (!products.length) {
        openDialog({
          eyebrow: 'Laci · Beli Bahan',
          title: 'Beli Bahan · Transaksi',
          readOnly: true,
          body: '<p class="muted">Belum ada barang aktif yang boleh dibeli dan dilacak stoknya.</p>'
        });
        return;
      }

      const supplierOptions = ['<option value="">Tanpa supplier</option>', ...suppliers.map(supplier => `<option value="${escapeHtml(supplier.id)}">${escapeHtml(supplier.name)}</option>`)].join('');
      let editor;

      openDialog({
        eyebrow: 'Laci · Beli Bahan',
        title: 'Beli Bahan · Transaksi',
        body: `
          <div id="purchasePimasatu"></div>
          <div class="field"><label>Supplier</label><select id="dialogSupplier" class="text-input">${supplierOptions}</select></div>
          <div class="field"><label>Cara bayar</label><select id="dialogPurchasePayment" class="text-input">${methodOptions()}</select><div class="muted">Berasal dari metode bayar POS.</div></div>
          <div class="field"><label>Deskripsi <span class="muted">optional</span></label><input id="dialogPurchaseDescription" class="text-input" maxlength="220" placeholder="Otomatis dari nama barang jika kosong" /></div>
          <div class="field"><label>Catatan <span class="muted">optional</span></label><textarea id="dialogPurchaseNote" rows="2" maxlength="500"></textarea></div>
          <div id="dialogPurchaseGrandTotal" class="cashier-lock-note">Total pembelian · Rp0</div>
          <p class="muted">PIMASATU hanya mengatur pola input barang. Supplier dan cara bayar adalah data transaksi terpisah.</p>`,
        submitText: 'SIMPAN PEMBELIAN',
        onSubmit: async () => {
          const lines = editor.getLines();
          const submittedItems = lines.map(line => ({
            productId: Number(line.id),
            quantity: Number(line.quantity),
            lineTotal: Math.round(Number(line.quantity) * Number(line.unitAmount))
          }));
          if (!submittedItems.length) throw new Error('Masukkan minimal satu barang pembelian.');
          if (submittedItems.some(item => !Number.isInteger(item.quantity) || item.quantity <= 0)) throw new Error('Qty barang terpilih wajib bilangan bulat lebih dari 0.');
          if (submittedItems.some(item => !Number.isSafeInteger(item.lineTotal) || item.lineTotal <= 0)) throw new Error('Harga beli dan total baris wajib lebih dari 0.');
          const result = await canonicalFactPost('/api/cashier/purchases', {
            supplierId: byId('dialogSupplier').value,
            paymentMethod: byId('dialogPurchasePayment').value,
            description: byId('dialogPurchaseDescription').value,
            note: byId('dialogPurchaseNote').value,
            items: submittedItems
          });
          toast(`Pembelian tersimpan · ${submittedItems.length} barang · ${rupiah(result.totalAmount)} · ${accountingLabel(result)}`);
          return true;
        }
      });

      editor = window.MAXIPimasatu.create({
        host: byId('purchasePimasatu'),
        items: products,
        getId: item => item.productId,
        getLabel: item => item.productName,
        getMeta: item => [item.productKindName, item.unitSymbol].filter(Boolean).join(' · '),
        getDefaultAmount: item => item.purchasePrice,
        itemLabel: 'Barang / bahan',
        priceLabel: 'Harga beli / unit',
        detailTitle: 'Detail Pembelian',
        priceEditable: true,
        amountMode: 'toggle',
        onError: toast,
        onLinesChange: lines => {
          const total = lines.reduce((sum, line) => sum + Math.round(Number(line.quantity) * Number(line.unitAmount)), 0);
          const host = byId('dialogPurchaseGrandTotal');
          if (host) host.textContent = `Total pembelian · ${rupiah(total)}`;
        }
      });
    } catch (error) {
      toast(error.message);
    }
  }

  async function operationalDialog() {
    await refreshAccountingSettings();
    if (!methods().length) return toast('Belum ada cara bayar POS yang aktif.');

    let payload;
    try {
      payload = await loadCostMasters();
    } catch (error) {
      return toast(`Master Biaya gagal dimuat: ${error.message}`);
    }

    const costs = payload.costs || [];
    if (!costs.length) return toast('Belum ada Master Biaya aktif.');
    let editor;

    openDialog({
      eyebrow: 'Laci · Operasional',
      title: 'Pengeluaran Operasional',
      body: `
        <div id="operationalPimasatu"></div>
        <div class="field"><label>Kontak terkait</label><div id="operationalContactSummary" class="cashier-lock-note">Mengikuti kontak pada Master Biaya yang dipilih.</div></div>
        <div class="field"><label>Cara bayar</label><select id="dialogOperationalPayment" class="text-input">${methodOptions()}</select><div class="muted">Berasal dari metode bayar POS.</div></div>
        <div id="dialogOperationalTotal" class="cashier-lock-note">Total operasional · Rp0</div>
        <p class="muted">PIMASATU hanya mengatur pola input biaya. Kontak dan cara bayar tetap berada di layer transaksi.</p>`,
      submitText: 'SIMPAN OPERASIONAL',
      onSubmit: async () => {
        const items = editor.getLines().map(line => ({
          costMasterId: line.id,
          quantity: line.quantity,
          unitAmount: line.unitAmount
        }));
        if (!items.length) throw new Error('Masukkan minimal satu biaya operasional.');
        const result = await canonicalFactPost('/api/cashier/expenses', {
          items,
          paymentMethod: byId('dialogOperationalPayment').value
        });
        toast(`Operasional tersimpan · ${items.length} biaya · ${rupiah(result.totalAmount)} · ${accountingLabel(result)}`);
        return true;
      }
    });

    editor = window.MAXIPimasatu.create({
      host: byId('operationalPimasatu'),
      items: costs,
      getId: item => item.id,
      getLabel: item => item.name,
      getMeta: item => [item.costTypeName, item.costGroup, item.contact].filter(Boolean).join(' · '),
      getDefaultAmount: item => item.outgoingAmount,
      itemLabel: 'Biaya / variabel',
      priceLabel: 'Biaya keluar / unit',
      detailTitle: 'Detail Operasional',
      onError: toast,
      onLinesChange: lines => {
        const contacts = [...new Set(lines.map(line => line.item?.contact).filter(Boolean))];
        const contactHost = byId('operationalContactSummary');
        if (contactHost) contactHost.textContent = contacts.length ? contacts.join(' · ') : 'Tidak ada kontak pada detail yang dipilih.';
        const total = lines.reduce((sum, line) => sum + (Number(line.quantity) * Number(line.unitAmount)), 0);
        const totalHost = byId('dialogOperationalTotal');
        if (totalHost) totalHost.textContent = `Total operasional · ${rupiah(total)}`;
      }
    });
  }

  if (!window.__cashierPaymentApiWrapped) {
    window.__cashierPaymentApiWrapped = true;
    const baseApi = api;
    api = async function cashierPaymentAwareApi(path, options = {}) {
      const method = String(options.method || 'GET').toUpperCase();
      if (path === '/api/cashier/sales' && method === 'POST' && options.body) {
        try {
          const payload = JSON.parse(options.body);
          payload.paymentMethod = byId('saleDialogPaymentMethod')?.value
            || byId('salePaymentMethod')?.value
            || payload.paymentMethod
            || defaultCode()
            || 'CASH';
          return canonicalFactPost(path, payload);
        } catch (error) {
          if (error instanceof SyntaxError) return baseApi(path, options);
          throw error;
        }
      }
      return baseApi(path, options);
    };
  }

  function bindCanonicalPurchaseClick() {
    if (window.__cashierPurchaseClickBound) return;
    window.__cashierPurchaseClickBound = true;
    document.addEventListener('click', event => {
      const button = event.target.closest?.('#purchaseBtn');
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      purchaseDialog();
    }, true);
  }

  function mount() {
    renderSaleMethod();
    renderSaleDialogMethod();
    bindCanonicalPurchaseClick();
    replaceButton('expenseBtn', 'accountingInputsBound', operationalDialog);
    if (state.canWrite) {
      loadPurchaseData().catch(() => {});
      loadCostMasters().catch(() => {});
    }
  }

  document.addEventListener('cashier:workspace-applied', mount);
  document.addEventListener('cashier:sale-dialog-opened', () => {
    syncSaleDialogAccounting().catch(error => toast(error.message));
  });
  mount();
})();
