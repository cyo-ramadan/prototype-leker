// Entity Admin -> Pengaturan -> Surat Fina (teguran / SP) -- paket H3 (contracts/fina-hr-paket-v1.md).
// Fina hanya menyimpan DRAFT. Di sini manusia memeriksa isi + fakta, lalu Setujui atau Batalkan.
// Belum dikirim ke CS (fase WA, paket H5). Dimuat saat tab Pengaturan dibuka, tanpa polling.
(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  const api = (path = '', options) => entityAdminApi(`/api/entity-admin/fina/surat${path}`, options);
  const toast = message => entityAdminToast(message);
  const LABEL = { DRAFT: ['Draft', 'warn'], DISETUJUI: ['Disetujui', 'ok'], DIBATALKAN: ['Dibatalkan', 'off'] };
  let data = null;
  let filter = 'DRAFT';

  function render() {
    const host = el('entityFinaSurat');
    if (!host || !data) return;
    const daftar = data.surat.filter(s => !filter || s.status === filter);
    host.innerHTML = `
      <div class="list-head"><div><h2 style="margin:0">Surat Fina (teguran / SP)</h2>
        <div class="muted">Draft disusun Fina dari rekap masalah CS. Belum ada yang dikirim ke CS. Surat baru berlaku setelah Admin menekan Setujui; masa berlaku mengikuti pengaturan Fina (HR).</div></div>
        <select class="text-input" data-surat-filter style="max-width:180px">
          ${[['DRAFT', 'Draft'], ['DISETUJUI', 'Disetujui'], ['DIBATALKAN', 'Dibatalkan'], ['', 'Semua']].map(([v, l]) => `<option value="${v}" ${v === filter ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div>
      <div class="master-list">${daftar.map(kartu).join('') || '<div class="empty">Belum ada surat di daftar ini.</div>'}</div>`;
    host.querySelector('[data-surat-filter]').onchange = event => { filter = event.target.value; render(); };
    host.querySelectorAll('[data-surat-setujui]').forEach(button => {
      button.onclick = async () => {
        if (!window.confirm('Setujui surat ini? Surat mulai berlaku hari ini.')) return;
        try { const r = await api(`/${encodeURIComponent(button.dataset.suratSetujui)}/setujui`, { method: 'POST', body: '{}' }); toast(`Surat disetujui, berlaku sampai ${r.berlakuSampai}.`); await load(); } catch (error) { toast(error.message); }
      };
    });
    host.querySelectorAll('[data-surat-batal]').forEach(button => {
      button.onclick = async () => {
        const alasan = (window.prompt('Alasan membatalkan surat ini (wajib):', '') ?? '').trim();
        if (alasan.length < 3) return toast('Alasan pembatalan wajib diisi.');
        try { await api(`/${encodeURIComponent(button.dataset.suratBatal)}/batalkan`, { method: 'POST', body: JSON.stringify({ alasan }) }); toast('Surat dibatalkan.'); await load(); } catch (error) { toast(error.message); }
      };
    });
    host.querySelectorAll('[data-surat-salin]').forEach(button => {
      button.onclick = () => {
        const surat = data.surat.find(s => s.id === button.dataset.suratSalin);
        navigator.clipboard?.writeText(surat?.isi || '').then(() => toast('Isi surat disalin.'), () => toast('Salin gagal; pilih teks lalu Ctrl+C.'));
      };
    });
  }

  function kartu(s) {
    const [label, kelas] = LABEL[s.status] || [s.status, ''];
    const f = s.fakta || {};
    return `
      <details class="admin-card" style="margin-bottom:10px">
        <summary><strong>${esc(s.tingkat)}</strong> · ${esc(s.name || s.accountId)} · ${esc(s.storeCode)} · ${esc(s.periodeDari)} s.d. ${esc(s.periodeSampai)}
          · <span class="status-chip ${kelas}">${label}</span>${s.berlakuSampai ? ` · berlaku s.d. ${esc(s.berlakuSampai)}` : ''}</summary>
        <div class="master-meta" style="margin:8px 0">Fakta: telat ${Number(f.telatMenit) || 0} mnt · pulang awal ${Number(f.pulangAwalMenit) || 0} mnt · kosong ${Number(f.kosongMenit) || 0} mnt · denda ${Number(f.denda) || 0}× · lupa pulang ${Number(f.lupaPulang) || 0}× · ${Number(f.kejadian) || 0} shift</div>
        <pre style="white-space:pre-wrap;font:inherit;background:var(--surface-2, #f5f5f5);padding:10px;border-radius:8px">${esc(s.isi)}</pre>
        ${s.dibatalkanAlasan ? `<p class="field-note">Alasan batal: ${esc(s.dibatalkanAlasan)}</p>` : ''}
        <div class="row-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="secondary-btn" type="button" data-surat-salin="${esc(s.id)}">Salin isi</button>
          ${s.status === 'DRAFT' ? `<button class="primary-btn" type="button" data-surat-setujui="${esc(s.id)}">Setujui</button>` : ''}
          ${s.status !== 'DIBATALKAN' ? `<button class="secondary-btn" type="button" data-surat-batal="${esc(s.id)}">Batalkan</button>` : ''}
        </div>
      </details>`;
  }

  async function load() {
    const host = el('entityFinaSurat');
    if (!host) return;
    try { data = await api(); render(); } catch (error) { host.innerHTML = `<div class="staff-message">${esc(error.message)}</div>`; }
  }

  window.addEventListener('entity-admin-tab', event => { if (event.detail?.name === 'settings') load(); });
  window.loadEntityFinaSurat = load;
})();
