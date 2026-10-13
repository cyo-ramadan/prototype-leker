// Tombol "Sinkronisasi Akuntansi" di tab Karyawan Entity Admin (Bos Cyo, 2026-10-13). Buku Akuntansi
// = acuan dan tidak disentuh; yang ditambah hanya baris "Sinkronisasi Akuntansi" di riwayat Portal
// Staf & panel Entity (src/sinkron-akuntansi.js, migration 0153). Alur: klik -> pratinjau semua
// selisih per orang/gerai/jenis (centang, bawaannya semua) -> "Sinkronkan yang dicentang" sekali.
// Pratinjau dimuat per karyawan, maksimal 4 bersamaan, hanya saat tombol ditekan (bukan polling).
(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  const rupiah = value => `${Number(value) < 0 ? '−' : ''}Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.abs(Number(value) || 0))}`;
  const signed = value => `${Number(value) < 0 ? '−' : '+'}Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.abs(Number(value) || 0))}`;
  const KIND_LABEL = { setoran: 'Setoran', gaji: 'Hutang Gaji' };
  let rows = [];

  function dialog() {
    let node = el('entitySinkronDialog');
    if (node) return node;
    node = document.createElement('dialog');
    node.id = 'entitySinkronDialog';
    node.className = 'admin-card';
    node.style.cssText = 'width:min(820px,calc(100vw - 28px));max-height:86vh;overflow:auto;padding:18px;border:1px solid var(--line)';
    document.body.appendChild(node);
    return node;
  }

  function employees() {
    return (typeof entityAdminState !== 'undefined' ? entityAdminState.employees : []) || [];
  }

  async function loadPreview(progress) {
    const queue = [...employees()];
    const found = [];
    const errors = [];
    let done = 0;
    const worker = async () => {
      for (let employee = queue.shift(); employee; employee = queue.shift()) {
        try {
          const data = await entityAdminApi(`/api/entity-admin/employees/${encodeURIComponent(employee.id)}/sync-preview`);
          for (const item of data.items || []) found.push({ ...item, employeeId: employee.id, employeeName: data.employee?.fullName || employee.fullName });
        } catch (error) { errors.push(`${employee.fullName}: ${error.message}`); }
        progress(++done, employees().length);
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    found.sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName), 'id') || a.storeCode.localeCompare(b.storeCode) || a.kind.localeCompare(b.kind));
    return { found, errors };
  }

  function render(node, errors) {
    const total = rows.length;
    const checked = rows.filter(row => row.checked).length;
    node.innerHTML = `
      <div class="list-head"><div><h2 style="margin:0">Sinkronisasi Akuntansi</h2>
        <div class="muted">Buku Akuntansi menjadi acuan dan <b>tidak diubah</b>. Tiap baris yang dicentang menambah satu baris "Sinkronisasi Akuntansi" di riwayat Portal Staf dan panel Entity sebesar selisihnya, supaya riwayat sama dengan buku. Baris ini tidak masuk Akuntansi dan bisa dibatalkan dari Riwayat Setoran / Riwayat Hutang Gaji.</div></div>
        <button class="secondary-btn" type="button" data-sinkron-close>Tutup</button></div>
      ${errors.length ? `<div class="admin-tip" style="margin:10px 0">Sebagian belum dapat dihitung: ${esc(errors.join(' · '))}</div>` : ''}
      ${total ? `
        <label class="admin-check" style="margin:10px 0"><input type="checkbox" data-sinkron-all ${checked === total ? 'checked' : ''} /> Centang semua (${total} baris)</label>
        <div class="master-list">${rows.map((row, index) => `
          <label class="master-row" style="cursor:pointer">
            <input type="checkbox" data-sinkron-row="${index}" ${row.checked ? 'checked' : ''} style="margin-right:10px" />
            <div class="master-main"><strong>${esc(row.employeeName)}</strong> <span class="muted">· ${esc(row.storeCode)} · ${esc(KIND_LABEL[row.kind] || row.kind)}</span>
              <div class="master-meta">Buku Akuntansi ${esc(rupiah(row.bookRupiah))} · Riwayat sekarang ${esc(rupiah(row.displayedRupiah))}</div></div>
            <div style="text-align:right"><strong>${esc(signed(row.selisihRupiah))}</strong><div class="master-meta">baris sinkronisasi</div></div>
          </label>`).join('')}</div>
        <button class="primary-btn" type="button" data-sinkron-save style="margin-top:12px" ${checked ? '' : 'disabled'}>Sinkronkan yang dicentang (${checked})</button>`
      : '<div class="empty" style="margin-top:12px">Semua riwayat sudah sama dengan buku Akuntansi. Tidak ada yang perlu disinkronkan.</div>'}`;
    node.querySelector('[data-sinkron-close]').onclick = () => node.close();
    node.querySelector('[data-sinkron-all]')?.addEventListener('change', event => { rows.forEach(row => { row.checked = event.target.checked; }); render(node, errors); });
    node.querySelectorAll('[data-sinkron-row]').forEach(box => box.addEventListener('change', () => { rows[Number(box.dataset.sinkronRow)].checked = box.checked; render(node, errors); }));
    const save = node.querySelector('[data-sinkron-save]');
    if (save) save.onclick = () => simpan(node);
  }

  async function simpan(node) {
    const picked = rows.filter(row => row.checked);
    if (!picked.length) return;
    if (!window.confirm(`Sinkronkan ${picked.length} baris? Buku Akuntansi tidak berubah; riwayat Portal Staf dan panel Entity ditambah baris "Sinkronisasi Akuntansi".`)) return;
    const byEmployee = new Map();
    for (const row of picked) {
      if (!byEmployee.has(row.employeeId)) byEmployee.set(row.employeeId, []);
      byEmployee.get(row.employeeId).push({ kind: row.kind, storeId: row.storeId, selisihRupiah: row.selisihRupiah });
    }
    node.querySelector('[data-sinkron-save]').disabled = true;
    const tally = { TERSINKRON: 0, SUDAH_SAMA: 0, BERUBAH: 0, GAGAL: 0 };
    for (const [employeeId, items] of byEmployee) {
      try {
        const result = await entityAdminApi(`/api/entity-admin/employees/${encodeURIComponent(employeeId)}/sync`, { method: 'POST', body: JSON.stringify({ items }) });
        for (const item of result.results || []) tally[item.status] = (tally[item.status] || 0) + 1;
      } catch { tally.GAGAL += items.length; }
    }
    entityAdminToast(`${tally.TERSINKRON} baris tersinkron${tally.BERUBAH ? ` · ${tally.BERUBAH} berubah sejak dihitung, cek lagi` : ''}${tally.GAGAL ? ` · ${tally.GAGAL} gagal` : ''}`);
    window.loadEntityEmployeeBalances?.({ force: true });
    window.renderEntityEmployees?.();
    await open();
  }

  async function open() {
    const node = dialog();
    if (!node.open) node.showModal();
    node.innerHTML = '<div class="muted">Menghitung selisih… <span data-sinkron-progress></span></div>';
    const { found, errors } = await loadPreview((done, total) => {
      const progress = node.querySelector('[data-sinkron-progress]');
      if (progress) progress.textContent = `${done}/${total} karyawan`;
    });
    rows = found.map(item => ({ ...item, checked: true }));
    render(node, errors);
  }

  el('entityEmployeeSyncBtn')?.addEventListener('click', () => { open().catch(error => entityAdminToast(error.message)); });
  window.openEntitySinkronAkuntansi = open;
})();
