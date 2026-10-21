// Entity Admin -> Pengaturan -> Fina (HR) -- paket H1 (contracts/fina-hr-paket-v1.md).
// Aturan HR yang dipakai Fina: bawaan entity + override per gerai. Kosongkan isian = ikut tingkat
// di atasnya (gerai -> entity -> bawaan aplikasi). Tarif & denda hanya ditampilkan; diaturnya tetap
// di kartu Dana Apresiasi. Dimuat saat tab Pengaturan dibuka, tanpa polling (invariant #6).
(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  const num = value => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(value) || 0);
  const api = (options) => entityAdminApi('/api/entity-admin/fina/settings', options);
  const toast = message => entityAdminToast(message);
  let data = null;

  const angka = (name, label, value, bawaan, [min, max]) => `<label class="admin-field">${esc(label)}<input class="text-input" name="${name}" type="number" min="${min}" max="${max}" step="1" value="${value ?? ''}" placeholder="${esc(`ikut: ${bawaan}`)}" /></label>`;

  function lintasGerai(value, bawaan) {
    const pilihan = [['', `Ikut atas (${bawaan ? 'ya' : 'tidak'})`], ['1', 'Ya, boleh dari gerai lain'], ['0', 'Tidak, gerai sendiri saja']];
    const current = value === null || value === undefined ? '' : (value ? '1' : '0');
    return `<label class="admin-field">Backup lintas gerai<select class="text-input" name="backupLintasGerai">${pilihan.map(([v, label]) => `<option value="${v}" ${v === current ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>`;
  }

  function isian(nilai, atas) {
    const r = data.rentang;
    return `<div class="form-grid">
      ${angka('deteksiKosongMenit', 'Gerai dianggap kosong setelah (menit tanpa presensi)', nilai?.deteksiKosongMenit, atas.deteksiKosongMenit, r.deteksiKosongMenit)}
      ${angka('tawaranSerentak', 'Freelance ditawari sekaligus (orang)', nilai?.tawaranSerentak, atas.tawaranSerentak, r.tawaranSerentak)}
      ${angka('batasTungguMenit', 'Lapor admin bila tak ada yang bisa dalam (menit)', nilai?.batasTungguMenit, atas.batasTungguMenit, r.batasTungguMenit)}
      ${lintasGerai(nilai?.backupLintasGerai, atas.backupLintasGerai)}
      ${angka('spBerlakuHari', 'Masa berlaku SP (hari)', nilai?.spBerlakuHari, atas.spBerlakuHari, r.spBerlakuHari)}
      <label class="admin-field">Tingkatan SP (dipisah koma, dari yang paling ringan)<input class="text-input" name="spTingkat" maxlength="140" value="${esc((nilai?.spTingkat || []).join(', '))}" placeholder="${esc(`ikut: ${atas.spTingkat.join(', ')}`)}" /></label>
      <label class="admin-field" style="grid-column:1/-1">Kop surat (nama usaha, alamat)<textarea class="text-input" name="kopSurat" rows="2" maxlength="${r.kopSuratPanjang}" placeholder="${esc(atas.kopSurat ? `ikut: ${atas.kopSurat}` : 'belum diisi')}">${esc(nilai?.kopSurat || '')}</textarea></label>
    </div>`;
  }

  function render() {
    const host = el('entityFinaPengaturan');
    if (!host || !data) return;
    host.innerHTML = `
      <div class="list-head"><div><h2 style="margin:0">Fina (HR)</h2>
        <div class="muted">Aturan yang dipakai Fina saat mencari gerai kosong, menawarkan backup ke freelance, dan menyiapkan draft SP. Isian kosong = ikut bawaan entity, lalu bawaan aplikasi. Tarif dan denda tetap diatur di kartu Dana Apresiasi. Fina hanya menyiapkan; keputusan soal orang dan uang tetap di Admin.</div></div></div>
      <form class="admin-card" data-fina-form="" style="margin:10px 0">
        <h3 style="margin-top:0">Bawaan entity</h3>
        ${isian(data.entity.tersimpan, data.bawaan)}
        <button class="primary-btn" type="submit" data-fina-simpan="entity">Simpan bawaan Fina</button>
      </form>
      <div class="master-list">${data.stores.map(gerai).join('')}</div>`;
    host.querySelectorAll('[data-fina-form]').forEach(form => {
      form.onsubmit = async event => {
        event.preventDefault();
        const nilai = Object.fromEntries(new FormData(form));
        const body = { ...nilai, storeId: form.dataset.finaForm, backupLintasGerai: nilai.backupLintasGerai === '' ? null : nilai.backupLintasGerai === '1' };
        try { await api({ method: 'PUT', body: JSON.stringify(body) }); toast('Pengaturan Fina disimpan.'); await load(); } catch (error) { toast(error.message); }
      };
    });
  }

  function gerai(store) {
    const e = store.efektif;
    const a = store.apresiasi;
    return `
      <details class="admin-card" style="margin-bottom:10px">
        <summary><strong>${esc(store.storeCode)}</strong> · kosong setelah ${e.deteksiKosongMenit} mnt · tawari ${e.tawaranSerentak} freelance · ${e.backupLintasGerai ? 'lintas gerai' : 'gerai sendiri'}${store.override ? ' · <span class="status-chip warn">diatur khusus</span>' : ''}</summary>
        <p class="field-note" style="margin:8px 0">Dana Apresiasi gerai ini: ${a.aktif ? `ON, Rp${num(a.tarifPerJamRupiah)}/jam${a.dendaAktif ? ', denda ON' : ', denda OFF'}` : 'OFF'} (diatur di kartu Dana Apresiasi).</p>
        <form data-fina-form="${esc(store.storeId)}" style="margin:8px 0">
          ${isian(store.override, data.entity.efektif)}
          <span class="field-note">Kosongkan untuk ikut bawaan entity.</span>
          <button class="primary-btn" type="submit" data-fina-simpan="${esc(store.storeId)}">Simpan Fina gerai ${esc(store.storeCode)}</button>
        </form>
      </details>`;
  }

  async function load() {
    const host = el('entityFinaPengaturan');
    if (!host) return;
    try { data = await api(); render(); } catch (error) { host.innerHTML = `<div class="staff-message">${esc(error.message)}</div>`; }
  }

  window.addEventListener('entity-admin-tab', event => { if (event.detail?.name === 'settings') load(); });
  window.loadEntityFinaPengaturan = load;
})();
