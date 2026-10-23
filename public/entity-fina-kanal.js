// Entity Admin -> Pengaturan -> Sambungan Fina (Bos Cyo, 2026-10-22, migration 0183).
// WA, Email, Instagram, Facebook milik usaha ini yang dihubungkan ke Fina. WA memakai gateway lokal di
// laptop/PC (perangkat tertaut, jalur tidak resmi): buat token di sini lalu tempel di gateway.
// Token hanya tampil sekali. Dimuat saat tab Pengaturan dibuka, tanpa polling (invariant #6).
(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  const api = (path = '', options) => entityAdminApi(`/api/entity-admin/fina/kanal${path}`, options);
  const toast = message => entityAdminToast(message);
  const CONTOH = { WA: 'Nomor WA HR, mis. 0812xxxxxxx', EMAIL: 'Alamat email HR, mis. hrd@usaha.com', IG: 'Akun Instagram, mis. @usaha.loker', FB: 'Halaman Facebook usaha' };
  const CHIP = { TERSAMBUNG: 'ok', MENUNGGU: 'warn', PERLU_TOKEN: 'warn', MANUAL: 'warn', MATI: 'off' };
  let data = null;

  function kartu(k) {
    return `
      <form class="admin-card" data-kanal="${esc(k.jenis)}" style="margin-bottom:10px">
        <div class="list-head"><h3 style="margin:0">${esc(k.label)}</h3><span class="status-chip ${CHIP[k.status.kode] || ''}">${esc(k.status.teks)}</span></div>
        <div class="form-grid">
          <label class="admin-field"><span><input type="checkbox" name="aktif" ${k.aktif ? 'checked' : ''} /> Hubungkan ke Fina</span></label>
          <label class="admin-field">Akun / nomor<input class="text-input" name="identitas" maxlength="120" value="${esc(k.identitas)}" placeholder="${esc(CONTOH[k.jenis])}" /></label>
          <label class="admin-field">Catatan<input class="text-input" name="catatan" maxlength="300" value="${esc(k.catatan)}" /></label>
        </div>
        ${k.jenis === 'WA' ? `<p class="field-note">WA tersambung lewat gateway di laptop/PC (perangkat tertaut). Laptop harus menyala. Jalur ini tidak resmi: risiko nomor diblokir WhatsApp tetap ada, jadi pesan keluar dari Fina selalu menunggu persetujuan Admin.${k.terakhirTerlihat ? ` Terakhir terlihat ${esc(new Date(k.terakhirTerlihat).toLocaleString('id-ID'))}.` : ''}</p>
          <div data-kanal-token-hasil></div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="primary-btn" type="submit" data-kanal-simpan="${esc(k.jenis)}">Simpan ${esc(k.label)}</button>
          ${k.jenis === 'WA' ? `<button class="secondary-btn" type="button" data-kanal-token>${k.adaToken ? 'Ganti token gateway' : 'Buat token gateway'}</button>` : ''}
        </div>
      </form>`;
  }

  function render() {
    const host = el('entityFinaKanal');
    if (!host || !data) return;
    host.innerHTML = `
      <div class="list-head"><div><h2 style="margin:0">Sambungan Fina</h2>
        <div class="muted">WA, email, Instagram, dan Facebook usaha ini yang boleh dibaca Fina untuk urusan HR (pelamar, jadwal interview/training, kabar ke CS). Fina hanya menyiapkan: setiap pesan keluar menunggu persetujuan Admin.</div></div></div>
      ${data.kanal.map(kartu).join('')}`;
    host.querySelectorAll('[data-kanal]').forEach(f => {
      f.onsubmit = async event => {
        event.preventDefault();
        const nilai = Object.fromEntries(new FormData(f));
        try { await api('', { method: 'PUT', body: JSON.stringify({ jenis: f.dataset.kanal, aktif: Boolean(nilai.aktif), identitas: nilai.identitas, catatan: nilai.catatan }) }); toast('Sambungan disimpan.'); await load(); } catch (error) { toast(error.message); }
      };
    });
    host.querySelector('[data-kanal-token]')?.addEventListener('click', async () => {
      if (!window.confirm('Buat token gateway baru? Token lama langsung tidak berlaku.')) return;
      try {
        const r = await api('/WA/token', { method: 'POST', body: '{}' });
        const tempat = host.querySelector('[data-kanal-token-hasil]');
        tempat.innerHTML = `<div class="admin-tip" style="margin:8px 0"><strong>Token gateway (hanya tampil sekali):</strong><br><code style="word-break:break-all">${esc(r.token)}</code><br><button class="secondary-btn" type="button" data-kanal-salin>Salin token</button></div>`;
        tempat.querySelector('[data-kanal-salin]').onclick = () => navigator.clipboard?.writeText(r.token).then(() => toast('Token disalin.'), () => toast('Pilih teks token lalu Ctrl+C.'));
      } catch (error) { toast(error.message); }
    });
  }

  async function load() {
    const host = el('entityFinaKanal');
    if (!host) return;
    try { data = await api(); render(); } catch (error) { host.innerHTML = `<div class="staff-message">${esc(error.message)}</div>`; }
  }

  window.addEventListener('entity-admin-tab', event => { if (event.detail?.name === 'settings') load(); });
  window.loadEntityFinaKanal = load;
})();
