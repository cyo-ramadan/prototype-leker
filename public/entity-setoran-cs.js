// Setoran CS menunggu ACC -- sisi Entity Admin (Bos Cyo, 2026-10-07): "kalo dari sisi entity ketika
// tombol di klik maka keluarin semua list yang perlu di acc dari setor uang tersebut. yang akan di
// cek admin adalah jumlah nominal transfer, waktu persisnya jam:menit, dan foto bukti transfer."
// Daftar semua gerai di entity ini; ACC/Tolak memakai route per-gerai yang sama dengan Admin Gerai
// (/api/admin/employee-deposits/payments/:id?store=KODE) -- hasil ACC identik (jurnal, Rekening
// Bersama, piutang CS). Data dimuat saat tab dibuka atau tombol ditekan, bukan polling.
(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  const money = value => `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(value) || 0)}`;
  const waktu = value => value
    ? `${new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta' }).format(new Date(value))} WIB`
    : '';
  const tanggal = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(`${String(value).slice(0, 10)}T00:00:00`)) : '';
  let photoUrls = [];

  // Waktu transfer menurut bukti + asalnya (migration 0142), dan peringatan bila nominal yang terbaca
  // dari foto beda dengan nominal yang diketik CS.
  function buktiInfo(payment) {
    const read = payment.proofRead || {};
    const jam = payment.transferAt
      ? `<b>Transfer ${esc(waktu(payment.transferAt))}</b> <span class="status-chip ${payment.transferAtSource === 'OTOMATIS' ? 'ok' : 'warn'}">${payment.transferAtSource === 'OTOMATIS' ? 'terbaca otomatis' : 'diisi manual'}</span>`
      : '<span class="muted">Waktu transfer tidak diisi (kiriman lama)</span>';
    const nominalBeda = read.nominalRupiah && Number(read.nominalRupiah) !== Number(payment.amountRupiah)
      ? ` <span class="status-chip bad">Nominal di foto ${money(read.nominalRupiah)}</span>` : '';
    const detail = [read.bank, read.referensi ? `ref ${read.referensi}` : '', read.penerima ? `ke ${read.penerima}` : ''].filter(Boolean).map(esc).join(' · ');
    return `<div class="master-meta">${jam}${nominalBeda}</div>${detail ? `<div class="master-meta">${detail}</div>` : ''}`;
  }

  function tokenHeader() {
    const token = (typeof entityAdminState !== 'undefined' && entityAdminState.token) || localStorage.getItem('lekerEntityAdminToken') || '';
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function setBadge(count) {
    const button = document.querySelector('[data-entity-tab="setorancs"]');
    if (button) button.textContent = `💵 Setoran CS${count ? ` ${count}` : ''}`;
  }

  async function fetchQueue() {
    return entityAdminApi('/api/entity-admin/employee-deposits/pending');
  }

  async function loadPhotos() {
    photoUrls.forEach(url => URL.revokeObjectURL(url));
    photoUrls = [];
    await Promise.all([...document.querySelectorAll('#entitySetoranCsList [data-deposit-photo]')].map(async img => {
      try {
        const response = await fetch(`/api/admin/employee-deposits/payments/${encodeURIComponent(img.dataset.depositPhoto)}/photo?store=${encodeURIComponent(img.dataset.store)}`, { headers: tokenHeader() });
        if (!response.ok) return;
        const url = URL.createObjectURL(await response.blob());
        photoUrls.push(url);
        img.src = url;
        img.onclick = () => window.MAXIFotoLihat ? window.MAXIFotoLihat.buka(url, 'Foto bukti transfer') : window.open(url, '_blank');
      } catch {}
    }));
  }

  function render(payments) {
    el('entitySetoranCsCount').textContent = payments.length;
    setBadge(payments.length);
    el('entitySetoranCsList').innerHTML = payments.length ? payments.map(payment => `
      <article class="master-row">
        ${payment.hasPhoto
          ? `<img data-deposit-photo="${esc(payment.id)}" data-store="${esc(payment.storeCode)}" alt="Foto bukti transfer" loading="lazy" style="width:84px;height:84px;object-fit:cover;border-radius:10px;border:1px solid var(--line, #e5ddd3);cursor:zoom-in;background:var(--soft, #f4efe9)" />`
          : '<span class="status-chip warn">Tanpa foto</span>'}
        <div class="master-main">
          <strong style="font-size:1.15em">${esc(money(payment.amountRupiah))}</strong> <span class="muted">· ${esc(payment.employeeName)} · ${esc(payment.storeCode)}</span>
          ${buktiInfo(payment)}
          <div class="master-meta">Dikirim ${esc(waktu(payment.createdAt))}</div>
          <div class="master-meta">Setoran laci ${esc(tanggal(payment.depositDate))}${payment.sharedAccountName ? ` · ke ${esc(payment.sharedAccountName)}` : ' · ke Kas'}${payment.proofReference ? ` · ${esc(payment.proofReference)}` : ''}</div>
        </div>
        <div class="master-actions">
          <button class="mini-btn" type="button" data-approve="${esc(payment.id)}" data-store="${esc(payment.storeCode)}" data-info="${esc(`${money(payment.amountRupiah)} dari ${payment.employeeName} (${payment.storeCode}), transfer ${waktu(payment.transferAt || payment.createdAt)}`)}">ACC</button>
          <button class="mini-btn danger" type="button" data-reject="${esc(payment.id)}" data-store="${esc(payment.storeCode)}">Tolak</button>
        </div>
      </article>`).join('') : '<div class="empty">Tidak ada setoran yang menunggu ACC di gerai mana pun.</div>';
    document.querySelectorAll('#entitySetoranCsList [data-approve]').forEach(button => { button.onclick = () => review(button, 'APPROVE'); });
    document.querySelectorAll('#entitySetoranCsList [data-reject]').forEach(button => { button.onclick = () => review(button, 'REJECT'); });
    loadPhotos();
  }

  async function review(button, action) {
    const paymentId = action === 'APPROVE' ? button.dataset.approve : button.dataset.reject;
    let rejectionReason;
    if (action === 'APPROVE') {
      if (!window.confirm(`ACC setoran ${button.dataset.info}?\nPastikan nominal, jam:menit, dan foto cocok dengan mutasi rekening. Piutang CS langsung berkurang.`)) return;
    } else {
      rejectionReason = window.prompt('Alasan penolakan (wajib, terlihat oleh CS):', '') ?? '';
      if (!rejectionReason.trim()) return entityAdminToast('Alasan penolakan wajib diisi.');
    }
    button.disabled = true;
    try {
      await entityAdminApi(`/api/admin/employee-deposits/payments/${encodeURIComponent(paymentId)}?store=${encodeURIComponent(button.dataset.store)}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, rejectionReason })
      });
      entityAdminToast(action === 'APPROVE' ? 'Setoran di-ACC, piutang CS berkurang.' : 'Setoran ditolak, piutang tidak berubah.');
      await load();
    } catch (error) { entityAdminToast(error.message); button.disabled = false; }
  }

  async function load() {
    try {
      render((await fetchQueue()).payments || []);
    } catch (error) { entityAdminToast(error.message); }
  }

  // Jumlah antrean untuk lencana pada tombol tab: dimuat saat panel dibuka dan saat tab browser
  // kembali aktif, tanpa timer berulang (invariant #6).
  async function refreshBadge() {
    try {
      if (!(typeof entityAdminState !== 'undefined' && entityAdminState.token)) return;
      setBadge(((await fetchQueue()).payments || []).length);
    } catch {}
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshBadge(); });
  el('entitySetoranCsRefresh')?.addEventListener('click', load);
  window.loadEntitySetoranCs = load;
  window.refreshEntitySetoranBadge = refreshBadge;
  refreshBadge();
})();
