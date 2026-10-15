// Entity Admin -> Pengaturan -> Dana Apresiasi & Denda CS (Bos Cyo, 2026-10-15, ADR-058).
// Saklar bawaan entity + override per gerai, angka, jam operasional, status akun CS asli/freelance,
// peringatan jam bolong, rekap harian (apresiasi masuk vs keluar harus 0), koreksi "menggantikan
// siapa", dan tombol Penyesuaian (alasan syar'i; bawaan membalik penuh, nominal bisa diubah).
// Dimuat saat tab Pengaturan dibuka atau tombol ditekan, tanpa polling (invariant #6).
(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  const num = value => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.abs(Number(value) || 0));
  const signed = value => `${Number(value) < 0 ? '−' : '+'}Rp${num(value)}`;
  const api = (path, options) => entityAdminApi(`/api/entity-admin/dana-apresiasi${path}`, options);
  const toast = message => entityAdminToast(message);
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const jam = iso => new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta' }).format(new Date(iso));
  let data = null;

  const numberField = (name, label, value, placeholder) => `<label class="admin-field">${esc(label)}<input class="text-input" name="${name}" type="number" min="0" step="1" value="${value ?? ''}" placeholder="${esc(placeholder ?? '')}" /></label>`;

  function enabledSelect(value, allowInherit) {
    const options = [
      ...(allowInherit ? [['', 'Ikut bawaan entity']] : []),
      ['1', 'ON (aktif)'],
      ['0', 'OFF (tanpa potongan/denda)']
    ];
    const current = value === null || value === undefined ? '' : (value ? '1' : '0');
    return `<label class="admin-field">Mekanisme<select class="text-input" name="enabled">${options.map(([v, label]) => `<option value="${v}" ${v === current ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
  }

  function render() {
    const host = el('entityDanaApresiasi');
    if (!host || !data) return;
    const entity = data.entity;
    host.innerHTML = `
      <div class="list-head"><div><h2 style="margin:0">Dana Apresiasi &amp; Denda CS</h2>
        <div class="muted">CS asli yang tidak menjaga jam shift-nya membayar apresiasi per jam: jam yang dijaga backup diteruskan ke backup (akun penampung 2105, saldo harus 0), jam kosong dan denda masuk Pendapatan Lainnya. Perusahaan hanya terbeban tarif dasar. Dihitung satu jam setelah jam pulang shift, mulai tanggal "Mulai dihitung". Telat 1 menit pun dihitung, jadi pastikan jadwal shift &amp; hari libur tiap CS asli sudah benar.</div></div>
        <button class="secondary-btn" type="button" data-apr-rekap>Rekap &amp; penyesuaian</button></div>
      <form class="admin-card" data-apr-form="" style="margin:10px 0">
        <h3 style="margin-top:0">Bawaan entity</h3>
        <div class="form-grid">${enabledSelect(entity.enabled, false)}
          ${numberField('ratePerHourRupiah', 'Apresiasi per jam (Rp)', entity.ratePerHourRupiah)}
          ${numberField('dendaPenuhRupiah', 'Denda shift kosong penuh (Rp)', entity.dendaPenuhRupiah)}
          ${numberField('dendaSebagianRupiah', 'Denda shift kosong sebagian (Rp)', entity.dendaSebagianRupiah)}
          <label class="admin-field">Mulai dihitung<input class="text-input" name="mulaiTanggal" type="date" min="${esc(data.palingAwal || '')}" value="${esc(entity.savedMulai || entity.mulaiTanggal || '')}" /></label></div>
        <button class="primary-btn" type="submit">Simpan bawaan</button>
      </form>
      <div class="master-list">${data.stores.map(store => storeCard(store)).join('')}</div>`;
    host.querySelector('[data-apr-rekap]').onclick = () => openRekap();
    host.querySelectorAll('[data-apr-form]').forEach(form => {
      form.onsubmit = async event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form));
        const body = { storeId: form.dataset.aprForm, ...values, enabled: values.enabled === '' ? null : values.enabled === '1' };
        try { await api('/settings', { method: 'POST', body: JSON.stringify(body) }); toast('Pengaturan dana apresiasi disimpan.'); await load(); } catch (error) { toast(error.message); }
      };
    });
    host.querySelectorAll('[data-apr-status]').forEach(select => {
      select.onchange = async () => {
        try { await api('/status', { method: 'POST', body: JSON.stringify({ accountId: select.dataset.aprStatus, status: select.value }) }); toast('Status akun disimpan.'); await load(); } catch (error) { toast(error.message); }
      };
    });
  }

  function storeCard(store) {
    const o = store.override || {};
    const e = store.effective;
    const accounts = store.accounts.map(account => `
      <div class="master-row"><div class="master-main"><strong>${esc(account.username)}</strong>
        <div class="master-meta">${account.hourlyWageRupiah != null ? `Rp${num(account.hourlyWageRupiah)}/jam · ` : ''}${esc(account.schedule || 'jadwal belum diatur')}</div></div>
        <select class="text-input" data-apr-status="${esc(account.id)}" style="max-width:160px">
          <option value="ASLI" ${account.status === 'ASLI' ? 'selected' : ''}>CS asli</option>
          <option value="FREELANCE" ${account.status === 'FREELANCE' ? 'selected' : ''}>Freelance</option>
        </select></div>`).join('') || '<div class="empty">Belum ada akun kasir aktif.</div>';
    return `
      <details class="admin-card" style="margin-bottom:10px">
        <summary><strong>${esc(store.storeCode)}</strong> · ${e.enabled ? '<span class="status-chip ok">ON</span>' : '<span class="status-chip off">OFF</span>'}
          ${e.enabled ? ` · mulai ${esc(e.since)}` : ''}${e.jamBuka ? ` · buka ${esc(e.jamBuka)}-${esc(e.jamTutup)}` : ' · jam operasional belum diisi'}
          ${store.warnings.length ? ` · <span class="status-chip warn">${store.warnings.length} peringatan</span>` : ''}</summary>
        ${store.warnings.length ? `<div class="admin-tip" style="margin:8px 0">${store.warnings.map(w => `⚠ ${esc(w)}`).join('<br>')}</div>` : ''}
        <form data-apr-form="${esc(store.storeId)}" style="margin:8px 0">
          <div class="form-grid">${enabledSelect(o.enabled ?? null, true)}
            <label class="admin-field">Jam buka<input class="text-input" name="jamBuka" type="time" value="${esc(o.jamBuka || '')}" /></label>
            <label class="admin-field">Jam tutup<input class="text-input" name="jamTutup" type="time" value="${esc(o.jamTutup || '')}" /></label>
            ${numberField('ratePerHourRupiah', 'Apresiasi per jam (Rp)', o.ratePerHourRupiah, `ikut bawaan: ${num(e.ratePerHourRupiah)}`)}
            ${numberField('dendaPenuhRupiah', 'Denda kosong penuh (Rp)', o.dendaPenuhRupiah, `ikut bawaan: ${num(e.dendaPenuhRupiah)}`)}
            ${numberField('dendaSebagianRupiah', 'Denda kosong sebagian (Rp)', o.dendaSebagianRupiah, `ikut bawaan: ${num(e.dendaSebagianRupiah)}`)}
            <label class="admin-field">Mulai dihitung<input class="text-input" name="mulaiTanggal" type="date" value="${esc(o.mulaiTanggal || '')}" /></label></div>
          <span class="field-note">Kosongkan angka/tanggal untuk ikut bawaan entity.</span>
          <button class="primary-btn" type="submit">Simpan gerai ${esc(store.storeCode)}</button>
        </form>
        <h4 style="margin:10px 0 4px">Status akun</h4>
        <div class="master-list">${accounts}</div>
      </details>`;
  }

  async function load() {
    const host = el('entityDanaApresiasi');
    if (!host) return;
    try { data = await api('/settings'); render(); } catch (error) { host.innerHTML = `<div class="staff-message">${esc(error.message)}</div>`; }
  }

  // --- Rekap & penyesuaian --------------------------------------------------

  function dialog() {
    let node = el('entityDanaApresiasiDialog');
    if (node) return node;
    node = document.createElement('dialog');
    node.id = 'entityDanaApresiasiDialog';
    node.className = 'admin-card';
    node.style.cssText = 'width:min(900px,calc(100vw - 28px));max-height:88vh;overflow:auto;padding:18px;border:1px solid var(--line)';
    document.body.appendChild(node);
    return node;
  }

  const KIND_LABEL = { POTONG_BACKUP: 'Potongan (dijaga backup)', POTONG_KOSONG: 'Potongan (kosong)', DENDA: 'Denda', FEE_BACKUP: 'Apresiasi backup', PENYESUAIAN: 'Penyesuaian' };

  async function openRekap(range) {
    const node = dialog();
    if (!node.open) node.showModal();
    const from = range?.from || `${today().slice(0, 8)}01`;
    const to = range?.to || today();
    node.innerHTML = '<div class="muted">Memuat rekap…</div>';
    let rekap;
    try { rekap = await api(`/rekap?from=${from}&to=${to}`); } catch (error) { node.innerHTML = `<div class="staff-message">${esc(error.message)}</div><span class="secondary-btn" data-apr-close>Tutup</span>`; node.querySelector('[data-apr-close]').onclick = () => node.close(); return; }
    const t = rekap.totals;
    const dayRows = rekap.days.map(day => `
      <tr style="${day.selisihRupiah ? 'color:#c2255c;font-weight:600' : ''}"><td>${esc(day.businessDate)}</td><td>${esc(day.storeCode)}</td>
        <td>Rp${num(day.masukRupiah)}</td><td>Rp${num(day.keluarRupiah)}</td><td>Rp${num(day.selisihRupiah)}</td>
        <td>Rp${num(day.kosongRupiah)}</td><td>Rp${num(day.dendaRupiah)}</td><td>${signed(day.penyesuaianRupiah)}</td></tr>`).join('');
    const entryRows = rekap.entries.map(entry => `
      <div class="master-row ${entry.voided ? 'inactive' : ''}"><div class="master-main"><strong>${esc(entry.accountName)}</strong> · ${esc(KIND_LABEL[entry.kind] || entry.kind)}${entry.voided ? ' <span class="status-chip off">dibatalkan</span>' : ''}
        <div class="master-meta">${esc(entry.businessDate)} · ${esc(entry.storeCode)} · ${esc(entry.description)}${entry.adjustedRupiah ? ` · sudah disesuaikan ${signed(entry.adjustedRupiah)}` : ''}${entry.voided && entry.voidReason ? ` · ${esc(entry.voidReason)}` : ''}</div></div>
        <div style="text-align:right"><strong>${signed(entry.amountRupiah)}</strong>
          ${!entry.voided && entry.kind !== 'PENYESUAIAN' ? `<div><span class="mini-btn" role="button" tabindex="0" data-apr-adjust="${esc(entry.id)}" data-amount="${-entry.amountRupiah}">Penyesuaian</span></div>` : ''}
          ${!entry.voided && entry.kind === 'PENYESUAIAN' ? `<div><span class="mini-btn danger" role="button" tabindex="0" data-apr-void="${esc(entry.id)}">Batalkan</span></div>` : ''}</div>
      </div>`).join('') || '<div class="empty">Belum ada potongan/denda di rentang ini.</div>';
    const evalRows = rekap.evaluations.filter(item => item.sessions.length).map(item => `
      <div class="master-row"><div class="master-main"><strong>${esc(item.accountName)}</strong> · ${esc(item.businessDate)} · ${esc(item.storeCode)} · shift ${esc(item.shift)} · ${esc(item.refCode)}
        ${item.sessions.map(sesi => `<div class="master-meta">Sesi ${esc(sesi.name)} ${esc(jam(sesi.start))}-${esc(jam(sesi.end))} menggantikan:
          <select class="text-input" data-apr-pengganti="${esc(sesi.attendanceId)}" style="max-width:220px;display:inline-block">
            <option value="AUTO" ${sesi.replaces === 'AUTO' ? 'selected' : ''}>Otomatis dari jadwal</option>
            <option value="${esc(item.accountId)}" ${sesi.replaces === item.accountId ? 'selected' : ''}>${esc(item.accountName)}</option>
            <option value="" ${sesi.replaces === '' ? 'selected' : ''}>Tidak menggantikan siapa pun</option>
          </select></div>`).join('')}</div></div>`).join('');
    node.innerHTML = `
      <div class="list-head"><h2 style="margin:0">Rekap Dana Apresiasi &amp; Denda</h2><span class="secondary-btn" role="button" tabindex="0" data-apr-close>Tutup</span></div>
      <form data-apr-range style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin:10px 0">
        <label class="admin-field">Dari<input class="text-input" type="date" name="from" value="${esc(rekap.from)}" /></label>
        <label class="admin-field">Sampai<input class="text-input" type="date" name="to" value="${esc(rekap.to)}" /></label>
        <button class="secondary-btn" type="submit">Tampilkan</button></form>
      <div class="admin-tip">Total: apresiasi masuk Rp${num(t.masukRupiah)} · keluar ke backup Rp${num(t.keluarRupiah)} · <span style="${t.selisihRupiah ? 'color:#c2255c;font-weight:700' : ''}">selisih Rp${num(t.selisihRupiah)}</span> · jam kosong Rp${num(t.kosongRupiah)} · denda Rp${num(t.dendaRupiah)} · penyesuaian ${signed(t.penyesuaianRupiah)}</div>
      <div style="overflow:auto;min-width:0"><table class="data-table" style="width:100%;margin:10px 0"><thead><tr><th>Tanggal</th><th>Gerai</th><th>Masuk</th><th>Keluar</th><th>Selisih</th><th>Kosong</th><th>Denda</th><th>Penyesuaian</th></tr></thead>
        <tbody>${dayRows || '<tr><td colspan="8" class="muted">Belum ada data.</td></tr>'}</tbody></table></div>
      ${evalRows ? `<h3>Siapa menggantikan siapa</h3><div class="master-list">${evalRows}</div>` : ''}
      <h3>Rincian potongan, denda &amp; penyesuaian</h3><div class="master-list">${entryRows}</div>`;
    node.querySelector('[data-apr-close]').onclick = () => node.close();
    node.querySelector('[data-apr-range]').onsubmit = event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.target));
      openRekap(values);
    };
    const again = () => openRekap({ from: rekap.from, to: rekap.to });
    node.querySelectorAll('[data-apr-adjust]').forEach(button => {
      button.onclick = async () => {
        const amount = window.prompt('Nominal penyesuaian (Rp). Bawaan membatalkan potongan/denda ini sepenuhnya; boleh diubah.', String(button.dataset.amount));
        if (amount === null) return;
        const note = window.prompt('Keterangan (wajib terlihat CS):', "Alasan syar'i");
        if (note === null) return;
        try {
          await api('/penyesuaian', { method: 'POST', body: JSON.stringify({ entryId: button.dataset.aprAdjust, amountRupiah: Number(amount), note }) });
          toast('Penyesuaian dicatat.');
          again();
        } catch (error) { toast(error.message); }
      };
    });
    node.querySelectorAll('[data-apr-void]').forEach(button => {
      button.onclick = async () => {
        const reason = (window.prompt('Alasan membatalkan penyesuaian ini (wajib):', '') ?? '').trim();
        if (reason.length < 3) return toast('Alasan pembatalan wajib diisi.');
        try { await api(`/penyesuaian/${encodeURIComponent(button.dataset.aprVoid)}/void`, { method: 'POST', body: JSON.stringify({ reason }) }); toast('Penyesuaian dibatalkan.'); again(); } catch (error) { toast(error.message); }
      };
    });
    node.querySelectorAll('[data-apr-pengganti]').forEach(select => {
      select.onchange = async () => {
        try {
          const result = await api('/pengganti', { method: 'POST', body: JSON.stringify({ attendanceId: select.dataset.aprPengganti, replacesAccountId: select.value }) });
          toast(result.reevaluated ? 'Pengganti dikoreksi, shift dihitung ulang.' : 'Pengganti disimpan.');
          again();
        } catch (error) { toast(error.message); }
      };
    });
  }

  window.addEventListener('entity-admin-tab', event => { if (event.detail?.name === 'settings') load(); });
  window.loadEntityDanaApresiasi = load;
})();
