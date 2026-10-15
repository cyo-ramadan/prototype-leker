// Konfirmasi "menggantikan siapa" sesudah presensi masuk akun freelance/backup (Bos Cyo, 2026-10-15,
// ADR-058). Server menyarankan CS asli gerai ini yang shift-nya sedang/akan berjalan dan belum
// presensi. Pilihan dikirim ke /api/staff/pengganti; ditutup tanpa memilih = otomatis dari jadwal.
// Entity Admin tetap bisa mengoreksi di Rekap Dana Apresiasi.
(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));

  window.konfirmasiPengganti = (pengganti, api) => new Promise(resolve => {
    if (!pengganti?.attendanceId || !pengganti.options?.length) { resolve(); return; }
    const dialog = document.createElement('dialog');
    dialog.className = 'admin-card';
    dialog.style.cssText = 'width:min(420px,calc(100vw - 28px));padding:18px;border:1px solid var(--line, #ddd)';
    const options = [
      ...pengganti.options.map((option, index) => [option.accountId, `${option.name} (shift ${option.shift})`, index === 0]),
      ['AUTO', 'Otomatis sesuai jadwal', false],
      ['', 'Tidak menggantikan siapa pun', false]
    ];
    dialog.innerHTML = `
      <h3 style="margin-top:0">Hari ini menggantikan siapa?</h3>
      <p class="muted" style="margin:0 0 10px">Jam yang kamu jaga untuk CS ini mendapat apresiasi backup.</p>
      ${options.map(([value, label, checked]) => `<label style="display:block;margin:6px 0"><input type="radio" name="pengganti" value="${esc(value)}" ${checked ? 'checked' : ''}/> ${esc(label)}</label>`).join('')}
      <div class="staff-message hidden" data-pengganti-error></div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px"><span class="primary-btn" role="button" tabindex="0" data-pengganti-simpan>Simpan</span></div>`;
    document.body.appendChild(dialog);
    const close = () => { dialog.close(); dialog.remove(); resolve(); };
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.querySelector('[data-pengganti-simpan]').onclick = async () => {
      const value = dialog.querySelector('input[name="pengganti"]:checked')?.value ?? 'AUTO';
      try {
        await api('/api/staff/pengganti', { method: 'POST', body: JSON.stringify({ attendanceId: pengganti.attendanceId, replacesAccountId: value }), headers: { 'Content-Type': 'application/json' } });
        close();
      } catch (error) {
        const node = dialog.querySelector('[data-pengganti-error]');
        node.textContent = error.message;
        node.classList.remove('hidden');
      }
    };
    dialog.showModal();
  });
})();
