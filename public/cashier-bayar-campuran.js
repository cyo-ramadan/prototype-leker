// Pembayaran campuran di dialog penjualan kasir (Bos Cyo, 2026-10-17): "ada yang beli 12 ribu, qris 5000
// cash 7000". Menambah pilihan "🔀 Campuran" di Cara bayar; bila dipilih muncul dua baris cara bayar +
// nominal, baris kedua terisi otomatis dari sisa total. Rincian dikirim lewat pembungkus penjualan di
// cashier-payment-methods.js (payload.payments). Server yang menegakkan aturan (jumlah = total, tanpa
// cara bayar hutang, saklar tenant) -- di sini hanya membantu kasir.
(() => {
  const byId = id => document.getElementById(id);
  const angka = value => Number(String(value ?? '').replace(/\D/g, '')) || 0;
  const rupiah = value => `Rp${Number(value || 0).toLocaleString('id-ID')}`;
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  let enabled = null;

  async function aktif() {
    if (enabled !== null) return enabled;
    try { enabled = Boolean((await api('/api/cashier/pembayaran-campuran')).enabled); } catch { enabled = false; }
    return enabled;
  }

  const total = () => angka(byId('saleDialogTotal')?.textContent);
  const pilihan = () => (Array.isArray(state.paymentMethods) ? state.paymentMethods : [])
    .filter(item => item.code && item.code !== 'CAMPURAN' && item.code !== 'PAYABLE');

  function pasangPilihan() {
    const select = byId('saleDialogPaymentMethod');
    if (!select || select.querySelector('option[value="CAMPURAN"]') || pilihan().length < 2) return;
    select.insertAdjacentHTML('beforeend', '<option value="CAMPURAN">🔀 Campuran (2 cara bayar)</option>');
    if (!select.dataset.campuranBound) {
      select.dataset.campuranBound = '1';
      select.addEventListener('change', tampilkan);
    }
  }

  function hitungSisa() {
    const pertama = angka(byId('saleSplitAmount1')?.value);
    const sisa = Math.max(0, total() - pertama);
    if (byId('saleSplitAmount2')) byId('saleSplitAmount2').value = sisa ? sisa.toLocaleString('id-ID') : '';
    const info = byId('saleSplitInfo');
    const teks = `Total ${rupiah(total())} · ${rupiah(pertama)} + ${rupiah(sisa)}`;
    if (info && info.textContent !== teks) info.textContent = teks; // hanya bila berubah: observer di bawah tidak berputar
  }

  function tampilkan() {
    const select = byId('saleDialogPaymentMethod');
    let box = byId('saleSplitBox');
    if (!select || select.value !== 'CAMPURAN') { box?.remove(); return; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'saleSplitBox';
      box.className = 'field';
      (select.closest('.field') || select).insertAdjacentElement('afterend', box);
    }
    const list = pilihan();
    const pertama = list.find(item => item.code === 'QRIS')?.code || list.find(item => item.code !== 'CASH')?.code || list[0].code;
    const kedua = list.find(item => item.code === 'CASH' && item.code !== pertama)?.code || list.find(item => item.code !== pertama)?.code;
    const opsi = kode => list.map(item => `<option value="${esc(item.code)}" ${item.code === kode ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
    box.innerHTML = `<label>Rincian bayar campuran</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <select id="saleSplitMethod1" class="text-input">${opsi(pertama)}</select>
        <input id="saleSplitAmount1" class="text-input" inputmode="numeric" placeholder="Nominal" />
        <select id="saleSplitMethod2" class="text-input">${opsi(kedua)}</select>
        <input id="saleSplitAmount2" class="text-input" inputmode="numeric" placeholder="Sisa otomatis" readonly />
      </div>
      <div id="saleSplitInfo" class="muted"></div>`;
    byId('saleSplitAmount1').addEventListener('input', hitungSisa);
    hitungSisa();
  }

  // Dipanggil pembungkus penjualan. null = bukan campuran. Melempar Error bila isian belum benar.
  function payments() {
    if (byId('saleDialogPaymentMethod')?.value !== 'CAMPURAN') return null;
    hitungSisa();
    const bagian = [
      { paymentMethod: byId('saleSplitMethod1')?.value, amount: angka(byId('saleSplitAmount1')?.value) },
      { paymentMethod: byId('saleSplitMethod2')?.value, amount: angka(byId('saleSplitAmount2')?.value) }
    ];
    if (bagian.some(item => !item.paymentMethod || item.amount <= 0)) throw new Error('Isi nominal bagian pertama; bagian kedua harus lebih dari 0.');
    if (bagian[0].paymentMethod === bagian[1].paymentMethod) throw new Error('Pilih dua cara bayar yang berbeda.');
    return bagian;
  }

  // Dialog penjualan merender ulang pilihan cara bayar (async) -- pasang lagi pilihan Campuran setiap
  // kali isinya berubah, dan hitung ulang sisa saat total berubah.
  const observer = new MutationObserver(() => {
    if (enabled) pasangPilihan();
    if (byId('saleSplitBox')) hitungSisa();
  });
  document.addEventListener('cashier:sale-dialog-opened', async () => {
    if (!await aktif()) return;
    const root = byId('saleDialogPaymentMethod')?.closest('dialog') || document.body;
    observer.disconnect();
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    pasangPilihan();
    tampilkan();
  });

  window.CashierBayarCampuran = { payments };
})();
