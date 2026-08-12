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
      body: `<p class="muted">${escapeHtml(description)}</p><p class="muted">Write langsung sengaja belum diaktifkan supaya flow laci yang stabil tidak tersentuh sebelum contract domain-nya final.</p>`
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
        <p class="muted">Pengajuan tetap unposted sampai mendapat ACC dan posting contract tersedia.</p>`,
      submitText: 'AJUKAN ARUS KAS',
      onSubmit: async () => {
        const amount = Number(el('approvalCashAmount').value);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Nominal arus kas wajib lebih dari 0.');
        await submitApprovalRequest('CASH_FLOW', {
          direction: el('approvalCashDirection').value,
          amount: Math.round(amount),
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
        <p class="muted">Pengajuan ini tidak mengubah stok pada saat entry kasir.</p>`,
      submitText: 'AJUKAN ARUS BARANG',
      onSubmit: async () => {
        const quantity = Number(el('approvalGoodsQuantity').value);
        if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Qty arus barang wajib bilangan bulat lebih dari 0.');
        const productId = Number(el('approvalGoodsProduct').value);
        const product = (state.products || []).find(item => Number(item.id) === productId);
        if (!product) throw new Error('Barang tidak ditemukan pada snapshot menu kasir.');
        await submitApprovalRequest('GOODS_FLOW', {
          productId,
          productName: product.name,
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
        <div class="field"><label>Deskripsi aset/perubahan</label><input id="approvalAssetDescription" class="text-input" maxlength="220" required /></div>
        <div class="field"><label>Nilai referensi <span class="muted">optional</span></label><input id="approvalAssetValue" class="text-input" type="number" min="0" step="1" /></div>
        <div class="field"><label>Catatan</label><textarea id="approvalAssetNote" rows="2" maxlength="500"></textarea></div>
        <p class="muted">Entry kasir hanya membuat pengajuan. Tidak ada asset ledger yang berubah realtime.</p>`,
      submitText: 'AJUKAN ASET',
      onSubmit: async () => {
        const rawValue = el('approvalAssetValue').value;
        const referenceValue = rawValue === '' ? null : Number(rawValue);
        if (referenceValue !== null && (!Number.isFinite(referenceValue) || referenceValue < 0)) throw new Error('Nilai referensi aset tidak valid.');
        await submitApprovalRequest('ASSET', {
          description: el('approvalAssetDescription').value.trim(),
          referenceValue: referenceValue === null ? null : Math.round(referenceValue),
          note: el('approvalAssetNote').value.trim()
        });
        return true;
      }
    });
  }

  el('stockAdjustmentBtn')?.addEventListener('click', () => pendingContractDialog('Penyesuaian Stok', 'Tombol sudah masuk ke action bar. Contract inventory untuk adjustment belum ditetapkan, jadi belum ada direct write.'));
  el('productionBtn')?.addEventListener('click', () => pendingContractDialog('Produksi', 'Tombol sudah masuk ke action bar. Recipe/BOM, yield, waste, dan costing produksi belum memiliki contract canonical.'));
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
