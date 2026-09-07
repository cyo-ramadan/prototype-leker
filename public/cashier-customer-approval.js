(() => {
  const customerApprovalButton = el('customerApprovalBtn');
  if (!customerApprovalButton) return;

  function customerApprovalStoreCode() {
    return String(state.cashier?.store?.code || '').trim().toUpperCase();
  }

  function customerApprovalEndpoint(requestId = '') {
    const storeCode = customerApprovalStoreCode();
    if (!storeCode) throw new Error('Gerai kasir belum terbaca. Login ulang lalu coba lagi.');
    const base = requestId
      ? `/api/admin/customer-requests/${encodeURIComponent(requestId)}`
      : '/api/admin/customer-requests';
    return `${base}?store=${encodeURIComponent(storeCode)}`;
  }

  function customerApprovalRows(requests) {
    if (!requests.length) {
      return '<div class="cashier-lock-note">Belum ada pendaftaran pelanggan yang menunggu ACC di gerai ini.</div>';
    }
    return requests.map(request => {
      const contact = [request.phone, request.email].filter(Boolean).join(' · ') || 'Kontak belum diisi';
      return `
        <div class="cashier-lock-note" style="margin-bottom:10px">
          <strong>${escapeHtml(request.customerName || '-')}</strong>
          <div class="muted">${escapeHtml(request.requestCode || '')} · @${escapeHtml(request.username || '')}</div>
          <div class="muted">${escapeHtml(contact)} · ${escapeHtml(request.createdAt || '')}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <button class="primary-btn" type="button" data-customer-review-action="APPROVE" data-customer-request-id="${escapeHtml(request.id)}">ACC</button>
            <button class="secondary-btn" type="button" data-customer-review-action="REJECT" data-customer-request-id="${escapeHtml(request.id)}">Reject</button>
          </div>
        </div>`;
    }).join('');
  }

  async function reviewCustomerRequest(request, action, button) {
    if (action === 'APPROVE') {
      const confirmed = window.confirm(`ACC ${request.customerName || request.username || 'pelanggan ini'}? Setelah ACC, akun pelanggan langsung aktif.`);
      if (!confirmed) return;
    }

    let reason = '';
    if (action === 'REJECT') {
      const input = window.prompt(`Alasan reject ${request.customerName || request.username || 'pelanggan ini'}? (optional)`, '');
      if (input === null) return;
      reason = input.trim().slice(0, 240);
    }

    button.disabled = true;
    try {
      const body = action === 'REJECT' ? { action, reason } : { action };
      await api(customerApprovalEndpoint(request.id), {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      toast(action === 'APPROVE' ? 'Pelanggan di-ACC · akun sudah aktif' : 'Pendaftaran pelanggan ditolak');
      await openCustomerApprovalDialog();
    } catch (error) {
      button.disabled = false;
      toast(error.message);
    }
  }

  function bindCustomerApprovalActions(requests) {
    const byId = new Map(requests.map(request => [String(request.id), request]));
    document.querySelectorAll('[data-customer-review-action]').forEach(button => {
      button.addEventListener('click', () => {
        const request = byId.get(String(button.dataset.customerRequestId || ''));
        if (!request) return;
        reviewCustomerRequest(request, String(button.dataset.customerReviewAction || ''), button);
      });
    });
  }

  async function openCustomerApprovalDialog() {
    try {
      const payload = await api(customerApprovalEndpoint());
      const requests = payload.requests || [];
      openDialog({
        eyebrow: `Kasir · ${escapeHtml(payload.store?.storeName || customerApprovalStoreCode())}`,
        title: `ACC Pelanggan (${requests.length})`,
        readOnly: true,
        body: `
          <p class="muted">Request di bawah ini hanya berasal dari gerai akun kasir. ACC membuat Customer ID dan mengaktifkan login pelanggan.</p>
          ${customerApprovalRows(requests)}`
      });
      bindCustomerApprovalActions(requests);
    } catch (error) {
      toast(error.message);
    }
  }

  customerApprovalButton.addEventListener('click', openCustomerApprovalDialog);
})();
