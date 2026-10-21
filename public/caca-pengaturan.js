// Pengaturan tenant dan profil suara lokal perangkat. Tidak menyimpan rekaman audio ke server.
(() => {
  let profilRuang = '', mesinPromise = null, menyiapkanLive = false;
  let profil = null, generasi = 0, pemilik = null, contoh = [], sibuk = false;
  let live = false, mulai = false, tundaUcapan = false, antrean = [], mengirim = false;
  const el = id => document.getElementById(id);
  // Nama yang tampil di panel = persona yang sedang dipilih di chat (Una · Rika · Fina).
  const agenAktif = () => (typeof cacaState !== 'undefined' && cacaState.agen) || 'una';
  window.cacaNamaAsisten = () => (agenAktif() !== 'una' && typeof cacaNamaAgen === 'function' ? cacaNamaAgen() : profil?.namaAsisten || 'Una');
  window.cacaPengaturanProfil = () => profil;
  const status = (teks, obrolan = false) => {
    if (el('cacaPengaturanStatus')) el('cacaPengaturanStatus').textContent = teks;
    if ((obrolan || live || mulai || menyiapkanLive) && el('cacaSuaraStatus')) el('cacaSuaraStatus').textContent = teks;
  };
  function hentikan() {
    generasi += 1; live = false; mulai = false; antrean = []; contoh = []; sibuk = false;
    if (tundaUcapan) { window.speechSynthesis?.resume(); tundaUcapan = false; }
    pemilik?.hentikan(); cacaDiam(); tombol();
  }
  function kosong() { return !el('cacaPertanyaan')?.value.trim() && !cacaState.lampiran && !cacaSuara.sesi; }
  function masih(versi, adapter, lingkup, login) { return versi === generasi && pemilik === adapter && cacaState.scope === lingkup && cacaSidikLogin() === login && !document.hidden; }
  async function kirimAntrean() {
    if (!live || mengirim || !antrean.length || cacaState.sedangKirim || !kosong()) return;
    const item = antrean.shift();
    if (!masih(item.versi, item.adapter, item.lingkup, item.login)) { hentikan(); return; }
    if (!cacaState.siap || cacaSedangNgambek()) { status('Perintah suara ditahan: asisten belum siap.'); antrean.unshift(item); return; }
    mengirim = true; cacaState.sedangKirim = true; cacaAturTombol();
    try {
      await cacaKirimTeks(item.teks, { generasi: cacaMulutGenerasi, scope: item.lingkup, login: item.login, suara: true });
    } finally {
      mengirim = false; cacaState.sedangKirim = false; cacaAturTombol();
      if (live) void kirimAntrean();
    }
  }
  async function klikLive() {
    if (live || mulai) { await mulaiLive(); return; }
    if (menyiapkanLive) return;
    const lingkup = cacaState.scope, login = cacaSidikLogin();
    menyiapkanLive = true; tombol();
    try {
      await muat();
      const adapter = await siapkanSuara();
      if (cacaState.scope !== lingkup || cacaSidikLogin() !== login || pemilik !== adapter || document.hidden) return;
      await mulaiLive();
    } catch (error) { status(error.message, true); }
    finally { menyiapkanLive = false; tombol(); }
  }
  async function mulaiLive() {
    if (live || mulai) { hentikan(); status('Obrolan live dihentikan.', true); return; }
    if (!profil || !pemilik) { status('Pengaturan asisten belum siap.'); return; }
    if (!kosong()) { status('Kirim atau kosongkan pesan dan foto sebelum memulai live.'); return; }
    const adapter = pemilik, versi = generasi, lingkup = cacaState.scope, login = cacaSidikLogin();
    mulai = true; tombol();
    try {
      status('Memuat transkrip suara lokal, unduhan awal sekitar 41 MB…');
      await adapter.muatTranskrip();
      if (!masih(versi, adapter, lingkup, login)) return;
      if (adapter.wajib()) {
        if (!adapter.hasProfile()) throw new Error('Daftarkan suara pemilik atau matikan opsi hanya pemilik.');
        await adapter.muatModel();
        if (!masih(versi, adapter, lingkup, login)) return;
      }
      live = true;
      await adapter.mulaiLive({ headset: el('cacaLiveHeadset').checked,
        onTunda: () => { if (live && window.speechSynthesis?.speaking) { window.speechSynthesis.pause(); tundaUcapan = true; } },
        onLanjut: () => { if (tundaUcapan) { window.speechSynthesis?.resume(); tundaUcapan = false; } },
        onPotong: () => { if (live) { tundaUcapan = false; cacaDiam(); } },
        onPerintah: async teks => {
          if (!live || !masih(versi, adapter, lingkup, login)) return;
          if (antrean.length >= 3) { status('Antrean suara penuh. Tunggu jawaban sebelum mengulang perintah terakhir.'); return; }
          antrean.push({ teks, versi, adapter, lingkup, login });
          if (cacaState.sedangKirim || !kosong()) status('Perintah suara menunggu. Pesan atau foto yang sedang disiapkan tetap disimpan.');
          await kirimAntrean();
        }
      });
      if (!masih(versi, adapter, lingkup, login)) adapter.hentikan();
    } catch (error) { if (versi === generasi) { live = false; adapter.hentikan(); status(error.message); } }
    finally { if (versi === generasi) { mulai = false; tombol(); } }
  }
  function query() {
    const scope = cacaState.scope || (el('entityTab-settings') ? CACA_ENTITY : window.LEKER_STORE_CODE || '');
    return scope === CACA_ENTITY ? 'lingkup=entity' : scope ? `store=${encodeURIComponent(scope)}` : '';
  }
  function namaTampil() {
    const nama = window.cacaNamaAsisten();
    el('cacaFab')?.setAttribute('title', `Tanya ${nama}`);
    el('cacaPanel')?.setAttribute('aria-label', nama);
    el('cacaTutup')?.setAttribute('aria-label', `Tutup ${nama}`);
    el('cacaMulutToggle')?.setAttribute('aria-label', `${nama} bicara`);
    const subjudul = el('cacaStatus'); if (subjudul) subjudul.textContent = subjudul.textContent.replace(/\b(?:Una|Maimunah)\b/g, () => nama);
    const fab = el('cacaFab')?.querySelector('.caca-fab-teks'); if (fab) fab.textContent = nama;
    document.querySelectorAll('.caca-avatar, .caca-fab-ikon').forEach(node => { if (!node.closest('[data-caca-scope]')) node.textContent = nama.slice(0,1).toUpperCase(); });
    if (el('cacaNamaAsisten')) el('cacaNamaAsisten').value = profil?.namaAsisten || 'Una';
    for (const id of ['rika', 'fina']) {
      const atur = profil?.persona?.[id]; if (!atur) continue;
      const k = id[0].toUpperCase() + id.slice(1);
      if (el(`cacaNama${k}`)) el(`cacaNama${k}`).value = atur.nama;
      if (el(`cacaAktif${k}`)) el(`cacaAktif${k}`).checked = atur.aktif !== false;
    }
  }
  // Pemilih persona di chat (public/caca-chat.js) mengikuti daftar dari server.
  function kabarkanAgen() {
    if (profil && typeof CustomEvent === 'function') window.dispatchEvent?.(new CustomEvent('caca-agen-daftar', { detail: { agen: profil.agen || [] } }));
  }
  function tombol() {
    const siap = Boolean(profil && pemilik);
    for (const id of ['cacaSuaraModel','cacaSuaraDaftar','cacaSuaraHapus','cacaSuaraPemilikWajib']) if (el(id)) el(id).disabled = sibuk || !siap;
    for (const id of ['cacaSuaraModel','cacaSuaraDaftar','cacaSuaraHapus','cacaSuaraPemilikWajib']) if(el(id)) el(id).disabled ||= live || mulai;
    if (el('cacaLiveToggle')) {
      const button = el('cacaLiveToggle'), label = live || mulai ? 'Hentikan obrolan live' : 'Mulai obrolan live';
      button.disabled = menyiapkanLive; button.textContent = live || mulai ? '■' : '☎';
      button.setAttribute('aria-label', label); button.setAttribute('title', label); button.setAttribute('aria-pressed', String(live));
    }
    if (el('cacaLiveHeadset')) el('cacaLiveHeadset').disabled = live || mulai;
    if (el('cacaSuaraDaftar')) el('cacaSuaraDaftar').textContent = `Rekam contoh ${contoh.length + 1} dari 3`;
  }
  function pasangPemilik() {
    if (!profil || pemilik || !window.KerangkaSuaraPemilik) return;
    pemilik = window.KerangkaSuaraPemilik.buat({ getScope: () => profil?.ruangSuara || '', onStatus: status, onProgress: p => status(typeof p === 'string' ? p : 'Mengunduh mesin pengenal suara…') });
    window.cacaSuaraPemilik = pemilik;
    if (el('cacaSuaraPemilikWajib')) el('cacaSuaraPemilikWajib').checked = pemilik.wajib();
    tombol();
  }
  async function siapkanSuara() {
    const versi = generasi;
    if (!profil) throw new Error('Pengaturan asisten sedang dimuat.');
    if (!window.KerangkaSuaraPemilik) {
      mesinPromise ||= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/kerangka-suara-pemilik.js?v=20261014-una-v2'; script.async = true;
        script.onload = () => { if (window.KerangkaSuaraPemilik) resolve(); else { mesinPromise = null; reject(new Error('Mesin suara belum tersedia. Coba kembali.')); } };
        script.onerror = () => { script.remove(); mesinPromise = null; reject(new Error('Mesin suara belum termuat. Periksa koneksi lalu coba kembali.')); };
        document.head.appendChild(script);
      });
      await mesinPromise;
    }
    if (versi !== generasi || !profil) throw new Error('Pengaturan suara berubah. Mulai kembali pada akun dan gerai yang benar.');
    pasangPemilik(); return pemilik;
  }
  window.cacaSiapkanSuara = siapkanSuara;
  function bolehMengatur() {
    const ownerMode = typeof entityAdminState !== 'undefined' && entityAdminState.ownerMode;
    return Boolean(localStorage.getItem('lekerEntityAdminToken')) && !ownerMode
      && (window.LEKER_PAGE_CONTEXT !== 'admin' || !localStorage.getItem('lekerOwnerToken'));
  }
  async function muat(paksa = false) {
    if (!bolehMengatur()) return;
    const q = query(); if (!q) return;
    const ruang = q + ':' + cacaSidikLogin();
    if (!paksa && profil && profilRuang === ruang) return;
    hentikan(); profil = null; pemilik = null; window.cacaSuaraPemilik = null; tombol();
    const versi = generasi;
    try {
      const hasil = await cacaApi(`/api/caca/pengaturan?${q}`);
      if (versi !== generasi || q !== query()) return;
      profil = hasil; profilRuang = ruang; namaTampil(); kabarkanAgen();
      pasangPemilik();
      status('Pengaturan nama siap. Mesin suara dimuat ketika pengaturan suara atau mikrofon dipilih.');
    } catch (error) { if (versi === generasi) status(error.message); }
    tombol();
  }
  async function kerja(fn) {
    if (sibuk) return; sibuk = true; tombol(); const versi = generasi;
    try { await fn(versi); } catch (error) { if (versi === generasi) status(error.message || 'Pengaturan belum berhasil.'); }
    finally { if (versi === generasi) { sibuk = false; tombol(); } }
  }
  function pasang() {
    const host = el('cacaPengaturanHost'); if (!host || el('cacaPengaturan')) return;
    const wadah = document.createElement('article'); wadah.id = 'cacaPengaturan'; wadah.className = 'admin-card caca-pengaturan';
    wadah.innerHTML = `<h2>Asisten</h2><p class="muted">Nama berlaku untuk tenant. Pilihan suara dan profil pemilik khusus akun serta browser perangkat ini.</p><div class="caca-pengaturan-isi">
      <label>Nama asisten <input id="cacaNamaAsisten" class="text-input" maxlength="32" value="Una" autocomplete="off"></label>
      <button id="cacaNamaSimpan" class="secondary-btn" type="button">Simpan nama untuk tenant</button>
      <p>Asisten lain di chat (bawaan aktif). Yang dimatikan tidak muncul di pilihan chat dan ditolak server.</p>
      <label>Nama asisten akuntan <input id="cacaNamaRika" class="text-input" maxlength="32" value="Rika" autocomplete="off"></label>
      <label><input id="cacaAktifRika" type="checkbox" checked> Rika (akuntan) aktif</label>
      <label>Nama asisten HR <input id="cacaNamaFina" class="text-input" maxlength="32" value="Fina" autocomplete="off"></label>
      <label><input id="cacaAktifFina" type="checkbox" checked> Fina (HR) aktif</label>
      <button id="cacaAgenSimpan" class="secondary-btn" type="button">Simpan Rika &amp; Fina untuk tenant</button>
      <p>Obrolan live memakai transkrip lokal. Unduhan awal sekitar 41 MB; kecepatannya mengikuti perangkat.</p>
      <label><input id="cacaLiveHeadset" type="checkbox"> Saya memakai headset agar ucapan asisten tidak masuk kembali ke mikrofon</label>
      <p>Mulai atau akhiri obrolan live dari tombol telepon di chat. Tanpa headset, live memerlukan peredam gema penuh yang didukung browser. Pengenalan pemilik opsional; tanpa opsi itu, suara sekitar dapat menjadi perintah.</p>
      <p>Suara pemilik dikenali di perangkat ini. Login dan persetujuan draft tetap diperlukan.</p>
      <button id="cacaSuaraModel" class="secondary-btn" type="button">Unduh mesin pengenal suara</button>
      <p>Opsional: unduhan pengenal pemilik sekitar 102 MB, terpisah dari transkrip live. Model WavLM: <a href="https://github.com/microsoft/UniSpeech/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">Microsoft, CC BY-SA 3.0</a>.</p>
      <p id="cacaSuaraKalimat">Baca dengan suara normal: “Ini suara saya. Asisten membantu mengurus usaha saya setiap hari.”</p>
      <button id="cacaSuaraDaftar" class="secondary-btn" type="button">Rekam contoh 1 dari 3</button>
      <button id="cacaSuaraHapus" class="secondary-btn" type="button">Hapus profil suara perangkat ini</button>
      <label><input id="cacaSuaraPemilikWajib" type="checkbox"> Terima perintah suara hanya dari pemilik terdaftar</label>
      <p id="cacaPengaturanStatus" role="status" aria-live="polite"></p></div>`;
    host.appendChild(wadah);
    async function bukaPengaturan() {
      await muat();
      try { await siapkanSuara(); } catch (error) { status(error.message); }
    }
    el('cacaPengaturanTab')?.addEventListener('click', () => { void bukaPengaturan(); });
    window.addEventListener('entity-admin-tab', event => { if (event.detail?.name === 'settings') void bukaPengaturan(); });
    el('cacaLiveToggle')?.addEventListener('click', klikLive);
    el('cacaPertanyaan')?.addEventListener('input', () => { if (kosong()) void kirimAntrean(); });
    el('cacaNamaSimpan').addEventListener('click', () => kerja(async versi => {
      if (!profil) throw new Error('Buka kembali pengaturan setelah memilih gerai.');
      const hasil = await cacaApi(`/api/caca/pengaturan?${query()}`, { method: 'PATCH', body: JSON.stringify({ namaAsisten: el('cacaNamaAsisten').value }) });
      if (versi !== generasi) return; profil = { ...profil, ...hasil }; namaTampil(); status('Nama asisten tenant sudah disimpan.');
    }));
    el('cacaAgenSimpan')?.addEventListener('click', () => kerja(async versi => {
      if (!profil) throw new Error('Buka kembali pengaturan setelah memilih gerai.');
      let terakhir = null;
      for (const id of ['rika', 'fina']) {
        const k = id[0].toUpperCase() + id.slice(1);
        terakhir = await cacaApi(`/api/caca/pengaturan?${query()}`, { method: 'PATCH', body: JSON.stringify({ persona: id, namaAsisten: el(`cacaNama${k}`).value, aktif: Boolean(el(`cacaAktif${k}`).checked) }) });
        if (versi !== generasi) return;
        profil = { ...profil, persona: { ...profil.persona, [id]: { nama: terakhir.nama, aktif: terakhir.aktif } }, agen: terakhir.agen };
      }
      namaTampil(); kabarkanAgen(); status('Asisten Rika & Fina tenant sudah disimpan.');
    }));
    el('cacaSuaraModel').addEventListener('click', () => kerja(async versi => { await pemilik.muatModel(); if (versi === generasi) status('Mesin siap. Rekam tiga contoh suara pemilik.'); }));
    el('cacaSuaraDaftar').addEventListener('click', () => kerja(async versi => {
      if (!pemilik) throw new Error('Mesin suara belum siap.');
      status('Merekam 4 detik. Bacakan kalimat di atas dengan suara normal.');
      const rekaman = await pemilik.rekam({ durasi: 4 });
      if (versi !== generasi) return;
      contoh.push(rekaman);
      if (contoh.length < 3) { status(`Contoh ${contoh.length} diterima. Rekam contoh berikutnya.`); return; }
      try { await pemilik.daftarkan(contoh); if (versi === generasi) status('Tiga contoh sudah terdaftar. Aktifkan pilihan suara pemilik untuk menggunakannya.'); }
      finally { contoh = []; }
    }));
    el('cacaSuaraHapus').addEventListener('click', () => kerja(async () => { await pemilik.hapus(); contoh = []; el('cacaSuaraPemilikWajib').checked = false; status('Profil suara di perangkat ini sudah dihapus.'); }));
    el('cacaSuaraPemilikWajib').addEventListener('change', async event => {
      try { await pemilik.setWajib(event.target.checked); } catch (error) { event.target.checked = false; status(error.message); }
    });
    tombol();
  }
  window.addEventListener('caca-profile-needed', () => { void muat(); });
  window.addEventListener('caca-scope-change', () => { hentikan(); profil = null; pemilik = null; window.cacaSuaraPemilik = null; muat(); });
  window.addEventListener('caca-agen-ganti', () => { if (profil) namaTampil(); });
  window.addEventListener('caca-chat-idle', () => { void kirimAntrean(); });
  window.addEventListener('caca-audio-stop', hentikan);
  window.addEventListener('pagehide', hentikan);
  document.addEventListener('visibilitychange', () => { if (document.hidden) hentikan(); });
  function perbaruiAkses() {
    const boleh = bolehMengatur();
    el('cacaPengaturanHost')?.classList.toggle('hidden', !boleh);
    el('cacaPengaturanTab')?.classList.toggle('hidden', !boleh);
    if (!boleh) { hentikan(); profil = null; pemilik = null; window.cacaSuaraPemilik = null; tombol(); }
    return boleh;
  }
  window.addEventListener('entity-admin-ready', perbaruiAkses);
  window.addEventListener('storage', event => { if (!event.key || /leker(?:EntityAdmin|Owner)Token/.test(event.key)) perbaruiAkses(); });
  document.addEventListener('DOMContentLoaded', () => { pasang(); if (perbaruiAkses() && cacaState.scope) void muat(); });
})();
