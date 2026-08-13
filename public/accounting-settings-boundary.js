(() => {
  const el = id => document.getElementById(id);

  function removeAccountEditors() {
    document.querySelectorAll('[data-edit-account]').forEach(button => button.remove());
  }

  function setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function setHtml(node, value) {
    if (node && node.innerHTML !== value) node.innerHTML = value;
  }

  function applyBoundary() {
    const tab = el('accountingSettingsTab');
    setText(tab, 'Setting Akuntansi');

    const section = el('tab-accounting-settings');
    if (!section) return;

    const heading = section.querySelector('.list-head h2');
    setText(heading, 'Setting Akuntansi');
    const intro = heading?.parentElement?.querySelector('.muted');
    setText(intro, 'Tempat menghubungkan transaksi, jenis barang, dan cara pembayaran ke akun. Pekerjaan akuntansi tetap dilakukan di modul Akuntansi.');

    const warning = section.querySelector('.settings-warning');
    setHtml(warning, '<b>Boundary:</b> akun dibuat dan dikelola di modul <b>Akuntansi</b>. Setting Akuntansi hanya membaca akun tersebut untuk mapping. Kode akun dibuat unik otomatis oleh program Akuntansi.');

    const accountNav = section.querySelector('[data-accounting-section="coa"]');
    setText(accountNav, 'Akun dari Akuntansi');
    const paymentNav = section.querySelector('[data-accounting-section="payment"]');
    setText(paymentNav, 'Cara Pembayaran');
    const itemNav = section.querySelector('[data-accounting-section="item"]');
    setText(itemNav, 'Jenis Barang → Akun');
    const rulesNav = section.querySelector('[data-accounting-section="rules"]');
    setText(rulesNav, 'Aturan Transaksi');

    const accountPanel = el('accountingSectionCoa');
    if (accountPanel && accountPanel.dataset.boundaryAdjusted !== '1') {
      accountPanel.dataset.boundaryAdjusted = '1';
      accountPanel.classList.remove('settings-grid');
      accountPanel.innerHTML = `
        <div class="admin-card">
          <div class="list-head">
            <div>
              <h2>Akun dari Modul Akuntansi</h2>
              <div class="muted">Read only di halaman ini. Tambah/edit/nonaktifkan akun dilakukan dari Akuntansi; Setting Akuntansi hanya memilih akun untuk mapping.</div>
            </div>
            <span id="accountCount" class="master-count">0</span>
          </div>
          <div class="settings-warning" style="margin-top:12px">Kode akun tidak diinput manual di Setting Akuntansi. Modul Akuntansi bertanggung jawab menghasilkan kode yang unik.</div>
          <div id="accountList" class="settings-list"></div>
        </div>`;
    }

    removeAccountEditors();
    const accountList = el('accountList');
    if (accountList && accountList.dataset.boundaryObserver !== '1') {
      accountList.dataset.boundaryObserver = '1';
      new MutationObserver(removeAccountEditors).observe(accountList, { childList: true, subtree: true });
    }

    const warehouseHint = el('tab-warehouse-settings')?.querySelector('.settings-warning');
    setHtml(warehouseHint, 'Transaksi warehouse yang berdampak nilai hanya mendaftarkan jenis transaksinya ke <b>Setting Akuntansi</b>. Pemilihan akun tetap dilakukan di Setting Akuntansi; pembuatan akun tetap milik modul Akuntansi.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyBoundary);
  else applyBoundary();

  new MutationObserver(applyBoundary).observe(document.documentElement, { childList: true, subtree: true });
})();
