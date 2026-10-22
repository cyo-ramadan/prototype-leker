// Entity Admin -> Karyawan -> [Pelamar | Karyawan] (Bos Cyo, 2026-10-22). Bawaan tetap Karyawan.
// Pelamar = data calon karyawan: diinput manual di sini, dari halaman lowongan /loker, dan nanti dari
// WA/email lewat Fina (selalu draft + "Ya"). Status Diterima / Ditolak hanya oleh Admin.
// Dimuat saat tombol Pelamar dibuka, tanpa polling (invariant #6).
(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  const api = (path, options) => entityAdminApi(path, options);
  const toast = message => entityAdminToast(message);
  const STATUS = [['BARU', 'Baru'], ['SCREENING', 'Screening'], ['INTERVIEW', 'Interview'], ['DITERIMA', 'Diterima'], ['DITOLAK', 'Ditolak']];
  const SUMBER = [['MANUAL', 'Manual / datang langsung'], ['WA', 'WhatsApp'], ['IG', 'Instagram'], ['FB', 'Facebook'], ['EMAIL', 'Email'], ['WEB', 'Halaman lowongan'], ['LAIN', 'Lainnya']];
  let stores = [];
  let filter = { status: '', store: '' };

  function pilihMode(mode) {
    const pelamar = mode === 'pelamar';
    el('entityPelamarPanel')?.toggleAttribute('hidden', !pelamar);
    el('entityKaryawanPanel')?.toggleAttribute('hidden', pelamar);
    document.querySelectorAll('[data-karyawan-mode]').forEach(b => {
      const aktif = b.dataset.karyawanMode === mode;
      b.setAttribute('aria-pressed', String(aktif));
      b.classList.toggle('primary-btn', aktif);
      b.classList.toggle('secondary-btn', !aktif);
    });
    if (pelamar) void load();
  }

  function form() {
    return `
      <form class="admin-card" data-pelamar-baru>
        <h2>Tambah pelamar</h2>
        <div class="muted" style="margin-bottom:10px">Calon karyawan yang melamar lewat WA, Instagram, datang langsung, dsb. Satu nomor WA hanya dicatat sekali.</div>
        <label class="admin-field">Nama lengkap<input class="text-input" name="nama" maxlength="80" required /></label>
        <label class="admin-field">Nomor WhatsApp<input class="text-input" name="noWa" maxlength="20" inputmode="tel" placeholder="0812xxxxxxx" required /></label>
        <label class="admin-field">Posisi yang dilamar<input class="text-input" name="posisi" maxlength="80" placeholder="mis. CS shift pagi" /></label>
        <label class="admin-field">Gerai tujuan<select class="text-input" name="storeId"><option value="">Belum ditentukan</option>${stores.map(s => `<option value="${esc(s.storeId)}">${esc(s.storeCode)}</option>`).join('')}</select></label>
        <label class="admin-field">Domisili<input class="text-input" name="domisili" maxlength="120" /></label>
        <label class="admin-field">Umur<input class="text-input" name="umur" type="number" min="14" max="80" inputmode="numeric" /></label>
        <label class="admin-field">Sumber<select class="text-input" name="sumber">${SUMBER.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
        <label class="admin-field">Pengalaman<textarea class="text-input" name="pengalaman" rows="2" maxlength="1000"></textarea></label>
        <label class="admin-field">Catatan<input class="text-input" name="catatan" maxlength="500" /></label>
        <button class="primary-btn" type="submit" data-pelamar-simpan>Simpan pelamar</button>
      </form>`;
  }

  function daftar(rows) {
    return `
      <div class="admin-card list-card">
        <div class="list-head"><h2>Data pelamar</h2><span class="master-count">${rows.length}</span></div>
        <div class="management-actions" style="margin-bottom:10px">
          <label class="admin-field" style="margin:0">Status<select class="text-input" data-pelamar-filter="status"><option value="">Semua</option>${STATUS.map(([v, l]) => `<option value="${v}" ${filter.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="admin-field" style="margin:0">Gerai<select class="text-input" data-pelamar-filter="store"><option value="">Semua</option>${stores.map(s => `<option value="${esc(s.storeId)}" ${filter.store === s.storeId ? 'selected' : ''}>${esc(s.storeCode)}</option>`).join('')}</select></label>
        </div>
        <div class="master-list">${rows.map(p => `
          <div class="master-row"><div class="master-main"><strong>${esc(p.nama)}</strong>
            <div class="master-meta">${esc([p.posisi, p.storeCode, p.umur && `${p.umur} th`, p.domisili, p.sumber].filter(Boolean).join(' · '))} · <a href="https://wa.me/${esc(p.noWa)}" target="_blank" rel="noopener noreferrer">WA ${esc(p.noWa)}</a></div>
            ${p.pengalaman ? `<div class="master-meta">${esc(p.pengalaman)}</div>` : ''}
            <input class="text-input" data-pelamar-catatan="${esc(p.id)}" maxlength="500" value="${esc(p.catatan)}" placeholder="Catatan admin" style="margin-top:6px" /></div>
            <select class="text-input" data-pelamar-status="${esc(p.id)}" style="max-width:150px">${STATUS.map(([v, l]) => `<option value="${v}" ${v === p.status ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`).join('') || '<div class="empty">Belum ada pelamar.</div>'}</div>
      </div>`;
  }

  async function load() {
    const host = el('entityPelamarPanel');
    if (!host) return;
    try {
      const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v));
      const [hasil, atur] = await Promise.all([api(`/api/entity-admin/fina/pelamar${q.toString() ? `?${q}` : ''}`), stores.length ? { stores } : api('/api/entity-admin/fina/settings').catch(() => ({ stores: [] }))]);
      stores = atur.stores || [];
      host.innerHTML = `<div class="admin-grid two" style="align-items:start">${form()}${daftar(hasil.pelamar)}</div>`;
      pasang(host);
    } catch (error) { host.innerHTML = `<div class="staff-message">${esc(error.message)}</div>`; }
  }

  function pasang(host) {
    host.querySelector('[data-pelamar-baru]').onsubmit = async event => {
      event.preventDefault();
      const nilai = Object.fromEntries(new FormData(event.currentTarget));
      try { await api('/api/entity-admin/fina/pelamar', { method: 'POST', body: JSON.stringify(nilai) }); toast('Pelamar disimpan.'); await load(); } catch (error) { toast(error.message); }
    };
    host.querySelectorAll('[data-pelamar-filter]').forEach(select => {
      select.onchange = () => { filter = { ...filter, [select.dataset.pelamarFilter]: select.value }; void load(); };
    });
    host.querySelectorAll('[data-pelamar-status]').forEach(select => {
      select.onchange = async () => {
        if (['DITERIMA', 'DITOLAK'].includes(select.value) && !window.confirm(`Tandai pelamar ini ${select.value}?`)) { await load(); return; }
        try { await api(`/api/entity-admin/fina/pelamar/${encodeURIComponent(select.dataset.pelamarStatus)}`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) }); toast('Status pelamar disimpan.'); } catch (error) { toast(error.message); await load(); }
      };
    });
    host.querySelectorAll('[data-pelamar-catatan]').forEach(input => {
      input.onchange = async () => {
        try { await api(`/api/entity-admin/fina/pelamar/${encodeURIComponent(input.dataset.pelamarCatatan)}`, { method: 'PATCH', body: JSON.stringify({ catatan: input.value }) }); toast('Catatan disimpan.'); } catch (error) { toast(error.message); }
      };
    });
  }

  document.addEventListener('click', event => {
    const tombol = event.target.closest?.('[data-karyawan-mode]');
    if (tombol) pilihMode(tombol.dataset.karyawanMode);
  });
  // Bawaan Karyawan setiap tab Karyawan dibuka, seperti sebelumnya.
  window.addEventListener('entity-admin-tab', event => { if (event.detail?.name === 'employees') pilihMode('karyawan'); });
  window.loadEntityPelamar = load;
})();
