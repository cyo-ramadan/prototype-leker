(() => {
  const originalButton = document.getElementById('closeDrawerBtn');
  if (!originalButton || !window.CameraSnapshotModal) return;

  const button = originalButton.cloneNode(true);
  originalButton.replaceWith(button);

  async function submitDrawerClose(blob, closingAmount, leftInDrawerAmount, closingNote) {
    const form = new FormData();
    form.set('closingAmount', String(closingAmount));
    // Setoran dihitung server: saldo kas fisik - titip laci (Bos Cyo, 2026-10-03).
    form.set('leftInDrawerAmount', String(leftInDrawerAmount));
    form.set('closingNote', closingNote || '');
    form.set('photo', blob, 'drawer-close.jpg');
    await api('/api/cashier/drawer/close', { method: 'POST', body: form });
    await loadDrawer();
    toast('Laci ditutup · Live Photo tersimpan');
  }

  function openLivePhoto() {
    openDialog({
      eyebrow: state.cashier?.store.code || 'Gerai',
      title: 'Tutup Laci',
      body: `
        <div class="field"><label>Saldo kas fisik saat tutup</label><input id="dialogClosingAmount" class="text-input" type="number" min="0" step="1" required /></div>
        <div class="field"><label>Titip laci <span class="muted">(uang yang ditinggal di laci untuk modal shift berikutnya)</span></label><input id="dialogLeftAmount" class="text-input" type="number" min="0" step="1" required /></div>
        <p class="muted" id="dialogDepositPreview">Setoran dihitung otomatis: saldo kas fisik dikurangi titip laci.</p>
        <div class="field"><label>Catatan <span class="muted">optional</span></label><textarea id="dialogClosingNote" rows="2" maxlength="500"></textarea></div>
        <p class="muted">Setelah nominal dikonfirmasi, kamera akan dibuka untuk Live Photo penutupan laci.</p>`,
      submitText: 'LANJUT FOTO',
      onSubmit: async () => {
        const closingAmount = Number(document.getElementById('dialogClosingAmount').value);
        if (!Number.isInteger(closingAmount) || closingAmount < 0) throw new Error('Saldo akhir laci wajib berupa bilangan rupiah valid.');
        const leftRaw = document.getElementById('dialogLeftAmount').value;
        const leftInDrawerAmount = Number(leftRaw);
        if (leftRaw === '' || !Number.isInteger(leftInDrawerAmount) || leftInDrawerAmount < 0) throw new Error('Titip laci wajib diisi (isi 0 kalau tidak ada yang ditinggal).');
        if (leftInDrawerAmount > closingAmount) throw new Error('Titip laci tidak boleh lebih besar dari saldo kas fisik laci.');
        const closingNote = document.getElementById('dialogClosingNote').value.trim();
        closeDialog();
        window.CameraSnapshotModal.open({
          facingMode: 'user',
          title: 'Foto Tutup Laci',
          onCaptureSuccess: async blob => {
            try {
              await submitDrawerClose(blob, closingAmount, leftInDrawerAmount, closingNote);
            } catch (error) {
              toast(error.message);
              await loadDrawer().catch(() => {});
            }
          },
          onPermissionDenied: () => {
            toast('Kamera belum diizinkan. Laci tetap terbuka.');
          }
        });
        return false;
      }
    });
  }

  // Pratinjau setoran otomatis saat kasir mengetik (tanpa polling: hanya event input).
  document.addEventListener('input', event => {
    if (event.target?.id !== 'dialogClosingAmount' && event.target?.id !== 'dialogLeftAmount') return;
    const preview = document.getElementById('dialogDepositPreview');
    const closing = Number(document.getElementById('dialogClosingAmount')?.value);
    const left = Number(document.getElementById('dialogLeftAmount')?.value);
    if (!preview || !Number.isFinite(closing) || !Number.isFinite(left)) return;
    const deposit = closing - left;
    preview.textContent = deposit < 0
      ? 'Titip laci lebih besar dari saldo kas fisik.'
      : `Setoran otomatis: Rp${new Intl.NumberFormat('id-ID').format(deposit)}`;
  });

  button.addEventListener('click', openLivePhoto);
})();
