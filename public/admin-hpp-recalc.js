(() => {
  // Hitung Ulang HPP (Bos Cyo, 2026-10-02): admin menetapkan harga per satuan
  // yang benar untuk satu bahan sejak tanggal tertentu; sistem menghitung
  // ulang HPP penjualan yang memakai bahan itu. Hanya HPP -- stok, nominal
  // pembelian, dan uang laci tidak berubah. Selalu pratinjau dulu, baru
  // Terapkan. Backend: src/hpp-recalculation.js.
  const el = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  const rupiahText = value => `${value < 0 ? '−' : ''}Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 6 }).format(Math.abs(Number(value) || 0))}`;
  const storeQuery = () => `store=${encodeURIComponent(window.LEKER_STORE_CODE || 'G001')}`;
  let components = [];
  let previewed = null;

  async function call(path, options = {}) {
    const response = await fetch(path, { cache: 'no-store', headers: { 'content-type': 'application/json' }, ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  function mount() {
    const tabs = document.querySelector('.admin-tabs');
    const shell = document.getElementById('adminApp');
    if (!tabs || !shell || el('tab-hpp-recalc')) return;

    const button = document.createElement('button');
    button.className = 'admin-tab';
    button.dataset.tab = 'hpp-recalc';
    button.type = 'button';
    button.textContent = '🧮 Hitung Ulang HPP';
    button.addEventListener('click', () => { switchTab('hpp-recalc'); load().catch(error => setStatus(error.message)); });
    tabs.appendChild(button);

    shell.insertAdjacentHTML('beforeend', `
      <section id="tab-hpp-recalc" class="admin-section">
        <div class="admin-card">
          <div class="list-head"><div><h2>Hitung Ulang HPP</h2><div class="muted">Pakai ini kalau harga bahan tercatat salah sehingga HPP (modal barang terjual) jadi tidak wajar. Isi harga per satuan yang benar; sistem menghitung ulang HPP penjualan yang memakai bahan itu sejak tanggal yang dipilih. <b>Hanya HPP yang berubah</b> — stok, nominal pembelian, dan uang laci tidak disentuh.</div></div></div>
          <div class="admin-grid two compact">
            <label class="admin-field">Bahan<select id="hppRecalcComponent"></select></label>
            <label class="admin-field">Harga benar per satuan (Rp)<input id="hppRecalcUnitCost" inputmode="decimal" placeholder="mis. 1 atau 0,5" /></label>
            <label class="admin-field">Mulai tanggal<input id="hppRecalcFrom" type="date" /></label>
            <label class="admin-field">Alasan<input id="hppRecalcReason" maxlength="300" placeholder="mis. 1 adonan = Rp1, Leker barang titipan" /></label>
          </div>
          <div id="hppRecalcCurrent" class="muted" style="margin:6px 0 10px"></div>
          <button id="hppRecalcPreview" class="secondary-btn" type="button">Pratinjau</button>
          <div id="hppRecalcStatus" class="muted" style="margin-top:10px"></div>
        </div>
        <div id="hppRecalcResult" class="admin-card" style="margin-top:16px;display:none"></div>
        <div id="hppRecalcHistory" class="admin-card" style="margin-top:16px;display:none"></div>
      </section>`);

    el('hppRecalcComponent').addEventListener('change', () => { previewed = null; showCurrent(); el('hppRecalcResult').style.display = 'none'; });
    ['hppRecalcUnitCost', 'hppRecalcFrom'].forEach(id => el(id).addEventListener('input', () => { previewed = null; el('hppRecalcResult').style.display = 'none'; }));
    el('hppRecalcPreview').addEventListener('click', () => preview().catch(error => setStatus(error.message)));
  }

  const setStatus = message => { const node = el('hppRecalcStatus'); if (node) node.textContent = message; };

  function showCurrent() {
    const chosen = components.find(item => String(item.productId) === el('hppRecalcComponent').value);
    el('hppRecalcCurrent').textContent = chosen ? `Harga rata-rata tercatat sekarang: ${rupiahText(chosen.averageCostRupiah)} per ${chosen.unitSymbol || chosen.unitCode || 'satuan'}` : '';
  }

  async function load() {
    const [list, history] = await Promise.all([
      call(`/api/admin/hpp-recalculation/components?${storeQuery()}`),
      call(`/api/admin/hpp-recalculation?${storeQuery()}`)
    ]);
    components = list.components || [];
    const select = el('hppRecalcComponent');
    const chosen = select.value;
    select.innerHTML = components.length
      ? components.map(item => `<option value="${item.productId}">${escapeHtml(item.name)}${item.unitSymbol ? ` (${escapeHtml(item.unitSymbol)})` : ''}</option>`).join('')
      : '<option value="">Belum ada bahan yang dipakai produksi dadakan</option>';
    if (chosen) select.value = chosen;
    if (!el('hppRecalcFrom').value) el('hppRecalcFrom').value = '2026-01-01';
    showCurrent();
    renderHistory(history.history || []);
  }

  function input() {
    return {
      componentProductId: Number(el('hppRecalcComponent').value),
      unitCost: el('hppRecalcUnitCost').value,
      from: el('hppRecalcFrom').value
    };
  }

  async function preview() {
    setStatus('Menghitung pratinjau…');
    const body = input();
    const payload = await call(`/api/admin/hpp-recalculation/preview?${storeQuery()}`, { method: 'POST', body: JSON.stringify(body) });
    previewed = body;
    const s = payload.summary;
    const box = el('hppRecalcResult');
    box.style.display = 'block';
    box.innerHTML = `<div class="list-head"><h2>Pratinjau: ${escapeHtml(payload.component)}</h2></div>
      ${s.lineCount ? `
      <div class="admin-grid two compact" style="margin-bottom:10px">
        <div><div class="muted">HPP tercatat sekarang</div><div style="font-size:20px;font-weight:800">${rupiahText(s.oldHppRupiah)}</div></div>
        <div><div class="muted">HPP setelah dihitung ulang</div><div style="font-size:20px;font-weight:800">${rupiahText(s.newHppRupiah)}</div></div>
      </div>
      <div style="margin-bottom:10px">Selisih HPP: <b>${rupiahText(s.deltaRupiah)}</b> pada ${s.saleCount} penjualan · untung ikut berubah sebesar ${rupiahText(-s.deltaRupiah)}</div>
      ${s.manualProductionSkipped ? `<div class="admin-tip" style="margin-bottom:10px">${s.manualProductionSkipped} produksi stok (bukan dadakan) yang memakai bahan ini tidak ikut dihitung ulang.</div>` : ''}
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr style="text-align:right;color:var(--muted)"><th style="text-align:left;padding:6px">Tanggal</th><th style="padding:6px">Penjualan</th><th style="padding:6px">HPP lama</th><th style="padding:6px">HPP baru</th><th style="padding:6px">Selisih</th></tr>
        ${s.byDate.map(day => `<tr style="text-align:right"><td style="text-align:left;padding:6px">${escapeHtml(day.businessDate)}</td><td style="padding:6px">${day.saleCount}</td><td style="padding:6px">${rupiahText(day.oldHppRupiah)}</td><td style="padding:6px">${rupiahText(day.newHppRupiah)}</td><td style="padding:6px">${rupiahText(day.deltaRupiah)}</td></tr>`).join('')}
      </table></div>
      <button id="hppRecalcApply" class="primary-btn" type="button" style="margin-top:12px">Terapkan hitung ulang</button>`
      : '<div class="empty">Tidak ada penjualan yang HPP-nya berubah dengan harga ini.</div>'}`;
    el('hppRecalcApply')?.addEventListener('click', () => apply().catch(error => setStatus(error.message)));
    setStatus('');
  }

  async function apply() {
    if (!previewed) return setStatus('Pratinjau dulu sebelum menerapkan.');
    const reason = el('hppRecalcReason').value.trim();
    if (reason.length < 5) return setStatus('Isi alasan dulu (minimal 5 karakter).');
    if (!confirm('Terapkan hitung ulang HPP ini? Catatan koreksi akan tersimpan permanen.')) return;
    setStatus('Menerapkan…');
    const payload = await call(`/api/admin/hpp-recalculation?${storeQuery()}`, { method: 'POST', body: JSON.stringify({ ...previewed, reason }) });
    const posted = (payload.journals || []).filter(item => item.status === 'POSTED').length;
    setStatus(`Selesai. HPP dikoreksi ${rupiahText(payload.summary.deltaRupiah)}.${posted ? ` ${posted} jurnal koreksi masuk pembukuan.` : ''}`);
    previewed = null;
    el('hppRecalcResult').style.display = 'none';
    await load();
  }

  function renderHistory(history) {
    const box = el('hppRecalcHistory');
    if (!history.length) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.innerHTML = `<div class="list-head"><h2>Riwayat hitung ulang</h2><span class="master-count">${history.length}</span></div>`
      + history.map(item => `<div class="master-row" style="align-items:flex-start"><div class="master-main">
          <strong>${escapeHtml(item.componentName)}</strong> · ${rupiahText(item.previousAverageCostRupiah)} → ${rupiahText(item.unitCostRupiah)} per satuan · sejak ${escapeHtml(item.from)}
          <div class="master-meta">${item.lineCount} baris penjualan · HPP ${rupiahText(item.oldHppRupiah)} → ${rupiahText(item.newHppRupiah)} (selisih ${rupiahText(item.deltaRupiah)})</div>
          <div class="master-meta">Alasan: ${escapeHtml(item.reason)} · ${escapeHtml(new Date(item.createdAt).toLocaleString('id-ID'))}</div>
        </div></div>`).join('');
  }

  mount();
})();
