// Stok bahan di Admin Entity (Bos Cyo, 2026-10-02). Tampilan utama: satu gerai
// sekali lihat (tombol gerai di atas untuk ganti), satu baris per bahan dengan
// satuan di samping nama. Tabel semua gerai (satu kolom per gerai) hanya
// muncul di hasil Export Excel / PDF. Dimuat sesudah entity-admin.js (memakai
// entityAdminApi/entityAdminState/entityAdminEscape). Refresh manual --
// tanpa polling (invariant #6). Backend: src/entity-stock.js.
(() => {
  const el = id => document.getElementById(id);
  const STORAGE_KEY = 'entityStockStore';
  const state = { kind: 'BAHAN', view: 'STOK', store: '', mounted: false, payload: null };

  const read = () => { try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; } };
  const write = value => { try { localStorage.setItem(STORAGE_KEY, value); } catch { /* browser memblokir penyimpanan: abaikan */ } };
  const number = value => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(value) || 0);
  const hppNumber = value => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 }).format(Number(value) || 0);
  const ANOMALY = { NOL: ['HPP nol', 'bad'], TINGGI: ['Terlalu tinggi', 'warn'], RENDAH: ['Terlalu rendah', 'warn'] };
  const kindLabel = () => (state.kind === 'BAHAN' ? 'Bahan' : 'Barang');
  const viewLabel = () => (state.view === 'HPP' ? 'hpp' : 'stok');
  const stores = () => entityAdminState.stores || [];
  const storeName = code => stores().find(store => store.code === code)?.storeName || code;
  const setStatus = message => { const node = el('entityStockStatus'); if (node) node.textContent = message || ''; };

  // ---- Tampilan satu gerai -------------------------------------------------

  function renderStoreButton() {
    const button = el('entityStockStoreBtn');
    if (button) button.innerHTML = `<span class="stk-store-code">${entityAdminEscape(state.store || '—')}</span><span class="stk-store-name">${entityAdminEscape(state.store ? storeName(state.store) : 'Pilih gerai')}</span><span aria-hidden="true">▾</span>`;
    const menu = el('entityStockStoreMenu');
    if (menu) {
      menu.innerHTML = stores().map(store => `<button type="button" role="option" data-stock-store="${entityAdminEscape(store.code)}" aria-selected="${store.code === state.store}"><b>${entityAdminEscape(store.code)}</b> ${entityAdminEscape(store.storeName || '')}</button>`).join('');
    }
  }

  function toggleMenu(open) {
    const menu = el('entityStockStoreMenu');
    const button = el('entityStockStoreBtn');
    if (!menu || !button) return;
    const next = open ?? menu.hidden;
    menu.hidden = !next;
    button.setAttribute('aria-expanded', String(next));
  }

  function cellText(found) {
    if (!found) return '<td class="stk-none">–</td>';
    if (!found.tracked) return '<td class="stk-none">tak dilacak</td>';
    return `<td class="${found.quantity === 0 ? 'stk-zero' : ''}">${number(found.quantity)}</td>`;
  }

  function render() {
    const wrap = el('entityStockTable');
    const payload = state.payload;
    if (!payload) return;
    if (!payload.rows.length) { wrap.innerHTML = '<div class="empty">Tidak ada barang yang cocok di gerai ini.</div>'; return; }
    if (state.view === 'HPP') { renderHpp(payload); return; }
    const body = payload.rows.map(entry => {
      const found = entry.byStore[state.store];
      const unit = found?.unit || entry.unit;
      return `<tr><td>${entityAdminEscape(entry.name)}${unit ? ` <span class="stk-u">(${entityAdminEscape(unit)})</span>` : ''}</td>${cellText(found)}</tr>`;
    }).join('');
    wrap.innerHTML = `<table class="stk-table"><thead><tr><th>${kindLabel()}</th><th>Stok</th></tr></thead><tbody>${body}</tbody></table>
      <div class="muted" style="margin-top:8px">${payload.rows.length} ${kindLabel().toLowerCase()} di ${entityAdminEscape(state.store)} · angka merah = stok 0 · "tak dilacak" = stok tidak dihitung.${payload.truncated ? ' Daftar dipotong; persempit dengan pencarian.' : ''}</div>`;
  }

  // HPP: harga rata-rata per satuan di gerai ini, acuan = median semua gerai (server),
  // penanda janggal dari server. Hanya dibaca; koreksinya lewat Una atau Hitung Ulang HPP.
  function hppChip(found) {
    const info = found?.anomaly && ANOMALY[found.anomaly];
    return info ? `<span class="status-chip ${info[1]}">${info[0]}</span>` : '';
  }

  function renderHpp(payload) {
    const rows = payload.rows.filter(entry => entry.byStore[state.store]);
    if (!rows.length) { el('entityStockTable').innerHTML = '<div class="empty">Tidak ada barang yang cocok di gerai ini.</div>'; return; }
    const body = rows.map(entry => {
      const found = entry.byStore[state.store];
      const unit = found.unit || entry.unit;
      const bad = Boolean(found.anomaly);
      return `<tr><td>${entityAdminEscape(entry.name)}${unit ? ` <span class="stk-u">(per ${entityAdminEscape(unit)})</span>` : ''}</td>
        <td class="${bad ? 'stk-hpp-bad' : ''}">${found.averageCost === '0' ? '<span class="stk-zero">0</span>' : `Rp${hppNumber(found.averageCost)}`}</td>
        <td>${entry.hppReference ? `Rp${hppNumber(entry.hppReference)}` : '<span class="stk-none">–</span>'}</td>
        <td>${hppChip(found)}</td></tr>`;
    }).join('');
    const flagged = rows.filter(entry => entry.byStore[state.store].anomaly).length;
    el('entityStockTable').innerHTML = `<table class="stk-table stk-hpp"><thead><tr><th>${kindLabel()}</th><th>HPP rata-rata</th><th>Acuan semua gerai</th><th>Status</th></tr></thead><tbody>${body}</tbody></table>
      <div class="muted" style="margin-top:8px">${rows.length} ${kindLabel().toLowerCase()} di ${entityAdminEscape(state.store)} · ${flagged ? `${flagged} tampak janggal` : 'tidak ada yang tampak janggal'}. Acuan = nilai tengah HPP di semua gerai yang punya barang itu (minimal 3 gerai, satuan sama); "Terlalu tinggi/rendah" = lebih dari 3 kali dari acuan, "HPP nol" = nol padahal gerai lain punya. Hanya penanda: HPP dikoreksi lewat Una atau Hitung Ulang HPP.${payload.truncated ? ' Daftar dipotong; persempit dengan pencarian.' : ''}</div>`;
  }

  async function load() {
    const caller = anyEntityStoreCode();
    if (!caller || !state.store) { setStatus('Belum ada gerai di entity ini.'); return; }
    setStatus(state.view === 'HPP' ? 'Memuat HPP…' : 'Memuat stok…');
    try {
      const params = new URLSearchParams({ store: caller, stores: state.store, kind: state.kind });
      const query = el('entityStockSearch').value.trim();
      if (query) params.set('q', query);
      state.payload = await entityAdminApi(`/api/admin/entity-stock?${params}`);
      setStatus('');
      render();
    } catch (error) { setStatus(error.message); }
  }

  function chooseStore(code) {
    state.store = code;
    write(code);
    renderStoreButton();
    toggleMenu(false);
    load();
  }

  function renderViewButtons() {
    document.querySelectorAll('[data-stock-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.stockView === state.view)));
  }

  function renderKindButtons() {
    document.querySelectorAll('[data-stock-kind]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.stockKind === state.kind)));
  }

  // ---- Export (semua gerai: satu kolom per gerai) --------------------------

  async function fetchAll() {
    const caller = anyEntityStoreCode();
    const codes = stores().map(store => store.code);
    if (!caller || !codes.length) throw new Error('Belum ada gerai di entity ini.');
    const params = new URLSearchParams({ store: caller, stores: codes.join(','), kind: state.kind });
    return entityAdminApi(`/api/admin/entity-stock?${params}`);
  }

  // Baris tabel export. Stok: [Nama, Satuan, ...stok per gerai, Total]. HPP: [Nama, Satuan,
  // ...HPP per gerai, Acuan]. null = sel kosong.
  function exportTable(payload) {
    if (state.view === 'HPP') {
      const head = [kindLabel(), 'Satuan', ...payload.stores.map(store => store.code), 'Acuan (median)'];
      const rows = payload.rows.map(entry => [
        entry.name,
        entry.uniformUnit ? entry.unit : `${entry.unit} (beda antar gerai)`,
        ...payload.stores.map(store => {
          const found = entry.byStore[store.code];
          if (!found) return null;
          return found.anomaly ? `${Number(found.averageCost)} (${ANOMALY[found.anomaly][0].toLowerCase()})` : Number(found.averageCost);
        }),
        entry.hppReference === null || entry.hppReference === undefined ? null : Number(entry.hppReference)
      ]);
      return { head, rows };
    }
    const head = [kindLabel(), 'Satuan', ...payload.stores.map(store => store.code), 'Total'];
    const rows = payload.rows.map(entry => [
      entry.name,
      entry.uniformUnit ? entry.unit : `${entry.unit} (beda antar gerai)`,
      ...payload.stores.map(store => {
        const found = entry.byStore[store.code];
        if (!found) return null;
        return found.tracked ? Number(found.quantity) : 'tak dilacak';
      }),
      entry.total === null ? null : Number(entry.total)
    ]);
    return { head, rows };
  }

  const stamp = () => new Date().toISOString().slice(0, 10);
  const filename = ext => `${viewLabel()}-${state.kind === 'BAHAN' ? 'bahan' : 'barang'}-semua-gerai-${stamp()}.${ext}`;

  // XLSX minimal tanpa pustaka: zip tanpa kompresi berisi XML.
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
    return table;
  })();
  const crc32 = bytes => { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

  function zipStore(files) {
    const encoder = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const u16 = value => [value & 0xFF, (value >>> 8) & 0xFF];
    const u32 = value => [value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF, (value >>> 24) & 0xFF];
    for (const [name, content] of files) {
      const nameBytes = encoder.encode(name);
      const data = encoder.encode(content);
      const crc = crc32(data);
      const local = new Uint8Array([0x50, 0x4B, 0x03, 0x04, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...nameBytes]);
      chunks.push(local, data);
      central.push(new Uint8Array([0x50, 0x4B, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes]));
      offset += local.length + data.length;
    }
    const centralSize = central.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array([0x50, 0x4B, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), ...u16(0)]);
    return new Blob([...chunks, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  const xmlEscape = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  const columnLetter = index => { let n = index + 1; let out = ''; while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); } return out; };

  function buildXlsx({ head, rows }) {
    const cell = (value, col, rowNo, style) => {
      const ref = `${columnLetter(col)}${rowNo}`;
      if (value === null || value === undefined || value === '') return '';
      if (typeof value === 'number') return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    };
    const sheetRows = [head, ...rows].map((row, index) => `<row r="${index + 1}">${row.map((value, col) => cell(value, col, index + 1, index === 0 ? 1 : 0)).join('')}</row>`).join('');
    const cols = head.map((_, index) => `<col min="${index + 1}" max="${index + 1}" width="${index === 0 ? 34 : index === 1 ? 10 : 12}" customWidth="1"/>`).join('');
    const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    return zipStore([
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${state.view === 'HPP' ? 'HPP' : 'Stok'}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
      ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${sheetRows}</sheetData></worksheet>`]
    ]);
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function exportExcel() {
    setStatus('Menyiapkan Excel…');
    try {
      const payload = await fetchAll();
      download(buildXlsx(exportTable(payload)), filename('xlsx'));
      setStatus(`Excel siap: ${payload.rows.length} baris, ${payload.stores.length} gerai.`);
    } catch (error) { setStatus(error.message); }
  }

  // PDF lewat dialog cetak browser ("Simpan sebagai PDF"). Jendela dibuka
  // lebih dulu (saat klik) supaya tidak diblokir pop-up, diisi setelah data datang.
  async function exportPdf() {
    const win = window.open('', '_blank');
    if (!win) { setStatus('Browser memblokir jendela baru. Izinkan pop-up untuk halaman ini lalu coba lagi.'); return; }
    win.document.write('<p style="font-family:sans-serif">Menyiapkan PDF…</p>');
    setStatus('Menyiapkan PDF…');
    try {
      const payload = await fetchAll();
      const { head, rows } = exportTable(payload);
      const cells = row => row.map((value, index) => `<${index === 0 ? 'th' : 'td'} class="${index > 1 ? 'n' : ''}">${value === null ? '' : entityAdminEscape(typeof value === 'number' ? (state.view === 'HPP' ? hppNumber(value) : number(value)) : value)}</${index === 0 ? 'th' : 'td'}>`).join('');
      win.document.open();
      win.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${entityAdminEscape(filename('pdf').replace(/\.pdf$/, ''))}</title>
        <style>@page{size:A4 landscape;margin:10mm}body{font:11px/1.35 Arial,sans-serif;color:#111}h1{font-size:15px;margin:0 0 2px}p{margin:0 0 8px;color:#555}
        table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:3px 5px;text-align:left}thead th{background:#eee}td.n,thead th:nth-child(n+3){text-align:right}tr{page-break-inside:avoid}thead{display:table-header-group}</style></head>
        <body><h1>${state.view === 'HPP' ? 'HPP' : 'Stok'} ${state.kind === 'BAHAN' ? 'bahan' : 'barang'} semua gerai</h1><p>${new Date().toLocaleString('id-ID')} · ${payload.rows.length} baris · ${payload.stores.length} gerai</p>
        <table><thead><tr>${head.map(h => `<th>${entityAdminEscape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${cells(row)}</tr>`).join('')}</tbody></table>
        <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
      win.document.close();
      setStatus(`PDF siap: ${payload.rows.length} baris, ${payload.stores.length} gerai. Di dialog cetak pilih "Simpan sebagai PDF".`);
    } catch (error) { win.close(); setStatus(error.message); }
  }

  // ---- Pasang --------------------------------------------------------------

  function mount() {
    if (state.mounted) return;
    state.mounted = true;
    el('entityStockStoreBtn')?.addEventListener('click', event => { event.stopPropagation(); toggleMenu(); });
    el('entityStockStoreMenu')?.addEventListener('click', event => {
      const choice = event.target.closest('[data-stock-store]');
      if (choice) chooseStore(choice.dataset.stockStore);
    });
    document.addEventListener('click', () => toggleMenu(false));
    el('entityStockRun')?.addEventListener('click', load);
    el('entityStockXlsx')?.addEventListener('click', exportExcel);
    el('entityStockPdf')?.addEventListener('click', exportPdf);
    el('entityStockSearch')?.addEventListener('keydown', event => { if (event.key === 'Enter') load(); });
    document.querySelectorAll('[data-stock-kind]').forEach(button => button.addEventListener('click', () => { state.kind = button.dataset.stockKind; renderKindButtons(); load(); }));
    document.querySelectorAll('[data-stock-view]').forEach(button => button.addEventListener('click', () => {
      state.view = button.dataset.stockView === 'HPP' ? 'HPP' : 'STOK';
      renderViewButtons();
      // Data yang sama dipakai dua tampilan: tidak perlu muat ulang dari server.
      if (state.payload) render(); else load();
    }));
    renderKindButtons();
    renderViewButtons();
  }

  // Dipanggil switchEntityTab saat tab dibuka.
  window.loadEntityStockMatrix = () => {
    mount();
    const codes = stores().map(store => store.code);
    if (!codes.includes(state.store)) {
      const saved = read();
      state.store = codes.includes(saved) ? saved : (codes[0] || '');
    }
    renderStoreButton();
    return load();
  };
})();
