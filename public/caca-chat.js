// Panel chat Caca di Entity Admin (ADR-044 Tahap 1).
// Tahap ini hanya membaca: tidak ada tombol simpan, karena belum ada alat tulis.

const cacaState = {
  storeCode: '',
  sedangBaca: false,
  sedangTanya: false,
  siapDipakai: false
};

const cacaEl = id => document.getElementById(id);
const cacaEscape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
const cacaRupiah = value => (value === null || value === undefined ? '—' : new Intl.NumberFormat('id-ID').format(value));

async function cacaApi(path, options = {}) {
  const token = localStorage.getItem('lekerEntityAdminToken') || '';
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Permintaan gagal (${response.status})`);
  return payload;
}

function cacaBacaBerkas(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gambarnya tidak terbaca.'));
    reader.onload = () => {
      const hasil = String(reader.result || '');
      const pemisah = hasil.indexOf(',');
      if (pemisah < 0) return reject(new Error('Gambarnya tidak terbaca.'));
      resolve({ media_type: file.type, data: hasil.slice(pemisah + 1) });
    };
    reader.readAsDataURL(file);
  });
}

async function cacaMuatGerai() {
  const payload = await cacaApi('/api/entity-admin/stores');
  const stores = payload.stores || [];
  const pilihan = stores.length
    ? stores.map(store => `<option value="${cacaEscape(store.code)}">${cacaEscape(store.code)} · ${cacaEscape(store.storeName)}</option>`).join('')
    : '<option value="">Belum ada gerai</option>';

  for (const id of ['cacaStore', 'cacaTanyaStore']) {
    const select = cacaEl(id);
    if (select) select.innerHTML = pilihan;
  }
  cacaState.storeCode = cacaEl('cacaStore')?.value || '';
}

function cacaTambahGelembung(dari, teks, catatan = '') {
  const wadah = cacaEl('cacaPercakapan');
  if (!wadah) return null;
  const gelembung = document.createElement('div');
  gelembung.className = `caca-gelembung ${dari}`;
  gelembung.innerHTML = `<p>${cacaEscape(teks)}</p>${catatan ? `<span class="caca-jejak">${cacaEscape(catatan)}</span>` : ''}`;
  wadah.appendChild(gelembung);
  wadah.scrollTop = wadah.scrollHeight;
  return gelembung;
}

// Yang ditampilkan adalah akibatnya, bukan pengulangan perintah — konfirmasi
// yang cuma mengulang kalimat sendiri gampang di-klik tanpa dibaca.
function cacaTampilkanDraft(payload) {
  const draft = payload.draft;
  const wadah = cacaEl('cacaPercakapan');
  const kartu = document.createElement('div');
  kartu.className = 'caca-draft';
  kartu.innerHTML = `
    <div class="caca-draft-judul">Caca mau mencatat ini — dicek dulu ya:</div>
    <div class="caca-draft-baris"><span>Untuk</span><strong>${cacaEscape(draft.keterangan)}</strong></div>
    <div class="caca-draft-baris"><span>Nominal</span><strong>${cacaRupiah(draft.nominal)}</strong></div>
    <div class="caca-draft-baris"><span>Ke</span><strong>${cacaEscape(draft.pihak)}</strong></div>
    <div class="caca-draft-baris"><span>Tanggal</span><strong>${cacaEscape(draft.tanggal)}</strong></div>
    <ul class="caca-draft-dampak">${draft.dampak.map(d => `<li>${cacaEscape(d)}</li>`).join('')}</ul>
    <div class="caca-draft-aksi">
      <button class="primary-btn" type="button" data-caca-catat>Ya, catat</button>
      <button class="secondary-btn" type="button" data-caca-batal>Batal</button>
    </div>`;
  wadah.appendChild(kartu);
  wadah.scrollTop = wadah.scrollHeight;

  const kunci = () => kartu.querySelectorAll('button').forEach(b => { b.disabled = true; });

  kartu.querySelector('[data-caca-batal]').addEventListener('click', () => {
    kunci();
    kartu.classList.add('dibatalkan');
    cacaTambahGelembung('caca', 'Oke, tidak jadi dicatat.');
  });

  kartu.querySelector('[data-caca-catat]').addEventListener('click', async () => {
    kunci();
    try {
      const store = cacaEl('cacaTanyaStore').value;
      const hasil = await cacaApi(`/api/caca/catat?store=${encodeURIComponent(store)}`, {
        method: 'POST',
        body: JSON.stringify({ draft })
      });
      kartu.classList.add('tercatat');
      cacaTambahGelembung('caca', hasil.jawaban);
    } catch (error) {
      // Tombol dibuka lagi: yang gagal biasanya bisa diulang setelah sebabnya
      // dibereskan, dan menguncinya permanen memaksa mengetik ulang dari awal.
      kartu.querySelectorAll('button').forEach(b => { b.disabled = false; });
      cacaTambahGelembung('caca', error.message);
    }
  });
}

function cacaJejakAlat(payload) {
  if (!payload.alat) return '';
  const periode = payload.periode ? ` · ${payload.periode.dari}${payload.periode.sampai !== payload.periode.dari ? ` s/d ${payload.periode.sampai}` : ''}` : '';
  return `dari ${payload.alat}${periode}`;
}

async function cacaTanya(event) {
  event.preventDefault();
  const input = cacaEl('cacaPertanyaan');
  const pertanyaan = input.value.trim();
  if (!pertanyaan || cacaState.sedangTanya) return;

  cacaState.sedangTanya = true;
  cacaEl('cacaTanyaKirim').disabled = true;
  input.value = '';
  cacaTambahGelembung('saya', pertanyaan);
  const menunggu = cacaTambahGelembung('caca', 'Sebentar ya…');

  try {
    const store = cacaEl('cacaTanyaStore').value;
    const payload = await cacaApi(`/api/caca/tanya?store=${encodeURIComponent(store)}`, {
      method: 'POST',
      body: JSON.stringify({ pertanyaan })
    });
    menunggu.remove();
    if (payload.perluKonfirmasi && payload.draft) {
      cacaTampilkanDraft(payload);
    } else {
      // Jejak alat sengaja ditampilkan: angka yang muncul harus bisa ditelusuri
      // asalnya, bukan diterima begitu saja karena keluar dari mulut Caca.
      cacaTambahGelembung('caca', payload.jawaban, cacaJejakAlat(payload));
    }
  } catch (error) {
    menunggu.remove();
    cacaTambahGelembung('caca', error.message);
  } finally {
    cacaState.sedangTanya = false;
    cacaEl('cacaTanyaKirim').disabled = false;
    input.focus();
  }
}

function cacaRenderBaris(judul, baris, kolom) {
  if (!baris.length) return '';
  const head = kolom.map(k => `<th>${cacaEscape(k.judul)}</th>`).join('');
  const body = baris.map(item => `<tr>${kolom.map(k => `<td>${k.render(item)}</td>`).join('')}</tr>`).join('');
  return `<h4>${cacaEscape(judul)}</h4><table class="caca-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function cacaRenderHasil(payload) {
  const hasil = payload.hasil;
  const r = hasil.ringkasan;

  const penjualan = cacaRenderBaris('Penjualan', hasil.penjualan, [
    { judul: 'Tertulis', render: b => cacaEscape(b.nama_tertulis) },
    { judul: 'Barang di sistem', render: b => (b.product_name ? cacaEscape(b.product_name) : '<span class="caca-warn">belum cocok</span>') },
    { judul: 'Qty', render: b => cacaRupiah(b.qty) },
    { judul: 'Harga', render: b => cacaRupiah(b.harga_satuan) },
    { judul: 'Jumlah', render: b => cacaRupiah(b.jumlah_hitung ?? b.jumlah_tertulis) }
  ]);

  const pengeluaran = cacaRenderBaris('Pengeluaran', hasil.pengeluaran, [
    { judul: 'Tertulis', render: b => cacaEscape(b.nama_tertulis) },
    { judul: 'Banyaknya', render: b => cacaRupiah(b.banyaknya) },
    { judul: 'Jumlah', render: b => cacaRupiah(b.jumlah) }
  ]);

  const pengurang = cacaRenderBaris('Pengurang setoran', hasil.pengurang_setoran, [
    { judul: 'Tertulis', render: b => cacaEscape(b.nama_tertulis) },
    { judul: 'Jumlah', render: b => cacaRupiah(b.jumlah) }
  ]);

  const konfirmasi = hasil.perlu_konfirmasi.length
    ? `<div class="caca-konfirmasi"><h4>Caca mau memastikan dulu (${hasil.perlu_konfirmasi.length})</h4><ul>${
        hasil.perlu_konfirmasi.map(item => `<li><span class="caca-tag">${cacaEscape(item.jenis)}</span> ${cacaEscape(item.pesan)}</li>`).join('')
      }</ul></div>`
    : '<div class="caca-konfirmasi ok">Tidak ada yang janggal menurut Caca.</div>';

  cacaEl('cacaHasil').innerHTML = `
    <div class="caca-ringkas">
      <div><span>Tanggal di lembar</span><strong>${cacaEscape(hasil.tanggal_tertulis || '—')}</strong></div>
      <div><span>Gerai yang dipakai</span><strong>${cacaEscape(payload.store.code)} · ${cacaEscape(payload.store.storeName)}</strong></div>
      <div><span>Total penjualan</span><strong>${cacaRupiah(r.total_penjualan)}</strong></div>
      <div><span>Total pengeluaran</span><strong>${cacaRupiah(r.total_pengeluaran)}</strong></div>
      <div><span>Setoran</span><strong>${cacaRupiah(r.setoran)}</strong></div>
    </div>
    ${konfirmasi}
    ${penjualan}${pengeluaran}${pengurang}
    <p class="muted caca-catatan">${cacaEscape(payload.catatan)}</p>`;
}

async function cacaKirimGambar() {
  const input = cacaEl('cacaGambar');
  const file = input?.files?.[0];
  if (!file) {
    cacaEl('cacaPesan').textContent = 'Pilih dulu foto lembar rekapnya.';
    return;
  }
  if (cacaState.sedangBaca) return;

  cacaState.sedangBaca = true;
  cacaEl('cacaKirim').disabled = true;
  cacaEl('cacaPesan').textContent = 'Lagi dibaca ya, tunggu sebentar…';
  cacaEl('cacaHasil').innerHTML = '';

  try {
    const gambar = await cacaBacaBerkas(file);
    const store = cacaEl('cacaStore').value;
    const payload = await cacaApi(`/api/caca/baca-rekap?store=${encodeURIComponent(store)}`, {
      method: 'POST',
      body: JSON.stringify({ gambar })
    });
    cacaEl('cacaPesan').textContent = '';
    cacaRenderHasil(payload);
  } catch (error) {
    cacaEl('cacaPesan').textContent = error.message;
  } finally {
    cacaState.sedangBaca = false;
    cacaEl('cacaKirim').disabled = false;
  }
}

// Panel Caca hidup di luar sistem tab, jadi pindah tab tidak menyentuhnya sama
// sekali. Yang menentukan dia ada atau tidak cuma satu hal: masih login Entity
// Admin atau tidak.
function cacaSetTampil(tampil) {
  cacaEl('cacaFab')?.classList.toggle('hidden', !tampil);
  if (!tampil) cacaTutupPanel();
}

function cacaTutupPanel() {
  cacaEl('cacaPanel')?.classList.add('hidden');
  cacaEl('cacaFab')?.setAttribute('aria-expanded', 'false');
}

// Panel tidak boleh menutupi tab bar. Kalau menutupi, Bos Cyo harus menutup
// Caca dulu tiap kali mau pindah tab — persis kebalikan dari maksudnya menemani
// sambil kerja. Tinggi tab bar berubah-ubah (di layar sempit dia membungkus
// jadi beberapa baris), jadi batasnya diukur dari posisi aslinya, bukan ditebak
// dengan angka tetap di CSS.
function cacaAturTinggiPanel() {
  const panel = cacaEl('cacaPanel');
  if (!panel || panel.classList.contains('hidden')) return;
  const tabBar = document.querySelector('.admin-tabs');
  const batasAtas = tabBar ? tabBar.getBoundingClientRect().bottom + 12 : 80;
  const jarakBawah = window.innerWidth <= 560 ? 76 : 84;
  panel.style.maxHeight = `${Math.max(220, window.innerHeight - batasAtas - jarakBawah)}px`;
}

function cacaBukaPanel() {
  cacaEl('cacaPanel')?.classList.remove('hidden');
  cacaEl('cacaFab')?.setAttribute('aria-expanded', 'true');
  cacaAturTinggiPanel();
  cacaEl('cacaPertanyaan')?.focus();
  // Dimuat sekali saat pertama dibuka; percakapan yang sudah jalan tidak direset
  // waktu panel ditutup-buka lagi.
  if (!cacaState.siapDipakai) cacaMuatPanel();
}

function cacaTogglePanel() {
  const tersembunyi = cacaEl('cacaPanel')?.classList.contains('hidden');
  if (tersembunyi) cacaBukaPanel(); else cacaTutupPanel();
}

async function cacaMuatPanel() {
  try {
    const status = await cacaApi('/api/caca/status');
    cacaEl('cacaStatus').textContent = status.siap
      ? 'Caca siap membaca lembar rekap.'
      : 'Caca belum tersambung ke mesin AI — kunci API belum dipasang.';
    cacaEl('cacaKirim').disabled = !status.siap;
    cacaEl('cacaTanyaKirim').disabled = !status.siap;
    await cacaMuatGerai();
    cacaState.siapDipakai = true;
  } catch (error) {
    cacaEl('cacaStatus').textContent = error.message;
  }
}

function initCacaPanel() {
  cacaEl('cacaKirim')?.addEventListener('click', cacaKirimGambar);
  cacaEl('cacaTanyaForm')?.addEventListener('submit', cacaTanya);
  cacaEl('cacaStore')?.addEventListener('change', event => { cacaState.storeCode = event.target.value; });
  cacaEl('cacaFab')?.addEventListener('click', cacaTogglePanel);
  cacaEl('cacaTutup')?.addEventListener('click', cacaTutupPanel);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') cacaTutupPanel();
  });
  window.addEventListener('resize', cacaAturTinggiPanel);
}

window.cacaSetTampil = cacaSetTampil;
document.addEventListener('DOMContentLoaded', initCacaPanel);
