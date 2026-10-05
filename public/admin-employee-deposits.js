(() => {
  // Setoran CS (Bos Cyo, 2026-10-04): "panel admin pun punya sendiri untuk ngecek dan
  // validasi itu". CS mentransfer setoran laci lalu mengirim FOTO bukti transfer dari
  // Portal Staf; piutang CS baru berkurang setelah Admin klik ACC di sini (tidak ada ACC
  // otomatis). Isi tab: antrean menunggu ACC (dengan foto), sisa piutang per CS, dan
  // riwayat keputusan. Backend: src/employee-deposit-settlement.js.
  const el = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const dateTime = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '';
  const tanggal = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(`${String(value).slice(0, 10)}T00:00:00`)) : '';
  const STATUS = { pending_approval: ['Menunggu ACC', 'warn'], approved: ['Di-ACC', 'ok'], rejected: ['Ditolak', 'bad'] };
  let photoUrls = [];

  function storeQuery() {
    const code = window.LEKER_STORE_CODE;
    return code ? `?store=${encodeURIComponent(code)}` : '';
  }

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { cache: 'no-store', ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  function toast(message) {
    const node = el('adminToast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 2800);
  }

  function mount() {
    const tabs = document.querySelector('.admin-tabs');
    const shell = document.getElementById('adminApp');
    if (!tabs || !shell || el('tab-setoran-cs')) return;

    const button = document.createElement('button');
    button.className = 'admin-tab';
    button.dataset.tab = 'setoran-cs';
    button.type = 'button';
    button.textContent = '💵 Setoran CS';
    button.addEventListener('click', () => { if (typeof window.switchTab === 'function') window.switchTab('setoran-cs'); load(); });
    tabs.appendChild(button);

    shell.insertAdjacentHTML('beforeend', `
      <section id="tab-setoran-cs" class="admin-section">
        <div class="admin-card">
          <div class="list-head">
            <div><h2>Setoran menunggu ACC</h2><div class="muted">Bukti transfer setoran laci yang dikirim CS lewat Portal Staf. Cocokkan nominal dengan foto dan mutasi rekening. ACC mengurangi piutang CS; Tolak wajib alasan dan piutang tidak berubah. Tidak ada yang di-ACC otomatis.</div></div>
            <span id="setoranPendingCount" class="master-count">0</span>
          </div>
          <button id="setoranRefresh" class="secondary-btn" type="button" style="margin-bottom:10px">↻ Muat ulang</button>
          <div id="setoranPendingList" class="master-list"></div>
        </div>
        <div class="admin-card" style="margin-top:16px">
          <div class="list-head"><div><h2>Sisa piutang setoran per CS</h2><div class="muted">Total setoran laci dikurangi yang sudah di-ACC. Minus berarti CS menyetor lebih.</div></div></div>
          <div id="setoranBalanceList" class="master-list"></div>
        </div>
        <div class="admin-card" style="margin-top:16px">
          <div class="list-head"><div><h2>Riwayat setoran</h2><div class="muted">50 keputusan terakhir (ACC/Tolak).</div></div></div>
          <div id="setoranHistoryList" class="master-list"></div>
        </div>
      </section>`);
    el('setoranRefresh').addEventListener('click', load);
  }

  const foto = payment => payment.hasPhoto
    ? `<img class="setoran-foto" data-deposit-photo="${escapeHtml(payment.id)}" alt="Foto bukti transfer" loading="lazy" style="width:72px;height:72px;object-fit:cover;border-radius:10px;border:1px solid var(--line, #e5ddd3);cursor:zoom-in;background:var(--soft, #f4efe9)" />`
    : '<span class="status-chip warn">Tanpa foto</span>';

  function renderPending(payments) {
    el('setoranPendingCount').textContent = payments.length;
    el('setoranPendingList').innerHTML = payments.length ? payments.map(payment => `
      <article class="master-row">
        ${foto(payment)}
        <div class="master-main">
          <strong>${escapeHtml(payment.employeeName)} · ${money(payment.amountRupiah)}</strong>
          <div class="master-meta">Setoran laci ${escapeHtml(tanggal(payment.depositDate))} · dikirim ${escapeHtml(dateTime(payment.createdAt))}${payment.proofReference ? ` · ${escapeHtml(payment.proofReference)}` : ''}</div>
        </div>
        <div class="master-actions">
          <button class="mini-btn" type="button" data-approve-payment="${escapeHtml(payment.id)}" data-nama="${escapeHtml(payment.employeeName)}" data-nominal="${escapeHtml(money(payment.amountRupiah))}">ACC</button>
          <button class="mini-btn danger" type="button" data-reject-payment="${escapeHtml(payment.id)}">Tolak</button>
        </div>
      </article>`).join('') : '<div class="empty">Tidak ada setoran yang menunggu ACC.</div>';
    document.querySelectorAll('[data-approve-payment]').forEach(button => button.onclick = () => review(button, 'APPROVE'));
    document.querySelectorAll('[data-reject-payment]').forEach(button => button.onclick = () => review(button, 'REJECT'));
  }

  function renderBalances(balances) {
    el('setoranBalanceList').innerHTML = balances.length ? balances.map(row => `
      <article class="master-row">
        <div class="master-main">
          <strong>${escapeHtml(row.employeeName)}</strong>
          <div class="master-meta">${row.receivableCount} setoran laci · total ${money(row.originalAmountRupiah)} · sudah di-ACC ${money(row.paidAmountRupiah)}${row.pendingAmountRupiah ? ` · menunggu ACC ${money(row.pendingAmountRupiah)}` : ''}${row.manualAdjustmentRupiah ? ` · penyesuaian Akuntansi ${row.manualAdjustmentRupiah > 0 ? '+' : '−'}${money(Math.abs(row.manualAdjustmentRupiah))}` : ''}</div>
        </div>
        <span class="status-chip ${row.balanceRupiah > 0 ? 'warn' : 'ok'}">${row.balanceRupiah > 0 ? `Sisa ${money(row.balanceRupiah)}` : row.balanceRupiah < 0 ? `Lebih ${money(-row.balanceRupiah)}` : 'Lunas'}</span>
      </article>`).join('') : '<div class="empty">Belum ada piutang setoran di gerai ini.</div>';
  }

  function renderHistory(history) {
    el('setoranHistoryList').innerHTML = history.length ? history.map(payment => {
      const [label, chip] = STATUS[payment.approvalStatus] || [payment.approvalStatus, ''];
      return `
      <article class="master-row">
        ${foto(payment)}
        <div class="master-main">
          <strong>${escapeHtml(payment.employeeName)} · ${money(payment.amountRupiah)}</strong>
          <div class="master-meta">Setoran laci ${escapeHtml(tanggal(payment.depositDate))} · dikirim ${escapeHtml(dateTime(payment.createdAt))} · diputuskan ${escapeHtml(dateTime(payment.reviewedAt))}${payment.rejectionReason ? ` · alasan: ${escapeHtml(payment.rejectionReason)}` : ''}</div>
        </div>
        <span class="status-chip ${chip}">${escapeHtml(label)}</span>
      </article>`;
    }).join('') : '<div class="empty">Belum ada riwayat setoran.</div>';
  }

  async function loadPhotos() {
    photoUrls.forEach(url => URL.revokeObjectURL(url));
    photoUrls = [];
    await Promise.all([...document.querySelectorAll('#tab-setoran-cs [data-deposit-photo]')].map(async img => {
      try {
        const response = await fetch(`/api/admin/employee-deposits/payments/${encodeURIComponent(img.dataset.depositPhoto)}/photo${storeQuery()}`);
        if (!response.ok) return;
        const url = URL.createObjectURL(await response.blob());
        photoUrls.push(url);
        img.src = url;
        img.onclick = () => window.open(url, '_blank');
      } catch {}
    }));
  }

  async function load() {
    try {
      const payload = await request(`/api/admin/employee-deposits/overview${storeQuery()}`);
      renderPending(payload.pending || []);
      renderBalances(payload.balances || []);
      renderHistory(payload.history || []);
      loadPhotos();
    } catch (error) { toast(error.message); }
  }

  async function review(button, action) {
    const paymentId = action === 'APPROVE' ? button.dataset.approvePayment : button.dataset.rejectPayment;
    let rejectionReason;
    if (action === 'APPROVE') {
      if (!window.confirm(`ACC setoran ${button.dataset.nominal} dari ${button.dataset.nama}?\nPastikan uangnya sudah masuk rekening. Piutang CS langsung berkurang.`)) return;
    } else {
      rejectionReason = window.prompt('Alasan penolakan (wajib, terlihat oleh CS):', '') ?? '';
      if (!rejectionReason.trim()) return toast('Alasan penolakan wajib diisi.');
    }
    button.disabled = true;
    try {
      await request(`/api/admin/employee-deposits/payments/${encodeURIComponent(paymentId)}${storeQuery()}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, rejectionReason })
      });
      toast(action === 'APPROVE' ? 'Setoran di-ACC, piutang CS berkurang.' : 'Setoran ditolak, piutang tidak berubah.');
      await load();
    } catch (error) { toast(error.message); button.disabled = false; }
  }

  mount();
})();
