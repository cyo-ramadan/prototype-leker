(() => {
  const approvalButtonIds = ['stockAdjustmentBtn', 'productionBtn', 'cashFlowBtn', 'goodsFlowBtn', 'assetBtn'];

  function syncApprovalButtons() {
    for (const id of approvalButtonIds) {
      const button = el(id);
      if (button) button.disabled = !state.canWrite;
    }
  }

  async function submitApprovalRequest(requestType, payload) {
    const result = await api('/api/cashier/approval-requests', {
      method: 'POST',
      body: JSON.stringify({ requestType, payload })
    });
    toast(`Pengajuan ${result.request.requestType} masuk · pending approval`);
    return result;
  }

  function pendingContractDialog(title, description) {
    openDialog({
      eyebrow: 'Laci · Modul Baru',
      title,
      readOnly: true,
      body: `<p class="muted">${escapeHtml(description)}</p><p class="muted">Modul ini akan memakai contract versioned sendiri sebelum write behavior diaktifkan.</p>`
    });
  }

  function cashFlowDialog() {
    openDialog({
      eyebrow: 'Laci · Approval Queue',
      title: 'Arus Kas',
      body: `
        <div class="field"><label>Arah arus</label><select id="approvalCashDirection" class="text-input"><option value="IN">Kas Masuk</option><option value="OUT">Kas Keluar</option></select></div>
        <div class="field"><label>Nominal</label><input id="approvalCashAmount" class="text-input" type="number" min="1" step="1" required /></div>
        <div class="field"><label>Deskripsi</label><input id="approvalCashDescription" class="text-input" maxlength="220" required /></div>
        <div class="field"><label>Catatan</label><textarea id="approvalCashNote" rows="2" maxlength="500"></textarea></div>
        <p class="muted">Entry kasir tetap unposted. Setelah ACC Admin/Owner, snapshot diposting atomic ke cash ledger laci.</p>`,
      submitText: 'AJUKAN ARUS KAS',
      onSubmit: async () => {
        const amount = Number(el('approvalCashAmount').value);
        if (!Number.isInteger(amount) || amount <= 0) throw new Error('Nominal arus kas wajib bilangan bulat lebih dari 0.');
        await submitApprovalRequest('CASH_FLOW', {
          direction: el('approvalCashDirection').value,
          amount,
          description: el('approvalCashDescription').value.trim(),
          note: el('approvalCashNote').value.trim()
        });
        return true;
      }
    });
  }

  function goodsFlowDialog() {
    const options = (state.products || []).map(product => `<option value="${Number(product.id)}">${escapeHtml(product.name)}</option>`).join('');
    openDialog({
      eyebrow: 'Laci · Approval Queue',
      title: 'Arus Barang',
      body: `
        <div class="field"><label>Barang</label><select id="approvalGoodsProduct" class="text-input" required>${options}</select></div>
        <div class="field"><label>Arah arus</label><select id="approvalGoodsDirection" class="text-input"><option value="IN">Barang Masuk</option><option value="OUT">Barang Keluar</option></select></div>
        <div class="field"><label>Qty</label><input id="approvalGoodsQuantity" class="text-input" type="number" min="1" step="1" required /></div>
        <div class="field"><label>Catatan</label><textarea id="approvalGoodsNote" rows="2" maxlength="500"></textarea></div>
        <p class="muted">Entry kasir tidak mengubah stok. Setelah ACC, stock balance dan inventory ledger berubah dalam batch yang sama.</p>`,
      submitText: 'AJUKAN ARUS BARANG',
      onSubmit: async () => {
        const quantity = Number(el('approvalGoodsQuantity').value);
        if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Qty arus barang wajib bilangan bulat lebih dari 0.');
        const productId = Number(el('approvalGoodsProduct').value);
        if (!Number.isInteger(productId)) throw new Error('Barang tidak valid.');
        await submitApprovalRequest('GOODS_FLOW', {
          productId,
          direction: el('approvalGoodsDirection').value,
          quantity,
          note: el('approvalGoodsNote').value.trim()
        });
        return true;
      }
    });
  }

  function assetDialog() {
    openDialog({
      eyebrow: 'Laci · Approval Queue',
      title: 'Aset',
      body: `
        <div class="field"><label>Perubahan nilai aset</label><select id="approvalAssetDirection" class="text-input"><option value="INCREASE">Tambah Nilai Aset</option><option value="DECREASE">Kurangi Nilai Aset</option></select></div>
        <div class="field"><label>Nilai</label><input id="approvalAssetAmount" class="text-input" type="number" min="1" step="1" required /></div>
        <div class="field"><label>Deskripsi aset/perubahan</label><input id="approvalAssetDescription" class="text-input" maxlength="220" required /></div>
        <div class="field"><label>Catatan</label><textarea id="approvalAssetNote" rows="2" maxlength="500"></textarea></div>
        <p class="muted">Asset V1 memakai aggregate asset-value ledger gerai. Entry baru berdampak setelah ACC.</p>`,
      submitText: 'AJUKAN ASET',
      onSubmit: async () => {
        const amount = Number(el('approvalAssetAmount').value);
        if (!Number.isInteger(amount) || amount <= 0) throw new Error('Nilai aset wajib bilangan bulat lebih dari 0.');
        await submitApprovalRequest('ASSET', {
          direction: el('approvalAssetDirection').value,
          amount,
          description: el('approvalAssetDescription').value.trim(),
          note: el('approvalAssetNote').value.trim()
        });
        return true;
      }
    });
  }

  el('stockAdjustmentBtn')?.addEventListener('click', () => pendingContractDialog('Penyesuaian Stok', 'Entry point tersedia. Protocol adjustment akan memakai inventory ledger yang sama, dengan rule snapshot adjustment versioned terpisah.'));
  el('productionBtn')?.addEventListener('click', () => pendingContractDialog('Produksi', 'Entry point tersedia. Protocol produksi akan dibuat saat recipe/BOM master pertama kali diaktifkan agar input-output produksinya eksplisit.'));
  el('cashFlowBtn')?.addEventListener('click', cashFlowDialog);
  el('goodsFlowBtn')?.addEventListener('click', goodsFlowDialog);
  el('assetBtn')?.addEventListener('click', assetDialog);

  const baseRenderDrawer = renderDrawer;
  renderDrawer = function renderDrawerWithApprovalActions() {
    baseRenderDrawer();
    syncApprovalButtons();
  };

  syncApprovalButtons();
})();
