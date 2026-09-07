(() => {
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const voucherState = { products: [], vouchers: [], editingId: '' };
  const rodaState = { options: [], rewards: [] };

  async function voucherApi(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  function notify(message) {
    const node = byId('adminToast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => node.classList.remove('show'), 1800);
  }

  function todayOffset(days) {
    const value = new Date();
    value.setDate(value.getDate() + days);
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, '0'),
      String(value.getDate()).padStart(2, '0')
    ].join('-');
  }

  function injectStyle() {
    if (byId('adminVoucherStyle')) return;
    const style = document.createElement('style');
    style.id = 'adminVoucherStyle';
    style.textContent = `
      .voucher-product-picker{display:grid;gap:7px;max-height:250px;overflow:auto;padding:10px;border:1px solid var(--line);border-radius:12px;background:#fffaf5}
      .voucher-product-picker label{display:flex;align-items:center;gap:9px;font-weight:800}
      .voucher-product-picker input{width:18px;height:18px}
      .voucher-chip-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}
      .voucher-chip{display:inline-flex;padding:5px 8px;border-radius:999px;background:#f1e7dc;font-size:11px;font-weight:800}
      .voucher-progress{font-variant-numeric:tabular-nums}
      .roda-config-card{margin-top:18px}
      .roda-reward-rows{display:grid;gap:9px;margin:12px 0}
      .roda-reward-row{display:grid;grid-template-columns:minmax(0,1fr) 120px auto;gap:8px;align-items:end;padding:10px;border:1px solid var(--line);border-radius:12px;background:#fffaf5}
      .roda-reward-row label{display:grid;gap:5px;font-size:12px;font-weight:800}
      .roda-reward-row select,.roda-reward-row input{width:100%}
      .roda-weight-summary{display:flex;justify-content:space-between;gap:12px;padding:10px 0;font-weight:900;font-variant-numeric:tabular-nums}
      .roda-weight-summary.invalid{color:#b42318}
      @media(max-width:680px){.roda-reward-row{grid-template-columns:1fr 110px}.roda-reward-row button{grid-column:1/-1}}
    `;
    document.head.appendChild(style);
  }

  function mount() {
    const app = byId('adminApp');
    const tabs = document.querySelector('.admin-tabs');
    if (!app || !tabs || byId('tab-vouchers')) return;
    injectStyle();

    const button = document.createElement('button');
    button.className = 'admin-tab';
    button.dataset.tab = 'vouchers';
    button.type = 'button';
    button.textContent = 'Voucher';
    tabs.appendChild(button);

    const section = document.createElement('section');
    section.id = 'tab-vouchers';
    section.className = 'admin-section';
    section.innerHTML = `
      <div class="admin-grid master-layout">
        <form id="voucherMasterForm" class="admin-card sticky-form">
          <input id="voucherMasterId" type="hidden" />
          <div class="form-title-row"><h2 id="voucherMasterFormTitle">Tambah Master Voucher</h2><button id="voucherMasterCancel" class="text-btn hidden" type="button">Batal edit</button></div>
          <label class="admin-field">Nama promo<input id="voucherMasterName" maxlength="100" required /></label>
          <div class="admin-grid two compact">
            <label class="admin-field">Aktif mulai<input id="voucherActiveFrom" type="date" required /></label>
            <label class="admin-field">Aktif sampai<input id="voucherActiveUntil" type="date" required /></label>
          </div>
          <label class="admin-field">Kuota penukaran<input id="voucherUsageQuota" type="number" min="1" step="1" value="1" required /></label>
          <div class="admin-field"><label>Pilih barang dari Master Barang</label><div id="voucherProductPicker" class="voucher-product-picker"></div></div>
          <label class="admin-check"><input id="voucherMasterActive" type="checkbox" checked /> Master aktif</label>
          <button class="primary-btn" type="submit">Simpan Master Voucher</button>
        </form>
        <div class="admin-card list-card"><div class="list-head"><div><h2>Master Voucher</h2><div class="muted">Dibuat Admin, dibagikan CS ke satu customer.</div></div><span id="voucherMasterCount" class="master-count">0</span></div><div id="voucherMasterList" class="master-list"></div></div>
      </div>
      <form id="rodaPuterForm" class="admin-card roda-config-card">
        <div class="list-head"><div><h2>Hadiah Roda Puter</h2><div class="muted">Pilih barang dari Master Voucher dan tentukan bobot custom. Total wajib tepat 100%.</div></div><button id="rodaAddReward" class="mini-btn" type="button">+ Hadiah</button></div>
        <div id="rodaRewardRows" class="roda-reward-rows"></div>
        <div id="rodaWeightSummary" class="roda-weight-summary"><span>Total bobot</span><span>0%</span></div>
        <button class="primary-btn" type="submit">Simpan Konfigurasi Roda</button>
      </form>`;
    app.insertBefore(section, byId('adminToast'));

    button.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(item => item.classList.toggle('active', item === button));
      document.querySelectorAll('.admin-section').forEach(item => item.classList.toggle('active', item === section));
      Promise.all([loadVouchers(), loadRodaPuter()]).catch(error => notify(error.message));
    });
    byId('voucherMasterForm').addEventListener('submit', saveVoucher);
    byId('voucherMasterCancel').addEventListener('click', resetForm);
    byId('rodaPuterForm').addEventListener('submit', saveRodaPuter);
    byId('rodaAddReward').addEventListener('click', addRodaReward);
    resetForm();
  }

  async function loadVouchers() {
    const payload = await voucherApi('/api/admin/vouchers');
    voucherState.products = payload.products || [];
    voucherState.vouchers = payload.vouchers || [];
    renderProductPicker();
    renderVoucherList();
  }

  function basisPointsToPercent(value) {
    const basisPoints = Number(value || 0);
    const whole = Math.floor(basisPoints / 100);
    const fraction = String(basisPoints % 100).padStart(2, '0').replace(/0+$/, '');
    return `${whole}${fraction ? `.${fraction}` : ''}`;
  }

  function percentToBasisPoints(value) {
    const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(String(value ?? '').trim());
    if (!match) return null;
    const basisPoints = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0') || 0);
    return Number.isSafeInteger(basisPoints) && basisPoints > 0 && basisPoints <= 10000 ? basisPoints : null;
  }

  async function loadRodaPuter() {
    const payload = await voucherApi('/api/admin/roda-puter');
    rodaState.options = payload.options || [];
    rodaState.rewards = (payload.campaign?.rewards || []).map(reward => ({
      voucherMasterId: reward.voucherMasterId,
      productId: Number(reward.productId),
      weightPercent: basisPointsToPercent(reward.weightBasisPoints)
    }));
    if (!rodaState.rewards.length && rodaState.options.length) {
      const first = rodaState.options[0];
      rodaState.rewards = [{ voucherMasterId: first.voucherMasterId, productId: Number(first.productId), weightPercent: '100' }];
    }
    renderRodaRewards();
  }

  function optionIndexFor(reward) {
    return rodaState.options.findIndex(option =>
      option.voucherMasterId === reward.voucherMasterId
      && Number(option.productId) === Number(reward.productId)
    );
  }

  function renderRodaRewards() {
    const target = byId('rodaRewardRows');
    if (!target) return;
    if (!rodaState.options.length) {
      target.innerHTML = '<div class="empty">Buat Master Voucher aktif beserta pilihan barang terlebih dahulu.</div>';
      byId('rodaPuterForm').querySelector('button[type="submit"]').disabled = true;
      updateRodaTotal();
      return;
    }
    byId('rodaPuterForm').querySelector('button[type="submit"]').disabled = false;
    target.innerHTML = rodaState.rewards.map((reward, rowIndex) => {
      const selectedIndex = optionIndexFor(reward);
      return `<div class="roda-reward-row" data-roda-row="${rowIndex}">
        <label>Hadiah dari Master Voucher<select data-roda-option>${rodaState.options.map((option, optionIndex) => `<option value="${optionIndex}" ${optionIndex === selectedIndex ? 'selected' : ''}>${esc(option.voucherMasterName)} · ${esc(option.productName)}</option>`).join('')}</select></label>
        <label>Bobot (%)<input data-roda-weight inputmode="decimal" value="${esc(reward.weightPercent)}" placeholder="contoh 25" /></label>
        <button class="mini-btn danger" data-roda-remove="${rowIndex}" type="button">Hapus</button>
      </div>`;
    }).join('');
    target.querySelectorAll('select,input').forEach(input => input.addEventListener('input', updateRodaTotal));
    target.querySelectorAll('[data-roda-remove]').forEach(button => button.addEventListener('click', () => removeRodaReward(Number(button.dataset.rodaRemove))));
    updateRodaTotal();
  }

  function syncRodaRows() {
    rodaState.rewards = [...document.querySelectorAll('[data-roda-row]')].map(row => {
      const option = rodaState.options[Number(row.querySelector('[data-roda-option]').value)] || rodaState.options[0];
      return {
        voucherMasterId: option.voucherMasterId,
        productId: Number(option.productId),
        weightPercent: row.querySelector('[data-roda-weight]').value
      };
    });
  }

  function updateRodaTotal() {
    const summary = byId('rodaWeightSummary');
    if (!summary) return;
    const weights = [...document.querySelectorAll('[data-roda-weight]')].map(input => percentToBasisPoints(input.value));
    const valid = weights.length > 0 && weights.every(value => value !== null);
    const total = valid ? weights.reduce((sum, value) => sum + value, 0) : 0;
    summary.lastElementChild.textContent = valid ? `${basisPointsToPercent(total)}%` : 'Cek input';
    summary.classList.toggle('invalid', !valid || total !== 10000);
  }

  function addRodaReward() {
    syncRodaRows();
    const usedProducts = new Set(rodaState.rewards.map(reward => Number(reward.productId)));
    const option = rodaState.options.find(item => !usedProducts.has(Number(item.productId)));
    if (!option) return notify('Semua barang yang tersedia sudah masuk roda.');
    rodaState.rewards.push({ voucherMasterId: option.voucherMasterId, productId: Number(option.productId), weightPercent: '1' });
    renderRodaRewards();
  }

  function removeRodaReward(index) {
    syncRodaRows();
    rodaState.rewards.splice(index, 1);
    renderRodaRewards();
  }

  async function saveRodaPuter(event) {
    event.preventDefault();
    syncRodaRows();
    const rewards = rodaState.rewards.map(reward => ({
      voucherMasterId: reward.voucherMasterId,
      productId: reward.productId,
      weightBasisPoints: percentToBasisPoints(reward.weightPercent)
    }));
    if (!rewards.length || rewards.some(reward => reward.weightBasisPoints === null)) {
      return notify('Isi bobot setiap hadiah dengan angka lebih dari 0%.');
    }
    try {
      await voucherApi('/api/admin/roda-puter', { method: 'PUT', body: JSON.stringify({ rewards }) });
      await loadRodaPuter();
      notify('Konfigurasi Roda Puter disimpan');
    } catch (error) {
      notify(error.message);
    }
  }

  function renderProductPicker(selected = null) {
    const picker = byId('voucherProductPicker');
    if (!picker) return;
    const checked = selected || new Set([...picker.querySelectorAll('[data-voucher-product]:checked')].map(input => Number(input.value)));
    picker.innerHTML = voucherState.products.length
      ? voucherState.products.map(product => `<label><input data-voucher-product type="checkbox" value="${Number(product.id)}" ${checked.has(Number(product.id)) ? 'checked' : ''} /><span>${esc(product.name)}${product.unitSymbol ? ` · ${esc(product.unitSymbol)}` : ''}</span></label>`).join('')
      : '<div class="empty">Belum ada barang aktif di Master Barang.</div>';
  }

  function renderVoucherList() {
    const target = byId('voucherMasterList');
    if (!target) return;
    byId('voucherMasterCount').textContent = voucherState.vouchers.length;
    target.innerHTML = voucherState.vouchers.length ? voucherState.vouchers.map(voucher => `
      <div class="master-row ${voucher.isActive ? '' : 'inactive'}">
        <div class="master-main">
          <strong>${esc(voucher.name)}</strong>
          <div class="master-meta">${esc(voucher.activeFrom)} s.d. ${esc(voucher.activeUntil)} · ${voucher.isActive ? 'Aktif' : 'Nonaktif'}</div>
          <div class="master-meta voucher-progress">Terpakai ${Number(voucher.redeemedCount)} / ${Number(voucher.usageQuota)}</div>
          <div class="voucher-chip-row">${(voucher.products || []).map(product => `<span class="voucher-chip">${esc(product.name)}</span>`).join('')}</div>
        </div>
        <div class="master-actions"><button class="mini-btn" data-edit-voucher="${esc(voucher.id)}" type="button">Edit</button><button class="mini-btn danger" data-delete-voucher="${esc(voucher.id)}" type="button">Nonaktifkan</button></div>
      </div>`).join('') : '<div class="empty">Belum ada Master Voucher.</div>';
    target.querySelectorAll('[data-edit-voucher]').forEach(button => button.addEventListener('click', () => editVoucher(button.dataset.editVoucher)));
    target.querySelectorAll('[data-delete-voucher]').forEach(button => button.addEventListener('click', () => deactivateVoucher(button.dataset.deleteVoucher)));
  }

  function resetForm() {
    voucherState.editingId = '';
    byId('voucherMasterForm')?.reset();
    if (byId('voucherMasterId')) byId('voucherMasterId').value = '';
    if (byId('voucherMasterFormTitle')) byId('voucherMasterFormTitle').textContent = 'Tambah Master Voucher';
    byId('voucherMasterCancel')?.classList.add('hidden');
    if (byId('voucherActiveFrom')) byId('voucherActiveFrom').value = todayOffset(0);
    if (byId('voucherActiveUntil')) byId('voucherActiveUntil').value = todayOffset(30);
    if (byId('voucherUsageQuota')) byId('voucherUsageQuota').value = '1';
    if (byId('voucherMasterActive')) byId('voucherMasterActive').checked = true;
    renderProductPicker(new Set());
  }

  function editVoucher(id) {
    const voucher = voucherState.vouchers.find(item => item.id === id);
    if (!voucher) return;
    voucherState.editingId = id;
    byId('voucherMasterId').value = id;
    byId('voucherMasterName').value = voucher.name;
    byId('voucherActiveFrom').value = voucher.activeFrom;
    byId('voucherActiveUntil').value = voucher.activeUntil;
    byId('voucherUsageQuota').value = String(voucher.usageQuota);
    byId('voucherMasterActive').checked = voucher.isActive;
    byId('voucherMasterFormTitle').textContent = 'Edit Master Voucher';
    byId('voucherMasterCancel').classList.remove('hidden');
    renderProductPicker(new Set((voucher.products || []).map(product => Number(product.id))));
    byId('voucherMasterForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function saveVoucher(event) {
    event.preventDefault();
    const productIds = [...document.querySelectorAll('[data-voucher-product]:checked')].map(input => Number(input.value));
    if (!productIds.length) return notify('Pilih minimal satu barang untuk Voucher.');
    const id = voucherState.editingId;
    try {
      await voucherApi(id ? `/api/admin/vouchers/${encodeURIComponent(id)}` : '/api/admin/vouchers', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: byId('voucherMasterName').value,
          activeFrom: byId('voucherActiveFrom').value,
          activeUntil: byId('voucherActiveUntil').value,
          usageQuota: Number(byId('voucherUsageQuota').value),
          productIds,
          isActive: byId('voucherMasterActive').checked
        })
      });
      resetForm();
      await Promise.all([loadVouchers(), loadRodaPuter()]);
      notify(id ? 'Master Voucher diperbarui' : 'Master Voucher dibuat');
    } catch (error) {
      notify(error.message);
    }
  }

  async function deactivateVoucher(id) {
    if (!confirm('Nonaktifkan Master Voucher ini? Voucher yang sudah dibagikan tetap menjadi riwayat.')) return;
    try {
      await voucherApi(`/api/admin/vouchers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await Promise.all([loadVouchers(), loadRodaPuter()]);
      if (voucherState.editingId === id) resetForm();
      notify('Master Voucher dinonaktifkan');
    } catch (error) {
      notify(error.message);
    }
  }

  mount();
})();
