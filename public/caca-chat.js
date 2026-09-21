// Panel chat Caca di Entity Admin (ADR-044 Tahap 1).
// Tahap ini hanya membaca: tidak ada tombol simpan, karena belum ada alat tulis.

const cacaState = {
  storeCode: '',
  sedangBaca: false,
  sedangTanya: false
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
    // Jejak alat sengaja ditampilkan: angka yang muncul harus bisa ditelusuri
    // asalnya, bukan diterima begitu saja karena keluar dari mulut Caca.
    cacaTambahGelembung('caca', payload.jawaban, cacaJejakAlat(payload));
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

async function cacaMuatPanel() {
  try {
    const status = await cacaApi('/api/caca/status');
    cacaEl('cacaStatus').textContent = status.siap
      ? 'Caca siap membaca lembar rekap.'
      : 'Caca belum tersambung ke mesin AI — kunci API belum dipasang.';
    cacaEl('cacaKirim').disabled = !status.siap;
    cacaEl('cacaTanyaKirim').disabled = !status.siap;
    await cacaMuatGerai();
  } catch (error) {
    cacaEl('cacaStatus').textContent = error.message;
  }
}

function initCacaPanel() {
  cacaEl('cacaKirim')?.addEventListener('click', cacaKirimGambar);
  cacaEl('cacaTanyaForm')?.addEventListener('submit', cacaTanya);
  cacaEl('cacaStore')?.addEventListener('change', event => { cacaState.storeCode = event.target.value; });
}

window.cacaMuatPanel = cacaMuatPanel;
document.addEventListener('DOMContentLoaded', initCacaPanel);
