(() => {
  const originalButton = document.getElementById('closeDrawerBtn');
  if (!originalButton || !window.CameraSnapshotModal) return;

  const button = originalButton.cloneNode(true);
  originalButton.replaceWith(button);

  async function submitDrawerClose(blob, closingAmount, closingNote) {
    const form = new FormData();
    form.set('closingAmount', String(closingAmount));
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
        <div class="field"><label>Catatan <span class="muted">optional</span></label><textarea id="dialogClosingNote" rows="2" maxlength="500"></textarea></div>
        <p class="muted">Setelah nominal dikonfirmasi, kamera akan dibuka untuk Live Photo penutupan laci.</p>`,
      submitText: 'LANJUT FOTO',
      onSubmit: async () => {
        const closingAmount = Number(document.getElementById('dialogClosingAmount').value);
        if (!Number.isInteger(closingAmount) || closingAmount < 0) throw new Error('Saldo akhir laci wajib berupa bilangan rupiah valid.');
        const closingNote = document.getElementById('dialogClosingNote').value.trim();
        closeDialog();
        window.CameraSnapshotModal.open({
          facingMode: 'user',
          title: 'Foto Tutup Laci',
          onCaptureSuccess: async blob => {
            try {
              await submitDrawerClose(blob, closingAmount, closingNote);
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

  button.addEventListener('click', openLivePhoto);
})();
