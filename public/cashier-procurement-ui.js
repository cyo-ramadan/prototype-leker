(() => {
  function replaceActionButton(id, handler) {
    const current = el(id);
    if (!current || current.dataset.procurementUiBound === '1') return current;
    const replacement = current.cloneNode(true);
    replacement.dataset.procurementUiBound = '1';
    current.replaceWith(replacement);
    replacement.addEventListener('click', handler);
    return replacement;
  }

  function productOptions(products) {
    return products.map(product => `
      <option value="${Number(product.productId)}" data-unit="${escapeHtml(product.unitSymbol || '')}">
        ${escapeHtml(product.productName)}${product.unitSymbol ? ` · ${escapeHtml(product.unitSymbol)}` : ''}
      </option>`).join('');
  }

  async function purchaseDialogV2() {
    try {
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
          body: '<p class="muted">Belum ada barang aktif yang boleh dibeli dan dilacak stoknya. Tambahkan/aktifkan barang dari Master Barang terlebih dahulu.</p>'
        });
        return;
      }

      const supplierOptions = ['<option value="">Tanpa supplier</option>', ...suppliers.map(supplier => `<option value="${escapeHtml(supplier.id)}">${escapeHtml(supplier.name)}</option>`)].join('');
      const selectableProducts = productOptions(products);
      const lines = [];

      openDialog({
        eyebrow: 'Laci · Inventory Purchase',
        title: 'Beli Bahan',
        body: `
          <div class="field"><label>Supplier</label><select id="dialogSupplier" class="text-input">${supplierOptions}</select></div>
          <div class="field"><label>Cara bayar</label><select id="dialogPurchasePayment" class="text-input">
            <option value="CASH">Cash / Kas</option>
            <option value="BANK">Bank / Transfer</option>
            <option value="PAYABLE">Hutang / Utang Usaha</option>
            <option value="NON_CASH">Non Tunai (legacy)</option>
          </select></div>
          <div class="field"><label>Deskripsi <span class="muted">optional</span></label><input id="dialogPurchaseDescription" class="text-input" maxlength="220" placeholder="Otomatis dari nama barang jika kosong" /></div>
          <div class="cashier-lock-note"><b>Tambah barang dari Master Barang</b><br><span class="muted">Barang tidak menerima input nama bebas. Pilihan di bawah berasal dari database gerai aktif.</span></div>
          <div class="field"><label>Barang</label><select id="dialogPurchaseProduct" class="text-input">${selectableProducts}</select></div>
          <div class="field"><label>Qty <span id="dialogPurchaseUnit" class="muted"></span></label><input id="dialogPurchaseQty" class="text-input" type="number" min="1" step="1" value="1" required /></div>
          <div class="field"><label>Total baris</label><input id="dialogPurchaseLineTotal" class="text-input" type="number" min="1" step="1" required /></div>
          <button id="dialogPurchaseAddLine" class="secondary-btn" type="button">＋ Tambah Baris Barang</button>
          <div id="dialogPurchaseLines" class="cashier-detail-list"></div>
          <div id="dialogPurchaseGrandTotal" class="cashier-lock-note">Total pembelian · Rp0</div>
          <div class="field"><label>Catatan</label><textarea id="dialogPurchaseNote" rows="2" maxlength="500"></textarea></div>
          <p class="muted">Setiap baris menyimpan Product ID, qty, total biaya, unit cost snapshot, stock-in, Harga Beli Terakhir, dan Average Cost secara atomic.</p>`,
        submitText: 'SIMPAN PEMBELIAN',
        onSubmit: async () => {
          if (!lines.length) throw new Error('Tambahkan minimal satu barang pembelian.');
          const result = await api('/api/cashier/purchases', {
            method: 'POST',
            body: JSON.stringify({
              supplierId: el('dialogSupplier').value,
              paymentMethod: el('dialogPurchasePayment').value,
              description: el('dialogPurchaseDescription').value,
              note: el('dialogPurchaseNote').value,
              items: lines.map(line => ({ productId: line.productId, quantity: line.quantity, lineTotal: line.lineTotal }))
            })
          });
          toast(`Pembelian tersimpan · ${lines.length} barang · ${rupiah(result.totalAmount)}`);
          return true;
        }
      });

      const renderUnit = () => {
        const option = el('dialogPurchaseProduct')?.selectedOptions?.[0];
        const unit = option?.dataset.unit || '';
        const label = el('dialogPurchaseUnit');
        if (label) label.textContent = unit ? `(${unit})` : '';
      };

      const renderLines = () => {
        const host = el('dialogPurchaseLines');
        const totalHost = el('dialogPurchaseGrandTotal');
        if (host) {
          host.innerHTML = lines.length
            ? lines.map((line, index) => `<div class="cashier-detail-row"><span><b>${escapeHtml(line.productName)}</b><small>${line.quantity} ${escapeHtml(line.unitSymbol)} · ${rupiah(line.lineTotal / line.quantity)} / unit</small></span><span><b>${rupiah(line.lineTotal)}</b> <button type="button" class="text-btn" data-remove-purchase-line="${index}">Hapus</button></span></div>`).join('')
            : '<div class="muted">Belum ada barang pembelian.</div>';
        }
        const grandTotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
        if (totalHost) totalHost.textContent = `Total pembelian · ${rupiah(grandTotal)}`;
        document.querySelectorAll('[data-remove-purchase-line]').forEach(button => {
          button.addEventListener('click', () => {
            lines.splice(Number(button.dataset.removePurchaseLine), 1);
            renderLines();
          });
        });
      };

      el('dialogPurchaseProduct')?.addEventListener('change', renderUnit);
      el('dialogPurchaseAddLine')?.addEventListener('click', () => {
        const productId = Number(el('dialogPurchaseProduct').value);
        const quantity = Number(el('dialogPurchaseQty').value);
        const lineTotal = Number(el('dialogPurchaseLineTotal').value);
        const product = products.find(item => Number(item.productId) === productId);
        if (!product || !Number.isInteger(quantity) || quantity <= 0) {
          toast('Barang dan qty pembelian wajib valid.');
          return;
        }
        if (!Number.isSafeInteger(lineTotal) || lineTotal <= 0) {
          toast('Total baris pembelian wajib valid.');
          return;
        }
        if (lines.some(line => line.productId === productId)) {
          toast('Barang itu sudah ada di daftar pembelian. Hapus dulu jika ingin mengubah qty.');
          return;
        }
        lines.push({
          productId,
          productName: product.productName,
          unitSymbol: product.unitSymbol || '',
          quantity,
          lineTotal
        });
        el('dialogPurchaseQty').value = '1';
        el('dialogPurchaseLineTotal').value = '';
        renderLines();
      });
      renderUnit();
      renderLines();
    } catch (error) {
      toast(error.message);
    }
  }

  function operationalExpenseDialogV2() {
    openDialog({
      eyebrow: 'Laci · Operasional',
      title: 'Pengeluaran Operasional',
      body: `
        <div class="field"><label>Deskripsi</label><input id="dialogOperationalDescription" class="text-input" maxlength="220" required /></div>
        <div class="field"><label>Qty</label><input id="dialogOperationalQty" class="text-input" type="number" min="0.000001" step="any" value="1" required /></div>
        <div class="field"><label>Total nominal</label><input id="dialogOperationalAmount" class="text-input" type="number" min="1" step="1" required /></div>
        <div class="field"><label>Cara bayar</label><select id="dialogOperationalPayment" class="text-input"><option value="CASH">Cash / Kas</option><option value="NON_CASH">Non Tunai</option></select></div>
        <p class="muted">Qty disimpan sebagai customer-behaviour metadata. Qty operasional tidak mengubah stok barang secara otomatis.</p>`,
      submitText: 'SIMPAN OPERASIONAL',
      onSubmit: async () => {
        const quantity = el('dialogOperationalQty').value.trim();
        const amount = Number(el('dialogOperationalAmount').value);
        if (!quantity) throw new Error('Qty operasional wajib diisi.');
        if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Total nominal operasional wajib valid.');
        const result = await api('/api/cashier/expenses', {
          method: 'POST',
          body: JSON.stringify({
            description: el('dialogOperationalDescription').value,
            quantity,
            amount,
            paymentMethod: el('dialogOperationalPayment').value
          })
        });
        toast(`Operasional tersimpan · qty ${result.quantity} · ${rupiah(result.amount)}`);
        return true;
      }
    });
  }

  replaceActionButton('purchaseBtn', purchaseDialogV2);
  replaceActionButton('expenseBtn', operationalExpenseDialogV2);
})();
