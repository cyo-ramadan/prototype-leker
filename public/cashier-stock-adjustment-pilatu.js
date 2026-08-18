(() => {
  async function openStockAdjustmentPilatu() {
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
            .stock-adjustment-search-results{display:none;position:absolute;z-index:30;left:0;right:0;top:calc(100% + 4px);max-height:230px;overflow:auto;border:1px solid #d8dde6;border-radius:12px;background:#fff;box-shadow:0 14px 34px rgba(15,23,42,.16);padding:6px}
            .stock-adjustment-search-results.is-open{display:block}
            .stock-adjustment-search-result{display:flex;width:100%;min-height:44px;align-items:center;justify-content:space-between;gap:12px;border:0;border-radius:9px;background:transparent;padding:9px 10px;text-align:left;cursor:pointer}
            .stock-adjustment-search-result:hover,.stock-adjustment-search-result:focus{background:#f3f5f8;outline:none}
            .stock-adjustment-search-result span,.stock-adjustment-search-result small{display:block}
            .stock-adjustment-search-result small{color:#6b7280;margin-top:2px}
            .stock-adjustment-table{border:1px solid #e1e5eb;border-radius:12px;overflow:hidden;margin:12px 0}
            .stock-adjustment-grid{display:grid;grid-template-columns:minmax(135px,1.7fr) minmax(76px,.72fr) minmax(92px,.82fr) minmax(78px,.72fr) minmax(72px,.68fr);gap:8px;align-items:center}
            .stock-adjustment-head{background:#111827;color:#fff;padding:9px 10px;font-size:11px;font-weight:800}
            .stock-adjustment-row{padding:9px 10px;border-top:1px solid #edf0f4;background:#fff}
            .stock-adjustment-item{position:relative;min-width:0;padding-right:30px}
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
            <div><b>Qty Tercatat</b><br />Read-only dari pembacaan stok saat panel dibuka. Server mengambil snapshot resmi lagi saat pengajuan.</div>
            <div><b>HPP</b><br />Read-only milik Accounting. Selama read binding resminya belum tersedia, panel menampilkan — dan tidak mengarang nilai.</div>
          </div>
          <div class="field"><label>Alasan penyesuaian</label><input id="stockAdjustmentReason" class="text-input" maxlength="220" placeholder="Contoh: hasil hitung fisik" required /></div>
          <div class="field"><label>Catatan <span class="muted">optional</span></label><textarea id="stockAdjustmentNote" rows="2" maxlength="500"></textarea></div>
          <p class="muted">Setiap barang yang punya selisih menjadi pengajuan Penyesuaian Stok sendiri. Saat ACC, stale-snapshot guard tetap berjalan per barang.</p>`,
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
              await api('/api/cashier/approval-requests', {
                method: 'POST',
                body: JSON.stringify({
                  requestType: 'GOODS_FLOW',
                  payload: {
                    purpose: 'STOCK_ADJUSTMENT',
                    productId: row.productId,
                    targetQuantity: row.targetQuantity,
                    reason,
                    note
                  }
                })
              });
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

      function differenceView(row) {
        const difference = pilatu.stockAdjustmentDifference(row);
        if (difference === null) return { value: '—', label: 'Isi fisik' };
        return {
          value: `${difference > 0 ? '+' : ''}${formatQty(difference)}`,
          label: difference > 0 ? 'PLUS / IN' : difference < 0 ? 'MINUS / OUT' : 'SAMA'
        };
      }

      function renderRows() {
        if (!rowsNode) return;
        if (!selectedRows.length) {
          rowsNode.innerHTML = '<div class="stock-adjustment-empty">Belum ada barang. Search lalu klik barang; pilihan berikutnya akan masuk di atas tanpa menghapus row sebelumnya.</div>';
          return;
        }
        rowsNode.innerHTML = selectedRows.map(row => {
          const difference = differenceView(row);
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
              <div class="stock-adjustment-difference" data-stock-adjustment-difference="${Number(row.productId)}"><strong>${difference.value}</strong><small>${difference.label}</small></div>
            </div>`;
        }).join('');
      }

      function renderSearchResults() {
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
      }

      searchInput?.addEventListener('input', renderSearchResults);
      searchInput?.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        const first = searchResults?.querySelector('[data-stock-adjustment-result]');
        if (!first) return;
        event.preventDefault();
        first.click();
      });

      searchResults?.addEventListener('click', event => {
        const source = event.target instanceof Element ? event.target.closest('[data-stock-adjustment-result]') : null;
        if (!source) return;
        const product = productById.get(Number(source.dataset.stockAdjustmentResult));
        if (!product) return;
        selectedRows = pilatu.selectStockAdjustmentProduct(selectedRows, product);
        searchInput.value = '';
        searchResults.classList.remove('is-open');
        searchResults.innerHTML = '';
        renderRows();
        requestAnimationFrame(() => rowsNode?.querySelector(`[data-stock-adjustment-actual="${Number(product.productId)}"]`)?.focus());
      });

      rowsNode?.addEventListener('input', event => {
        const input = event.target instanceof Element ? event.target.closest('[data-stock-adjustment-actual]') : null;
        if (!input) return;
        const productId = Number(input.dataset.stockAdjustmentActual);
        selectedRows = pilatu.updateStockAdjustmentActualQuantity(selectedRows, productId, input.value);
        const row = selectedRows.find(candidate => Number(candidate.productId) === productId);
        const differenceNode = rowsNode.querySelector(`[data-stock-adjustment-difference="${productId}"]`);
        if (!row || !differenceNode) return;
        const difference = differenceView(row);
        differenceNode.querySelector('strong').textContent = difference.value;
        differenceNode.querySelector('small').textContent = difference.label;
      });

      rowsNode?.addEventListener('click', event => {
        const source = event.target instanceof Element ? event.target.closest('[data-stock-adjustment-remove]') : null;
        if (!source) return;
        selectedRows = pilatu.removeStockAdjustmentRow(selectedRows, Number(source.dataset.stockAdjustmentRemove));
        renderRows();
      });

      renderRows();
      searchInput?.focus();
    } catch (error) {
      toast(error.message);
    }
  }

  document.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('#stockAdjustmentBtn') : null;
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openStockAdjustmentPilatu();
  }, true);
})();
