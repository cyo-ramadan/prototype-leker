// Stok bahan lintas gerai di Admin Entity (Bos Cyo, 2026-10-02): satu baris per
// bahan, satu kolom per gerai. Dimuat sesudah entity-admin.js (memakai
// entityAdminApi/entityAdminState/entityAdminEscape). Refresh manual lewat
// tombol -- tanpa polling (invariant #6). Backend: src/entity-stock.js.
(() => {
  const el = id => document.getElementById(id);
  const STORAGE_KEY = 'entityStockStores';
  const state = { kind: 'BAHAN', mounted: false, payload: null };

  const read = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; } };
  const write = value => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* browser memblokir penyimpanan: abaikan */ } };
  const number = value => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(value) || 0);

  function selectedCodes() {
    return [...document.querySelectorAll('#entityStockStores input[type="checkbox"]:checked')].map(input => input.value);
  }

  function mountChecklist() {
    const box = el('entityStockStores');
    if (!box || !entityAdminState.stores.length) return;
    const saved = read();
    const known = new Set(entityAdminState.stores.map(store => store.code));
    const chosen = new Set((saved || entityAdminState.stores.map(store => store.code)).filter(code => known.has(code)));
    // Daftar gerai bisa bertambah: gerai baru tidak otomatis dicentang kalau Bos sudah memilih sendiri.
    box.innerHTML = entityAdminState.stores.map(store => `
      <label class="admin-check" style="font-weight:600" title="${entityAdminEscape(store.storeName)}">
        <input type="checkbox" value="${entityAdminEscape(store.code)}" ${chosen.has(store.code) ? 'checked' : ''} /> ${entityAdminEscape(store.code)}
      </label>`).join('');
    box.querySelectorAll('input').forEach(input => input.addEventListener('change', () => write(selectedCodes())));
  }

  function setAll(checked) {
    document.querySelectorAll('#entityStockStores input[type="checkbox"]').forEach(input => { input.checked = checked; });
    write(selectedCodes());
  }

  function renderKindButtons() {
    document.querySelectorAll('[data-stock-kind]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.stockKind === state.kind)));
  }

  function cell(entry, store) {
    const found = entry.byStore[store.code];
    if (!found) return '<td class="stk-none" title="Barang ini tidak ada di gerai ini">–</td>';
    if (!found.tracked) return '<td class="stk-none" title="Stok barang ini tidak dilacak di gerai ini">tak dilacak</td>';
    const unit = !entry.uniformUnit && found.unit ? `<span class="stk-unit">${entityAdminEscape(found.unit)}</span>` : '';
    return `<td class="${found.quantity === 0 ? 'stk-zero' : ''}">${number(found.quantity)}${unit}</td>`;
  }

  function render() {
    const wrap = el('entityStockTable');
    const payload = state.payload;
    if (!payload) return;
    if (!payload.stores.length) { wrap.innerHTML = '<div class="empty">Pilih minimal satu gerai.</div>'; return; }
    if (!payload.rows.length) { wrap.innerHTML = '<div class="empty">Tidak ada barang yang cocok di gerai-gerai ini.</div>'; return; }
    const head = `<tr><th>${state.kind === 'BAHAN' ? 'Bahan' : 'Barang'}</th>${payload.stores.map(store => `<th title="${entityAdminEscape(store.storeName)}">${entityAdminEscape(store.code)}</th>`).join('')}<th>Total</th></tr>`;
    const body = payload.rows.map(entry => `<tr>
      <td title="${entityAdminEscape(entry.name)}">${entityAdminEscape(entry.name)}<span class="stk-sub">${entityAdminEscape(entry.unit || '')}${entry.masterCode ? ` · ${entityAdminEscape(entry.masterCode)}` : ''}${entry.uniformUnit ? '' : ' · satuan beda antar gerai'}</span></td>
      ${payload.stores.map(store => cell(entry, store)).join('')}
      <td class="stk-total">${entry.total === null ? '–' : number(entry.total)}</td>
    </tr>`).join('');
    wrap.innerHTML = `<div class="stk-wrap"><table class="stk-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      <div class="muted" style="margin-top:8px">${payload.rows.length} ${state.kind === 'BAHAN' ? 'bahan' : 'barang'} · ${payload.stores.length} gerai · angka merah = stok 0 · "–" = barang tidak ada di gerai itu · "tak dilacak" = stok tidak dihitung di gerai itu.${payload.truncated ? ' Daftar dipotong; persempit dengan pencarian atau pilih lebih sedikit gerai.' : ''}</div>`;
  }

  async function load() {
    const status = el('entityStockStatus');
    const codes = selectedCodes();
    if (!codes.length) { status.textContent = 'Pilih minimal satu gerai.'; state.payload = { stores: [], rows: [] }; render(); return; }
    const caller = anyEntityStoreCode();
    if (!caller) { status.textContent = 'Belum ada gerai di entity ini.'; return; }
    status.textContent = 'Memuat stok…';
    try {
      const params = new URLSearchParams({ store: caller, stores: codes.join(','), kind: state.kind });
      const query = el('entityStockSearch').value.trim();
      if (query) params.set('q', query);
      state.payload = await entityAdminApi(`/api/admin/entity-stock?${params}`);
      status.textContent = '';
      render();
    } catch (error) { status.textContent = error.message; }
  }

  function mount() {
    if (state.mounted) return;
    state.mounted = true;
    el('entityStockRun')?.addEventListener('click', load);
    el('entityStockAll')?.addEventListener('click', () => setAll(true));
    el('entityStockNone')?.addEventListener('click', () => setAll(false));
    el('entityStockSearch')?.addEventListener('keydown', event => { if (event.key === 'Enter') load(); });
    document.querySelectorAll('[data-stock-kind]').forEach(button => button.addEventListener('click', () => { state.kind = button.dataset.stockKind; renderKindButtons(); load(); }));
    renderKindButtons();
  }

  // Dipanggil switchEntityTab saat tab dibuka.
  window.loadEntityStockMatrix = () => {
    mount();
    mountChecklist();
    return load();
  };
})();
