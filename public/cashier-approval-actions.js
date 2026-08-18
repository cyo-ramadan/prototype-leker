(() => {
  const approvalButtonIds = ['stockAdjustmentBtn', 'productionBtn', 'cashFlowBtn', 'goodsFlowBtn', 'assetBtn'];

  function syncApprovalButtons() {
    for (const id of approvalButtonIds) {
      const button = el(id);
      if (button) button.disabled = !state.canWrite;
    }
  }

  async function submitApprovalRequest(requestType, payload, { silent = false } = {}) {
    const result = await api('/api/cashier/approval-requests', {
      method: 'POST',
      body: JSON.stringify({ requestType, payload })
    });
    const label = result.request?.payload?.purpose === 'STOCK_ADJUSTMENT' ? 'Penyesuaian Stok' : result.request.requestType;
    if (!silent) toast(`Pengajuan ${label} masuk · pending approval`);
    return result;
  }

  async function stockAdjustmentDialog() {
    try {
      const [payload, pilatu] = await Promise.all([
        api('/api/cashier/stock-adjustment/options'),
        import('/stock-adjustment-pilatu.js')
      ]);
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

      let selectedRows = [];
      const productById = new Map(products.map(product => [Number(product.productId), product]));

      openDialog({
        eyebrow: 'Laci · Approval Queue',
        title: 'Penyesuaian Stok',
        body: `
          <style>
            .stock-adjustment-search-wrap{position:relative;margin-bottom:12px}
            .stock-adjustment-search-results{display:none;position:absolute;z-index:20;left:0;right:0;top:calc(100% + 4px);max-height:230px;overflow:auto;border:1px solid #d8dde6;border-radius:12px;background:#fff;box-shadow:0 14px 34px rgba(15,23,42,.16);padding:6px}
            .stock-adjustment-search-results.is-open{display:block}
            .stock-adjustment-search-result{display:flex;width:100%;min-height:44px;align-items:center;justify-content:space-between;gap:12px;border:0;border-radius:9px;background:transparent;padding:9px 10px;text-align:left;cursor:pointer}
            .stock-adjustment-search-result:hover,.stock-adjustment-search-result:focus{background:#f3f5f8;outline:none}
            .stock-adjustment-search-result span,.stock-adjustment-search-result small{display:block}
            .stock-adjustment-search-result small{color:#6b7280;margin-top:2px}
            .stock-adjustment-table{border:1px solid #e1e5eb;border-radius:12px;overflow:hidden;margin:12px 0}
            .stock-adjustment-grid{display:grid;grid-template-columns:minmax(135px,1.7fr) minmax(76px,.72fr) minmax(92px,.82fr) minmax(78px,.72fr) minmax(72px,.68fr);gap:8px;align-items:center}
            .stock-adjustment-head{background:#111827;color:#fff;padding:9px 10px;font-size:11px;font-weight:800}
            .stock-adjustment-row{padding:9px 10px;border-top:1px solid #edf0f4;background:#fff}
            .stock-adjustment-item{position:relative;min-width:0;padding-right:28px}
            .stock-adjustment-item strong,.stock-adjustment-item small,.stock-adjustment-readonly strong,.stock-adjustment-readonly small,.stock-adjustment-difference strong,.stock-adjustment-difference small{display:block}
            .stock-adjustment-item strong{white-space:normal;overflow-wrap:anywhere}
            .stock-adjustment-item small,.stock-adjustment-readonly small,.stock-adjustment-difference small{color:#6b7280;margin-top:2px;font-size:10px}
            .stock-adjustment-readonly,.stock-adjustment-difference{text-align:right;min-width:0}
            .stock-adjustment-actual{margin:0;min-width:0}
            .stock-adjustment-actual span{display:none}
            .stock-adjustment-actual input{width:100%;min-width:0;margin:0;text-align:right;font-weight:800}
            .stock-adjustment-remove{position:absolute;right:0;top:50%;transform:translateY(-50%);width:26px;height:26px;border:0;border-radius:50%;background:#f3f4f6;color:#6b7280;cursor:pointer}
            .stock-adjustment-remove:hover{background:#fee2e2;color:#b91c1c}
            .stock-adjustment-empty{padding:18px 12px;text-align:center;color:#6b7280}
            .stock-adjustment-source-note{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0 14px}
            .stock-adjustment-source-note>div{background:#f6f7f9;border-radius:10px;padding:9px 10px;font-size:11px;color:#4b5563;line-height:1.45}
            @media(max-width:680px){
              .stock-adjustment-head{display:none}
              .stock-adjustment-row{grid-template-columns:1fr 1fr;gap:9px;padding:12px 10px}
              .stock-adjustment-item{grid-column:1/-1;min-height:34px}
              .stock-adjustment-readonly,.stock-adjustment-difference{background:#f6f7f9;border-radius:9px;padding:8px;text-align:left}
              .stock-adjustment-actual{position:relative;padding-top:16px}
              .stock-adjustment-actual span{display:block;position:absolute;top:0;left:0;font-size:10px;color:#6b7280;font-weight:700}
              .stock-adjustment-source-note{grid-template-columns:1fr}
            }
          </style>
          <div class="field stock-adjustment-search-wrap">
            <label>Cari barang</label>
            <input id="stockAdjustmentSearch" class="text-input" type="search" autocomplete="off" placeholder="Cari nama barang..." />
            <div id="stockAdjustmentSearchResults" class="stock-adjustment-search-results" role="listbox"></div>
          </div>
          <div class="stock-adjustment-table">
            <div class="stock-adjustment-grid stock-adjustment-head">
              <span>Barang</span><span>Qty Tercatat</span><span>Qty Sebenarnya</span><span>HPP</span><span>Selisih</span>
            </div>
            <div id="stockAdjustmentRows"></div>
          </div>
          <div class="stock-adjustment-source-note">
            <div><b>Qty Tercatat</b><br />Read-only dari snapshot stok Warehouse saat panel dibuka.</div>
            <div><b>HPP</b><br />Read-only milik Accounting. Sampai read binding Accounting tersedia, panel tidak mengarang angka HPP.</div>
          </div>
          <div class="field"><label>Alasan penyesuaian</label><input id="stockAdjustmentReason" class="text-input" maxlength="220" placeholder="Contoh: hasil hitung fisik" required /></div>
          <div class="field"><label>Catatan <span class="muted">optional</span></label><textarea id="stockAdjustmentNote" rows="2" maxlength="500"></textarea></div>
          <p class="muted">Setiap barang yang punya selisih dibuat sebagai pengajuan Penyesuaian Stok terpisah di Approval Queue. Saat Admin/Owner ACC, server tetap melakukan stale-snapshot guard per barang.</p>`,
        submitText: 'AJUKAN PENYESUAIAN',
        onSubmit: async () => {
          const reason = el('stockAdjustmentReason').value.trim();
          if (!reason) throw new Error('Alasan Penyesuaian Stok wajib diisi.');

          const prepared = pilatu.prepareStockAdjustmentRows(selectedRows);
          const changed = prepared.filter(row => row.difference !== 0);
          if (!changed.length) throw new Error('Tidak ada selisih stok yang perlu diajukan.');

          const note = el('stockAdjustmentNote').value.trim();
          const submittedProductIds = [];
          try {
            for (const row of changed) {
              await submitApprovalRequest('GOODS_FLOW', {
                purpose: 'STOCK_ADJUSTMENT',
                productId: row.productId,
                targetQuantity: row.targetQuantity,
                reason,
                note
              }, { silent: true });
              submittedProductIds.push(row.productId);
            }
          } catch (error) {
            selectedRows = selectedRows.filter(row => !submittedProductIds.includes(Number(row.productId)));
            renderRows();
            throw new Error(`${submittedProductIds.length} barang sudah berhasil diajukan. Sisanya belum diajukan: ${error.message}`);
          }

          const skipped = prepared.length - changed.length;
          toast(`${changed.length} Penyesuaian Stok masuk Approval Queue${skipped ? ` · ${skipped} tanpa selisih dilewati` : ''}.`);
          return true;
        }
      });

      const searchInput = el('stockAdjustmentSearch');
      const searchResults = el('stockAdjustmentSearchResults');
      const rowsNode = el('stockAdjustmentRows');

      const formatQty = value => Number(value).toLocaleString('id-ID');
      const formatDifference = difference => `${difference > 0 ? '+' : ''}${formatQty(difference)}`;

      const renderRows = () => {
        if (!rowsNode) return;
        if (!selectedRows.length) {
          rowsNode.innerHTML = '<div class="stock-adjustment-empty">Belum ada barang. Search lalu klik barang; setiap pilihan baru akan turun menjadi row dan row sebelumnya tetap ada.</div>';
          return;
        }
        rowsNode.innerHTML = selectedRows.map(row => {
          const difference = pilatu.stockAdjustmentDifference(row);
          const differenceLabel = difference === null ? 'Isi fisik' : difference > 0 ? 'PLUS / IN' : difference < 0 ? 'MINUS / OUT' : 'SAMA';
          return `
            <div class="stock-adjustment-grid stock-adjustment-row" data-stock-adjustment-row="${Number(row.productId)}">
              <div class="stock-adjustment-item">
                <strong>${escapeHtml(row.productName)}</strong>
                <small>${escapeHtml(row.unitSymbol || '')}</small>
                <button class="stock-adjustment-remove" type="button" data-stock-adjustment-remove="${Number(row.productId)}" aria-label="Hapus ${escapeHtml(row.productName)}">×</button>
              </div>
              <div class="stock-adjustment-readonly"><strong>${formatQty(row.currentQuantity)}</strong><small>Warehouse</small></div>
              <label class="stock-adjustment-actual"><span>Qty Sebenarnya</span><input class="text-input" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(row.actualQuantity)}" data-stock-adjustment-actual="${Number(row.productId)}" aria-label="Qty Sebenarnya ${escapeHtml(row.productName)}" /></label>
              <div class="stock-adjustment-readonly"><strong>${escapeHtml(row.accountingHppDisplay || '—')}</strong><small>Accounting</small></div>
              <div class="stock-adjustment-difference"><strong>${difference === null ? '—' : formatDifference(difference)}</strong><small>${differenceLabel}</small></div>
            </div>`;
        }).join('');
      };

      const renderSearchResults = () => {
        if (!searchInput || !searchResults) return;
        const query = searchInput.value.trim().toLowerCase();
        if (!query) {
          searchResults.classList.remove('is-open');
          searchResults.innerHTML = '';
          return;
        }
        const matches = products.filter(product => `${product.productName} ${product.productId} ${product.unitSymbol || ''}`.toLowerCase().includes(query)).slice(0, 20);
        searchResults.innerHTML = matches.length ? matches.map(product => `
          <button class="stock-adjustment-search-result" type="button" role="option" data-stock-adjustment-result="${Number(product.productId)}">
            <span><b>${escapeHtml(product.productName)}</b><small>#${Number(product.productId)} · ${escapeHtml(product.unitSymbol || '')}</small></span>
            <span style="text-align:right"><b>${formatQty(product.currentQuantity)}</b><small>Qty tercatat</small></span>
          </button>`).join('') : '<div class="stock-adjustment-empty">Barang tidak ditemukan.</div>';
        searchResults.classList.add('is-open');
      };

      searchInput?.addEventListener('input', renderSearchResults);
      searchInput?.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        const first = searchResults?.querySelector('[data-stock-adjustment-result]');
        if (!first) return;
        event.preventDefault();
        first.click();
      });

      searchResults?.addEventListener('click', event => {
        const button = event.target.closest('[data-stock-adjustment-result]');
        if (!button) return;
        const product = productById.get(Number(button.dataset.stockAdjustmentResult));
        if (!product) return;
        selectedRows = pilatu.selectStockAdjustmentProduct(selectedRows, product);
        searchInput.value = '';
        searchResults.classList.remove('is-open');
        searchResults.innerHTML = '';
        renderRows();
        requestAnimationFrame(() => rowsNode?.querySelector(`[data-stock-adjustment-actual="${Number(product.productId)}"]`)?.focus());
      });

      rowsNode?.addEventListener('input', event => {
        const input = event.target.closest('[data-stock-adjustment-actual]');
        if (!input) return;
        selectedRows = pilatu.updateStockAdjustmentActualQuantity(selectedRows, Number(input.dataset.stockAdjustmentActual), input.value);
        renderRows();
        requestAnimationFrame(() => rowsNode?.querySelector(`[data-stock-adjustment-actual="${Number(input.dataset.stockAdjustmentActual)}"]`)?.focus());
      });

      rowsNode?.addEventListener('click', event => {
        const button = event.target.closest('[data-stock-adjustment-remove]');
        if (!button) return;
        selectedRows = pilatu.removeStockAdjustmentRow(selectedRows, Number(button.dataset.stockAdjustmentRemove));
        renderRows();
      });

      renderRows();
      searchInput?.focus();
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
    const counterparts = state.cashFlowCounterparts || [];
    const optionMarkup = direction => counterparts.filter(option => option.direction === direction).map(option =>
      `<option value="${escapeHtml(option.journalRuleId)}"${option.isDefault ? ' data-default="1"' : ''}>${escapeHtml(option.accountCode)} — ${escapeHtml(option.accountName)}${option.isDefault ? ' · Default' : ''}</option>`
    ).join('');
    openDialog({
      eyebrow: 'Laci · Approval Queue',
      title: 'Arus Kas',
      body: `
        <div class="field"><label>Arah arus</label><select id="approvalCashDirection" class="text-input"><option value="IN">Kas Masuk</option><option value="OUT">Kas Keluar</option></select></div>
        <div class="field"><label>Akun lawan</label><select id="approvalCashCounterpart" class="text-input" required></select></div>
        <div class="field"><label>Nominal</label><input id="approvalCashAmount" class="text-input" type="number" min="1" step="1" required /></div>
        <div class="field"><label>Deskripsi</label><input id="approvalCashDescription" class="text-input" maxlength="220" required /></div>
        <div class="field"><label>Catatan</label><textarea id="approvalCashNote" rows="2" maxlength="500"></textarea></div>
        <p id="approvalCashCounterpartHelp" class="muted">Pilihan dan default berasal dari Setting Akuntansi. Entry tetap unposted sampai ACC Admin/Owner.</p>`,
      submitText: 'AJUKAN ARUS KAS',
      onSubmit: async () => {
        const amount = Number(el('approvalCashAmount').value);
        if (!Number.isInteger(amount) || amount <= 0) throw new Error('Nominal arus kas wajib bilangan bulat lebih dari 0.');
        const accountingCounterpartRuleId = el('approvalCashCounterpart').value;
        if (!accountingCounterpartRuleId) throw new Error('Setting Akuntansi belum memiliki akun lawan aktif untuk arah Arus Kas ini.');
        await submitApprovalRequest('CASH_FLOW', {
          direction: el('approvalCashDirection').value,
          accountingCounterpartRuleId,
          amount,
          description: el('approvalCashDescription').value.trim(),
          note: el('approvalCashNote').value.trim()
        });
        return true;
      }
    });
    const direction = el('approvalCashDirection');
    const counterpart = el('approvalCashCounterpart');
    const syncCounterparts = () => {
      const options = optionMarkup(direction.value);
      counterpart.innerHTML = options || '<option value="">Belum diatur di Setting Akuntansi</option>';
      const defaultOption = counterpart.querySelector('[data-default="1"]');
      if (defaultOption) counterpart.value = defaultOption.value;
      counterpart.disabled = !options;
    };
    direction?.addEventListener('change', syncCounterparts);
    syncCounterparts();
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
