(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  function create({ host, items, getId = item => item.id, getLabel = item => item.name, getMeta = () => '', getDefaultAmount = () => 0, openLabel = 'Tambah Item', itemLabel = 'Item', priceLabel = 'Nominal / unit', detailTitle = 'Detail', priceEditable = true, renderDetails = true, initialExpanded = true, amountMode = 'perUnit', onAdd = null, onError = () => {}, onLinesChange = () => {} }) {
    host = typeof host === 'string' ? document.querySelector(host) : host;
    if (!host) throw new Error('PIMASATU host tidak ditemukan.');
    const isToggleMode = amountMode === 'toggle';
    const state = { selectedId: null, lines: [], expanded: false, activeField: 'perUnit' };
    const list = () => typeof items === 'function' ? items() : items;
    host.className = `${host.className} pimasatu`.trim();
    // type="number" only understands a period as decimal separator; Indonesian
    // keyboards/locale type a comma, and the browser silently drops it (or the
    // whole keystroke) so the parsed value is wrong. The per-unit price field
    // (toggle mode's default, and the classic behaviour kasir already knows)
    // uses a plain text input (still numeric keyboard via inputmode) and
    // normalizes comma -> period ourselves instead of trusting the number input.
    const priceInputAttrs = isToggleMode ? `type="text" inputmode="decimal"` : `type="number" min="0" step="any"`;
    const pricePlaceholder = isToggleMode ? 'Terisi otomatis, boleh koma' : 'Terisi otomatis';
    // Toggle mode: harga per satuan (klasik, sudah biasa dipakai kasir) tetap
    // jadi default aktif. Kolom "Total belanja" ada di sampingnya, terkunci
    // sampai tombol hijau ditekan -- baru saat itu kolom total yang aktif dan
    // harga per satuan yang terkunci. Reset ke default (harga per satuan aktif)
    // begitu barisnya sudah ditambahkan.
    const totalFieldHtml = isToggleMode ? `
      <div class="field pimasatu-total-wrap">
        <label>Total belanja barang ini</label>
        <div class="pimasatu-total-row">
          <input class="text-input pimasatu-total" type="number" min="0" step="1" placeholder="Isi total dibayar" disabled />
          <button type="button" class="pimasatu-amount-toggle" title="Isi berdasar total belanja, bukan harga per satuan" style="background:var(--green,#168a45);color:#fff;border:0;border-radius:8px;width:34px;height:34px;font-weight:900;cursor:pointer;flex-shrink:0">⇄</button>
        </div>
      </div>` : '';
    host.innerHTML = `<button type="button" class="pimasatu-toggle">＋ ${esc(openLabel)}</button><section class="pimasatu-composer hidden"><div class="field pimasatu-search-wrap"><label>${esc(itemLabel)}</label><input class="text-input pimasatu-search" autocomplete="off" placeholder="Cari dan pilih"/><div class="pimasatu-results hidden"></div></div><div class="pimasatu-input-row${isToggleMode ? ' has-total' : ''}"><div class="field"><label>Qty</label><input class="text-input pimasatu-qty" type="number" min="1" step="1" value="1"/></div><div class="field"><label>${esc(priceLabel)}</label><input class="text-input pimasatu-price" ${priceInputAttrs} placeholder="${esc(pricePlaceholder)}"/></div>${totalFieldHtml}</div><div class="muted pimasatu-hint">Pilih item untuk mengisi nominal.</div><button type="button" class="secondary-btn pimasatu-add">＋ Masukkan</button></section><div class="pimasatu-detail-head"><strong>${esc(detailTitle)}</strong><span>Terbaru di atas</span></div><div class="pimasatu-lines"></div>`;
    const composer = host.querySelector('.pimasatu-composer'), search = host.querySelector('.pimasatu-search'), results = host.querySelector('.pimasatu-results'), qty = host.querySelector('.pimasatu-qty'), price = host.querySelector('.pimasatu-price'), total = host.querySelector('.pimasatu-total'), amountToggle = host.querySelector('.pimasatu-amount-toggle'), hint = host.querySelector('.pimasatu-hint'), linesHost = host.querySelector('.pimasatu-lines'), toggle = host.querySelector('.pimasatu-toggle');
    price.readOnly = !priceEditable;
    if (!renderDetails) host.querySelector('.pimasatu-detail-head').classList.add('hidden');
    const money = value => new Intl.NumberFormat('id-ID', { style:'currency', currency:'IDR', maximumFractionDigits:0 }).format(Number(value) || 0);
    const unitMoney = value => new Intl.NumberFormat('id-ID', { style:'currency', currency:'IDR', maximumFractionDigits:4 }).format(Number(value) || 0);
    const parseDecimal = raw => Number(String(raw).trim().replace(',', '.'));
    function lockStyle(field, locked) { field.disabled = locked; field.style.background = locked ? '#f3f4f6' : ''; field.style.color = locked ? '#9ca3af' : ''; }
    function applyActiveField() {
      if (!isToggleMode) return;
      const perUnitActive = state.activeField === 'perUnit';
      lockStyle(price, !perUnitActive);
      lockStyle(total, perUnitActive);
    }
    function setExpanded(value) { state.expanded = value; composer.classList.toggle('hidden', !value); toggle.classList.toggle('hidden', value); toggle.textContent = `＋ ${openLabel}`; }
    function reset() {
      state.selectedId = null; search.value = ''; qty.value = '1'; price.value = ''; if (total) total.value = '';
      state.activeField = 'perUnit'; applyActiveField();
      hint.textContent = 'Pilih item untuk mengisi nominal.'; results.classList.add('hidden');
    }
    function renderResults() { const key = search.value.trim().toLowerCase(); const found = list().filter(item => !key || `${getLabel(item)} ${getMeta(item)}`.toLowerCase().includes(key)).slice(0,8); results.innerHTML = found.length ? found.map(item => `<button type="button" data-result="${esc(getId(item))}"><strong>${esc(getLabel(item))}</strong><span>${esc(getMeta(item))}</span></button>`).join('') : '<div class="pimasatu-empty">Tidak ditemukan.</div>'; results.classList.remove('hidden'); }
    function renderLines() { if(!renderDetails){linesHost.classList.add('hidden');return;} linesHost.innerHTML = state.lines.length ? state.lines.map((line,index) => `<article class="pimasatu-line"><div><strong>${esc(line.label)}</strong><span>${esc(line.meta)}</span></div><label>Qty<input class="text-input" data-line-qty="${index}" type="number" min="1" step="1" value="${line.quantity}"/></label><div><strong>${money(line.quantity*line.unitAmount)}</strong>${isToggleMode ? `<small class="muted">${unitMoney(line.unitAmount)}/unit</small>` : ''}<button type="button" class="text-btn" data-remove="${index}">Hapus</button></div></article>`).join('') : '<div class="muted pimasatu-empty">Belum ada item.</div>'; linesHost.querySelectorAll('[data-remove]').forEach(button => button.onclick = () => { state.lines.splice(Number(button.dataset.remove),1); renderLines(); onLinesChange(state.lines.slice()); }); linesHost.querySelectorAll('[data-line-qty]').forEach(input => input.onchange = () => { const value=Number(input.value); if(value>0){state.lines[Number(input.dataset.lineQty)].quantity=value; renderLines(); onLinesChange(state.lines.slice());} }); }
    toggle.onclick = () => setExpanded(true); search.onfocus = renderResults; search.oninput = () => { state.selectedId=null; price.value=''; if (total) total.value=''; renderResults(); };
    if (amountToggle) amountToggle.onclick = () => { state.activeField = state.activeField === 'perUnit' ? 'total' : 'perUnit'; applyActiveField(); };
    results.onclick = event => {
      const button=event.target.closest('[data-result]'); if(!button)return;
      const item=list().find(candidate=>String(getId(candidate))===String(button.dataset.result));
      state.selectedId=getId(item); search.value=getLabel(item);
      price.value=String(Number(getDefaultAmount(item))||'');
      if (total) total.value = '';
      state.activeField = 'perUnit'; applyActiveField();
      hint.textContent=getMeta(item);
      results.classList.add('hidden');
    };
    host.querySelector('.pimasatu-add').onclick = () => {
      const item=list().find(candidate=>String(getId(candidate))===String(state.selectedId));
      const quantity=Number(qty.value);
      if(!item)return onError('Pilih item dari hasil pencarian.');
      if(!(quantity>0))return onError('Qty wajib lebih dari 0.');
      if(renderDetails&&state.lines.some(line=>String(line.id)===String(getId(item))))return onError('Item sudah ada di detail.');
      let line;
      if (isToggleMode && state.activeField === 'total') {
        const enteredTotal = Number(total.value);
        if(!Number.isSafeInteger(enteredTotal)||enteredTotal<=0)return onError('Total belanja wajib bilangan bulat lebih dari 0.');
        line = { id:getId(item), item, label:getLabel(item), meta:getMeta(item), quantity, unitAmount: enteredTotal / quantity };
      } else {
        const unitAmount = isToggleMode ? parseDecimal(price.value) : Number(price.value);
        const amountValid = isToggleMode ? (Number.isFinite(unitAmount) && unitAmount >= 0) : (Number.isSafeInteger(unitAmount) && unitAmount >= 0);
        if(!amountValid)return onError('Nominal tidak valid.');
        line = { id:getId(item), item, label:getLabel(item), meta:getMeta(item), quantity, unitAmount };
      }
      if(renderDetails) state.lines.unshift(line);
      if(onAdd) onAdd(line);
      renderLines(); onLinesChange(state.lines.slice()); reset(); setExpanded(true);
    };
    renderLines(); setExpanded(initialExpanded); applyActiveField();
    return { getLines:()=>state.lines.slice(), clear:()=>{state.lines=[];reset();renderLines();}, open:()=>setExpanded(true) };
  }
  window.MAXIPimasatu = { version:'1.4.0', create };
})();
