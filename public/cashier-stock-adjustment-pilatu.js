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
            .stock-adjustment-search-wrap{position:relative}
            .stock-adjustment-search-results{display:none;position:absolute;z-index:30;left:0;right:0;top:calc(100% + 4px);max-height:230px;overflow:auto;border:1px solid #d8dde6;border-radius:12px;background:#fff;box-shadow:0 14px 34px rgba(15,23,42,.16);padding:6px}
            .stock-adjustment-search-results.is-open{display:block}
            .stock-adjustment-search-result{display:flex;width:100%;min-height:44px;align-items:center;justify-content:space-between;gap:12px;border:0;border-radius:9px;background:transparent;padding:9px 10px;text-align:left;cursor:pointer}
            .stock-adjustment-search-result:hover,.stock-adjustment-search-result:focus{background:#f3f5f8;outline:none}
            .stock-adjustment-search-result span,.stock-adjustment-search-result small{display:block}
            .stock-adjustment-search-result small{color:#6b7280;margin-top:2px}
            .stock-adjustment-table{border:1px solid #e1e5eb;border-radius:12px;overflow:hidden;margin-top:10px}
            .stock-adjustment-grid{display:grid;grid-template-columns:minmax(160px,2.4fr) minmax(70px,.7fr) minmax(80px,.8fr);gap:8px;align-items:center}
            .stock-adjustment-head{background:#111827;color:#fff;padding:9px 10px;font-size:11px;font-weight:800}
            .stock-adjustment-row{padding:9px 10px;border-top:1px solid #edf0f4;background:#fff}
            .stock-adjustment-item{position:relative;min-width:0;padding-right:30px}
            .stock-adjustment-item strong,.stock-adjustment-item small,.stock-adjustment-readonly strong,.stock-adjustment-readonly small{display:block}
            .stock-adjustment-item strong{white-space:normal;overflow-wrap:anywhere}
            .stock-adjustment-item small,.stock-adjustment-readonly small{color:#6b7280;margin-top:2px;font-size:10px}
            .stock-adjustment-readonly{text-align:right;min-width:0}
            .stock-adjustment-actual{margin:0;min-width:0}
            .stock-adjustment-actual span{display:none}
            .stock-adjustment-actual input{width:100%;min-width:0;margin:0;text-align:right;font-weight:800}
            .stock-adjustment-remove{position:absolute;right:0;top:50%;transform:translateY(-50%);width:26px;height:26px;border:0;border-radius:50%;background:#f3f4f6;color:#6b7280;cursor:pointer}
            .stock-adjustment-remove:hover{background:#fee2e2;color:#b91c1c}
            .stock-adjustment-empty{padding:18px 12px;text-align:center;color:#6b7280}
            .stock-adjustment-source-note{background:#f6f7f9;border-radius:10px;padding:9px 10px;font-size:11px;color:#4b5563;line-height:1.45;margin-top:10px}
            @media(max-width:680px){
              .stock-adjustment-head{font-size:10px;padding:7px 8px}
              .stock-adjustment-grid{grid-template-columns:minmax(0,1fr) 34px 50px;gap:4px}
              .stock-adjustment-item{padding-right:24px}
              .stock-adjustment-remove{width:22px;height:22px}
              .stock-adjustment-row{padding:10px}
              .stock-adjustment-readonly small{font-size:9px}
            }
          </style>
          <div class="pimasatu-detail-head"><strong>Pilih Barang</strong><span class="muted">cari &amp; pilih dari daftar</span></div>
          <div class="pimasatu-panel-body">
            <div class="field"><label>Form Stock Opname <span class="muted">optional</span></label><select id="stockAdjustmentTemplate" class="text-input" disabled><option>Belum ada form stock opname</option></select><div class="muted" style="margin-top:4px;font-size:11px">Dibuat admin nanti -- kalau dipilih, komponen di bawah otomatis terisi dari daftar barang form itu.</div></div>
            <div class="field stock-adjustment-search-wrap">
              <label>Cari barang</label>
              <input id="stockAdjustmentSearch" class="text-input" type="search" autocomplete="off" placeholder="Cari nama barang..." />
              <div id="stockAdjustmentSearchResults" class="stock-adjustment-search-results" role="listbox"></div>
            </div>
          </div>

          <div class="pimasatu-detail-head"><strong>Detail Penyesuaian Stok</strong><span id="stockAdjustmentCount" class="muted"></span></div>
          <div class="pimasatu-panel-body">
            <div class="stock-adjustment-table">
              <div class="stock-adjustment-grid stock-adjustment-head">
                <span>Barang</span><span>Noted</span><span>Real</span>
              </div>
              <div id="stockAdjustmentRows"></div>
            </div>
            <div class="stock-adjustment-source-note"><b>Stok Tercatat</b> read-only dari pembacaan stok saat panel dibuka. Server mengambil snapshot resmi lagi saat pengajuan. Selisih baru ditampilkan nanti di data Stock Opname.</div>
            <div class="field"><label>Catatan <span class="muted">optional</span></label><textarea id="stockAdjustmentNote" rows="2" maxlength="500" placeholder="Contoh: hasil hitung fisik"></textarea></div>
          </div>

          <p class="muted">Semua barang yang punya selisih diajukan sekaligus sebagai satu pengajuan -- ACC/Reject Admin berlaku untuk semuanya bersamaan. Stale-snapshot guard tetap re-check tiap barang; kalau ada satu yang stoknya berubah, seluruh pengajuan ini ditolak otomatis supaya diajukan ulang dari saldo terbaru.</p>`,
        submitText: 'AJUKAN PENYESUAIAN',
        onSubmit: async () => {
          const prepared = pilatu.prepareStockAdjustmentRows(selectedRows);
          const changed = prepared.filter(row => row.difference !== 0);
          if (!changed.length) throw new Error('Tidak ada selisih stok yang perlu diajukan.');

          const note = el('stockAdjustmentNote').value.trim();
          await api('/api/cashier/approval-requests/stock-adjustment-batch', {
            method: 'POST',
            body: JSON.stringify({
              items: changed.map(row => ({
                productId: row.productId,
                targetQuantity: row.targetQuantity,
                note
              }))
            })
          });

          const skipped = prepared.length - changed.length;
          toast(`${changed.length} Penyesuaian Stok masuk Approval Queue sebagai satu pengajuan${skipped ? ` · ${skipped} tanpa selisih dilewati` : ''}.`);
          return true;
        }
      });

      const searchInput = el('stockAdjustmentSearch');
      const searchResults = el('stockAdjustmentSearchResults');
      const rowsNode = el('stockAdjustmentRows');
      const countNode = el('stockAdjustmentCount');
      const formatQty = value => Number(value).toLocaleString('id-ID');

      function renderRows() {
        if (!rowsNode) return;
        if (countNode) countNode.textContent = `${selectedRows.length} barang`;
        if (!selectedRows.length) {
          rowsNode.innerHTML = '<div class="stock-adjustment-empty">Belum ada barang. Search lalu klik barang; pilihan berikutnya akan masuk di atas tanpa menghapus row sebelumnya.</div>';
          return;
        }
        rowsNode.innerHTML = selectedRows.map(row => `
            <div class="stock-adjustment-grid stock-adjustment-row" data-stock-adjustment-row="${Number(row.productId)}">
              <div class="stock-adjustment-item">
                <strong>${escapeHtml(row.productName)}</strong>
                <small>${escapeHtml(row.unitSymbol || '')}</small>
                <button class="stock-adjustment-remove" type="button" data-stock-adjustment-remove="${Number(row.productId)}" aria-label="Hapus ${escapeHtml(row.productName)}">×</button>
              </div>
              <div class="stock-adjustment-readonly"><strong>${formatQty(row.currentQuantity)}</strong></div>
              <label class="stock-adjustment-actual"><span>Stok Real</span><input class="text-input" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(row.actualQuantity)}" data-stock-adjustment-actual="${Number(row.productId)}" aria-label="Stok Real ${escapeHtml(row.productName)}" /></label>
            </div>`).join('');
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
            <span style="text-align:right"><b>${formatQty(product.currentQuantity)}</b><small>Stok tercatat</small></span>
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
