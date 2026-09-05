(() => {
  const MODAL_ID = 'adminDetailModal';
  const STYLE_ID = 'adminDetailModalStyle';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${MODAL_ID} { border:none; border-radius:22px; padding:0; width:min(760px,92vw); max-height:86vh; box-shadow:0 20px 60px rgba(0,0,0,.25); }
      #${MODAL_ID}::backdrop { background:rgba(20,16,10,.45); }
      #${MODAL_ID} .admin-detail-modal-head { position:sticky; top:0; background:white; display:flex; justify-content:space-between; align-items:flex-start; gap:10px; padding:18px 18px 12px; border-bottom:1px solid var(--line); border-radius:22px 22px 0 0; z-index:1; }
      #${MODAL_ID} .admin-detail-modal-body { padding:16px 18px 20px; overflow-y:auto; }
    `;
    document.head.appendChild(style);
  }

  function ensureModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;
    injectStyles();
    modal = document.createElement('dialog');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="admin-detail-modal-head">
        <div id="adminDetailModalHead"></div>
        <button id="adminDetailModalClose" class="mini-btn" type="button">Tutup</button>
      </div>
      <div id="adminDetailModalBody" class="admin-detail-modal-body"></div>`;
    document.body.appendChild(modal);
    modal.querySelector('#adminDetailModalClose').addEventListener('click', () => modal.close());
    modal.addEventListener('click', event => { if (event.target === modal) modal.close(); });
    return modal;
  }

  // head/body are trusted HTML built by the caller from escaped fields (same
  // pattern already used by every admin panel here) -- this modal is just a
  // shared shell, it does not escape anything itself.
  window.openAdminDetailModal = function openAdminDetailModal({ head = '', body = '' } = {}) {
    const modal = ensureModal();
    modal.querySelector('#adminDetailModalHead').innerHTML = head;
    modal.querySelector('#adminDetailModalBody').innerHTML = body;
    if (!modal.open) modal.showModal();
    return modal;
  };

  window.closeAdminDetailModal = function closeAdminDetailModal() {
    document.getElementById(MODAL_ID)?.close();
  };
})();
