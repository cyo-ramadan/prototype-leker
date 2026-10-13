(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const groups = {
    stores: [['stores','Daftar gerai'],['drawerstatus','Detail laci'],['employees','Tim'],['branch:cashiers','Akun kasir'],['branch:attendance-report','Presensi']],
    goods: [['branch:products','Barang & resep'],['entitystock','Stok semua gerai'],['branch:stock','Stok gerai'],['productmasters','Bagikan barang'],['branch:categories','Kategori'],['branch:suppliers','Supplier']],
    money: [['setorancs','Setoran CS'],['branch:beaops','Biaya'],['branch:hutangpiutang','Hutang / piutang'],['sharedaccounts','Rekening bersama'],['ledger','Pembukuan lanjutan']],
    reports: [['reports','Seluruh gerai'],['storereport','Per gerai'],['branch:transactions','Riwayat transaksi']],
    settings: [['customers','Pengaturan pelanggan'],['branch:contacts','Pelanggan gerai'],['branch:store','Pengaturan gerai']]
  };
  let shell, officeHost, frameHost, activeGroup = 'stores', selectedStore = '', mountedEntity = '', originalTab = 'stores', epoch = 0, office = null;
  const isH = () => window.MaxiSkin?.skin?.() === 'h';
  const state = () => typeof entityAdminState !== 'undefined' ? entityAdminState : null;
  const getToken = () => state()?.token || '';
  const entityId = () => state()?.entityAdmin?.entityId || '';
  function message(text) { const node = shell?.querySelector('[data-portal-status]'); if (node) node.textContent = text; }
  function selectSection(tab) {
    frameHost.hidden = true;
    document.querySelector('[data-entity-tab="' + tab + '"]')?.click();
  }
  function showBranch(tab) {
    const store = (state()?.stores || []).find(row => row.code === selectedStore);
    if (!store) { message('Pilih gerai terlebih dahulu.'); return; }
    document.querySelectorAll('#entityAdminApp > .admin-section').forEach(node => node.classList.remove('active'));
    frameHost.hidden = false;
    frameHost.replaceChildren();
    const label = document.createElement('p');
    label.className = 'h-portal-scope';
    label.textContent = 'Mengelola ' + (store.storeName || store.code) + ' · ' + store.code;
    const frame = document.createElement('iframe');
    frame.title = 'Administrasi ' + (store.storeName || store.code);
    frame.src = '/s/' + encodeURIComponent(store.code) + '/admin?ownerPortal=1#tab=' + encodeURIComponent(tab);
    frame.className = 'h-portal-frame';
    frameHost.append(label, frame);
  }
  function openItem(key) {
    if (!isH() || !shell) return;
    shell.querySelectorAll('[data-portal-item]').forEach(node => node.setAttribute('aria-current', String(node.dataset.portalItem === key)));
    const scoped = key.startsWith('branch:');
    shell.querySelector('[data-store-filter]').hidden = !scoped;
    shell.dataset.item = key;
    message('');
    if (scoped) showBranch(key.slice(7)); else selectSection(key);
  }
  function selectGroup(group) {
    activeGroup = groups[group] ? group : 'stores';
    shell.querySelectorAll('[data-portal-group]').forEach(node => node.setAttribute('aria-current', String(node.dataset.portalGroup === activeGroup)));
    shell.querySelector('[data-portal-subnav]').innerHTML = groups[activeGroup].map(([key,label]) => '<button type="button" class="secondary-btn" data-portal-item="' + key + '">' + esc(label) + '</button>').join('');
    openItem(groups[activeGroup][0][0]);
  }
  async function loadOffice() {
    const version = epoch;
    const target = officeHost;
    try {
      const data = await entityAdminApi('/api/management/owner-office?entity=' + encodeURIComponent(entityId()));
      if (version !== epoch || !isH() || target !== officeHost) return;
      office = data.office;
      const stores = data.stores || [];
      target.innerHTML = '<div class="h-office-heading"><div><span class="h-portal-eyebrow">KASIR ANDA</span><h2>Kantor' + (office ? ' · ' + esc(office.storeName) : '') + '</h2><p>Transaksi di sini selalu masuk ke gerai Kantor.</p></div></div><details class="h-office-settings"' + (office ? '' : ' open') + '><summary>' + (office ? 'Ganti gerai Kantor' : 'Pilih gerai Kantor') + '</summary><form data-office-form><label>Gerai Kantor<select name="storeCode" required><option value="">Pilih gerai…</option>' + stores.map(row => '<option value="' + esc(row.code) + '"' + (row.code === office?.storeCode ? ' selected' : '') + '>' + esc(row.storeName || row.code) + '</option>').join('') + '</select></label><button class="primary-btn" type="submit">Simpan Kantor</button></form></details><div data-office-status role="status"></div><div data-office-cashier></div>';
      target.querySelector('[data-office-form]').addEventListener('submit', async event => {
        event.preventDefault();
        const button = event.target.querySelector('button');
        button.disabled = true;
        try {
          await entityAdminApi('/api/management/owner-office?entity=' + encodeURIComponent(entityId()), { method:'PATCH', body:JSON.stringify({storeCode:event.target.elements.storeCode.value}) });
          if (version !== epoch || !isH()) return;
          window.OwnerOfficeCashier?.destroy();
          await loadOffice();
        } catch (error) { if (version === epoch) target.querySelector('[data-office-status]').textContent = error.message; }
        finally { button.disabled = false; }
      });
      if (office) await window.OwnerOfficeCashier?.mount(target.querySelector('[data-office-cashier]'), { entityId:entityId(), getToken, office, onError:error => { if (version === epoch) target.querySelector('[data-office-status]').textContent = error?.message || String(error); } });
    } catch (error) {
      if (version === epoch && target === officeHost) {
        target.replaceChildren();
        const text = document.createElement('p'); text.textContent = 'Kantor belum dapat dimuat: ' + error.message;
        const retry = document.createElement('button'); retry.type='button'; retry.className='secondary-btn'; retry.textContent='Coba lagi'; retry.onclick=loadOffice;
        target.append(text,retry);
      }
    }
  }
  function destroy() {
    epoch++;
    window.OwnerEntityApprovals?.destroy();
    window.OwnerOfficeCashier?.destroy();
    shell?.remove(); officeHost?.remove(); frameHost?.remove();
    shell = officeHost = frameHost = null;
    document.body.classList.remove('owner-entity-h');
    mountedEntity = ''; office = null;
    if (typeof renderEntityAdminStores === 'function') renderEntityAdminStores();
    if (typeof switchEntityTab === 'function' && state()?.entityAdmin) switchEntityTab(originalTab);
  }
  function mount() {
    const app = document.getElementById('entityAdminApp');
    if (!isH() || !entityId() || !getToken() || app?.classList.contains('hidden')) { if (shell) destroy(); return; }
    if (shell && mountedEntity === entityId()) return;
    if (shell) destroy();
    mountedEntity = entityId(); epoch++;
    originalTab = document.querySelector('[data-entity-tab].active')?.dataset.entityTab || 'stores';
    const stores = state().stores || [];
    selectedStore = stores.some(row => row.code === selectedStore) ? selectedStore : (stores[0]?.code || '');
    document.body.classList.add('owner-entity-h');
    shell = document.createElement('section'); shell.id='ownerEntityPortal';
    shell.innerHTML = '<div class="h-admin-heading"><div><span class="h-portal-eyebrow">ADMIN · SELURUH GERAI</span><h2>' + esc(state().entityAdmin.entityName || 'Usaha Anda') + '</h2></div><button class="secondary-btn" type="button" data-portal-group="settings" aria-label="Pengaturan usaha">⚙</button></div><div id="ownerEntityApprovals"></div><nav class="h-portal-nav" aria-label="Administrasi seluruh gerai">' + [['stores','Gerai'],['goods','Barang'],['money','Uang'],['reports','Laporan']].map(([key,label]) => '<button type="button" data-portal-group="' + key + '">' + label + '</button>').join('') + '</nav><div class="h-portal-subnav" data-portal-subnav></div><label data-store-filter hidden>Gerai yang dikelola<select data-portal-store>' + stores.map(row => '<option value="' + esc(row.code) + '"' + (row.code === selectedStore ? ' selected' : '') + '>' + esc(row.storeName || row.code) + '</option>').join('') + '</select></label><p data-portal-status role="status"></p>';
    const originalNav = app.querySelector('nav.admin-tabs');
    originalNav.before(shell);
    frameHost=document.createElement('section'); frameHost.className='h-portal-embedded'; frameHost.hidden=true; originalNav.after(frameHost);
    officeHost=document.createElement('section'); officeHost.id='ownerEntityOffice'; app.append(officeHost);
    shell.addEventListener('click', event => { const group=event.target.closest('[data-portal-group]'); const item=event.target.closest('[data-portal-item]'); if(group) selectGroup(group.dataset.portalGroup); if(item) openItem(item.dataset.portalItem); });
    shell.querySelector('[data-portal-store]').addEventListener('change', event => { selectedStore=event.target.value; openItem(shell.dataset.item); });
    selectGroup('stores');
    window.OwnerEntityApprovals?.mount(shell.querySelector('#ownerEntityApprovals'), { storeCode: stores[0]?.code || '', getToken, onChange:() => window.refreshEntityDrawerCards?.() });
    loadOffice();
  }
  document.addEventListener('click', event => {
    if (!isH() || !shell) return;
    const button=event.target.closest('[data-owner-store]');
    if (!button) return;
    selectedStore=button.dataset.ownerStore;
    shell.querySelector('[data-portal-store]').value=selectedStore;
    selectGroup('stores'); openItem('branch:store');
  });
  window.addEventListener('message', event => {
    const frame=frameHost?.querySelector('iframe');
    if (event.origin !== location.origin || !frame || event.source !== frame.contentWindow || !isH()) return;
    if(event.data?.type === 'owner-entity-height') frame.style.height=Math.min(30000,Math.max(450,Number(event.data.height)||450))+'px';
  });
  window.addEventListener('entity-admin-ready', mount);
  window.addEventListener('maxi-skin-change', mount);
  window.OwnerEntityPortal={mount,destroy};
  Promise.resolve(window.MaxiSkin?.ready).then(mount);
})();
