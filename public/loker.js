// Halaman lowongan publik (paket H4 Fina). /loker?l=<slug>. Hanya membaca lowongan yang TAYANG lewat
// GET /api/publik/loker/:slug dan mengirim form ke POST /api/publik/lamaran. Tanpa pustaka luar.
(() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[c]));
  const params = new URLSearchParams(location.search);
  const slug = (params.get('l') || '').trim().slice(0, 80);
  const sumber = (params.get('s') || 'WEB').toUpperCase();

  function tampil(loker) {
    document.title = `Lowongan ${loker.posisi}`;
    const bagian = (judul, isi) => (isi ? `<div class="label">${esc(judul)}</div><p class="isi">${esc(isi)}</p>` : '');
    $('loker').innerHTML = `
      <h1>${esc(loker.posisi)}</h1>
      <p class="usaha">${esc([loker.usaha, loker.gerai].filter(Boolean).join(' · '))}</p>
      ${loker.deskripsi ? `<p class="isi">${esc(loker.deskripsi)}</p>` : ''}
      ${bagian('Syarat', loker.syarat)}${bagian('Jam kerja', loker.jamKerja)}${bagian('Gaji', loker.gajiTeks)}`;
    $('lamar').hidden = false;
  }

  async function muat() {
    if (!slug) { $('loker').innerHTML = '<h1>Lowongan</h1><p>Buka tautan lowongan yang dibagikan (berisi kode lowongan).</p>'; return; }
    try {
      const res = await fetch(`/api/publik/loker/${encodeURIComponent(slug)}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { $('loker').innerHTML = `<h1>Lowongan</h1><p>${esc(data.error || 'Lowongan tidak ditemukan.')}</p>`; return; }
      tampil(data.loker);
    } catch { $('loker').innerHTML = '<h1>Lowongan</h1><p>Koneksi bermasalah. Coba muat ulang halaman.</p>'; }
  }

  $('formLamar').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const isi = Object.fromEntries(new FormData(form));
    const pesan = $('pesan');
    pesan.className = 'pesan'; pesan.textContent = '';
    if (!String(isi.nama || '').trim() || !String(isi.noWa || '').trim()) { pesan.className = 'pesan gagal'; pesan.textContent = 'Nama dan nomor WhatsApp wajib diisi.'; return; }
    $('kirimLamar').disabled = true;
    try {
      const res = await fetch('/api/publik/lamaran', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...isi, slug, sumber }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Lamaran belum terkirim.');
      form.reset();
      form.hidden = true;
      pesan.textContent = 'Terima kasih, lamaran sudah terkirim. Kami akan menghubungi lewat WhatsApp bila cocok.';
    } catch (error) {
      pesan.className = 'pesan gagal'; pesan.textContent = error.message;
    } finally { $('kirimLamar').disabled = false; }
  });

  muat();
})();
