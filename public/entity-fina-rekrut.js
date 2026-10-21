// Entity Admin -> Pengaturan -> Rekrutmen Fina -- paket H4 (contracts/fina-hr-paket-v1.md).
// Lowongan (dibuat Admin atau draft dari Fina) + pelamar dari halaman publik /loker?l=<slug>.
// Tayang / tutup lowongan dan status pelamar (termasuk Diterima / Ditolak) hanya lewat tombol di sini.
// Dimuat saat tab Pengaturan dibuka, tanpa polling (invariant #6).
(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  const api = (path, options) => entityAdminApi(path, options);
  const toast = message => entityAdminToast(message);
  const STATUS_PELAMAR = [['BARU', 'Baru'], ['SCREENING', 'Screening'], ['INTERVIEW', 'Interview'], ['DITERIMA', 'Diterima'], ['DITOLAK', 'Ditolak']];
  const CHIP = { DRAFT: ['Draft', 'warn'], TAYANG: ['Tayang', 'ok'], TUTUP: ['Tutup', 'off'] };
  let data = null;
  let stores = [];
  const pelamarCache = new Map();

  const tautan = slug => `${location.origin}/loker?l=${encodeURIComponent(slug)}`;

  function render() {
    const host = el('entityFinaRekrut');
    if (!host || !data) return;
    host.innerHTML = `
      <div class="list-head"><div><h2 style="margin:0">Rekrutmen Fina</h2>
        <div class="muted">Lowongan dan pelamar. Fina bisa menyusun draft lowongan dari chat; tayang ke umum hanya setelah tombol Tayangkan. Pelamar mengisi form di halaman lowongan. Keputusan Diterima / Ditolak tetap di Admin.</div></div></div>
      <form class="admin-card" data-rekrut-baru style="margin:10px 0">
        <h3 style="margin-top:0">Lowongan baru</h3>
        <div class="form-grid">
          <label class="admin-field">Posisi<input class="text-input" name="posisi" maxlength="80" required /></label>
          <label class="admin-field">Gerai<select class="text-input" name="storeId"><option value="">Semua / entity</option>${stores.map(s => `<option value="${esc(s.storeId)}">${esc(s.storeCode)}</option>`).join('')}</select></label>
          <label class="admin-field">Jam kerja<input class="text-input" name="jamKerja" maxlength="200" /></label>
          <label class="admin-field">Gaji (teks)<input class="text-input" name="gajiTeks" maxlength="120" /></label>
          <label class="admin-field" style="grid-column:1/-1">Syarat (satu per baris)<textarea class="text-input" name="syarat" rows="3" maxlength="2000"></textarea></label>
          <label class="admin-field" style="grid-column:1/-1">Deskripsi tugas<textarea class="text-input" name="deskripsi" rows="2" maxlength="2000"></textarea></label>
        </div>
        <button class="primary-btn" type="submit" data-rekrut-simpan>Simpan sebagai draft</button>
      </form>
      <div class="master-list">${data.lowongan.map(kartu).join('') || '<div class="empty">Belum ada lowongan.</div>'}</div>`;
    host.querySelector('[data-rekrut-baru]').onsubmit = async event => {
      event.preventDefault();
      const nilai = Object.fromEntries(new FormData(event.currentTarget));
      try { await api('/api/entity-admin/fina/lowongan', { method: 'POST', body: JSON.stringify(nilai) }); toast('Lowongan disimpan sebagai draft.'); await load(); } catch (error) { toast(error.message); }
    };
    host.querySelectorAll('[data-lowongan-status]').forEach(button => {
      button.onclick = async () => {
        const [id, status] = button.dataset.lowonganStatus.split('|');
        if (status === 'TAYANG' && !window.confirm('Tayangkan lowongan ini? Siapa pun yang punya tautannya bisa melamar.')) return;
        try { await api(`/api/entity-admin/fina/lowongan/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }); toast('Status lowongan disimpan.'); await load(); } catch (error) { toast(error.message); }
      };
    });
    host.querySelectorAll('[data-lowongan-salin]').forEach(button => {
      button.onclick = () => navigator.clipboard?.writeText(tautan(button.dataset.lowonganSalin)).then(() => toast('Tautan lowongan disalin.'), () => toast(tautan(button.dataset.lowonganSalin)));
    });
    host.querySelectorAll('details[data-lowongan]').forEach(node => {
      node.addEventListener('toggle', () => { if (node.open) muatPelamar(node.dataset.lowongan); });
    });
  }

  function kartu(l) {
    const [label, kelas] = CHIP[l.status] || [l.status, ''];
    const total = Object.values(l.pelamar || {}).reduce((a, b) => a + b, 0);
    const aksi = [
      l.status !== 'TAYANG' ? `<button class="primary-btn" type="button" data-lowongan-status="${esc(l.id)}|TAYANG">Tayangkan</button>` : '',
      l.status === 'TAYANG' ? `<button class="secondary-btn" type="button" data-lowongan-status="${esc(l.id)}|TUTUP">Tutup lowongan</button>` : '',
      l.status === 'TUTUP' ? `<button class="secondary-btn" type="button" data-lowongan-status="${esc(l.id)}|DRAFT">Jadikan draft</button>` : '',
      `<button class="secondary-btn" type="button" data-lowongan-salin="${esc(l.slug)}">Salin tautan</button>`
    ].join('');
    return `
      <details class="admin-card" data-lowongan="${esc(l.id)}" style="margin-bottom:10px">
        <summary><strong>${esc(l.posisi)}</strong>${l.storeCode ? ` · ${esc(l.storeCode)}` : ''} · <span class="status-chip ${kelas}">${label}</span> · ${total} pelamar${l.pelamar?.BARU ? ` (${l.pelamar.BARU} baru)` : ''}</summary>
        <div class="master-meta" style="margin:8px 0">${esc([l.jamKerja && `Jam ${l.jamKerja}`, l.gajiTeks && `Gaji ${l.gajiTeks}`].filter(Boolean).join(' · '))}</div>
        ${l.syarat ? `<pre style="white-space:pre-wrap;font:inherit;margin:0 0 8px">${esc(l.syarat)}</pre>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">${aksi}</div>
        <div data-pelamar-host="${esc(l.id)}"><div class="muted">Memuat pelamar…</div></div>
      </details>`;
  }

  async function muatPelamar(lowonganId) {
    const host = document.querySelector(`[data-pelamar-host="${CSS.escape(lowonganId)}"]`);
    if (!host) return;
    try {
      const hasil = await api(`/api/entity-admin/fina/pelamar?lowongan=${encodeURIComponent(lowonganId)}`);
      pelamarCache.set(lowonganId, hasil.pelamar);
      host.innerHTML = hasil.pelamar.map(p => `
        <div class="master-row"><div class="master-main"><strong>${esc(p.nama)}</strong>
          <div class="master-meta">${esc([p.umur && `${p.umur} th`, p.domisili, p.sumber].filter(Boolean).join(' · '))} · <a href="https://wa.me/${esc(p.noWa)}" target="_blank" rel="noopener noreferrer">WA ${esc(p.noWa)}</a></div>
          ${p.pengalaman ? `<div class="master-meta">${esc(p.pengalaman)}</div>` : ''}
          <input class="text-input" data-pelamar-catatan="${esc(p.id)}" maxlength="500" value="${esc(p.catatan)}" placeholder="Catatan admin" style="margin-top:6px" /></div>
          <select class="text-input" data-pelamar-status="${esc(p.id)}" style="max-width:150px">${STATUS_PELAMAR.map(([v, l]) => `<option value="${v}" ${v === p.status ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`).join('') || '<div class="empty">Belum ada pelamar.</div>';
      host.querySelectorAll('[data-pelamar-status]').forEach(select => {
        select.onchange = async () => {
          if (['DITERIMA', 'DITOLAK'].includes(select.value) && !window.confirm(`Tandai pelamar ini ${select.value === 'DITERIMA' ? 'DITERIMA' : 'DITOLAK'}?`)) { await muatPelamar(lowonganId); return; }
          try { await api(`/api/entity-admin/fina/pelamar/${encodeURIComponent(select.dataset.pelamarStatus)}`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) }); toast('Status pelamar disimpan.'); } catch (error) { toast(error.message); await muatPelamar(lowonganId); }
        };
      });
      host.querySelectorAll('[data-pelamar-catatan]').forEach(input => {
        input.onchange = async () => {
          try { await api(`/api/entity-admin/fina/pelamar/${encodeURIComponent(input.dataset.pelamarCatatan)}`, { method: 'PATCH', body: JSON.stringify({ catatan: input.value }) }); toast('Catatan disimpan.'); } catch (error) { toast(error.message); }
        };
      });
    } catch (error) { host.innerHTML = `<div class="staff-message">${esc(error.message)}</div>`; }
  }

  async function load() {
    const host = el('entityFinaRekrut');
    if (!host) return;
    try {
      const [lowongan, atur] = await Promise.all([api('/api/entity-admin/fina/lowongan'), api('/api/entity-admin/fina/settings').catch(() => ({ stores: [] }))]);
      data = lowongan; stores = atur.stores || []; render();
    } catch (error) { host.innerHTML = `<div class="staff-message">${esc(error.message)}</div>`; }
  }

  window.addEventListener('entity-admin-tab', event => { if (event.detail?.name === 'settings') load(); });
  window.loadEntityFinaRekrut = load;
})();
