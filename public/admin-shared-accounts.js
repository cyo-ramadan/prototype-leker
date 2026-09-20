(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  let accounts = [];
  let siblingStores = [];

  // Bos Cyo, 2026-09-20: Rekening Bersama (central account per entity, lihat
  // src/entity-shared-accounts.js). Konfigurasi (bikin/rename rekening) ada
  // di panel Entity Admin -- di sini murni sisi operasional gerai: lihat
  // saldo gerai ini di tiap Rekening Bersama, dan transfer/terima antar
  // gerai. SENGAJA di luar Akuntansi, jadi panel ini tidak menyentuh
  // chart_of_accounts/journal apa pun.
  const tabs = document.querySelector('.admin-tabs');
  if (tabs && !document.querySelector('[data-tab="sharedaccounts"]')) {
    const button = document.createElement('button');
    button.className = 'admin-tab';
    button.dataset.tab = 'sharedaccounts';
    button.type = 'button';
    button.textContent = '💰 Rekening Bersama';
    tabs.appendChild(button);
  }

  const app = el('adminApp');
  if (app && !el('tab-sharedaccounts')) {
    const toast = el('adminToast');
    const section = `
      <section id="tab-sharedaccounts" class="admin-section">
        <div class="admin-card">
          <div class="list-head"><div><h2>Rekening Bersama</h2><div class="muted">Saldo gerai ini di tiap rekening yang dipakai lintas gerai se-entity. Konfigurasi rekening baru dilakukan di panel Entity Admin.</div></div><span id="sharedAccountCount" class="master-count">0</span></div>
          <div id="sharedAccountList" class="master-list" style="margin-top:14px"></div>
        </div>
      </section>`;
    if (toast) toast.insertAdjacentHTML('beforebegin', section);
    else app.insertAdjacentHTML('beforeend', section);
  }

  function switchTab(tab) {
    document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
    document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === `tab-${tab}`));
    if (tab === 'sharedaccounts') loadAccounts();
  }

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { cache: 'no-store', ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error || `Request gagal (${response.status})`), { payload });
    return payload;
  }

  function toast(message) {
    const node = el('adminToast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 2200);
  }

  function renderAccounts() {
    el('sharedAccountCount').textContent = accounts.length;
    el('sharedAccountList').innerHTML = accounts.length ? accounts.map(account => `
      <div class="master-row contact-row">
        <div class="master-main">
          <strong>${esc(account.name)}</strong>
          <div class="master-meta">Saldo gerai ini: ${money(account.balance)}</div>
        </div>
        <div class="master-actions">
          <button class="mini-btn" type="button" data-open-shared-account="${esc(account.id)}">Transfer &amp; Riwayat</button>
        </div>
      </div>`).join('') : '<div class="empty">Belum ada Rekening Bersama untuk entity gerai ini.</div>';
    document.querySelectorAll('[data-open-shared-account]').forEach(button => button.onclick = () => openAccountDetail(button.dataset.openSharedAccount));
  }

  async function loadAccounts() {
    try {
      const payload = await request('/api/admin/shared-accounts');
      accounts = payload.accounts || [];
      siblingStores = payload.siblingStores || [];
      renderAccounts();
    } catch (error) { toast(error.message); }
  }

  function transferRow(transfer, storeCode) {
    const incomingPending = transfer.status === 'IN_TRANSIT' && transfer.toStoreCode === storeCode;
    return `<div class="master-row contact-row">
      <div class="master-main">
        <strong>${esc(transfer.fromStoreCode)} &rarr; ${esc(transfer.toStoreCode)}</strong>
        <div class="master-meta">${money(transfer.amount)} · ${transfer.status === 'IN_TRANSIT' ? 'Menunggu diterima' : 'Selesai'}${transfer.reason ? ` · ${esc(transfer.reason)}` : ''}</div>
      </div>
      ${incomingPending ? `<div class="master-actions"><button class="mini-btn" type="button" data-complete-transfer="${esc(transfer.id)}">Terima</button></div>` : ''}
    </div>`;
  }

  async function openAccountDetail(accountId) {
    const account = accounts.find(item => item.id === accountId);
    if (!account) return;
    const storeCode = String(window.LEKER_STORE_CODE || localStorage.getItem('lekerAdminStoreCode') || '').toUpperCase();

    window.openAdminDetailModal({
      head: `<div class="admin-eyebrow">Rekening Bersama</div><h2>${esc(account.name)}</h2>`,
      body: '<div class="muted">Memuat...</div>'
    });

    try {
      const payload = await request(`/api/admin/shared-accounts/${encodeURIComponent(accountId)}/transfers`);
      const transfers = payload.transfers || [];
      const storeOptions = siblingStores.map(store => `<option value="${esc(store.code)}">${esc(store.code)} · ${esc(store.storeName)}</option>`).join('');
      window.openAdminDetailModal({
        head: `<div class="admin-eyebrow">Rekening Bersama</div><h2>${esc(account.name)} · Saldo gerai ini: ${money(account.balance)}</h2>`,
        body: `
          <form id="sharedAccountTransferForm" style="margin-bottom:16px">
            <div class="form-title-row"><h3>Transfer ke gerai lain</h3></div>
            <label class="admin-field">Gerai tujuan<select id="sharedAccountTransferTo" required>${storeOptions || '<option value="">Tidak ada gerai lain di entity ini</option>'}</select></label>
            <label class="admin-field">Nominal<input id="sharedAccountTransferAmount" type="number" min="1" step="1" required /></label>
            <label class="admin-field">Alasan <span class="field-note">optional</span><input id="sharedAccountTransferReason" maxlength="300" /></label>
            <button class="primary-btn" type="submit" ${siblingStores.length ? '' : 'disabled'}>Kirim Transfer</button>
          </form>
          <h3>Riwayat transfer rekening ini</h3>
          <div id="sharedAccountTransferList">${transfers.length ? transfers.map(transfer => transferRow(transfer, storeCode)).join('') : '<div class="empty">Belum ada transfer.</div>'}</div>`
      });

      el('sharedAccountTransferForm')?.addEventListener('submit', async event => {
        event.preventDefault();
        try {
          await request(`/api/admin/shared-accounts/${encodeURIComponent(accountId)}/transfers`, {
            method: 'POST',
            body: JSON.stringify({
              toStore: el('sharedAccountTransferTo').value,
              amount: Number(el('sharedAccountTransferAmount').value),
              reason: el('sharedAccountTransferReason').value
            })
          });
          toast('Transfer terkirim, menunggu diterima gerai tujuan');
          await loadAccounts();
          openAccountDetail(accountId);
        } catch (error) { toast(error.message); }
      });

      document.querySelectorAll('[data-complete-transfer]').forEach(button => button.onclick = async () => {
        try {
          await request(`/api/admin/shared-accounts/${encodeURIComponent(accountId)}/transfers/${encodeURIComponent(button.dataset.completeTransfer)}/complete`, { method: 'PATCH' });
          toast('Transfer diterima');
          await loadAccounts();
          openAccountDetail(accountId);
        } catch (error) { toast(error.message); }
      });
    } catch (error) {
      window.openAdminDetailModal({
        head: `<div class="admin-eyebrow">Rekening Bersama</div><h2>Gagal memuat</h2>`,
        body: `<div class="empty">${esc(error.message)}</div>`
      });
    }
  }

  document.querySelector('[data-tab="sharedaccounts"]')?.addEventListener('click', () => switchTab('sharedaccounts'));

  const gate = el('authGate');
  if (gate) new MutationObserver(() => { if (gate.classList.contains('hidden')) loadAccounts(); }).observe(gate, { attributes: true, attributeFilter: ['class'] });
})();
