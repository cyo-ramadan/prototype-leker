// Izin CS menunggu ACC -- sisi Entity Admin (Bos Cyo, 2026-10-12: "kasih tombol acc dari permit yang
// diminta cs di entity admin"). Satu daftar untuk semua gerai di entity ini, empat jenis izin yang
// diajukan CS: koreksi jam masuk, titik GPS presensi, tutup laci, dan hapus transaksi. ACC/Tolak
// memakai route per-gerai yang sama dengan Admin Gerai (?store=KODE) -- backend sudah menerima
// Entity Admin dan memeriksa gerainya milik entity ini, jadi hasilnya identik dengan ACC Admin Gerai.
// Data dimuat saat tab dibuka atau tombol ditekan, bukan polling (invariant #6).
(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  const money = value => `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(value) || 0)}`;
  const waktu = value => value
    ? `${new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta' }).format(new Date(value))} WIB`
    : '-';
  const SUBJECT_LABEL = { SALE: 'Penjualan', PURCHASE: 'Pembelian Bahan', EXPENSE: 'Pengeluaran Operasional' };

  // Satu baris per jenis izin: route daftar, route keputusan, cara menggambar kartunya.
  const jam = value => value ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '';
  const JENIS = [
    // Revisi jam presensi (2026-10-17): ACC apa adanya, Edit lalu ACC, atau Tolak. ACC = gaji, potongan
    // dana apresiasi, dan jurnalnya dihitung ulang otomatis (jurnal pembalik + jurnal revisi).
    {
      kind: 'revisi',
      bisaEdit: true,
      list: '/api/admin/attendance-revisions?status=PENDING',
      decide: id => `/api/admin/attendance-revisions/${encodeURIComponent(id)}`,
      rows: payload => payload.permits || [],
      judul: permit => permit.attendanceId ? 'Revisi jam presensi' : 'Lupa presensi (sesi baru)',
      orang: permit => permit.requestedByName,
      diajukan: permit => permit.createdAt,
      isi: permit => `${esc(permit.businessDate)} · tercatat <b>${permit.originalCheckInAt ? esc(`${jam(permit.originalCheckInAt)}–${jam(permit.originalCheckOutAt) || 'belum pulang'}`) : 'tidak ada presensi'}</b> → minta <b>${esc(`${jam(permit.requestedCheckInAt)}${permit.requestedCheckOutAt ? `–${jam(permit.requestedCheckOutAt)}` : ''}`)}</b>`,
      alasan: permit => permit.reason,
      body: (decision, note, extra = {}) => ({ decision, note, ...extra })
    },
    {
      kind: 'koreksi',
      list: '/api/admin/attendance-correction-permits?status=PENDING',
      decide: id => `/api/admin/attendance-correction-permits/${encodeURIComponent(id)}`,
      rows: payload => payload.permits || [],
      judul: () => 'Koreksi jam masuk',
      orang: permit => permit.requestedByName,
      diajukan: permit => permit.createdAt,
      isi: permit => `Jam masuk tercatat <b>${esc(waktu(permit.originalCheckInAt))}</b> → minta jadi <b>${esc(waktu(permit.requestedCheckInAt))}</b>`,
      alasan: permit => permit.reason,
      body: (decision, note) => ({ decision, note })
    },
    {
      kind: 'gps',
      list: '/api/admin/attendance-gps-permits?status=PENDING',
      decide: id => `/api/admin/attendance-gps-permits/${encodeURIComponent(id)}`,
      rows: payload => payload.permits || [],
      judul: permit => `Titik GPS presensi ${permit.which === 'OUT' ? 'pulang' : 'datang'}`,
      orang: permit => permit.requestedByName,
      diajukan: permit => permit.createdAt,
      isi: permit => `Presensi ${esc(waktu(permit.attendanceAt))} · ${permit.originalStatus === 'OUT_OF_RADIUS'
        ? `di luar radius${permit.overRadiusMeters != null ? ` ${esc(permit.overRadiusMeters)} m` : ''}`
        : 'lokasi tidak terbaca'}`,
      alasan: permit => permit.reason,
      body: (decision, note) => ({ decision, note })
    },
    {
      kind: 'laci',
      list: '/api/admin/drawer/close-permits?status=PENDING',
      decide: id => `/api/admin/drawer/close-permits/${encodeURIComponent(id)}`,
      rows: payload => payload.permits || [],
      judul: () => 'Tutup laci',
      orang: permit => permit.requestedByCashierName + (permit.targetCashierName && permit.targetCashierName !== permit.requestedByCashierName ? ` (laci ${permit.targetCashierName})` : ''),
      diajukan: permit => permit.createdAt,
      isi: permit => `Uang di laci <b>${esc(money(permit.closingAmount))}</b> · disetor <b>${esc(money(permit.depositAmount))}</b>${permit.closingNote ? ` · ${esc(permit.closingNote)}` : ''}`,
      alasan: permit => permit.reason,
      body: (decision, note) => ({ decision, note })
    },
    {
      kind: 'hapus',
      list: '/api/management/transaction-void-permits?status=pending_approval',
      decide: id => `/api/management/transaction-void-permits/${encodeURIComponent(id)}`,
      rows: payload => payload.permits || [],
      judul: permit => `${permit.correctionKind === 'AMOUNT' ? 'Ganti pembelian' : 'Hapus transaksi'} · ${SUBJECT_LABEL[permit.subjectType] || permit.subjectType}`,
      orang: permit => permit.cashierName || permit.cashierId,
      diajukan: permit => permit.requestedAt,
      isi: permit => isiTransaksi(permit),
      alasan: permit => permit.reason,
      body: (decision, note) => ({ decision, note })
    },
    // Hapus Arus Kas yang diajukan CS (2026-10-22): ACC = Arus Kas tidak dihitung lagi di laci + jurnal dibalik.
    {
      kind: 'aruskas',
      list: '/api/management/cash-flow-void-permits?status=pending_approval',
      decide: id => `/api/management/cash-flow-void-permits/${encodeURIComponent(id)}`,
      rows: payload => payload.permits || [],
      judul: () => 'Hapus Arus Kas',
      orang: permit => permit.cashierName || permit.cashierId,
      diajukan: permit => permit.requestedAt,
      isi: permit => `<b>${esc(permit.subject?.description || 'Arus Kas')}</b> · ${permit.subject?.direction === 'OUT' ? 'keluar' : 'masuk'} ${esc(money(permit.subject?.amount))}${permit.subject?.counterpart ? ` · lawan ${esc(permit.subject.counterpart)}` : ''}`,
      alasan: permit => permit.reason,
      body: (decision, note) => ({ decision, note })
    },
    // ACC yang tertahan (Kaliurang, 2026-10-21: "sudah di-ACC tapi di laci masih ada"). Tidak ada ACC/Tolak
    // lagi: yang tertahan di eksekusi bisa dicoba lagi sesudah penyebabnya dibereskan (mis. stok
    // disesuaikan); yang tertahan di hitung ulang HPP cukup dibaca alasannya.
    {
      kind: 'tertahan',
      list: '/api/management/transaction-void-permits?status=approved',
      decide: id => `/api/management/transaction-void-permits/${encodeURIComponent(id)}`,
      rows: payload => (payload.permits || []).filter(permit => permit.executionStatus === 'HOLD' || permit.executionStatus === 'FAILED' || permit.hppReplayStatus === 'TERTAHAN'),
      judul: permit => `ACC tertahan · ${permit.correctionKind === 'AMOUNT' ? 'ganti pembelian' : 'hapus'} ${(SUBJECT_LABEL[permit.subjectType] || permit.subjectType).toLowerCase()}`,
      orang: permit => permit.cashierName || permit.cashierId,
      diajukan: permit => permit.decidedAt || permit.requestedAt,
      isi: permit => `${isiTransaksi(permit)}<br><b>Kenapa tertahan:</b> ${esc(permit.executionStatus === 'EXECUTED' ? `uang laci, stok, dan jurnal sudah beres; hitung ulang HPP perlu dicek manual: ${permit.hppReplayDetail}` : permit.executionDetail || permit.executionCode)}`,
      alasan: permit => permit.reason,
      tombol: (permit, storeCode) => permit.executionStatus === 'EXECUTED'
        ? ''
        : `<button class="mini-btn" type="button" data-izin-retry="${esc(permit.id)}" data-kind="tertahan" data-store="${esc(storeCode)}">Coba lagi</button>`,
      body: () => ({ decision: 'RETRY_EXECUTION' })
    }
  ];

  function isiTransaksi(permit) {
    const asal = `<b>${esc(permit.subject?.description || permit.subjectId)}</b> · ${esc(money(permit.subject?.amount))}${permit.subject?.paymentMethod ? ` · ${esc(permit.subject.paymentMethod)}` : ''}`;
    if (permit.correctionKind !== 'AMOUNT') return asal;
    const baru = (permit.requestedLines || []).reduce((sum, line) => sum + Number(line.lineTotal || 0), 0);
    const rincian = (permit.subject?.items || []).map(item => {
      const line = (permit.requestedLines || []).find(row => Number(row.productId) === Number(item.productId));
      const qty = line?.quantity == null ? item.quantity : line.quantity;
      return `${esc(item.productName)}: ${esc(item.quantity)} ${esc(item.unitSymbol)} ${esc(money(item.lineTotal))} → <b>${esc(qty)} ${esc(item.unitSymbol)} ${esc(money(line?.lineTotal))}</b>`;
    }).join(' · ');
    const bayar = permit.requestedPaymentMethod && permit.requestedPaymentMethod !== permit.subject?.paymentMethod
      ? ` · cara bayar ${esc(permit.subject?.paymentMethod || '')} → <b>${esc(permit.requestedPaymentMethod)}</b>` : '';
    return `${asal} → diganti <b>${esc(money(baru))}</b>${bayar}${rincian ? `<br>${rincian}` : ''}`;
  }
  const byKind = new Map(JENIS.map(jenis => [jenis.kind, jenis]));

  function stores() {
    return (typeof entityAdminState !== 'undefined' ? entityAdminState.stores : []) || [];
  }

  function setBadge(count) {
    const button = document.querySelector('[data-entity-tab="izincs"]');
    if (button) button.textContent = `🔐 Izin CS${count ? ` ${count}` : ''}`;
  }

  // Semua izin PENDING dari semua gerai; satu gerai/jenis yang gagal dimuat tidak menghentikan yang lain.
  async function fetchQueue() {
    const items = [];
    const errors = [];
    await Promise.all(stores().flatMap(store => JENIS.map(async jenis => {
      try {
        const separator = jenis.list.includes('?') ? '&' : '?';
        const payload = await entityAdminApi(`${jenis.list}${separator}store=${encodeURIComponent(store.code)}`);
        for (const permit of jenis.rows(payload)) items.push({ jenis, permit, storeCode: store.code });
      } catch (error) {
        errors.push(`${store.code} · ${jenis.judul({})}: ${error.message}`);
      }
    })));
    items.sort((a, b) => String(a.jenis.diajukan(a.permit) || '').localeCompare(String(b.jenis.diajukan(b.permit) || '')));
    return { items, errors };
  }

  function render({ items, errors }) {
    el('entityIzinCsCount').textContent = items.length;
    setBadge(items.length);
    const warning = errors.length ? `<div class="admin-tip" style="margin-bottom:10px">Sebagian izin belum dapat dimuat: ${esc(errors.join(' · '))}</div>` : '';
    el('entityIzinCsList').innerHTML = warning + (items.length ? items.map(({ jenis, permit, storeCode }) => `
      <article class="master-row">
        <div class="master-main">
          <strong>${esc(jenis.judul(permit))}</strong> <span class="muted">· ${esc(jenis.orang(permit) || '-')} · ${esc(storeCode)}</span>
          <div class="master-meta">${jenis.isi(permit)}</div>
          <div class="master-meta"><b>Alasan CS:</b> ${esc(jenis.alasan(permit) || '-')}</div>
          <div class="master-meta">Diajukan ${esc(waktu(jenis.diajukan(permit)))}</div>
        </div>
        <div class="master-actions">
          ${jenis.tombol ? jenis.tombol(permit, storeCode) : `${jenis.bisaEdit ? `<button class="mini-btn" type="button" data-izin-edit="${esc(permit.id)}" data-kind="${esc(jenis.kind)}" data-store="${esc(storeCode)}" data-in="${esc(jam(permit.requestedCheckInAt))}" data-out="${esc(jam(permit.requestedCheckOutAt))}">Edit lalu ACC</button>` : ''}
          <button class="mini-btn" type="button" data-izin-acc="${esc(permit.id)}" data-kind="${esc(jenis.kind)}" data-store="${esc(storeCode)}" data-info="${esc(`${jenis.judul(permit)} dari ${jenis.orang(permit) || '-'} (${storeCode})`)}">ACC</button>
          <button class="mini-btn danger" type="button" data-izin-reject="${esc(permit.id)}" data-kind="${esc(jenis.kind)}" data-store="${esc(storeCode)}">Tolak</button>`}
        </div>
      </article>`).join('') : '<div class="empty">Tidak ada izin CS yang menunggu ACC di gerai mana pun.</div>');
    document.querySelectorAll('#entityIzinCsList [data-izin-acc]').forEach(button => { button.onclick = () => decide(button, 'ACC'); });
    document.querySelectorAll('#entityIzinCsList [data-izin-reject]').forEach(button => { button.onclick = () => decide(button, 'REJECT'); });
    document.querySelectorAll('#entityIzinCsList [data-izin-edit]').forEach(button => { button.onclick = () => decide(button, 'EDIT'); });
    document.querySelectorAll('#entityIzinCsList [data-izin-retry]').forEach(button => { button.onclick = () => decide(button, 'RETRY'); });
  }

  async function decide(button, decisionInput) {
    let decision = decisionInput;
    const jenis = byKind.get(button.dataset.kind);
    const permitId = decision === 'ACC' ? button.dataset.izinAcc : decision === 'EDIT' ? button.dataset.izinEdit : decision === 'RETRY' ? button.dataset.izinRetry : button.dataset.izinReject;
    let note = '';
    let extra = {};
    if (decision === 'EDIT') {
      const checkIn = (window.prompt('Jam datang yang di-ACC (JJ:MM):', button.dataset.in) ?? '').trim();
      if (!checkIn) return;
      const checkOut = button.dataset.out ? (window.prompt('Jam pulang yang di-ACC (JJ:MM):', button.dataset.out) ?? '').trim() : '';
      if (button.dataset.out && !checkOut) return;
      note = (window.prompt('Catatan untuk CS (opsional):', 'Jam disesuaikan kebijakan') ?? '').trim();
      extra = { checkIn, checkOut };
      decision = 'ACC';
    } else if (decision === 'RETRY') {
      if (!window.confirm('Coba jalankan lagi izin yang tertahan ini?')) return;
    } else if (decision === 'ACC') {
      if (!window.confirm(`ACC ${button.dataset.info}?`)) return;
    } else {
      note = (window.prompt('Alasan penolakan (wajib, terlihat oleh CS):', '') ?? '').trim();
      if (note.length < 3) return entityAdminToast('Alasan penolakan wajib diisi.');
    }
    button.disabled = true;
    try {
      const result = await entityAdminApi(`${jenis.decide(permitId)}?store=${encodeURIComponent(button.dataset.store)}`, {
        method: 'PATCH',
        body: JSON.stringify(jenis.body(decision, note, extra))
      });
      entityAdminToast(decision === 'REJECT'
        ? 'Izin ditolak.'
        : result.executed === false && result.message ? `${decision === 'RETRY' ? 'Masih tertahan' : 'Izin di-ACC, tapi TERTAHAN'}: ${result.message} (lihat bagian ACC tertahan)`
          : result.hppMenunggu ? 'Izin di-ACC. Uang laci, stok, dan jurnal sudah beres; HPP bahannya dihitung ulang otomatis malam ini (23.00–07.00).'
          : decision === 'RETRY' ? 'Berhasil dijalankan.' : 'Izin di-ACC.');
      await load();
    } catch (error) { entityAdminToast(error.message); button.disabled = false; await load(); }
  }

  async function load() {
    const list = el('entityIzinCsList');
    if (list) list.textContent = 'Memuat izin…';
    el('entityIzinCsCount').textContent = '—';
    try {
      render(await fetchQueue());
      return true;
    } catch (error) {
      if (list) list.textContent = `Izin belum dapat dimuat: ${error.message}`;
      entityAdminToast(error.message);
      return false;
    }
  }

  async function refreshBadge() {
    try {
      if (!(typeof entityAdminState !== 'undefined' && entityAdminState.token) || !stores().length) return;
      setBadge((await fetchQueue()).items.length);
    } catch {}
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshBadge(); });
  el('entityIzinCsRefresh')?.addEventListener('click', load);
  window.loadEntityIzinCs = load;
  window.refreshEntityIzinBadge = refreshBadge;
})();
