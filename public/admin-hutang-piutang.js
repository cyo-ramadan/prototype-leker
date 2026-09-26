(() => {
  // Bos Cyo, 2026-09-26: "bikin tombol lagi di sisi admin misal kita kusus
  // pembayaran hutang/piutang ... untuk sementara kita bikin 2 tombol saja,
  // ada kusus pembayaran hutang piutang. dan pembayaran lainnya" + "bikin
  // tombol laporan hutang piutang ... per orangnya" + "data beban2 ya bisa
  // aku track". Empat tombol dalam satu tab. Backend: src/hutang-piutang.js.
  //
  // Pola mount mengikuti admin-operational-expense.js: tombol tab sendiri ke
  // .admin-tabs, section sendiri ke #adminApp, helper global (el/api/toast/
  // switchTab/escapeHtml/rupiah) dari admin.js; ?store= ditempel
  // store-context.js.
  let snapshot = { persons: [], totals: {}, sharedAccounts: [], payments: [], today: '' };
  let activePanel = 'bayar';

  const PANELS = [
    { key: 'bayar', label: '💳 Pembayaran Hutang/Piutang' },
    { key: 'lainnya', label: '🧾 Pembayaran Lainnya' },
    { key: 'laporan', label: '📒 Laporan Hutang Piutang' },
    { key: 'beban', label: '📊 Laporan Beban' }
  ];
  const PARTY_LABEL = { SUPPLIER: 'Supplier', EMPLOYEE: 'Karyawan', OTHER: 'Lainnya' };

  function mount() {
    const tabs = document.querySelector('.admin-tabs');
    const shell = document.getElementById('adminApp');
    if (!tabs || !shell || document.getElementById('tab-hutangpiutang')) return;

    const button = document.createElement('button');
    button.className = 'admin-tab';
    button.dataset.tab = 'hutangpiutang';
    button.type = 'button';
    button.textContent = '💳 Hutang & Pembayaran';
    button.addEventListener('click', () => { switchTab('hutangpiutang'); load().catch(error => toast(error.message)); });
    tabs.appendChild(button);

    shell.insertAdjacentHTML('beforeend', `
      <section id="tab-hutangpiutang" class="admin-section">
        <div class="admin-card" style="margin-bottom:14px">
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${PANELS.map(panel => `<button class="secondary-btn" type="button" style="width:auto;flex:0 0 auto" data-hp-panel="${panel.key}">${panel.label}</button>`).join('')}
          </div>
          <div class="muted" style="margin-top:8px">Hutang dibuat di tab <b>Bea Operasional</b> (dan otomatis dari pembelian kasir yang cara bayarnya ditandai "Jadi Hutang"). Di sini tempat melunasi dan melihat laporannya.</div>
        </div>
        <div id="hpPanelHost"></div>
      </section>`);

    document.querySelectorAll('[data-hp-panel]').forEach(panelButton => {
      panelButton.addEventListener('click', () => {
        activePanel = panelButton.dataset.hpPanel;
        render();
        if (activePanel === 'beban') loadBeban().catch(error => toast(error.message));
      });
    });
  }

  function paymentMethodOptions() {
    return [
      '<option value="KAS">Tunai / Kas Admin</option>',
      '<option value="BANK">Transfer Bank</option>',
      ...(snapshot.sharedAccounts || []).map(account =>
        `<option value="REKBER:${escapeHtml(account.id)}">Rekening Bersama ${escapeHtml(account.name)} (bagian gerai ini ${rupiah(account.storeBalance)})</option>`)
    ].join('');
  }

  function paymentMethodPayload(value) {
    if (String(value).startsWith('REKBER:')) return { paymentMethod: 'REKBER', sharedAccountId: value.slice(7) };
    return { paymentMethod: value };
  }

  function payableAccounts() {
    const rows = [];
    for (const person of snapshot.persons || []) {
      for (const account of person.accounts) {
        if (account.payableByAdmin && account.balanceRupiah > 0) rows.push({ person, account });
      }
    }
    return rows;
  }

  function render() {
    document.querySelectorAll('[data-hp-panel]').forEach(button => {
      button.classList.toggle('primary-btn', button.dataset.hpPanel === activePanel);
      button.classList.toggle('secondary-btn', button.dataset.hpPanel !== activePanel);
    });
    const host = el('hpPanelHost');
    if (!host) return;
    if (activePanel === 'bayar') renderBayar(host);
    else if (activePanel === 'lainnya') renderLainnya(host);
    else if (activePanel === 'laporan') renderLaporan(host);
    else renderBebanShell(host);
  }

  // ---------------------------------------------- Pembayaran Hutang/Piutang
  function renderBayar(host) {
    const accounts = payableAccounts();
    const piutang = [];
    const unlinked = [];
    for (const person of snapshot.persons || []) {
      for (const account of person.accounts) {
        if (account.balanceType === 'RECEIVABLE' && account.balanceRupiah !== 0) piutang.push({ person, account });
        if (account.unlinked && account.balanceRupiah !== 0) unlinked.push({ person, account });
      }
    }
    host.innerHTML = `
      <div class="admin-grid master-layout">
        <form id="hpPayForm" class="admin-card sticky-form">
          <div class="form-title-row"><h2>Pembayaran Hutang/Piutang</h2></div>
          <div class="muted" style="margin-bottom:10px">Pilih hutang siapa yang dibayar. Pelunasan tidak mengubah untung-rugi (bebannya sudah diakui waktu hutang dibuat) -- cuma mengurangi hutang.</div>
          <label class="admin-field">Bayar hutang ke<select id="hpPayAccount" required>
            ${accounts.length ? accounts.map(({ person, account }) =>
              `<option value="${escapeHtml(account.accountKey)}" data-balance="${account.balanceRupiah}">${escapeHtml(person.counterpartyName)} (${PARTY_LABEL[person.counterpartyType] || ''}) · ${escapeHtml(account.label)} · sisa ${rupiah(account.balanceRupiah)}</option>`).join('')
              : '<option value="">Tidak ada hutang terbuka</option>'}
          </select></label>
          <div class="admin-grid two compact">
            <label class="admin-field">Nominal (Rp)<input id="hpPayAmount" type="number" step="1" min="1" required /><span class="field-note">boleh cicil; lebih = kelebihan bayar</span></label>
            <label class="admin-field">Tanggal bayar<input id="hpPayDate" type="date" required value="${escapeHtml(snapshot.today || '')}" /></label>
          </div>
          <label class="admin-field">Cara bayar<select id="hpPayMethod">${paymentMethodOptions()}</select><span class="field-note">Rekening Bersama = saldo bagian gerai ini di rekening itu benar-benar berkurang</span></label>
          <label class="admin-field">Catatan <span class="field-note">opsional</span><input id="hpPayNote" maxlength="300" /></label>
          <button class="primary-btn" type="submit" ${accounts.length ? '' : 'disabled'}>Simpan Pembayaran</button>
        </form>
        <div class="admin-card list-card">
          <div class="list-head"><div><h2>Riwayat pembayaran</h2><div class="muted">Salah input? Batalkan -- semua efeknya dibalik (termasuk Rekening Bersama), jejaknya tetap ada.</div></div><span class="master-count">${(snapshot.payments || []).length}</span></div>
          <div class="master-list">${renderPayments()}</div>
          ${unlinked.length ? `
          <div class="list-head" style="margin-top:18px"><div><h2>Hutang Gaji belum bisa dibayar</h2><div class="muted">Gaji dari presensi akun kasir yang belum ditautkan ke Master Karyawan. Tautkan akunnya ke karyawan di tab Karyawan dulu -- sesudah itu gaji berikutnya otomatis bisa dibayar dari sini.</div></div></div>
          <div class="master-list">${unlinked.map(({ person, account }) => `
            <article class="master-row"><div class="master-main">
              <strong>${escapeHtml(person.counterpartyName)} · ${escapeHtml(account.label)} · ${rupiah(account.balanceRupiah)}</strong>
            </div></article>`).join('')}</div>` : ''}
          ${piutang.length ? `
          <div class="list-head" style="margin-top:18px"><div><h2>Piutang</h2><div class="muted">Piutang setoran laci dilunasi lewat alur setoran (bukti transfer + ACC), bukan dari sini.</div></div></div>
          <div class="master-list">${piutang.map(({ person, account }) => `
            <article class="master-row"><div class="master-main">
              <strong>${escapeHtml(person.counterpartyName)} · ${escapeHtml(account.label)} · ${rupiah(account.balanceRupiah)}</strong>
            </div></article>`).join('')}</div>` : ''}
        </div>
      </div>`;
    const accountSelect = el('hpPayAccount');
    const syncAmount = () => {
      const option = accountSelect.selectedOptions[0];
      if (option?.dataset.balance) el('hpPayAmount').value = option.dataset.balance;
    };
    accountSelect.addEventListener('change', syncAmount);
    syncAmount();
    el('hpPayForm').addEventListener('submit', payHutang);
    bindVoidButtons();
  }

  function renderPayments() {
    const payments = snapshot.payments || [];
    if (!payments.length) return '<div class="empty">Belum ada pembayaran.</div>';
    return payments.map(item => `
      <article class="master-row ${item.voidedAt ? 'inactive' : ''}">
        <div class="master-main">
          <strong>${escapeHtml(item.hutangLabel)}${item.counterpartyName ? ` · ${escapeHtml(item.counterpartyName)}` : ''} · ${rupiah(item.amount)}</strong>
          <span>${escapeHtml(item.businessDate)} · ${escapeHtml(item.paymentMethodLabel || '')}${item.expenseDescription ? ` · ${escapeHtml(item.expenseDescription)}` : ''}</span>
          <small>${item.voidedAt ? `Dibatalkan${item.voidReason ? ` · ${escapeHtml(item.voidReason)}` : ''}` : escapeHtml(item.note || 'Aktif')}</small>
        </div>
        ${item.voidedAt ? '' : `<button class="text-btn" type="button" data-void-payment="${escapeHtml(item.id)}">Batalkan</button>`}
      </article>`).join('');
  }

  function bindVoidButtons() {
    document.querySelectorAll('[data-void-payment]').forEach(button => {
      button.onclick = () => voidPayment(button.dataset.voidPayment);
    });
  }

  async function payHutang(event) {
    event.preventDefault();
    try {
      const payload = await api('/api/admin/hutang-piutang/payments', {
        method: 'POST',
        body: JSON.stringify({
          accountKey: el('hpPayAccount').value,
          amount: Number(el('hpPayAmount').value),
          businessDate: el('hpPayDate').value,
          note: el('hpPayNote').value,
          ...paymentMethodPayload(el('hpPayMethod').value)
        })
      });
      Object.assign(snapshot, { persons: payload.persons, totals: payload.totals, sharedAccounts: payload.sharedAccounts });
      snapshot.payments = [payload.payment, ...(snapshot.payments || [])];
      render();
      toast('Pembayaran hutang tersimpan');
    } catch (error) { toast(error.message); }
  }

  async function voidPayment(id) {
    const reason = prompt('Batalkan pembayaran ini? Tulis alasannya (opsional).', '');
    if (reason === null) return;
    try {
      const payload = await api(`/api/admin/hutang-piutang/payments/${encodeURIComponent(id)}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      Object.assign(snapshot, { persons: payload.persons, totals: payload.totals, sharedAccounts: payload.sharedAccounts });
      snapshot.payments = (snapshot.payments || []).map(item => item.id === id ? payload.payment : item);
      render();
      toast('Pembayaran dibatalkan');
    } catch (error) { toast(error.message); }
  }

  // ---------------------------------------------------- Pembayaran Lainnya
  function renderLainnya(host) {
    const lainnya = (snapshot.payments || []).filter(item => item.kind === 'LAINNYA');
    host.innerHTML = `
      <div class="admin-grid master-layout">
        <form id="hpOtherForm" class="admin-card sticky-form">
          <div class="form-title-row"><h2>Pembayaran Lainnya</h2></div>
          <div class="muted" style="margin-bottom:10px">Beban yang langsung dibayar saat itu juga, tanpa jadi hutang (mis. bayar WiFi langsung lunas). Langsung mengurangi untung di Laporan.</div>
          <label class="admin-field">Jenis<select id="hpOtherCategory"><option value="BEA_LAINNYA">Bea Lainnya</option><option value="BEA_LAPAK">Bea Lapak</option></select></label>
          <label class="admin-field">Keterangan<input id="hpOtherDescription" maxlength="220" required placeholder="Contoh: WiFi September" /></label>
          <label class="admin-field">Dibayar ke <span class="field-note">opsional</span><input id="hpOtherParty" maxlength="200" placeholder="Contoh: Indihome" /></label>
          <div class="admin-grid two compact">
            <label class="admin-field">Nominal (Rp)<input id="hpOtherAmount" type="number" step="1" min="1" required /></label>
            <label class="admin-field">Tanggal<input id="hpOtherDate" type="date" required value="${escapeHtml(snapshot.today || '')}" /></label>
          </div>
          <label class="admin-field">Cara bayar<select id="hpOtherMethod">${paymentMethodOptions()}</select></label>
          <label class="admin-field">Catatan <span class="field-note">opsional</span><input id="hpOtherNote" maxlength="300" /></label>
          <button class="primary-btn" type="submit">Simpan Pembayaran</button>
        </form>
        <div class="admin-card list-card">
          <div class="list-head"><div><h2>Riwayat Pembayaran Lainnya</h2></div><span class="master-count">${lainnya.length}</span></div>
          <div class="master-list">${lainnya.length ? lainnya.map(item => `
            <article class="master-row ${item.voidedAt ? 'inactive' : ''}">
              <div class="master-main">
                <strong>${escapeHtml(item.expenseDescription || 'Pembayaran lainnya')}${item.counterpartyName ? ` · ${escapeHtml(item.counterpartyName)}` : ''} · ${rupiah(item.amount)}</strong>
                <span>${escapeHtml(item.businessDate)} · ${escapeHtml(item.paymentMethodLabel || '')}</span>
                <small>${item.voidedAt ? 'Dibatalkan' : 'Aktif'}</small>
              </div>
              ${item.voidedAt ? '' : `<button class="text-btn" type="button" data-void-payment="${escapeHtml(item.id)}">Batalkan</button>`}
            </article>`).join('') : '<div class="empty">Belum ada.</div>'}</div>
        </div>
      </div>`;
    el('hpOtherForm').addEventListener('submit', payLainnya);
    bindVoidButtons();
  }

  async function payLainnya(event) {
    event.preventDefault();
    try {
      const payload = await api('/api/admin/hutang-piutang/pembayaran-lainnya', {
        method: 'POST',
        body: JSON.stringify({
          category: el('hpOtherCategory').value,
          description: el('hpOtherDescription').value,
          counterpartyName: el('hpOtherParty').value,
          amount: Number(el('hpOtherAmount').value),
          businessDate: el('hpOtherDate').value,
          note: el('hpOtherNote').value,
          ...paymentMethodPayload(el('hpOtherMethod').value)
        })
      });
      snapshot.sharedAccounts = payload.sharedAccounts || snapshot.sharedAccounts;
      snapshot.payments = [payload.payment, ...(snapshot.payments || [])];
      render();
      toast('Pembayaran tersimpan');
    } catch (error) { toast(error.message); }
  }

  // ----------------------------------------------- Laporan Hutang Piutang
  function renderLaporan(host) {
    const persons = snapshot.persons || [];
    const totals = snapshot.totals || {};
    host.innerHTML = `
      <div class="admin-card">
        <div class="list-head"><div><h2>Laporan Hutang Piutang per orang</h2>
          <div class="muted">Total hutang kita: <b>${rupiah(totals.hutangRupiah || 0)}</b> · Total piutang kita: <b>${rupiah(totals.piutangRupiah || 0)}</b>. Saldo minus = kelebihan bayar (pihak itu yang berhutang balik).</div></div>
          <span class="master-count">${persons.length}</span></div>
        <div class="master-list">${persons.length ? persons.map(person => `
          <details class="master-row" style="display:block">
            <summary style="cursor:pointer">
              <strong>${escapeHtml(person.counterpartyName)}</strong> <span class="muted">(${PARTY_LABEL[person.counterpartyType] || ''})</span>
              · Hutang ${rupiah(person.hutangRupiah)}${person.piutangRupiah ? ` · Piutang ${rupiah(person.piutangRupiah)}` : ''}
            </summary>
            ${person.accounts.map(account => `
              <div style="margin:10px 0 0 12px">
                <b>${escapeHtml(account.label)}</b> — dibuat ${rupiah(account.createdRupiah)} · dibayar ${rupiah(account.paidRupiah)} · <b>sisa ${rupiah(account.balanceRupiah)}</b>
                ${account.items.length ? `<ul style="margin:4px 0 0;padding-left:18px">${account.items.map(item => `
                  <li class="muted">${escapeHtml(item.transactionDate)} · ${escapeHtml(item.description || '-')} · ${rupiah(item.originalRupiah)}${item.sourceVoided ? ' (sumber dibatalkan)' : ''} · dibayar ${rupiah(item.paidRupiah)} · sisa ${rupiah(item.balanceRupiah)}</li>`).join('')}</ul>` : ''}
              </div>`).join('')}
          </details>`).join('') : `<div class="empty">Belum ada hutang/piutang di gerai ini.<br><small>Hutang muncul dari: (1) tab Bea Operasional &rarr; Catat Hutang &amp; Beban; (2) pembelian kasir yang cara bayarnya dicentang "Jadi Hutang" di Setting Akuntansi &gt; Metode Pembayaran (pembelian lama ikut ditarik saat dicentang); (3) gaji dari presensi.</small></div>`}</div>
      </div>`;
  }

  // ---------------------------------------------------------- Laporan Beban
  let bebanReport = null;
  function renderBebanShell(host) {
    const today = snapshot.today || '';
    const from = bebanReport?.from || (today ? `${today.slice(0, 8)}01` : '');
    const to = bebanReport?.to || today;
    host.innerHTML = `
      <div class="admin-card">
        <div class="list-head"><div><h2>Laporan Beban</h2><div class="muted">Semua beban yang mengurangi untung, dirinci per baris: dari mana, kategori apa, ke siapa, dibayar/dihutang lewat apa. Untuk dipelajari apa yang masih kurang dari sistem ini.</div></div></div>
        <div class="admin-grid two compact" style="margin-top:10px">
          <label class="admin-field">Dari<input id="hpBebanFrom" type="date" value="${escapeHtml(from)}" /></label>
          <label class="admin-field">Sampai<input id="hpBebanTo" type="date" value="${escapeHtml(to)}" /></label>
        </div>
        <button id="hpBebanLoad" class="secondary-btn" type="button">Tampilkan</button>
        <div id="hpBebanBody" style="margin-top:14px">${bebanReport ? bebanBody(bebanReport) : '<div class="muted">Memuat…</div>'}</div>
      </div>`;
    el('hpBebanLoad').addEventListener('click', () => loadBeban(el('hpBebanFrom').value, el('hpBebanTo').value).catch(error => toast(error.message)));
  }

  function bebanBody(report) {
    return `
      <div class="muted">Total ${escapeHtml(report.from)} s/d ${escapeHtml(report.to)}: <b>${rupiah(report.total)}</b></div>
      <div class="admin-grid two compact" style="margin-top:10px">
        <div><h3 style="margin:0 0 6px">Per kategori</h3>${report.byCategory.map(row => `<div>${escapeHtml(row.category)} · ${row.count}x · <b>${rupiah(row.total)}</b></div>`).join('') || '<div class="muted">-</div>'}</div>
        <div><h3 style="margin:0 0 6px">Per sumber</h3>${report.bySource.map(row => `<div>${escapeHtml(row.sourceLabel)} · ${row.count}x · <b>${rupiah(row.total)}</b></div>`).join('') || '<div class="muted">-</div>'}</div>
      </div>
      <div style="overflow-x:auto;margin-top:14px">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="text-align:left;border-bottom:1px solid var(--line)"><th>Tanggal</th><th>Sumber</th><th>Kategori</th><th>Keterangan</th><th>Pihak</th><th style="text-align:right">Nominal</th><th>Status</th></tr></thead>
          <tbody>${report.rows.map(row => `
            <tr style="border-bottom:1px solid var(--line)">
              <td>${escapeHtml(row.businessDate)}</td><td>${escapeHtml(row.sourceLabel)}</td><td>${escapeHtml(row.category)}</td>
              <td>${escapeHtml(row.description || '')}</td><td>${escapeHtml(row.party || '')}</td>
              <td style="text-align:right">${rupiah(row.amount)}</td><td>${escapeHtml(row.status || '')}</td>
            </tr>`).join('') || '<tr><td colspan="7" class="muted">Belum ada beban di rentang ini.</td></tr>'}</tbody>
        </table>
      </div>`;
  }

  async function loadBeban(from, to) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    bebanReport = await api(`/api/admin/laporan-beban${params.toString() ? `?${params}` : ''}`);
    const body = el('hpBebanBody');
    if (body) body.innerHTML = bebanBody(bebanReport);
  }

  async function load() {
    snapshot = await api('/api/admin/hutang-piutang');
    render();
    if (activePanel === 'beban') await loadBeban();
  }

  mount();
})();
