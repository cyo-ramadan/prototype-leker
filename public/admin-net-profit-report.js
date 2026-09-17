(() => {
  // Laporan Untung Rugi di panel Admin Gerai (Bos Cyo, 2026-09-17). Versi
  // Entity (entity-admin.js) menampilkan satu angka per gerai per hari untuk
  // perbandingan antar gerai; yang di sini sebaliknya -- cuma SATU gerai, tapi
  // dirinci supaya Admin tahu KENAPA untung/ruginya segitu. Bos Cyo:
  // "aku pingin bikin pos untuk user yang ga paham akunting minimal bisa
  // keluar rugi labanya", jadi istilah di layar sengaja bahasa warung
  // ("modal barang yang terjual"), bukan istilah akuntansi.
  //
  // Backend: src/net-profit-report.js. Gerainya dikunci ke gerai yang sedang
  // dibuka (window.LEKER_STORE_CODE) -- dikirim eksplisit, bukan dibiarkan
  // default, supaya Owner yang membuka panel gerai pun melihat gerai itu saja,
  // bukan gabungan seluruh entity.
  let snapshot = null;

  const money = value => rupiah(value);
  const signed = value => `${value < 0 ? '−' : ''}${rupiah(Math.abs(value))}`;
  const tone = value => (value < 0 ? 'color:var(--danger,#c0392b)' : '');

  function mount() {
    const tabs = document.querySelector('.admin-tabs');
    const shell = document.getElementById('adminApp');
    if (!tabs || !shell || document.getElementById('tab-labarugi')) return;

    const button = document.createElement('button');
    button.className = 'admin-tab';
    button.dataset.tab = 'labarugi';
    button.type = 'button';
    button.textContent = '📈 Laporan Untung Rugi';
    button.addEventListener('click', () => { switchTab('labarugi'); prefillDates(); });
    tabs.appendChild(button);

    shell.insertAdjacentHTML('beforeend', `
      <section id="tab-labarugi" class="admin-section">
        <div class="admin-card">
          <div class="list-head"><div><h2>Laporan Untung Rugi</h2><div class="muted">Dihitung langsung dari transaksi gerai ini — tidak perlu Accounting aktif. Hari yang sudah lewat disimpan otomatis supaya dibuka lagi jadi instan; hari ini selalu dihitung ulang.</div></div></div>
          <div class="admin-grid two compact">
            <label class="admin-field">Dari tanggal<input id="labaRugiFrom" type="date" required /></label>
            <label class="admin-field">Sampai tanggal<input id="labaRugiTo" type="date" required /></label>
          </div>
          <div class="labarugi-quick" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
            <button class="text-btn" type="button" data-laba-range="today">Hari ini</button>
            <button class="text-btn" type="button" data-laba-range="week">7 hari terakhir</button>
            <button class="text-btn" type="button" data-laba-range="month">Bulan ini</button>
          </div>
          <button id="labaRugiRun" class="primary-btn" type="button">Tampilkan Laporan</button>
          <div id="labaRugiStatus" class="muted" style="margin-top:10px"></div>
        </div>
        <div id="labaRugiSummary" class="admin-card" style="margin-top:16px;display:none"></div>
        <div id="labaRugiDaily" class="admin-card" style="margin-top:16px;display:none"></div>
      </section>`);

    el('labaRugiRun').addEventListener('click', () => { run().catch(error => setStatus(error.message)); });
    document.querySelectorAll('[data-laba-range]').forEach(item => {
      item.onclick = () => { applyQuickRange(item.dataset.labaRange); run().catch(error => setStatus(error.message)); };
    });
  }

  function setStatus(message) {
    const status = el('labaRugiStatus');
    if (status) status.textContent = message;
  }

  // Tanggal bisnis Asia/Jakarta, sama seperti yang dipakai server -- jam
  // browser Admin bisa saja bukan WIB, dan kalau meleset semalam laporannya
  // ikut meleset satu hari tanpa ada yang memberi tahu.
  function jakartaToday() {
    return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  function shiftDays(isoDate, days) {
    const date = new Date(`${isoDate}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function prefillDates() {
    const today = jakartaToday();
    if (!el('labaRugiFrom').value) el('labaRugiFrom').value = shiftDays(today, -6);
    if (!el('labaRugiTo').value) el('labaRugiTo').value = today;
  }

  function applyQuickRange(kind) {
    const today = jakartaToday();
    if (kind === 'today') { el('labaRugiFrom').value = today; el('labaRugiTo').value = today; return; }
    if (kind === 'week') { el('labaRugiFrom').value = shiftDays(today, -6); el('labaRugiTo').value = today; return; }
    el('labaRugiFrom').value = `${today.slice(0, 7)}-01`;
    el('labaRugiTo').value = today;
  }

  function renderSummary() {
    const totals = snapshot.breakdownTotals;
    const grossProfit = totals.otherIncome + totals.revenue - totals.hpp;
    const box = el('labaRugiSummary');
    box.style.display = '';
    box.innerHTML = `
      <div class="list-head"><div><h2>Ringkasan ${escapeHtml(snapshot.from)} s/d ${escapeHtml(snapshot.to)}</h2><div class="muted">${escapeHtml(snapshot.stores.map(store => store.storeName).join(', '))}</div></div></div>
      <div style="font-size:26px;font-weight:800;margin:6px 0 2px;${tone(totals.netProfit)}">${signed(totals.netProfit)}</div>
      <div class="muted" style="margin-bottom:14px">${totals.netProfit < 0 ? 'Rugi bersih periode ini' : 'Untung bersih periode ini'}</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tbody>
          ${summaryRow('Penjualan', totals.revenue)}
          ${summaryRow('Pendapatan lain', totals.otherIncome)}
          ${summaryRow('Modal barang yang terjual', -totals.hpp)}
          ${summaryRow('Untung kotor', grossProfit, true)}
          ${summaryRow('Biaya & bea yang dikeluarkan', -totals.expense)}
          ${summaryRow(totals.stockAdjustmentNet < 0 ? 'Stok hilang/susut' : 'Stok lebih saat dicocokkan', totals.stockAdjustmentNet)}
          ${summaryRow(totals.netProfit < 0 ? 'Rugi bersih' : 'Untung bersih', totals.netProfit, true)}
        </tbody>
      </table>
      <div class="muted" style="margin-top:12px">Pembelian bahan dan pembelian aset tidak ikut dipotong di sini — uangnya berubah jadi barang/aset, bukan hilang. Bahan baru terhitung saat barangnya terjual, lewat baris "Modal barang yang terjual".</div>`;
  }

  function summaryRow(label, value, strong = false) {
    const weight = strong ? 'font-weight:800;border-top:1px solid var(--line)' : '';
    return `<tr style="${weight}">
      <td style="padding:6px 0">${escapeHtml(label)}</td>
      <td style="padding:6px 0;text-align:right;${tone(value)}">${signed(value)}</td>
    </tr>`;
  }

  function renderDaily() {
    const box = el('labaRugiDaily');
    box.style.display = '';
    const header = `<tr style="text-align:right;font-size:12px;color:var(--muted,#666)">
      <th style="text-align:left;padding:6px 8px">Tanggal</th>
      <th style="padding:6px 8px">Penjualan</th>
      <th style="padding:6px 8px">Modal</th>
      <th style="padding:6px 8px">Biaya & bea</th>
      <th style="padding:6px 8px">Untung</th>
    </tr>`;
    const body = snapshot.rows.map(row => `<tr style="text-align:right">
      <td style="text-align:left;padding:6px 8px">${escapeHtml(row.businessDate)}</td>
      <td style="padding:6px 8px">${money(row.breakdown.revenue + row.breakdown.otherIncome)}</td>
      <td style="padding:6px 8px">${money(row.breakdown.hpp)}</td>
      <td style="padding:6px 8px">${money(row.breakdown.expense)}</td>
      <td style="padding:6px 8px;font-weight:700;${tone(row.breakdown.netProfit)}">${signed(row.breakdown.netProfit)}</td>
    </tr>`).join('');
    box.innerHTML = `
      <div class="list-head"><div><h2>Rincian per hari</h2><div class="muted">Kolom Penjualan sudah termasuk pendapatan lain.</div></div><span class="master-count">${snapshot.rows.length}</span></div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px">${header}${body}</table></div>`;
  }

  async function run() {
    prefillDates();
    const from = el('labaRugiFrom').value;
    const to = el('labaRugiTo').value;
    if (!from || !to) { setStatus('Isi dari/sampai tanggal dulu.'); return; }
    if (from > to) { setStatus('Tanggal "dari" tidak boleh lewat dari tanggal "sampai".'); return; }

    setStatus('Menghitung… periode yang baru pertama kali dibuka bisa agak lama, sesudahnya instan.');
    const storeCode = window.LEKER_STORE_CODE || '';
    const payload = await api(`/api/admin/reports/net-profit?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&stores=${encodeURIComponent(storeCode)}`);
    if (!payload.breakdownTotals) { setStatus('Laporan gerai ini belum bisa ditampilkan.'); return; }
    snapshot = payload;
    renderSummary();
    renderDaily();
    setStatus('');
  }

  mount();
})();
