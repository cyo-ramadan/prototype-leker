(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  let data = null;

  function install() {
    const accounting = el('tab-accounting');
    const reports = el('tab-reports');
    if (!accounting || accounting.dataset.integrationReady) return;
    accounting.dataset.integrationReady = 'true';
    accounting.innerHTML = `
      <div class="admin-grid two">
        <form id="integrationSettingsForm" class="admin-card">
          <div class="admin-eyebrow">MAXI Integration Bridge</div><h2>Identitas & modul</h2>
          <p class="field-note">Gerai/outlet, terminal, shift/laci, dan warehouse disimpan sebagai identitas berbeda. Tidak ada direct write ke database modul lain.</p>
          <label class="admin-field">Terminal ID<input id="integrationTerminalId" required maxlength="160" /></label>
          <label class="admin-field">Warehouse ID<input id="integrationWarehouseId" maxlength="120" placeholder="Wajib sebelum potong stok" /></label>
          <label class="admin-field">Akun laba ditahan<select id="retainedEarningsAccount"><option value="">NEEDS_CONFIGURATION</option></select></label>
          <button class="primary-btn" type="submit">Simpan konfigurasi bridge</button><div id="integrationContracts" class="field-note"></div>
        </form>
        <form id="accountForm" class="admin-card">
          <div class="admin-eyebrow">Chart of Accounts</div><h2>Tambah grup / subakun</h2>
          <div class="admin-grid two compact"><label class="admin-field">Kode<input id="accountCode" required maxlength="24" /></label><label class="admin-field">Tipe<select id="accountType"><option>ASSET</option><option>LIABILITY</option><option>EQUITY</option><option>REVENUE</option><option>EXPENSE</option></select></label></div>
          <label class="admin-field">Nama akun<input id="accountName" required maxlength="100" /></label><label class="admin-field">Parent akun grup<select id="accountParent"><option value="">Tanpa parent</option></select></label>
          <label class="admin-check"><input id="accountPostable" type="checkbox" /> Subakun postable</label><button class="primary-btn" type="submit">Tambah akun</button>
        </form>
      </div>
      <section class="admin-card" style="margin-top:16px"><div class="list-head"><div><h2>Hierarki akun</h2><div class="muted">Akun grup tidak dapat dipakai posting. Mapping hanya menerima subakun postable aktif.</div></div><span id="accountCount" class="master-count">0</span></div><div id="accountList" class="master-list" style="margin-top:12px"></div></section>
      <div class="admin-grid two" style="margin-top:16px">
        <form id="dimensionForm" class="admin-card"><div class="admin-eyebrow">Financial dimensions</div><h2>Tambah dimensi</h2><label class="admin-field">Tipe<input id="dimensionType" placeholder="Contoh: COST_CENTER" required maxlength="40" /></label><label class="admin-field">Kode<input id="dimensionCode" required maxlength="40" /></label><label class="admin-field">Nama<input id="dimensionName" required maxlength="100" /></label><button class="primary-btn" type="submit">Tambah dimensi</button><div id="dimensionList" class="field-note"></div></form>
        <form id="openingBalanceForm" class="admin-card"><div class="admin-eyebrow">Opening balance</div><h2>Saldo awal</h2><label class="admin-field">Subakun<select id="openingAccount" required></select></label><label class="admin-field">Tanggal efektif<input id="openingDate" type="date" required /></label><div class="admin-grid two compact"><label class="admin-field">Debit<input id="openingDebit" type="number" min="0" step="1" value="0" /></label><label class="admin-field">Kredit<input id="openingCredit" type="number" min="0" step="1" value="0" /></label></div><label class="admin-field">Catatan<input id="openingNote" maxlength="300" /></label><button class="primary-btn" type="submit">Simpan saldo awal</button><div id="openingList" class="field-note"></div></form>
      </div>
      <div class="admin-grid two" style="margin-top:16px">
        <form id="accountMappingForm" class="admin-card"><div class="admin-eyebrow">Fail-closed</div><h2>Mapping transaksi</h2>
          <div class="admin-grid two compact"><label class="admin-field">Jenis<select id="mappingType"><option>SALE</option><option>PURCHASE</option><option>EXPENSE</option><option>OTHER_INCOME</option><option>REFUND</option><option>VOID</option></select></label><label class="admin-field">Pembayaran<select id="mappingPayment"><option>CASH</option><option>NON_CASH</option><option>ANY</option></select></label></div>
          <label class="admin-field">Debit<select id="mappingDebit" required></select></label><label class="admin-field">Kredit<select id="mappingCredit" required></select></label>
          <button class="primary-btn" type="submit">Aktifkan mapping</button><div id="mappingList" class="field-note"></div>
        </form>
        <form id="warehouseMappingForm" class="admin-card"><div class="admin-eyebrow">@maxi/warehouse</div><h2>Mapping barang</h2>
          <label class="admin-field">Produk<select id="warehouseProduct" required></select></label><label class="admin-field">Warehouse ID<input id="warehouseMappingWarehouse" required maxlength="120" /></label><label class="admin-field">Warehouse Item ID<input id="warehouseItemId" required maxlength="160" /></label><label class="admin-field">Qty deduction per item<input id="warehouseDeduction" type="number" min="1" step="1" value="1" required /></label>
          <button class="primary-btn" type="submit">Simpan mapping stok</button><div id="warehouseMappingList" class="field-note"></div>
        </form>
      </div>`;
    if (reports) reports.innerHTML = `<section class="admin-card"><div class="admin-eyebrow">Connection readiness</div><h2>Status Integrasi POS</h2><p class="muted">Ini bukan laporan laba rugi/neraca palsu. Laporan finansial baru boleh dibentuk oleh @maxi/accounting setelah mapping valid dan outbox berhasil diproses.</p><div id="integrationStatus" class="master-list" style="margin-top:14px"><div class="empty">Buka tab Akuntansi untuk memuat status.</div></div></section>`;
    bind();
  }

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) }; if (options.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { ...options, headers }); const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${payload.code ? `${payload.code}: ` : ''}${payload.error || `Request gagal (${response.status})`}`); return payload;
  }
  function toast(message) { const node = el('adminToast'); if (!node) return; node.textContent = message; node.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2400); }
  const postableOptions = () => (data?.accounts || []).filter(a => a.isPostable && a.isActive).map(a => `<option value="${esc(a.id)}">${esc(a.code)} · ${esc(a.name)}</option>`).join('');
  function render() {
    const settings = data.settings || {}; el('integrationTerminalId').value = settings.terminal_id || `terminal_${data.store.id}`; el('integrationWarehouseId').value = settings.warehouse_id || ''; el('warehouseMappingWarehouse').value = settings.warehouse_id || '';
    el('integrationContracts').textContent = Object.values(data.contracts).join(' · '); el('accountCount').textContent = data.accounts.length;
    el('accountList').innerHTML = data.accounts.map(a => `<div class="master-row contact-row ${a.isActive ? '' : 'inactive'}"><div class="master-main"><strong>${esc(a.code)} · ${esc(a.name)}</strong><div class="master-meta">${esc(a.accountType)} · ${a.isPostable ? 'POSTABLE' : 'GROUP'}${a.parentId ? ` · parent ${esc(data.accounts.find(p => p.id === a.parentId)?.code || a.parentId)}` : ''}</div></div></div>`).join('') || '<div class="empty">Belum ada akun.</div>';
    el('accountParent').innerHTML = '<option value="">Tanpa parent</option>' + data.accounts.filter(a => !a.isPostable && a.isActive).map(a => `<option value="${esc(a.id)}">${esc(a.code)} · ${esc(a.name)}</option>`).join('');
    el('mappingDebit').innerHTML = '<option value="">Pilih subakun</option>' + postableOptions(); el('mappingCredit').innerHTML = '<option value="">Pilih subakun</option>' + postableOptions(); el('openingAccount').innerHTML = '<option value="">Pilih subakun</option>' + postableOptions();
    el('retainedEarningsAccount').innerHTML = '<option value="">NEEDS_CONFIGURATION</option>' + data.accounts.filter(a => a.accountType === 'EQUITY' && a.isPostable && a.isActive).map(a => `<option value="${esc(a.id)}" ${settings.retained_earnings_account_id === a.id ? 'selected' : ''}>${esc(a.code)} · ${esc(a.name)}</option>`).join('');
    el('mappingList').innerHTML = data.mappings.length ? data.mappings.map(m => `<div>${esc(m.transactionType)}/${esc(m.paymentMethod)}: <b>${esc(m.status)}</b></div>`).join('') : 'Belum ada mapping. Transaksi akan berstatus NEEDS_MAPPING.';
    el('dimensionList').textContent = data.dimensions.length ? `${data.dimensions.length} dimensi tersedia: ${data.dimensions.map(d => `${d.dimension_type}/${d.code}`).join(', ')}` : 'Belum ada dimensi.';
    el('openingList').textContent = data.openingBalances.length ? `${data.openingBalances.length} saldo awal · ${data.openingBalanceReconciliation.status} · selisih ${Number(data.openingBalanceReconciliation.difference)}` : 'Belum ada saldo awal.';
    el('warehouseProduct').innerHTML = data.products.filter(p => p.isActive).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join(''); el('warehouseMappingList').innerHTML = `${data.warehouseMappings.length}/${data.products.filter(p => p.isActive).length} produk aktif sudah dimapping.`;
    const statuses = data.outboxSummary || []; el('integrationStatus').innerHTML = statuses.length ? statuses.map(s => `<div class="master-row contact-row"><div class="master-main"><strong>${esc(s.destination)} · ${esc(s.status)}</strong><div class="master-meta">${Number(s.count)} message</div></div></div>`).join('') : '<div class="empty">Belum ada pesan integrasi. Transaksi berikutnya akan membuat outbox secara atomik.</div>';
  }
  async function load() { try { data = await request('/api/admin/integrations', { cache: 'no-store' }); render(); } catch (error) { toast(error.message); } }
  async function submit(event, path, payload, method = 'PUT') { event.preventDefault(); try { await request(path, { method, body: JSON.stringify(payload()) }); await load(); event.target.reset(); toast('Konfigurasi tersimpan'); } catch (error) { toast(error.message); } }
  function bind() {
    document.querySelector('[data-tab="accounting"]')?.addEventListener('click', load); document.querySelector('[data-tab="reports"]')?.addEventListener('click', load);
    el('integrationSettingsForm').addEventListener('submit', e => submit(e, '/api/admin/integrations/settings', () => ({ terminalId: el('integrationTerminalId').value, warehouseId: el('integrationWarehouseId').value, retainedEarningsAccountId: el('retainedEarningsAccount').value })));
    el('accountForm').addEventListener('submit', e => submit(e, '/api/admin/integrations/accounts', () => ({ code: el('accountCode').value, name: el('accountName').value, accountType: el('accountType').value, parentId: el('accountParent').value, isPostable: el('accountPostable').checked }), 'POST'));
    el('dimensionForm').addEventListener('submit', e => submit(e, '/api/admin/integrations/dimensions', () => ({ dimensionType: el('dimensionType').value, code: el('dimensionCode').value, name: el('dimensionName').value }), 'POST'));
    el('openingBalanceForm').addEventListener('submit', e => submit(e, '/api/admin/integrations/opening-balances', () => ({ accountId: el('openingAccount').value, effectiveDate: el('openingDate').value, debitAmount: Number(el('openingDebit').value), creditAmount: Number(el('openingCredit').value), note: el('openingNote').value }), 'POST'));
    el('accountMappingForm').addEventListener('submit', e => submit(e, '/api/admin/integrations/account-mapping', () => ({ transactionType: el('mappingType').value, paymentMethod: el('mappingPayment').value, debitAccountId: el('mappingDebit').value, creditAccountId: el('mappingCredit').value })));
    el('warehouseMappingForm').addEventListener('submit', e => submit(e, '/api/admin/integrations/warehouse-mapping', () => ({ productId: Number(el('warehouseProduct').value), warehouseId: el('warehouseMappingWarehouse').value, warehouseItemId: el('warehouseItemId').value, deductionQuantity: Number(el('warehouseDeduction').value) })));
  }
  document.addEventListener('DOMContentLoaded', install);
})();
