// Entity Admin -> Pengaturan -> Kotak masuk WA Fina (Bos Cyo, 2026-10-22; migration 0183).
// Pesan WA yang diteruskan gateway laptop, dikenali sebagai pelamar / karyawan / asing, dan antrean
// pesan keluar. Pesan keluar yang dibuat Fina lewat "Ya" sudah disetujui; yang masih Draft perlu
// tombol Setujui di sini. Dimuat saat tab Pengaturan dibuka atau tombol Muat ulang, tanpa polling.
(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  const api = (path, options) => entityAdminApi(`/api/entity-admin/fina/wa${path}`, options);
  const toast = message => entityAdminToast(message);
  const PENGIRIM = { PELAMAR: ['Pelamar', 'ok'], KARYAWAN: ['Karyawan', 'ok'], ASING: ['Belum dikenal', 'warn'] };
  const STATUS = { DRAFT: ['Draft', 'warn'], DISETUJUI: ['Menunggu gateway', 'warn'], DIAMBIL: ['Sedang dikirim', 'warn'], DIKIRIM: ['Terkirim', 'ok'], GAGAL: ['Gagal', 'bad'], BATAL: ['Batal', 'off'] };
  const waktu = iso => (iso ? new Date(String(iso).replace(' ', 'T') + (String(iso).includes('Z') || String(iso).includes('+') ? '' : 'Z')).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '');

  function render(masuk, keluar) {
    const host = el('entityFinaInbox');
    if (!host) return;
    host.innerHTML = `
      <div class="list-head"><div><h2 style="margin:0">Kotak masuk WA Fina</h2>
        <div class="muted">Pesan WA yang diteruskan gateway di laptop. Pengirim belum dikenal bisa dicatat sebagai pelamar lewat Fina ("catat pelamar dari WA"). Isi pesan orang asing tidak dibaca model.</div></div>
        <button class="secondary-btn" type="button" data-inbox-muat>Muat ulang</button></div>
      <h3>Masuk</h3>
      <div class="master-list">${masuk.map(m => `
        <div class="master-row"><div class="master-main"><strong>${esc(m.nama || m.namaWa || m.noWa)}</strong> <span class="status-chip ${PENGIRIM[m.pengirim]?.[1] || ''}">${PENGIRIM[m.pengirim]?.[0] || m.pengirim}</span>
          <div class="master-meta">${esc(waktu(m.waktu))}${m.jenisMedia ? ` · ${esc(m.jenisMedia)}` : ''} · <a href="https://wa.me/${esc(m.noWa)}" target="_blank" rel="noopener noreferrer">WA</a></div>
          <div style="white-space:pre-wrap">${esc(m.teks)}</div></div>
          ${m.status === 'BARU' ? `<button class="mini-btn" type="button" data-inbox-baca="${esc(m.id)}">Tandai dibaca</button>` : `<span class="field-note">${m.status === 'DIPROSES' ? 'Diproses' : 'Dibaca'}</span>`}</div>`).join('') || '<div class="empty">Belum ada pesan masuk. Pastikan gateway WA di laptop menyala dan token Sambungan Fina terpasang.</div>'}</div>
      <h3>Antrean kirim</h3>
      <div class="master-list">${keluar.map(k => `
        <div class="master-row"><div class="master-main"><strong>${esc(k.namaTujuan || k.noWa)}</strong> <span class="status-chip ${STATUS[k.status]?.[1] || ''}">${STATUS[k.status]?.[0] || k.status}</span>
          <div class="master-meta">${esc(k.keperluan || '')} · dibuat ${esc(waktu(k.createdAt))}${k.dikirimAt ? ` · terkirim ${esc(waktu(k.dikirimAt))}` : ''}${k.gagalAlasan ? ` · ${esc(k.gagalAlasan)}` : ''}</div>
          <div style="white-space:pre-wrap">${esc(k.teks)}</div></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${k.status === 'DRAFT' ? `<button class="primary-btn" type="button" data-keluar-setujui="${esc(k.id)}">Setujui</button>` : ''}
            ${['DRAFT', 'DISETUJUI', 'GAGAL'].includes(k.status) ? `<button class="secondary-btn" type="button" data-keluar-batal="${esc(k.id)}">Batal</button>` : ''}
          </div></div>`).join('') || '<div class="empty">Belum ada pesan keluar.</div>'}</div>`;
    host.querySelector('[data-inbox-muat]').onclick = () => load();
    host.querySelectorAll('[data-inbox-baca]').forEach(b => { b.onclick = async () => { try { await api(`/masuk/${encodeURIComponent(b.dataset.inboxBaca)}`, { method: 'PATCH', body: JSON.stringify({ status: 'DIBACA' }) }); await load(); } catch (error) { toast(error.message); } }; });
    host.querySelectorAll('[data-keluar-setujui]').forEach(b => { b.onclick = async () => { try { await api(`/keluar/${encodeURIComponent(b.dataset.keluarSetujui)}/setujui`, { method: 'POST', body: '{}' }); toast('Pesan disetujui, menunggu gateway.'); await load(); } catch (error) { toast(error.message); } }; });
    host.querySelectorAll('[data-keluar-batal]').forEach(b => { b.onclick = async () => { if (!window.confirm('Batalkan pesan ini?')) return; try { await api(`/keluar/${encodeURIComponent(b.dataset.keluarBatal)}/batal`, { method: 'POST', body: '{}' }); toast('Pesan dibatalkan.'); await load(); } catch (error) { toast(error.message); } }; });
  }

  async function load() {
    const host = el('entityFinaInbox');
    if (!host) return;
    try {
      const [m, k] = await Promise.all([api('/masuk'), api('/keluar')]);
      render(m.masuk.slice(0, 50), k.keluar.slice(0, 50));
    } catch (error) { host.innerHTML = `<div class="staff-message">${esc(error.message)}</div>`; }
  }

  window.addEventListener('entity-admin-tab', event => { if (event.detail?.name === 'settings') load(); });
  window.loadEntityFinaInbox = load;
})();
