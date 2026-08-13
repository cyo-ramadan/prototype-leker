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
    const label = result.request?.payload?.purpose === 'STOCK_ADJUSTMENT' ? 'Penyesuaian Stok' : result.request.requestType;
    toast(`Pengajuan ${label} masuk · pending approval`);
    return result;
  }

  async function stockAdjustmentDialog() {
    try {
      const payload = await api('/api/cashier/stock-adjustment/options');
      const products = payload.products || [];
      if (!products.length) {
        openDialog({
          eyebrow: 'Laci · Inventory',
          title: 'Penyesuaian Stok',
          readOnly: true,
          body: '<p class="muted">Belum ada barang aktif dengan stock tracking yang dapat disesuaikan.</p>'
        });
        return;
      }
      const options = products.map(product => `
        <option value="${Number(product.productId)}" data-current="${Number(product.currentQuantity)}" data-unit="${escapeHtml(product.unitSymbol || '')}">
          ${escapeHtml(product.productName)} · stok ${Number(product.currentQuantity)} ${escapeHtml(product.unitSymbol || '')}
        </option>`).join('');

      openDialog({
        eyebrow: 'Laci · Approval Queue',
        title: 'Penyesuaian Stok',
        body: `
          <div class="field"><label>Barang</label><select id="stockAdjustmentProduct" class="text-input" required>${options}</select></div>
          <div id="stockAdjustmentCurrent" class="cashier-lock-note"></div>
          <div class="field"><label>Target stok fisik</label><input id="stockAdjustmentTarget" class="text-input" type="number" min="0" step="1" required /></div>
          <div class="field"><label>Alasan penyesuaian</label><input id="stockAdjustmentReason" class="text-input" maxlength="220" placeholder="Contoh: hasil hitung fisik" required /></div>
          <div class="field"><label>Catatan <span class="muted">optional</span></label><textarea id="stockAdjustmentNote" rows="2" maxlength="500"></textarea></div>
          <div id="stockAdjustmentDelta" class="cashier-lock-note"></div>
          <p class="muted">Saat diajukan, server menyimpan snapshot stok saat ini. Saat Admin/Owner ACC, stok dicek ulang. Jika sudah berubah karena transaksi lain, pengajuan ditolak sebagai stale dan harus diajukan ulang.</p>`,
        submitText: 'AJUKAN PENYESUAIAN',
        onSubmit: async () => {
          const productId = Number(el('stockAdjustmentProduct').value);
          const targetQuantity = Number(el('stockAdjustmentTarget').value);
          const reason = el('stockAdjustmentReason').value.trim();
          if (!Number.isInteger(productId)) throw new Error('Barang Penyesuaian Stok tidak valid.');
          if (!Number.isInteger(targetQuantity) || targetQuantity < 0) throw new Error('Target stok wajib bilangan bulat minimal 0.');
          if (!reason) throw new Error('Alasan Penyesuaian Stok wajib diisi.');
          await submitApprovalRequest('GOODS_FLOW', {
            purpose: 'STOCK_ADJUSTMENT',
            productId,
            targetQuantity,
            reason,
            note: el('stockAdjustmentNote').value.trim()
          });
          return true;
        }
      });

      const renderAdjustment = () => {
        const option = el('stockAdjustmentProduct')?.selectedOptions?.[0];
        const currentQuantity = Number(option?.dataset.current || 0);
        const unit = option?.dataset.unit || '';
        const targetInput = el('stockAdjustmentTarget');
        if (targetInput && targetInput.value === '') targetInput.value = String(currentQuantity);
        const targetQuantity = Number(targetInput?.value || currentQuantity);
        const currentNode = el('stockAdjustmentCurrent');
        if (currentNode) currentNode.textContent = `Stok sistem saat ini · ${currentQuantity} ${unit}`;
        const deltaNode = el('stockAdjustmentDelta');
        if (deltaNode) {
          if (!Number.isInteger(targetQuantity) || targetQuantity < 0) deltaNode.textContent = 'Target stok belum valid.';
          else if (targetQuantity === currentQuantity) deltaNode.textContent = 'Tidak ada selisih. Ubah target sesuai hasil stok fisik.';
          else deltaNode.textContent = `Perubahan saat ACC · ${currentQuantity} → ${targetQuantity} ${unit} · ${targetQuantity > currentQuantity ? '+' : ''}${targetQuantity - currentQuantity}`;
        }
      };
      el('stockAdjustmentProduct')?.addEventListener('change', () => {
        const option = el('stockAdjustmentProduct')?.selectedOptions?.[0];
        if (el('stockAdjustmentTarget')) el('stockAdjustmentTarget').value = option?.dataset.current || '0';
        renderAdjustment();
      });
      el('stockAdjustmentTarget')?.addEventListener('input', renderAdjustment);
      renderAdjustment();
    } catch (error) {
      toast(error.message);
    }
  }

  async function productionDialog() {
    try {
      const payload = await api('/api/cashier/production/options');
      const products = payload.products || [];
      if (!products.length) {
        openDialog({
          eyebrow: 'Laci · Produksi',
          title: 'Produksi',
          readOnly: true,
          body: '<p class="muted">Belum ada barang yang punya resep aktif dan diizinkan sebagai hasil produksi. Atur resep dari Master terlebih dahulu.</p>'
        });
        return;
      }
      const options = products.map(product => `
        <option value="${Number(product.productId)}" data-output-qty="${Number(product.outputQuantityPerBatch)}" data-unit="${escapeHtml(product.unitSymbol)}" data-revision="${Number(product.recipeRevision)}">
          ${escapeHtml(product.productName)} · resep v${Number(product.recipeRevision)}
        </option>`).join('');
      openDialog({
        eyebrow: 'Laci · Produksi',
        title: 'Produksi dari Resep',
        body: `
          <div class="field"><label>Barang hasil</label><select id="manualProductionProduct" class="text-input" required>${options}</select></div>
          <div class="field"><label>Jumlah batch</label><input id="manualProductionBatches" class="text-input" type="number" min="1" step="1" value="1" required /></div>
          <div id="manualProductionSummary" class="cashier-lock-note"></div>
          <p class="muted">Sistem snapshot resep aktif, mengurangi komponen, menambah hasil produksi, dan mencatat mutasi stok dalam satu batch atomic.</p>`,
        submitText: 'PRODUKSI SEKARANG',
        onSubmit: async () => {
          const outputProductId = Number(el('manualProductionProduct').value);
          const batches = Number(el('manualProductionBatches').value);
          if (!Number.isInteger(outputProductId) || !Number.isInteger(batches) || batches < 1) {
            throw new Error('Barang hasil dan jumlah batch wajib valid.');
          }
          const result = await api('/api/cashier/production', {
            method: 'POST',
            body: JSON.stringify({ outputProductId, batches })
          });
          toast(`Produksi tersimpan · ${result.production.totalOutputQuantity} ${result.production.unitSymbol} ${result.production.outputProductName}`);
          return true;
        }
      });

      const renderSummary = () => {
        const select = el('manualProductionProduct');
        const batches = Number(el('manualProductionBatches')?.value || 0);
        const option = select?.selectedOptions?.[0];
        const qty = Number(option?.dataset.outputQty || 0);
        const unit = option?.dataset.unit || '';
        const revision = option?.dataset.revision || '-';
        const summary = el('manualProductionSummary');
        if (summary) summary.textContent = batches > 0 ? `Resep v${revision} · hasil ${qty * batches} ${unit}` : 'Jumlah batch minimal 1.';
      };
      el('manualProductionProduct')?.addEventListener('change', renderSummary);
      el('manualProductionBatches')?.addEventListener('input', renderSummary);
      renderSummary();
    } catch (error) {
      toast(error.message);
    }
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

  el('stockAdjustmentBtn')?.addEventListener('click', stockAdjustmentDialog);
  el('productionBtn')?.addEventListener('click', productionDialog);
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
