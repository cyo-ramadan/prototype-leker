const entityAdminState = {
  token: localStorage.getItem('lekerEntityAdminToken') || '',
  entityAdmin: null,
  stores: [],
  accounts: [],
  journals: [],
  sharedAccounts: [],
  productMasters: [],
  employees: []
};

const entityAdminEl = id => document.getElementById(id);
const entityAdminEscape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));

async function entityAdminApi(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (entityAdminState.token) headers.Authorization = `Bearer ${entityAdminState.token}`;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || `Request gagal (${response.status})`), { status: response.status });
  return payload;
}

function entityAdminToast(message) {
  const node = entityAdminEl('entityAdminToast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(entityAdminToast.timer);
  entityAdminToast.timer = setTimeout(() => node.classList.remove('show'), 1900);
}

async function entityAdminLogin() {
  entityAdminEl('entityAdminLoginMessage').textContent = '';
  try {
    const payload = await entityAdminApi('/api/entity-admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: entityAdminEl('entityAdminUsername').value,
        password: entityAdminEl('entityAdminPassword').value
      })
    });
    entityAdminState.token = payload.token;
    entityAdminState.entityAdmin = payload.entityAdmin;
    localStorage.setItem('lekerEntityAdminToken', payload.token);
    entityAdminEl('entityAdminPassword').value = '';
    await loadEntityAdminData();
    showEntityAdminApp();
  } catch (error) {
    entityAdminEl('entityAdminLoginMessage').textContent = error.message;
  }
}

function showEntityAdminApp() {
  entityAdminEl('entityAdminLoginView').classList.add('hidden');
  entityAdminEl('entityAdminApp').classList.remove('hidden');
  entityAdminEl('entityAdminLogoutBtn').classList.remove('hidden');
  entityAdminEl('entityAdminIdentity').textContent = entityAdminState.entityAdmin?.displayName || entityAdminState.entityAdmin?.username || 'Entity Admin';
  entityAdminEl('entityAdminEntityName').textContent = entityAdminState.entityAdmin?.entityName || 'Entity';
  renderEntityAdminStores();
  loadEntityLedger().catch(error => entityAdminToast(error.message));
  window.cacaSetTampil?.(true);
}

// --- Buku Entity ---------------------------------------------------------

function switchEntityTab(name) {
  document.querySelectorAll('[data-entity-tab]').forEach(button => button.classList.toggle('active', button.dataset.entityTab === name));
  entityAdminEl('entityTab-stores')?.classList.toggle('active', name === 'stores');
  entityAdminEl('entityTab-ledger')?.classList.toggle('active', name === 'ledger');
  entityAdminEl('entityTab-sharedaccounts')?.classList.toggle('active', name === 'sharedaccounts');
  entityAdminEl('entityTab-productmasters')?.classList.toggle('active', name === 'productmasters');
  entityAdminEl('entityTab-entityrecipes')?.classList.toggle('active', name === 'entityrecipes');
  entityAdminEl('entityTab-entitystock')?.classList.toggle('active', name === 'entitystock');
  entityAdminEl('entityTab-storereport')?.classList.toggle('active', name === 'storereport');
  entityAdminEl('entityTab-employees')?.classList.toggle('active', name === 'employees');
  entityAdminEl('entityTab-reports')?.classList.toggle('active', name === 'reports');
  if (name === 'sharedaccounts') loadEntitySharedAccounts().catch(error => entityAdminToast(error.message));
  if (name === 'productmasters') loadEntityProductMasters().catch(error => entityAdminToast(error.message));
  if (name === 'entityrecipes') loadEntityRecipes().catch(error => entityAdminToast(error.message));
  if (name === 'entitystock') window.loadEntityStockMatrix?.();
  if (name === 'storereport') window.loadEntityStoreReport?.();
  if (name === 'employees') loadEntityEmployees().catch(error => entityAdminToast(error.message));
  if (name === 'reports') renderEntityReportStoreChecklist();
}

// Master Barang & Karyawan (ADR-043) sudah entity-scoped di backend
// (src/product-master.js, src/employee-master.js), tapi endpoint-nya masih
// butuh ?store= untuk resolve entity_id (pola requireManagement yang sama
// dipakai Admin Gerai). Panel Entity Admin tidak punya konsep "gerai yang
// sedang dibuka" seperti Admin Gerai, jadi dipakai gerai PERTAMA milik
// entity ini murni sebagai kendaraan resolusi -- hasilnya tetap data
// seluruh entity, bukan data gerai itu saja (listEmployees/loadCatalog
// keduanya sudah filter by entity_id, bukan store_id).
function anyEntityStoreCode() {
  return entityAdminState.stores[0]?.code || '';
}

// --- Rekening Bersama -------------------------------------------------------
// Bos Cyo, 2026-09-20: satu Entity boleh punya lebih dari satu Rekening
// Bersama (mis. "Rekening Maxi Malang", "Rekening Bos Cyo", "Hutang Bos
// Cyo"), dipakai lintas semua gerai di entity ini. Panel ini murni
// create/rename + lihat rincian (total + breakdown per gerai + transfer yang
// masih in-transit); transfer antar gerai sendiri dikerjakan dari Admin
// Gerai (src/entity-shared-accounts.js, admin-shared-accounts.js) karena itu
// aksi operasional milik gerai pengirim/penerima, bukan konfigurasi entity.

async function loadEntitySharedAccounts() {
  const payload = await entityAdminApi(`/api/entity/shared-accounts?store=${encodeURIComponent(anyEntityStoreCode())}`);
  entityAdminState.sharedAccounts = payload.accounts || [];
  renderEntitySharedAccounts();
}

function renderEntitySharedAccounts() {
  const rows = entityAdminState.sharedAccounts || [];
  entityAdminEl('entitySharedAccountCount').textContent = rows.length;
  entityAdminEl('entitySharedAccountList').innerHTML = rows.length ? rows.map(account => `
    <div class="master-row contact-row ${account.isActive ? '' : 'inactive'}">
      <div class="master-main">
        <strong>${entityAdminEscape(account.name)}</strong>
        <div class="master-meta">${account.isActive ? 'Aktif' : 'Nonaktif'}</div>
      </div>
      <div class="master-actions">
        <button class="mini-btn" type="button" data-view-shared-account="${entityAdminEscape(account.id)}">Rincian</button>
        <button class="mini-btn" type="button" data-toggle-shared-account="${entityAdminEscape(account.id)}">${account.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button>
      </div>
    </div>`).join('') : '<div class="empty">Belum ada Rekening Bersama di entity ini.</div>';

  document.querySelectorAll('[data-view-shared-account]').forEach(button => button.onclick = () => viewEntitySharedAccount(button.dataset.viewSharedAccount));
  document.querySelectorAll('[data-toggle-shared-account]').forEach(button => button.onclick = () => toggleEntitySharedAccount(button.dataset.toggleSharedAccount));
}

async function toggleEntitySharedAccount(id) {
  const account = (entityAdminState.sharedAccounts || []).find(item => item.id === id);
  if (!account) return;
  try {
    await entityAdminApi(`/api/entity/shared-accounts/${encodeURIComponent(id)}?store=${encodeURIComponent(anyEntityStoreCode())}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !account.isActive })
    });
    await loadEntitySharedAccounts();
  } catch (error) { entityAdminToast(error.message); }
}

async function viewEntitySharedAccount(id) {
  const card = entityAdminEl('entitySharedAccountViewCard');
  try {
    const view = await entityAdminApi(`/api/entity/shared-accounts/${encodeURIComponent(id)}/view?store=${encodeURIComponent(anyEntityStoreCode())}`);
    entityAdminEl('entitySharedAccountViewTitle').textContent = `Rincian -- ${view.account.name}`;
    const breakdownRows = view.storeBreakdown.map(row => `
      <div class="master-row contact-row">
        <div class="master-main"><strong>${entityAdminEscape(row.storeCode)} · ${entityAdminEscape(row.storeName)}</strong></div>
        <div class="master-meta">Rp${entityReportRupiah(row.balance)}</div>
      </div>`).join('') || '<div class="empty">Belum ada gerai dengan saldo di rekening ini.</div>';
    const inTransitRows = view.inTransit.transfers.map(transfer => `
      <div class="master-row contact-row">
        <div class="master-main"><strong>${entityAdminEscape(transfer.fromStoreCode)} &rarr; ${entityAdminEscape(transfer.toStoreCode)}</strong><div class="master-meta">${entityAdminEscape(transfer.reason || '-')}</div></div>
        <div class="master-meta">Rp${entityReportRupiah(transfer.amount)}</div>
      </div>`).join('') || '<div class="empty">Tidak ada transfer yang masih menunggu diterima.</div>';
    entityAdminEl('entitySharedAccountViewBody').innerHTML = `
      <div class="admin-tip" style="margin-bottom:12px"><strong>Total rekening: Rp${entityReportRupiah(view.total)}</strong> (di luar Akuntansi -- murni tracking operasional)</div>
      <h3>Komposisi per gerai</h3>
      <div style="margin-bottom:14px">${breakdownRows}</div>
      <h3>Sedang transfer (in transit) -- total Rp${entityReportRupiah(view.inTransit.total)}</h3>
      <div>${inTransitRows}</div>`;
    card.style.display = '';
  } catch (error) { entityAdminToast(error.message); }
}

entityAdminEl('entitySharedAccountForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await entityAdminApi(`/api/entity/shared-accounts?store=${encodeURIComponent(anyEntityStoreCode())}`, {
      method: 'POST',
      body: JSON.stringify({ name: entityAdminEl('entitySharedAccountName').value })
    });
    entityAdminEl('entitySharedAccountForm').reset();
    await loadEntitySharedAccounts();
  } catch (error) { entityAdminToast(error.message); }
});

entityAdminEl('entitySharedAccountViewClose')?.addEventListener('click', () => {
  entityAdminEl('entitySharedAccountViewCard').style.display = 'none';
});

// --- Master Barang Entity -------------------------------------------------

// Kompresi foto sebelum dikirim -- sama persis pola imageFileToDataUrl di
// admin.js (maxSide 800, quality .76 dipakai buat foto barang di sana),
// diduplikasi kecil di sini karena entity-admin.html tidak memuat admin.js.
async function entityProductMasterImageToDataUrl(file) {
  if (!file) return '';
  if (!file.type.startsWith('image/')) throw new Error('File harus berupa gambar.');
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Gagal membaca gambar.'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gambar tidak bisa dibuka.'));
    img.src = source;
  });
  const maxSide = 800;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.76);
}

// Format sama persis admin-product-policy.js (Katalog Kode Barang Entity di
// Admin Gerai): satu bahan per baris, "nama bahan | takaran (opsional)".
function parseEntityRecipeEditorText(value) {
  return String(value || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const [ingredientLabel, quantityLabel = ''] = line.split('|').map(part => part.trim());
    return { ingredientLabel, quantityLabel };
  }).filter(component => component.ingredientLabel);
}

async function submitEntityProductMasterForm(event) {
  event.preventDefault();
  const storeCode = anyEntityStoreCode();
  if (!storeCode) return entityAdminToast('Belum ada gerai di entity ini.');
  try {
    const photoFile = entityAdminEl('entityProductMasterPhoto').files[0];
    const imageDataUrl = photoFile ? await entityProductMasterImageToDataUrl(photoFile) : '';
    const recipeComponents = parseEntityRecipeEditorText(entityAdminEl('entityProductMasterRecipe').value);
    await entityAdminApi(`/api/admin/product-masters?store=${encodeURIComponent(storeCode)}`, {
      method: 'POST',
      body: JSON.stringify({
        code: entityAdminEl('entityProductMasterCode').value,
        name: entityAdminEl('entityProductMasterName').value,
        imageData: imageDataUrl,
        recipeComponents
      })
    });
    entityAdminEl('entityProductMasterForm').reset();
    await loadEntityProductMasters();
    entityAdminToast('Kode Barang diupload');
  } catch (error) { entityAdminToast(error.message); }
}

async function saveEntityProductMasterRecipe(masterId) {
  const textarea = document.querySelector(`[data-entity-recipe-editor-input="${masterId}"]`);
  const components = parseEntityRecipeEditorText(textarea?.value);
  try {
    await entityAdminApi(`/api/admin/product-masters/${encodeURIComponent(masterId)}/recipe-components?store=${encodeURIComponent(anyEntityStoreCode())}`, {
      method: 'PUT',
      body: JSON.stringify({ components })
    });
    await loadEntityProductMasters();
    entityAdminToast('Resep acuan disimpan');
  } catch (error) { entityAdminToast(error.message); }
}

async function editEntityProductMaster(masterId) {
  const entry = (entityAdminState.productMasters || []).find(item => item.id === masterId);
  if (!entry) return;
  const name = prompt('Nama (label internal):', entry.name || '');
  if (name === null) return;
  const storeCode = anyEntityStoreCode();
  try {
    await entityAdminApi(`/api/admin/product-masters/${encodeURIComponent(masterId)}?store=${encodeURIComponent(storeCode)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name })
    });
    await loadEntityProductMasters();
    entityAdminToast('Kode Barang diperbarui');
  } catch (error) { entityAdminToast(error.message); }
}

async function loadEntityProductMasters() {
  const storeCode = anyEntityStoreCode();
  if (!storeCode) {
    entityAdminEl('entityProductMasterList').innerHTML = '<div class="empty">Belum ada gerai di entity ini.</div>';
    return;
  }
  const payload = await entityAdminApi(`/api/admin/product-masters?store=${encodeURIComponent(storeCode)}`);
  entityAdminState.productMasters = payload.catalog || [];
  renderEntityProductMasters();
}

function renderEntityProductMasterRecipeList(entry) {
  if (!entry.recipeReference.length) return '<span class="muted">Belum ada resep acuan.</span>';
  return entry.recipeReference.map(component =>
    `${entityAdminEscape(component.ingredientLabel)}${component.quantityLabel ? ` · ${entityAdminEscape(component.quantityLabel)}` : ''}`
  ).join(', ');
}

function renderEntityProductMasters() {
  const list = entityAdminEl('entityProductMasterList');
  const catalog = entityAdminState.productMasters || [];
  list.innerHTML = catalog.length ? catalog.map(entry => `
    <div class="master-row contact-row" data-entity-pm-row="${entityAdminEscape(entry.id)}">
      ${entry.imageData ? `<img class="master-thumb" src="${entityAdminEscape(entry.imageData)}" alt="${entityAdminEscape(entry.name || entry.code)}" />` : ''}
      <div class="master-main">
        <strong>${entityAdminEscape(entry.code)}${entry.name ? ` · ${entityAdminEscape(entry.name)}` : ''}</strong>
        <div class="master-meta">Dipakai ${entry.usedByStores.length} gerai${entry.usedByStores.length ? `: ${entry.usedByStores.map(u => entityAdminEscape(u.storeCode)).join(', ')}` : ''}</div>
        <div class="master-meta">Resep acuan: ${renderEntityProductMasterRecipeList(entry)}</div>
        <div class="master-meta"><button class="mini-btn" type="button" data-toggle-entity-recipe="${entityAdminEscape(entry.id)}">✎ Edit resep acuan</button></div>
        <div data-entity-recipe-editor="${entityAdminEscape(entry.id)}" class="hidden" style="margin-top:8px">
          <textarea data-entity-recipe-editor-input="${entityAdminEscape(entry.id)}" rows="3" style="width:100%" placeholder="Satu bahan per baris, format: nama bahan | takaran (takaran opsional)">${entry.recipeReference.map(c => `${c.ingredientLabel}${c.quantityLabel ? ` | ${c.quantityLabel}` : ''}`).join('\n')}</textarea>
          <button class="mini-btn" type="button" data-save-entity-recipe="${entityAdminEscape(entry.id)}">Simpan resep acuan</button>
        </div>
      </div>
      <div class="master-actions">
        <button class="mini-btn" type="button" data-edit-entity-pm="${entityAdminEscape(entry.id)}">Edit</button>
      </div>
    </div>`).join('') : '<div class="empty">Belum ada Kode Barang di entity ini. Upload lewat form di sebelah, atau daftarkan lewat field "Kode Barang" saat menambah/edit barang di Admin Gerai.</div>';
  list.querySelectorAll('[data-edit-entity-pm]').forEach(button => button.onclick = () => editEntityProductMaster(button.dataset.editEntityPm));
  list.querySelectorAll('[data-toggle-entity-recipe]').forEach(button => button.addEventListener('click', () => {
    document.querySelector(`[data-entity-recipe-editor="${button.dataset.toggleEntityRecipe}"]`)?.classList.toggle('hidden');
  }));
  list.querySelectorAll('[data-save-entity-recipe]').forEach(button => button.addEventListener('click', () => saveEntityProductMasterRecipe(button.dataset.saveEntityRecipe)));
}

// --- Resep Produksi Entity (ADR-050) ----------------------------------------
// Template resep milik Entity, dirujuk lewat Kode Barang. Disimpan di sini,
// lalu "diterapkan" ke gerai: hasilnya resep milik gerai itu sendiri.

const ENTITY_RECIPE_STATUS_LABELS = {
  READY: ['Siap diterapkan', '#2f9e44'],
  REPLACES: ['Akan menggantikan resep aktif gerai', '#8b5d00'],
  UP_TO_DATE: ['Sudah memakai revisi ini', '#6c757d'],
  BLOCKED: ['Belum bisa', '#a4133c']
};

async function loadEntityRecipes() {
  const storeCode = anyEntityStoreCode();
  const list = entityAdminEl('entityRecipeList');
  if (!storeCode) { list.innerHTML = '<div class="empty">Belum ada gerai di entity ini.</div>'; return; }
  const [recipes, catalog] = await Promise.all([
    entityAdminApi(`/api/admin/entity-recipes?store=${encodeURIComponent(storeCode)}`),
    entityAdminApi(`/api/admin/product-masters?store=${encodeURIComponent(storeCode)}`)
  ]);
  entityAdminState.entityRecipes = recipes.templates || [];
  entityAdminState.productMasters = catalog.catalog || [];
  const output = entityAdminEl('entityRecipeOutput');
  const chosen = output.value;
  output.innerHTML = '<option value="">Pilih Kode Barang…</option>' + entityAdminState.productMasters.map(entry =>
    `<option value="${entityAdminEscape(entry.id)}">${entityAdminEscape(entry.code)}${entry.name ? ` · ${entityAdminEscape(entry.name)}` : ''}</option>`).join('');
  output.value = chosen;
  renderEntityRecipes();
}

function renderEntityRecipes() {
  const list = entityAdminEl('entityRecipeList');
  const templates = entityAdminState.entityRecipes || [];
  list.innerHTML = templates.length ? templates.map(item => `
    <div class="master-row" style="align-items:flex-start">
      <div class="master-main">
        <strong>${entityAdminEscape(item.outputCode)}${item.outputName ? ` · ${entityAdminEscape(item.outputName)}` : ''}${item.variantLabel ? ` — ${entityAdminEscape(item.variantLabel)}` : ''}</strong>
        <div class="master-meta">Hasil ${item.outputQuantity} ${entityAdminEscape(item.outputUnitCode)} · revisi ${item.revision}</div>
        <div class="master-meta">Bahan: ${item.components.map(component => `${entityAdminEscape(component.code)} ${component.quantity} ${entityAdminEscape(component.unitCode)}`).join(', ')}</div>
        ${item.notes ? `<div class="master-meta">${entityAdminEscape(item.notes)}</div>` : ''}
      </div>
      <div class="master-actions">
        <button class="mini-btn" type="button" data-entity-recipe-edit="${entityAdminEscape(item.id)}">Edit</button>
        <button class="mini-btn" type="button" data-entity-recipe-preview="${entityAdminEscape(item.id)}">Pratinjau &amp; terapkan</button>
      </div>
    </div>`).join('') : '<div class="empty">Belum ada resep Entity. Isi form di sebelah.</div>';
  list.querySelectorAll('[data-entity-recipe-edit]').forEach(button => button.onclick = () => fillEntityRecipeForm(button.dataset.entityRecipeEdit));
  list.querySelectorAll('[data-entity-recipe-preview]').forEach(button => button.onclick = () => previewEntityRecipe(button.dataset.entityRecipePreview).catch(error => entityAdminToast(error.message)));
}

function fillEntityRecipeForm(templateId) {
  const item = (entityAdminState.entityRecipes || []).find(entry => entry.id === templateId);
  if (!item) return;
  entityAdminEl('entityRecipeOutput').value = item.outputMasterId;
  entityAdminEl('entityRecipeVariant').value = item.variantLabel;
  entityAdminEl('entityRecipeOutputQty').value = item.outputQuantity;
  entityAdminEl('entityRecipeOutputUnit').value = item.outputUnitCode;
  entityAdminEl('entityRecipeComponents').value = item.components.map(component => `${component.code} | ${component.quantity} | ${component.unitCode}`).join('\n');
  entityAdminEl('entityRecipeNotes').value = item.notes;
  entityAdminToast('Resep dimuat di form. Ubah lalu Simpan untuk membuat revisi baru.');
}

function parseEntityRecipeComponents(value) {
  const catalog = entityAdminState.productMasters || [];
  const lines = String(value || '').split('\n').map(line => line.trim()).filter(Boolean);
  return lines.map(line => {
    const [code, quantity, unitCode] = line.split('|').map(part => part.trim());
    const master = catalog.find(entry => entry.code.toLowerCase() === String(code || '').toLowerCase());
    if (!master) throw new Error(`Kode Barang "${code}" tidak ada di entity ini.`);
    return { masterId: master.id, quantity: Number(quantity), unitCode };
  });
}

async function submitEntityRecipeForm(event) {
  event.preventDefault();
  const storeCode = anyEntityStoreCode();
  if (!storeCode) return entityAdminToast('Belum ada gerai di entity ini.');
  try {
    const components = parseEntityRecipeComponents(entityAdminEl('entityRecipeComponents').value);
    await entityAdminApi(`/api/admin/entity-recipes?store=${encodeURIComponent(storeCode)}`, {
      method: 'PUT',
      body: JSON.stringify({
        outputMasterId: entityAdminEl('entityRecipeOutput').value,
        variantLabel: entityAdminEl('entityRecipeVariant').value,
        outputQuantity: Number(entityAdminEl('entityRecipeOutputQty').value),
        outputUnitCode: entityAdminEl('entityRecipeOutputUnit').value,
        components,
        notes: entityAdminEl('entityRecipeNotes').value
      })
    });
    entityAdminEl('entityRecipePreview').innerHTML = '';
    await loadEntityRecipes();
    entityAdminToast('Resep Entity disimpan. Belum diterapkan ke gerai mana pun.');
  } catch (error) { entityAdminToast(error.message); }
}

async function previewEntityRecipe(templateId) {
  const storeCode = anyEntityStoreCode();
  const box = entityAdminEl('entityRecipePreview');
  box.innerHTML = '<div class="muted">Memeriksa kesiapan tiap gerai…</div>';
  const payload = await entityAdminApi(`/api/admin/entity-recipes/${encodeURIComponent(templateId)}/preview?store=${encodeURIComponent(storeCode)}`);
  const title = `${payload.template.outputCode}${payload.template.variantLabel ? ` — ${payload.template.variantLabel}` : ''} (revisi ${payload.template.revision})`;
  box.innerHTML = `<div class="list-head"><h3>Terapkan: ${entityAdminEscape(title)}</h3></div>
    ${payload.stores.map(store => {
      const [label, color] = ENTITY_RECIPE_STATUS_LABELS[store.status] || [store.status, '#6c757d'];
      const selectable = store.status === 'READY' || store.status === 'REPLACES';
      const problems = (store.problems || []).map(problem => `<div class="master-meta">• ${entityAdminEscape(problem)}</div>`).join('');
      const replaces = store.status === 'REPLACES' ? `<div class="master-meta">Resep aktif gerai (revisi ${store.replacesRevision}) akan diarsipkan dan diganti revisi baru dari resep Entity.</div>` : '';
      return `<label class="master-row" style="align-items:flex-start;gap:10px">
        <input type="checkbox" data-entity-recipe-store="${entityAdminEscape(store.storeId)}" ${selectable ? '' : 'disabled'} ${store.status === 'READY' ? 'checked' : ''} />
        <div class="master-main"><strong>${entityAdminEscape(store.storeCode)} · ${entityAdminEscape(store.storeName)}</strong>
          <div class="master-meta" style="color:${color};font-weight:800">${entityAdminEscape(label)}</div>${replaces}${problems}</div>
      </label>`;
    }).join('')}
    <button class="primary-btn" type="button" data-entity-recipe-apply="${entityAdminEscape(templateId)}" style="margin-top:10px">Terapkan ke gerai terpilih</button>
    <div id="entityRecipeApplyResult" class="muted" style="margin-top:8px"></div>`;
  box.querySelector('[data-entity-recipe-apply]').onclick = () => applyEntityRecipe(templateId).catch(error => entityAdminToast(error.message));
}

async function applyEntityRecipe(templateId) {
  const storeCode = anyEntityStoreCode();
  const storeIds = [...document.querySelectorAll('[data-entity-recipe-store]:checked')].map(input => input.dataset.entityRecipeStore);
  if (!storeIds.length) return entityAdminToast('Pilih minimal satu gerai.');
  const payload = await entityAdminApi(`/api/admin/entity-recipes/${encodeURIComponent(templateId)}/apply?store=${encodeURIComponent(storeCode)}`, {
    method: 'POST',
    body: JSON.stringify({ storeIds })
  });
  const labels = { APPLIED: 'berhasil diterapkan', SKIPPED: 'dilewati (sudah terbaru)', BLOCKED: 'belum bisa', FAILED: 'gagal' };
  entityAdminToast('Penerapan selesai. Periksa hasil per gerai.');
  await previewEntityRecipe(templateId).catch(() => {});
  entityAdminEl('entityRecipeApplyResult').innerHTML = payload.results.map(result =>
    `<div>${entityAdminEscape(result.storeCode || result.storeId)}: ${entityAdminEscape(labels[result.status] || result.status)}${result.error ? ` — ${entityAdminEscape(result.error)}` : ''}${(result.problems || []).length ? ` — ${entityAdminEscape(result.problems.join('; '))}` : ''}</div>`).join('');
}

// --- Karyawan level Entity -------------------------------------------------

async function loadEntityEmployees() {
  const storeCode = anyEntityStoreCode();
  if (!storeCode) {
    entityAdminEl('entityEmployeeList').innerHTML = '<div class="empty">Belum ada gerai di entity ini.</div>';
    return;
  }
  const payload = await entityAdminApi(`/api/admin/employees?store=${encodeURIComponent(storeCode)}`);
  entityAdminState.employees = payload.employees || [];
  renderEntityEmployees();
}

function renderEntityEmployees() {
  const employees = entityAdminState.employees || [];
  entityAdminEl('entityEmployeeCount').textContent = employees.length;
  entityAdminEl('entityEmployeeList').innerHTML = employees.length ? employees.map(employee => `
    <div class="master-row contact-row ${employee.status === 'ACTIVE' ? '' : 'inactive'}">
      <div class="master-main">
        <strong>${entityAdminEscape(employee.fullName)}</strong>
        <div class="master-meta">${employee.entityLevel ? 'Level Entity (tanpa gerai perekrut)' : `Direkrut ${entityAdminEscape(employee.homeStoreCode)} · ${entityAdminEscape(employee.homeStoreName)}`} · ${employee.status === 'ACTIVE' ? 'Aktif' : 'Nonaktif'}</div>
        <div class="master-meta">${employee.links.length ? `Akun: ${employee.links.map(link => `${entityAdminEscape(link.username)}${link.storeCode ? ` @${entityAdminEscape(link.storeCode)}` : ' (Entity Admin)'}`).join(', ')}` : 'Belum ada akun ditautkan'}</div>
      </div>
    </div>`).join('') : '<div class="empty">Belum ada karyawan di entity ini.</div>';
}

// --- Laporan Net Profit Harian ---------------------------------------------

function todayJakartaDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function renderEntityReportStoreChecklist() {
  const box = entityAdminEl('entityReportStoreChecklist');
  // Mount sekali saja begitu daftar gerai sudah ada -- checklist tidak
  // boleh reset centangan pengguna tiap gonta-ganti tab bolak-balik.
  if (!box || box.dataset.mounted === '1' || !entityAdminState.stores.length) return;
  box.dataset.mounted = '1';
  box.innerHTML = entityAdminState.stores.map(store => `
    <label class="admin-check" style="font-weight:600">
      <input type="checkbox" value="${entityAdminEscape(store.code)}" checked /> ${entityAdminEscape(store.code)}
    </label>`).join('');
  if (!entityAdminEl('entityReportFrom').value) {
    const today = todayJakartaDate();
    entityAdminEl('entityReportFrom').value = today;
    entityAdminEl('entityReportTo').value = today;
  }
}

function selectedReportStoreCodes() {
  return [...document.querySelectorAll('#entityReportStoreChecklist input[type="checkbox"]:checked')].map(input => input.value);
}

const entityReportRupiah = value => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(value) || 0);

function renderEntityReportTable(payload) {
  const wrap = entityAdminEl('entityReportTableWrap');
  if (!payload.rows.length || !payload.stores.length) {
    wrap.innerHTML = '<div class="empty">Tidak ada data untuk periode/gerai ini.</div>';
    return;
  }
  const cell = value => `<td style="padding:6px 10px;text-align:right;white-space:nowrap${value < 0 ? ';color:#b91c1c;font-weight:700' : ''}">${entityReportRupiah(value)}</td>`;
  const header = `<tr>
    <th style="padding:6px 10px;text-align:left">Tanggal</th>
    ${payload.stores.map(store => `<th style="padding:6px 10px;text-align:right">${entityAdminEscape(store.code)}</th>`).join('')}
    <th style="padding:6px 10px;text-align:right">Total</th>
  </tr>`;
  const body = payload.rows.map(row => `<tr>
    <td style="padding:6px 10px;white-space:nowrap">${entityAdminEscape(row.businessDate)}</td>
    ${payload.stores.map(store => cell(row.byStore[store.code] || 0)).join('')}
    ${cell(row.total)}
  </tr>`).join('');
  const footer = `<tr style="font-weight:800;border-top:2px solid var(--line)">
    <td style="padding:6px 10px">Total</td>
    ${payload.stores.map(store => cell(payload.totals.byStore[store.code] || 0)).join('')}
    ${cell(payload.totals.total)}
  </tr>`;
  wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:14px">${header}${body}${footer}</table>`;
}

// --- Grafik perbandingan gerai (Bos Cyo, 2026-10-01) ------------------------
// Satu batang per gerai, urut dari nilai terbesar (atas) ke terkecil (bawah).
// Untung/rugi memakai hijau/merah DENGAN tanda ▲/▼ dan angka bertanda, jadi
// warna bukan satu-satunya penanda. Omset, HPP, dan Beban satu warna saja
// (besaran, bukan untung/rugi). Angka diambil dari storeTotals respons laporan
// -- sudah dijumlah di server dari rincian harian, tanpa query tambahan.

const ENTITY_REPORT_METRICS = {
  net: { label: 'Untung Bersih', kind: 'polar', value: row => row.netProfit, hint: 'Hijau = untung, merah = rugi, setelah semua beban.' },
  revenue: { label: 'Omset', kind: 'magnitude', value: row => row.revenue, hint: 'Total penjualan (belum dikurangi apa pun).' },
  gross: { label: 'Untung Kotor', kind: 'polar', value: row => row.grossProfit, hint: 'Omset + pendapatan lain - HPP, sebelum beban.' },
  beban: { label: 'Total Beban', kind: 'cost', value: row => row.totalBeban, hint: 'Beban kasir + Bea Gaji/Lapak/Lainnya + gaji dari presensi.' },
  hpp: { label: 'HPP', kind: 'cost', value: row => row.hpp, hint: 'Harga pokok barang yang terjual.' },
  margin: { label: 'Margin Bersih %', kind: 'polar', percent: true, value: row => (row.revenue > 0 ? (row.netProfit / row.revenue) * 100 : null), hint: 'Untung bersih dibagi omset.' }
};

const entityVizMinus = '\u2212';

function entityVizCompact(value) {
  const abs = Math.abs(value);
  const sign = value < 0 ? entityVizMinus : '';
  const trim = number => String(Math.round(number * 10) / 10).replace('.', ',');
  if (abs >= 1_000_000_000) return `${sign}${trim(abs / 1_000_000_000)}M`;
  if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000)}jt`;
  if (abs >= 1_000) return `${sign}${trim(abs / 1_000)}rb`;
  return `${sign}${Math.round(abs)}`;
}

const entityVizRupiah = value => `${value < 0 ? entityVizMinus : ''}Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.abs(Number(value) || 0))}`;

function entityVizFormat(metric, value) {
  if (value === null || value === undefined) return '\u2014';
  return metric.percent ? `${value < 0 ? entityVizMinus : ''}${String(Math.round(Math.abs(value) * 10) / 10).replace('.', ',')}%` : entityVizCompact(value);
}

function renderEntityReportMetricButtons() {
  const box = entityAdminEl('entityReportMetrics');
  if (!box) return;
  const current = entityAdminState.reportMetric || 'net';
  box.innerHTML = Object.entries(ENTITY_REPORT_METRICS).map(([key, metric]) =>
    `<button type="button" class="ent-viz-metric" data-entity-metric="${key}" aria-pressed="${key === current}">${entityAdminEscape(metric.label)}</button>`).join('');
  box.querySelectorAll('[data-entity-metric]').forEach(button => button.addEventListener('click', () => {
    entityAdminState.reportMetric = button.dataset.entityMetric;
    renderEntityReportMetricButtons();
    renderEntityReportChart();
  }));
}

function showEntityVizTip(event, row) {
  const tip = entityAdminEl('entityReportTip');
  if (!tip) return;
  const line = (label, value) => `<div><span>${label}</span><span>${value}</span></div>`;
  tip.innerHTML = `<strong>${entityAdminEscape(row.code)} \u00b7 ${entityAdminEscape(row.storeName || '')}</strong>
    ${line('Omset', entityVizRupiah(row.revenue))}
    ${line('Pendapatan lain', entityVizRupiah(row.otherIncome))}
    ${line('HPP', entityVizRupiah(row.hpp))}
    ${line('Untung kotor', entityVizRupiah(row.grossProfit))}
    ${row.source === 'ACCOUNTING' && (row.bebanAccounts || []).length
      ? row.bebanAccounts.map(account => line(entityAdminEscape(account.name), entityVizRupiah(account.amount))).join('')
      : `${line('Beban kasir', entityVizRupiah(row.expenseKasir))}${line('Bea gaji', entityVizRupiah(row.beaGaji))}${line('Bea lapak', entityVizRupiah(row.beaLapak))}${line('Bea lainnya', entityVizRupiah(row.beaLainnya))}`}
    ${line('Stok lebih / hilang', `${entityVizRupiah(row.stockAdjustmentGain)} / ${entityVizRupiah(row.stockAdjustmentLoss)}`)}
    ${line('<b>Untung bersih</b>', `<b>${entityVizRupiah(row.netProfit)}</b>`)}`;
  tip.style.display = 'block';
  const rect = event.currentTarget.getBoundingClientRect();
  const width = tip.offsetWidth;
  const left = Math.min(Math.max(8, rect.left + 24), window.innerWidth - width - 8);
  const below = rect.bottom + 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${below + tip.offsetHeight > window.innerHeight ? Math.max(8, rect.top - tip.offsetHeight - 8) : below}px`;
}

function hideEntityVizTip() {
  const tip = entityAdminEl('entityReportTip');
  if (tip) tip.style.display = 'none';
}

function renderEntityReportChart() {
  const wrap = entityAdminEl('entityReportChart');
  const payload = entityAdminState.reportPayload;
  if (!wrap || !payload) return;
  const stores = payload.storeTotals || [];
  if (!stores.length) { wrap.innerHTML = '<div class="empty">Tidak ada data untuk periode/gerai ini.</div>'; entityAdminEl('entityReportStoreTable').innerHTML = ''; return; }
  const metric = ENTITY_REPORT_METRICS[entityAdminState.reportMetric || 'net'];
  const rows = stores.map(store => ({ ...store, v: metric.value(store) }))
    .sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity) || a.code.localeCompare(b.code));
  const values = rows.map(row => row.v).filter(value => value !== null);
  // Semua batang tumbuh ke KANAN dari satu garis dasar di kiri; panjang = nilai
  // mutlak, untung/rugi hanya dibedakan lewat warna (permintaan Bos Cyo).
  const span = Math.max(1, ...values.map(value => Math.abs(value)));

  let summary = '';
  if (metric.kind === 'polar' && !metric.percent) {
    const total = values.reduce((sum, value) => sum + value, 0);
    summary = `Total semua gerai: <b>${entityVizRupiah(total)}</b> \u00b7 ${values.filter(value => value > 0).length} gerai untung \u00b7 ${values.filter(value => value < 0).length} gerai rugi`;
  } else if (!metric.percent) {
    summary = `Total semua gerai: <b>${entityVizRupiah(values.reduce((sum, value) => sum + value, 0))}</b>`;
  } else {
    summary = `${values.filter(value => value > 0).length} gerai untung \u00b7 ${values.filter(value => value < 0).length} gerai rugi \u00b7 gerai tanpa omset ditampilkan \u2014`;
  }
  const legend = metric.kind === 'polar'
    ? `<div class="ent-viz-legend"><span><i style="background:var(--viz-good)"></i>\u25b2 Untung</span><span><i style="background:var(--viz-bad)"></i>\u25bc Rugi</span></div>` : '';

  // Satu baris ringkas, bukan satu kotak per gerai (Bos Cyo, 2026-10-02: tujuh
  // kotak peringatan menutupi grafik di layar HP).
  const unpostedEntries = Object.entries(payload.unposted || {}).filter(([, info]) => info.count > 0);
  const unposted = unpostedEntries.length
    ? `<div class="admin-tip" style="margin:0 0 8px">Belum masuk pembukuan (angka gerai ini bisa kurang): ${unpostedEntries.map(([code, info]) => `<b>${entityAdminEscape(code)}</b> ${info.count}`).join(' \u00b7 ')}</div>`
    : '';
  wrap.innerHTML = `${unposted}<div class="ent-viz-summary">${entityAdminEscape(metric.hint)}<br>${summary} \u00b7 ${entityAdminEscape(payload.from)} s/d ${entityAdminEscape(payload.to)}</div>${legend}
    <div class="ent-viz-rows" role="list">${rows.map((row, index) => {
      const value = row.v;
      const width = value === null ? 0 : Math.max(Math.abs(value) / span * 100, value === 0 ? 0 : 0.8);
      const negative = value !== null && value < 0;
      const cls = metric.kind === 'polar' ? (negative ? 'neg' : 'pos') : metric.kind === 'cost' ? 'cost' : 'mag';
      const glyph = metric.kind === 'polar' && value !== null && value !== 0 ? (negative ? '\u25bc' : '\u25b2') : '';
      return `<div class="ent-viz-row" role="listitem" tabindex="0" data-entity-viz-row="${index}">
        <div class="ent-viz-name" title="${entityAdminEscape(row.storeName || row.code)}">${entityAdminEscape(row.code)}</div>
        <div class="ent-viz-track"><span class="ent-viz-axis"></span>${value === null ? '' : `<span class="ent-viz-bar ${cls}" style="width:${width}%"></span>`}</div>
        <div class="ent-viz-value ${negative ? 'ent-viz-neg' : ''}">${glyph ? `<small aria-hidden="true">${glyph}</small>` : ''}${entityAdminEscape(entityVizFormat(metric, value))}</div>
      </div>`;
    }).join('')}</div>`;
  wrap.querySelectorAll('[data-entity-viz-row]').forEach(node => {
    const row = rows[Number(node.dataset.entityVizRow)];
    node.addEventListener('mouseenter', event => showEntityVizTip(event, row));
    node.addEventListener('focus', event => showEntityVizTip(event, row));
    node.addEventListener('mouseleave', hideEntityVizTip);
    node.addEventListener('blur', hideEntityVizTip);
  });

  const cell = value => `<td class="${value < 0 ? 'ent-viz-neg' : ''}">${entityReportRupiah(value)}</td>`;
  entityAdminEl('entityReportStoreTable').innerHTML = `<table class="ent-viz-table"><thead><tr>
      <th>Gerai</th><th>Omset</th><th>HPP</th><th>Untung kotor</th><th>Total beban</th><th>Untung bersih</th><th>Margin</th></tr></thead><tbody>
      ${rows.map(row => `<tr><td>${entityAdminEscape(row.code)}</td>${cell(row.revenue)}${cell(row.hpp)}${cell(row.grossProfit)}${cell(row.totalBeban)}${cell(row.netProfit)}<td>${entityAdminEscape(entityVizFormat(ENTITY_REPORT_METRICS.margin, ENTITY_REPORT_METRICS.margin.value(row)))}</td></tr>`).join('')}
    </tbody></table>`;
}

async function runEntityReport() {
  const from = entityAdminEl('entityReportFrom').value;
  const to = entityAdminEl('entityReportTo').value;
  const codes = selectedReportStoreCodes();
  const status = entityAdminEl('entityReportStatus');
  if (!from || !to) { status.textContent = 'Isi dari/sampai tanggal dulu.'; return; }
  if (!codes.length) { status.textContent = 'Pilih minimal satu gerai.'; return; }
  status.textContent = 'Menghitung… (pertama kali untuk periode baru bisa agak lama, sesudahnya instan)';
  // ?store= WAJIB ada -- server memakainya untuk tahu entity mana yang
  // memanggil (selectedStore() di src/net-profit-report.js). Tanpa ini,
  // request jatuh ke gerai default (G001) yang bisa saja bukan bagian dari
  // entity Bos Cyo sama sekali, jadi seluruh gerai yang diminta ditolak
  // sebagai "di luar entity" -- laporan kelihatan kosong tanpa pesan yang
  // jelas kenapa (dibuktikan langsung, 2026-09-17).
  const callerStoreCode = anyEntityStoreCode();
  if (!callerStoreCode) { status.textContent = 'Belum ada gerai di entity ini.'; return; }
  try {
    const payload = await entityAdminApi(`/api/admin/reports/net-profit?store=${encodeURIComponent(callerStoreCode)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&stores=${encodeURIComponent(codes.join(','))}`);
    renderEntityReportTable(payload);
    entityAdminState.reportPayload = payload;
    renderEntityReportMetricButtons();
    renderEntityReportChart();
    status.textContent = '';
  } catch (error) {
    status.textContent = error.message;
  }
}

async function saveEntityEmployee(event) {
  event.preventDefault();
  const storeCode = anyEntityStoreCode();
  if (!storeCode) { entityAdminToast('Belum ada gerai di entity ini.'); return; }
  try {
    await entityAdminApi(`/api/admin/employees?store=${encodeURIComponent(storeCode)}`, {
      method: 'POST',
      body: JSON.stringify({
        scope: 'ENTITY',
        fullName: entityAdminEl('entityEmployeeName').value,
        phone: entityAdminEl('entityEmployeePhone').value,
        address: entityAdminEl('entityEmployeeAddress').value,
        note: entityAdminEl('entityEmployeeNote').value
      })
    });
    entityAdminEl('entityEmployeeForm').reset();
    await loadEntityEmployees();
    entityAdminToast('Karyawan level Entity ditambahkan');
  } catch (error) { entityAdminToast(error.message); }
}

async function loadEntityLedger() {
  const [accountsPayload, journalsPayload] = await Promise.all([
    entityAdminApi('/api/entity-admin/accounts'),
    entityAdminApi('/api/entity-admin/journals')
  ]);
  entityAdminState.accounts = accountsPayload.accounts || [];
  entityAdminState.journals = journalsPayload.journals || [];
  renderEntityAccounts();
  renderEntityJournalAccountOptions();
  renderEntityJournals();
}

const ENTITY_ACCOUNT_TYPE_LABEL = { ASSET: 'Aset', LIABILITY: 'Kewajiban', EQUITY: 'Ekuitas', REVENUE: 'Pendapatan', EXPENSE: 'Beban' };

function renderEntityAccounts() {
  entityAdminEl('entityAccountCount').textContent = entityAdminState.accounts.length;
  entityAdminEl('entityAccountList').innerHTML = entityAdminState.accounts.length ? entityAdminState.accounts.map(account => `
    <div class="master-row contact-row ${account.isActive ? '' : 'inactive'}">
      <div class="master-main">
        <strong>${entityAdminEscape(account.accountCode)} · ${entityAdminEscape(account.accountName)}</strong>
        <div class="master-meta">${entityAdminEscape(ENTITY_ACCOUNT_TYPE_LABEL[account.accountType] || account.accountType)}${account.subtype ? ` · ${entityAdminEscape(account.subtype)}` : ''} · ${account.isActive ? 'Aktif' : 'Nonaktif'}</div>
      </div>
      <div class="master-actions">
        <button class="mini-btn" type="button" data-edit-entity-account="${entityAdminEscape(account.accountId)}">Edit</button>
      </div>
    </div>`).join('') : '<div class="empty">Belum ada akun di buku Entity ini.</div>';

  document.querySelectorAll('[data-edit-entity-account]').forEach(button => button.onclick = () => editEntityAccount(button.dataset.editEntityAccount));
}

function resetEntityAccountForm() {
  entityAdminEl('entityAccountForm').reset();
  entityAdminEl('entityAccountId').value = '';
  entityAdminEl('entityAccountActive').checked = true;
  entityAdminEl('entityAccountFormTitle').textContent = 'Tambah akun Entity';
  entityAdminEl('entityAccountCancelEdit').classList.add('hidden');
}

function editEntityAccount(id) {
  const account = entityAdminState.accounts.find(item => item.accountId === id);
  if (!account) return;
  entityAdminEl('entityAccountId').value = account.accountId;
  entityAdminEl('entityAccountName').value = account.accountName;
  entityAdminEl('entityAccountType').value = account.accountType;
  entityAdminEl('entityAccountSubtype').value = account.subtype;
  entityAdminEl('entityAccountActive').checked = account.isActive;
  entityAdminEl('entityAccountFormTitle').textContent = 'Edit akun Entity';
  entityAdminEl('entityAccountCancelEdit').classList.remove('hidden');
  entityAdminEl('entityAccountForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveEntityAccount(event) {
  event.preventDefault();
  const id = entityAdminEl('entityAccountId').value;
  const payload = {
    accountName: entityAdminEl('entityAccountName').value,
    accountType: entityAdminEl('entityAccountType').value,
    subtype: entityAdminEl('entityAccountSubtype').value,
    isActive: entityAdminEl('entityAccountActive').checked
  };
  try {
    await entityAdminApi(id ? `/api/entity-admin/accounts/${encodeURIComponent(id)}` : '/api/entity-admin/accounts', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(payload)
    });
    await loadEntityLedger();
    resetEntityAccountForm();
    entityAdminToast(id ? 'Akun Entity diperbarui' : 'Akun Entity ditambahkan');
  } catch (error) { entityAdminToast(error.message); }
}

function entityJournalLineRow(index) {
  const options = entityAdminState.accounts.filter(account => account.isActive)
    .map(account => `<option value="${entityAdminEscape(account.accountId)}">${entityAdminEscape(account.accountCode)} · ${entityAdminEscape(account.accountName)}</option>`).join('');
  return `
    <div class="admin-grid two compact" data-entity-journal-line="${index}" style="margin-bottom:8px">
      <select data-line-account class="text-input"><option value="">Pilih akun…</option>${options}</select>
      <div style="display:flex;gap:8px">
        <select data-line-side class="text-input" style="max-width:110px"><option value="DEBIT">Debit</option><option value="CREDIT">Kredit</option></select>
        <input data-line-amount class="text-input" type="text" inputmode="decimal" placeholder="nominal" />
        <button class="mini-btn danger" type="button" data-remove-line>×</button>
      </div>
    </div>`;
}

function renderEntityJournalAccountOptions() {
  document.querySelectorAll('[data-line-account]').forEach(select => {
    const current = select.value;
    const options = entityAdminState.accounts.filter(account => account.isActive)
      .map(account => `<option value="${entityAdminEscape(account.accountId)}">${entityAdminEscape(account.accountCode)} · ${entityAdminEscape(account.accountName)}</option>`).join('');
    select.innerHTML = `<option value="">Pilih akun…</option>${options}`;
    select.value = current;
  });
}

function addEntityJournalLine() {
  const container = entityAdminEl('entityJournalLines');
  const index = container.children.length;
  container.insertAdjacentHTML('beforeend', entityJournalLineRow(index));
  container.lastElementChild.querySelector('[data-remove-line]').onclick = event => {
    event.target.closest('[data-entity-journal-line]').remove();
    updateEntityJournalBalanceHint();
  };
  container.querySelectorAll('[data-line-amount], [data-line-side]').forEach(input => {
    input.oninput = updateEntityJournalBalanceHint;
  });
  updateEntityJournalBalanceHint();
}

function updateEntityJournalBalanceHint() {
  let debit = 0;
  let credit = 0;
  document.querySelectorAll('[data-entity-journal-line]').forEach(row => {
    const amount = Number(String(row.querySelector('[data-line-amount]').value || '0').replace(',', '.')) || 0;
    if (row.querySelector('[data-line-side]').value === 'DEBIT') debit += amount; else credit += amount;
  });
  const hint = entityAdminEl('entityJournalBalanceHint');
  const balanced = debit === credit && debit > 0;
  hint.textContent = `Debit ${debit.toLocaleString('id-ID')} · Kredit ${credit.toLocaleString('id-ID')}${balanced ? ' · Balance ✓' : ' · belum balance'}`;
  hint.style.color = balanced ? '' : '#b45309';
}

async function submitEntityJournal(event) {
  event.preventDefault();
  const lines = [...document.querySelectorAll('[data-entity-journal-line]')].map(row => ({
    accountId: row.querySelector('[data-line-account]').value,
    side: row.querySelector('[data-line-side]').value,
    amountExact: row.querySelector('[data-line-amount]').value
  })).filter(line => line.accountId && line.amountExact);
  try {
    await entityAdminApi('/api/entity-admin/journals', {
      method: 'POST',
      body: JSON.stringify({
        businessDate: entityAdminEl('entityJournalDate').value,
        description: entityAdminEl('entityJournalDescription').value,
        journalLines: lines
      })
    });
    await loadEntityLedger();
    entityAdminEl('entityJournalForm').reset();
    entityAdminEl('entityJournalLines').innerHTML = '';
    addEntityJournalLine();
    addEntityJournalLine();
    entityAdminToast('Jurnal Entity terposting');
  } catch (error) { entityAdminToast(error.message); }
}

function renderEntityJournals() {
  entityAdminEl('entityJournalCount').textContent = entityAdminState.journals.length;
  entityAdminEl('entityJournalList').innerHTML = entityAdminState.journals.length ? entityAdminState.journals.map(journal => `
    <div class="master-row contact-row">
      <div class="master-main">
        <strong>${entityAdminEscape(journal.journalNumber)}</strong>
        <div class="master-meta">${entityAdminEscape(journal.businessDate)} · ${entityAdminEscape(journal.description)}${journal.isReversal ? ' · reversal' : ''}</div>
      </div>
    </div>`).join('') : '<div class="empty">Belum ada jurnal di buku Entity ini.</div>';
}

function showEntityAdminLogin() {
  entityAdminEl('entityAdminLoginView').classList.remove('hidden');
  entityAdminEl('entityAdminApp').classList.add('hidden');
  entityAdminEl('entityAdminLogoutBtn').classList.add('hidden');
  window.cacaSetTampil?.(false);
}

async function loadEntityAdminData() {
  const payload = await entityAdminApi('/api/entity-admin/stores');
  entityAdminState.entityAdmin = payload.entityAdmin;
  entityAdminState.stores = payload.stores || [];
  // Skin tampilan ikut tenant pemilik entity ini (public/ui-skin.js).
  window.MaxiSkin?.useEntity(payload.entityAdmin?.entityId);
}

function renderEntityAdminStores() {
  entityAdminEl('entityAdminStoreCount').textContent = entityAdminState.stores.length;
  entityAdminEl('entityAdminStoreList').innerHTML = entityAdminState.stores.length ? entityAdminState.stores.map(store => `
    <article class="owner-store-card ${store.isActive ? '' : 'inactive'}">
      <div class="owner-store-code">${entityAdminEscape(store.code)}</div>
      <h3>${entityAdminEscape(store.storeName)}</h3>
      <p>${entityAdminEscape(store.address || 'Alamat belum diisi')}</p>
      <div class="owner-store-status">${store.isActive ? '● Aktif' : '○ Nonaktif'}</div>
      <div class="owner-store-actions">
        <a class="primary-btn owner-link-btn" href="/s/${encodeURIComponent(store.code)}/admin">Buka Workspace</a>
      </div>
    </article>`).join('') : '<div class="empty">Belum ada gerai yang tertaut ke entity ini.</div>';
}

async function entityAdminLogout() {
  try { await entityAdminApi('/api/entity-admin/logout', { method: 'POST' }); } catch {}
  entityAdminState.token = '';
  entityAdminState.entityAdmin = null;
  entityAdminState.stores = [];
  window.lekerClearStaffSession?.();
  localStorage.removeItem('lekerEntityAdminToken');
  window.cacaLupakan?.();
  showEntityAdminLogin();
}

async function initEntityAdmin() {
  entityAdminEl('entityAdminLoginBtn').addEventListener('click', entityAdminLogin);
  entityAdminEl('entityAdminPassword').addEventListener('keydown', event => { if (event.key === 'Enter') entityAdminLogin(); });
  entityAdminEl('entityAdminLogoutBtn').addEventListener('click', entityAdminLogout);
  document.querySelectorAll('[data-entity-tab]').forEach(button => button.addEventListener('click', () => switchEntityTab(button.dataset.entityTab)));
  entityAdminEl('entityAccountForm').addEventListener('submit', saveEntityAccount);
  entityAdminEl('entityAccountCancelEdit').addEventListener('click', resetEntityAccountForm);
  entityAdminEl('entityJournalAddLine').addEventListener('click', addEntityJournalLine);
  entityAdminEl('entityJournalForm').addEventListener('submit', submitEntityJournal);
  addEntityJournalLine();
  addEntityJournalLine();
  entityAdminEl('entityRecipeForm')?.addEventListener('submit', submitEntityRecipeForm);
  entityAdminEl('entityRecipeRefresh')?.addEventListener('click', () => loadEntityRecipes().catch(error => entityAdminToast(error.message)));
  entityAdminEl('entityProductMasterRefresh')?.addEventListener('click', () => loadEntityProductMasters().catch(error => entityAdminToast(error.message)));
  entityAdminEl('entityProductMasterForm')?.addEventListener('submit', submitEntityProductMasterForm);
  entityAdminEl('entityEmployeeForm')?.addEventListener('submit', saveEntityEmployee);
  entityAdminEl('entityReportRun')?.addEventListener('click', () => runEntityReport());
  renderEntityReportMetricButtons();

  if (!entityAdminState.token) return showEntityAdminLogin();
  try {
    await loadEntityAdminData();
    showEntityAdminApp();
  } catch {
    localStorage.removeItem('lekerEntityAdminToken');
    entityAdminState.token = '';
    showEntityAdminLogin();
  }
}

initEntityAdmin();
