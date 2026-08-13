(() => {
  const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const dt = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '-';
  const labels = { SALE: 'Penjualan', PURCHASE: 'Pembelian', EXPENSE: 'Operasional' };

  function permitLabel(permit) {
    if (!permit) return 'Belum diajukan';
    if (permit.approvalStatus === 'pending_approval') return 'Menunggu Admin';
    if (permit.approvalStatus === 'rejected') return 'Ditolak';
    if (permit.executionStatus === 'EXECUTED') return 'ACC · reversal selesai';
    if (permit.executionStatus === 'HOLD') return 'ACC · execution HOLD';
    return 'ACC';
  }

  function canRequest(item) {
    if (!item.permit) return true;
    if (item.permit.approvalStatus === 'rejected') return true;
    return item.permit.executionStatus === 'EXECUTED';
  }

  async function requestPermit(item) {
    if (el('cashierDialog')?.open) el('cashierDialog').close();
    openDialog({
      eyebrow: 'Laci · Permit Admin',
      title: `Ajukan Hapus ${labels[item.subjectType] || item.subjectType}`,
      body: `<div class="cashier-lock-note"><b>${escapeHtml(item.description)}</b><br>${money(item.amount)} · ${escapeHtml(item.paymentMethod || '')} · ${escapeHtml(dt(item.createdAt))}</div><div class="field"><label>Alasan hapus / koreksi</label><textarea id="voidPermitReason" rows="4" maxlength="500" required placeholder="Jelaskan kenapa transaksi perlu dibatalkan"></textarea></div><p class="muted">Request ini tidak menghapus transaksi saat dikirim. Admin harus ACC/Reject. History transaksi tetap auditable; eksekusi final memakai void/reversal domain, bukan hard-delete.</p>`,
      submitText: 'AJUKAN PERMIT',
      onSubmit: async () => {
        const reason = el('voidPermitReason').value.trim();
        if (!reason) throw new Error('Alasan permit wajib diisi.');
        await api('/api/cashier/transaction-void/permits', { method: 'POST', body: JSON.stringify({ subjectType: item.subjectType, subjectId: item.subjectId, reason }) });
        toast('Permit hapus masuk ke Admin · pending approval');
        return true;
      }
    });
  }

  async function openPermitList() {
    try {
      const payload = await api('/api/cashier/transaction-void/candidates');
      const rows = payload.candidates || [];
      openDialog({
        eyebrow: 'Laci · Approval Queue', title: 'Permit Hapus Transaksi', readOnly: true,
        body: rows.length ? `<div class="master-list">${rows.map((item, index) => `<article class="cashier-lock-note" style="margin-bottom:9px" data-void-row="${index}"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap"><div><b>${escapeHtml(labels[item.subjectType] || item.subjectType)} · ${escapeHtml(item.description)}</b><div class="muted">${escapeHtml(dt(item.createdAt))} · ${escapeHtml(item.paymentMethod || '')} · ${escapeHtml(item.subjectId)}</div></div><strong>${money(item.amount)}</strong></div><div class="muted" style="margin-top:7px">Permit: ${escapeHtml(permitLabel(item.permit))}${item.permit?.executionCode ? ` · ${escapeHtml(item.permit.executionCode)}` : ''}</div><button class="secondary-btn" type="button" data-request-void="${index}" style="margin-top:8px" ${canRequest(item) ? '' : 'disabled'}>🗑 Ajukan Hapus</button></article>`).join('')}</div>` : '<div class="empty">Belum ada Penjualan, Pembelian, atau Operasional pada laci aktif.</div>'
      });
      document.querySelectorAll('[data-request-void]').forEach(button => button.addEventListener('click', () => requestPermit(rows[Number(button.dataset.requestVoid)])));
    } catch (error) { toast(error.message); }
  }

  function syncButton() { const button = el('transactionVoidPermitBtn'); if (button) button.disabled = !state.canWrite; }
  function mount() {
    if (el('transactionVoidPermitBtn')) return;
    const details = el('drawerDetailsBtn'); if (!details) return;
    details.insertAdjacentHTML('beforebegin', '<button id="transactionVoidPermitBtn" class="drawer-action-btn" type="button" disabled>🗑 Permit Hapus</button>');
    el('transactionVoidPermitBtn')?.addEventListener('click', openPermitList); syncButton();
    if (typeof renderDrawer === 'function' && !renderDrawer.__voidPermitWrapped) {
      const base = renderDrawer; const wrapped = function renderDrawerWithVoidPermit() { base(); syncButton(); }; wrapped.__voidPermitWrapped = true; renderDrawer = wrapped;
    }
  }
  mount();
})();
