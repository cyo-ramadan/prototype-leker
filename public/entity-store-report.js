// Laporan per gerai di Admin Entity (Bos Cyo, 2026-10-02): "ketika di klik
// gerai beji maka dari baris keluar tanggal, kolomnya adalah omset, hpp, so+,
// so-, grosprofit, beban, net profit. bebannya pisah juga: beban lapak, gaji,
// lainnya." Memakai endpoint Laporan Untung Rugi yang sama (satu gerai = ada
// rincian per hari); untuk gerai Akuntansi angkanya dari pembukuan dan
// transaksi yang tertunda ikut disinkronkan otomatis saat dibuka.
// Refresh manual -- tanpa polling (invariant #6).
(() => {
  const el = id => document.getElementById(id);
  const STORAGE_KEY = 'entityStoreReportStore';
  const state = { store: '', mounted: false };
  const read = () => { try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; } };
  const write = value => { try { localStorage.setItem(STORAGE_KEY, value); } catch { /* abaikan */ } };
  const stores = () => entityAdminState.stores || [];
  const money = value => {
    const n = Math.round(Number(value) || 0);
    return `${n < 0 ? '−' : ''}${new Intl.NumberFormat('id-ID').format(Math.abs(n))}`;
  };
  const setStatus = message => { const node = el('entityStoreReportStatus'); if (node) node.textContent = message || ''; };

  // Beban dipecah: Lapak, Gaji, Lainnya. Gerai Akuntansi: dari akun beban;
  // gerai non-Akuntansi: dari kategori Bea.
  function splitBeban(b) {
    if (Array.isArray(b.bebanAccounts) && (b.source === 'ACCOUNTING' || b.bebanAccounts.length)) {
      let lapak = 0; let gaji = 0; let lainnya = 0;
      for (const account of b.bebanAccounts) {
        const label = `${account.code} ${account.name}`.toLowerCase();
        if (/lapak/.test(label)) lapak += account.amount;
        else if (/gaji/.test(label)) gaji += account.amount;
        else lainnya += account.amount;
      }
      return { lapak, gaji, lainnya };
    }
    const lapak = Number(b.beaLapak || 0);
    const gaji = Number(b.beaGaji || 0);
    return { lapak, gaji, lainnya: Number(b.totalBeban || 0) - lapak - gaji };
  }

  function rowValues(b) {
    const beban = splitBeban(b);
    const omset = Number(b.revenue || 0) + Number(b.otherIncome || 0);
    const hpp = Number(b.hpp || 0);
    return {
      omset, hpp,
      soPlus: Number(b.stockAdjustmentGain || 0),
      soMinus: Number(b.stockAdjustmentLoss || 0),
      gross: omset - hpp,
      lapak: beban.lapak, gaji: beban.gaji, lainnya: beban.lainnya,
      net: Number(b.netProfit || 0)
    };
  }

  const COLUMNS = [
    ['omset', 'Omset'], ['hpp', 'HPP'], ['soPlus', 'SO+'], ['soMinus', 'SO−'], ['gross', 'Gross Profit'],
    ['lapak', 'Beban Lapak'], ['gaji', 'Gaji'], ['lainnya', 'Beban Lainnya'], ['net', 'Net Profit']
  ];

  function renderStoreButtons() {
    const box = el('entityStoreReportStores');
    if (!box) return;
    box.innerHTML = stores().map(store => `<button type="button" class="srp-store" data-store-report="${entityAdminEscape(store.code)}" aria-pressed="${store.code === state.store}" title="${entityAdminEscape(store.storeName || '')}">${entityAdminEscape(store.code)}</button>`).join('');
  }

  function render(payload) {
    const wrap = el('entityStoreReportTable');
    const rows = (payload.rows || []).map(row => ({ date: row.businessDate, v: rowValues(row.breakdown || {}) }));
    if (!rows.length) { wrap.innerHTML = '<div class="empty">Tidak ada data pada rentang ini.</div>'; return; }
    const total = Object.fromEntries(COLUMNS.map(([key]) => [key, rows.reduce((sum, row) => sum + row.v[key], 0)]));
    const cell = (key, value) => `<td class="${key === 'net' ? (value < 0 ? 'srp-neg' : 'srp-pos') : ''}${key === 'net' || key === 'gross' ? ' srp-strong' : ''}">${money(value)}</td>`;
    const body = rows.map(row => `<tr><td>${entityAdminEscape(row.date)}</td>${COLUMNS.map(([key]) => cell(key, row.v[key])).join('')}</tr>`).join('');
    const unposted = payload.unposted?.[state.store];
    wrap.innerHTML = `${unposted?.count ? `<div class="admin-tip" style="margin-bottom:8px">${unposted.count} transaksi ${entityAdminEscape(state.store)} belum masuk pembukuan, jadi angkanya bisa kurang.</div>` : ''}
      <div class="srp-wrap"><table class="srp-table">
        <thead><tr><th>Tanggal</th>${COLUMNS.map(([, label]) => `<th>${label}</th>`).join('')}</tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><th>Total</th>${COLUMNS.map(([key]) => cell(key, total[key])).join('')}</tr></tfoot>
      </table></div>
      <div class="muted" style="margin-top:8px">Dalam rupiah. Omset termasuk pendapatan lain. Gross Profit = Omset − HPP. Net Profit = Gross Profit + SO+ − SO− − semua beban.${payload.stores?.[0]?.source === 'ACCOUNTING' ? ' Sumber: pembukuan Akuntansi.' : ''}</div>`;
  }

  async function load() {
    if (!state.store) { setStatus('Pilih gerai dulu.'); return; }
    const from = el('entityStoreReportFrom').value;
    const to = el('entityStoreReportTo').value;
    if (!from || !to) { setStatus('Isi tanggal dulu.'); return; }
    setStatus('Memuat laporan…');
    try {
      const params = new URLSearchParams({ store: state.store, stores: state.store, from, to });
      const payload = await entityAdminApi(`/api/admin/reports/net-profit?${params}`);
      setStatus('');
      render(payload);
    } catch (error) { setStatus(error.message); }
  }

  function mount() {
    if (state.mounted) return;
    state.mounted = true;
    const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    if (!el('entityStoreReportFrom').value) el('entityStoreReportFrom').value = `${today.slice(0, 8)}01`;
    if (!el('entityStoreReportTo').value) el('entityStoreReportTo').value = today;
    el('entityStoreReportStores').addEventListener('click', event => {
      const button = event.target.closest('[data-store-report]');
      if (!button) return;
      state.store = button.dataset.storeReport;
      write(state.store);
      renderStoreButtons();
      load();
    });
    el('entityStoreReportRun').addEventListener('click', load);
  }

  // Dipanggil switchEntityTab saat tab dibuka.
  window.loadEntityStoreReport = () => {
    mount();
    const codes = stores().map(store => store.code);
    if (!codes.includes(state.store)) {
      const saved = read();
      state.store = codes.includes(saved) ? saved : '';
    }
    renderStoreButtons();
    if (state.store) return load();
    setStatus('Klik salah satu gerai untuk melihat laporannya.');
    return null;
  };
})();
