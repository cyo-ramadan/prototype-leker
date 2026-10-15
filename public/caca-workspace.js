/* Durable task host. Adapters keep chat, future calls, and review on the same task boundary. */
(() => {
  'use strict';
  let adapter = null; let identity = ''; let selected = null; let open = false; let epoch = 0; let localId = 0;
  const tasks = new Map(); const views = new Map();
  const labels = { DRAFT: 'Menunggu pemeriksaan', NEEDS_INPUT: 'Perlu dilengkapi', RUNNING: 'Sedang diproses', PARTIAL: 'Belum selesai', COMPLETED: 'Selesai', CANCELLED: 'Dibatalkan', INDETERMINATE: 'Hasil belum pasti — periksa manual', SAVING: 'Menyimpan draft', SAVE_FAILED: 'Draft belum tersimpan' };
  const $ = id => document.getElementById(id);
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; };
  const button = (text, action, cls = 'secondary-btn') => { const el = node('button', text, cls); el.type = 'button'; el.addEventListener('click', action); return el; };
  const clone = value => JSON.parse(JSON.stringify(value));
  const live = marker => adapter && marker === epoch && identity && adapter.getIdentity() === identity;
  const editable = task => !task.ephemeral && task.cursor === 0 && ['DRAFT', 'NEEDS_INPUT'].includes(task.status);
  const queryScope = task => task.scope.lingkup === 'entity' ? '__entity__' : task.scope.storeCode;
  const keyScope = task => task.scope?.label || task.scope?.storeCode || 'Entity';
  function emit(task) { document.dispatchEvent(new CustomEvent('una-workspace:update', { detail: { id: task.id, status: task.status, revision: task.revision, cursor: task.cursor, total: task.total, scope: task.scope } })); }
  function current() { return tasks.get(selected); }
  function context() { const task = current(); return task && ['DRAFT', 'NEEDS_INPUT'].includes(task.status) ? { id: task.id, revision: task.revision, scope: queryScope(task), dirty: !!views.get(task.id)?.dirty } : null; }
  function status(text) { if ($('cacaWorkspaceStatus')) $('cacaWorkspaceStatus').textContent = text || ''; }
  function ensure() {
    if ($('cacaWorkspace')) return;
    const panel = node('section', null, 'caca-workspace hidden'); panel.id = 'cacaWorkspace'; panel.setAttribute('aria-label', 'Workspace Una');
    const head = node('header', null, 'caca-workspace-head'); head.append(node('h2', 'Workspace Una'), button('Kembali ke chat', closeWorkspace), button('Muat ulang', () => refresh()));
    const hint = node('p', 'Pilih tugas, periksa isi dan dampaknya, lalu setujui. Chat tetap dapat dipakai selama tugas terbuka.', 'caca-workspace-hint');
    const message = node('p', '', 'caca-workspace-status'); message.id = 'cacaWorkspaceStatus'; message.setAttribute('role', 'status');
    const grid = node('div', null, 'caca-workspace-grid'); const list = node('nav', null, 'caca-workspace-list'); list.id = 'cacaWorkspaceList'; list.setAttribute('aria-label', 'Daftar tugas');
    const detail = node('main', null, 'caca-workspace-detail'); detail.id = 'cacaWorkspaceDetail'; grid.append(list, detail); panel.append(head, hint, message, grid); document.body.append(panel); renderList();
  }
  function configure(value) { if (adapter && identity !== value.getIdentity()) reset(); adapter = value; identity = value.getIdentity(); ensure(); window.UnaLembar?.configure({...value,selectTask:select}); }
  function assertSession(marker) { if (!live(marker)) throw new Error('Sesi Workspace berubah. Buka kembali setelah login.'); }
  async function request(path, options = {}, scope = adapter?.getScope()) {
    const marker = epoch; assertSession(marker); const value = await adapter.api('/api/caca/workspace' + path + '?' + adapter.scopeQuery(scope), options); assertSession(marker); return value;
  }
  function titleFor(draft, pending) { return draft?.aksi ? (draft.aksi === 'buat_barang_banyak' ? 'buat_barang' : draft.aksi).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : pending?.alat ? pending.alat.replace(/_/g, ' ') : 'Draft pengeluaran'; }
  function countFor(draft) { return draft?.bertahap ? draft.muatan?.daftar?.length || 0 : draft ? 1 : 0; }
  function requestedCount(task) { const rows = (task.draft?.tangkapan || task.tertunda?.tangkapan)?.daftar_barang; return Array.isArray(rows) ? rows.length : task.total || 1; }
  function summary(task) { const count = requestedCount(task); const omitted = Math.max(0, count - task.total); return `${count} draft \u00b7 ${task.title}\n${task.total} siap${omitted ? ` \u00b7 ${omitted} belum ikut; periksa dampak` : ''} \u00b7 ${labels[task.status] || task.status} \u00b7 ${keyScope(task)}${task.ephemeral ? ' \u00b7 hanya sesi ini' : ''}`; }
  function renderList() {
    const host = $('cacaWorkspaceList'); if (!host) return; host.replaceChildren();
    if (!tasks.size) { host.append(node('p', 'Belum ada tugas. Beri perintah lewat chat untuk mulai.', 'muted')); $('cacaWorkspaceDetail')?.replaceChildren(node('p', 'Draft dan pekerjaan Una akan muncul di sini.', 'muted')); }
    for (const task of [...tasks.values()].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))) {
      const pick = button(summary(task), () => select(task.id), 'caca-workspace-task'); pick.setAttribute('aria-current', String(selected === task.id)); host.append(pick);
      const view = views.get(task.id); if (view?.compact) view.compact.textContent = summary(task);
    }
  }
  function put(task, options = {}) {
    const old = tasks.get(task.id); const view = views.get(task.id);
    if (old) {
      if (task.revision < old.revision || (task.revision === old.revision && task.cursor < old.cursor)) return;
      if (task.revision === old.revision && task.cursor === old.cursor) {
        const oldTime = Date.parse(old.updatedAt); const nextTime = Date.parse(task.updatedAt);
        if ((Number.isFinite(oldTime) && Number.isFinite(nextTime) && nextTime < oldTime) || (task.results?.length || 0) < (old.results?.length || 0)) return;
        const terminal = ['COMPLETED', 'CANCELLED', 'INDETERMINATE'].includes(old.status);
        const reconcile = old.status === 'INDETERMINATE' && view?.localUncertain && options.reconcileUncertain;
        if (terminal && old.status !== task.status && !reconcile) return;
      }
    }
    if (old && view?.dirty && task.revision !== old.revision && !options.force) {
      view.incoming = task; view.warning.textContent = 'Ada versi baru dari server. Isian yang sedang diedit tetap disimpan di layar. Pilih Muat versi server untuk membuang edit lokal.'; return;
    }
    if (options.reconcileUncertain && view) view.localUncertain = false;
    const selectedDraftAdvanced = selected === task.id && old && ['DRAFT', 'NEEDS_INPUT'].includes(task.status)
      && (task.revision !== old.revision || JSON.stringify(task.draft) !== JSON.stringify(old.draft) || JSON.stringify(task.tertunda) !== JSON.stringify(old.tertunda));
    tasks.set(task.id, task); if (selectedDraftAdvanced) bindPending(task); renderList(); if (selected === task.id) renderDetail(task); emit(task);
  }
  function bindPending(task) {
    const pending = task.tertunda || (task.draft?.aksi && task.draft.tangkapan ? { alat: task.draft.aksi, tangkapan: task.draft.tangkapan, revisi: true, tanya: '', kurang: null } : null);
    adapter.setPending(['DRAFT', 'NEEDS_INPUT'].includes(task.status) ? pending : null);
  }
  function select(id) { const task = tasks.get(id); if (!task) return; selected = id; bindPending(task); renderList(); renderDetail(task); emit(task); }
  function draftEditor(task, view) {
    const capture = task.draft?.tangkapan || task.tertunda?.tangkapan; const action = task.draft?.aksi || task.tertunda?.alat;
    const rows = action === 'buat_barang_banyak' && Array.isArray(capture?.daftar_barang) ? capture.daftar_barang : null;
    if (!rows || !editable(task)) return;
    const form = node('div', null, 'caca-workspace-editor'); form.append(node('h3', 'Koreksi nama dan harga barang'));
    form.append(node('p', 'Simpan koreksi agar server menyusun ulang draft, kesiapan, dan dampaknya. Setelah itu periksa ulang sebelum menyetujui.', 'muted'));
    view.edited = clone(capture); view.inputs = [];
    rows.forEach((row, index) => {
      const line = node('div', null, 'caca-workspace-edit-row');
      for (const [key, label] of [['nama', 'Nama barang'], ['harga_jual', 'Harga jual'], ['harga_beli', 'Harga beli']]) {
        const field = node('label', label, 'admin-field'); const input = node('input'); input.type = 'text'; input.value = row[key] ?? ''; input.maxLength = key === 'nama' ? 100 : 40;
        if (key !== 'nama') input.inputMode = 'decimal'; input.addEventListener('input', () => { view.edited.daftar_barang[index][key] = input.value; view.dirty = true; view.review.checked = false; view.approve.disabled = true; view.warning.textContent = 'Ada edit lokal yang belum disimpan. Persetujuan menunggu koreksi disimpan dan diperiksa ulang.'; });
        view.inputs.push(input); field.append(input); line.append(field);
      }
      form.append(line);
    });
    const save = button('Simpan koreksi & susun ulang', async () => {
      if (!view.dirty || view.busy || !editable(tasks.get(task.id))) return;
      view.busy = true; save.disabled = true; updateActions(tasks.get(task.id), view);
      try { const result = await request('/' + encodeURIComponent(task.id), { method: 'PATCH', body: JSON.stringify({ revision: task.revision, tangkapan: view.edited }) }, queryScope(task)); view.dirty = false; view.renderedRevision = null; view.warning.textContent = ''; put(result.workspace, { force: true }); if (selected === task.id) bindPending(tasks.get(result.workspace.id)); }
      catch (error) { view.warning.textContent = error.message + ' Edit lokal belum dibuang. Muat ulang untuk memeriksa versi server.'; }
      finally { view.busy = false; save.disabled = false; if (tasks.has(task.id)) updateActions(tasks.get(task.id), view); }
    });
    form.append(save); view.body.append(form);
  }
  function renderDetail(task) {
    let view = views.get(task.id);
    if (!view) { view = {}; views.set(task.id, view); }
    if (!view.root) {
      view.root = node('article', null, 'caca-workspace-record'); view.heading = node('h3'); view.scope = node('p', '', 'muted'); view.progress = node('p', '', 'caca-workspace-progress'); view.readiness = node('p', '', 'caca-workspace-readiness'); view.warning = node('p', '', 'caca-workspace-warning'); view.warning.setAttribute('role', 'status'); view.body = node('div');
      view.results = node('div', null, 'caca-workspace-results'); view.candidates = node('div', null, 'caca-workspace-candidates'); view.actions = node('div', null, 'caca-workspace-actions'); view.root.append(view.heading, view.scope, view.progress, view.readiness, view.warning, view.body, view.results, view.candidates, view.actions);
    }
    const host = $('cacaWorkspaceDetail'); if (host && host.firstElementChild !== view.root) host.replaceChildren(view.root);
    view.heading.textContent = task.title; view.scope.textContent = `${keyScope(task)} · Lingkup tugas tetap sesuai saat dibuat${task.ephemeral ? ' · Draft berisi kredensial: hanya disimpan dalam sesi ini, hilang saat halaman ditutup' : ''}`;
    view.progress.textContent = `${labels[task.status] || task.status} · ${task.cursor || 0}/${task.total || 0} langkah selesai${view.pauseRequested ? ' · Jeda setelah langkah berjalan selesai' : ''}`;
    const requested = requestedCount(task); view.readiness.textContent = requested > task.total ? `${requested} baris diminta; hanya ${task.total} baris masuk eksekusi versi ini. ${requested - task.total} baris belum ikut. Periksa dampak di bawah dan lengkapi atau koreksi isian bila perlu sebelum menyetujui.` : '';
    view.results.replaceChildren();
    if (task.results?.length) { view.results.append(node('h4', 'Hasil langkah tersimpan')); for (const item of task.results) { const r = item.result || {}; view.results.append(node('p', `${item.index + 1}. ${r.jawaban || [r.nama, r.hasil].filter(Boolean).join(', ') || item.status || 'Selesai'}`)); } }
    if (view.renderedRevision === task.revision && view.renderedStatus === task.status || view.dirty) { updateActions(task, view); return; }
    view.renderedRevision = task.revision; view.renderedStatus = task.status; view.body.replaceChildren(); view.actions.replaceChildren();
    if (task.draft) {
      view.card = adapter.renderDraft(task.draft); view.body.append(view.card);
    } else { view.body.append(node('p', task.tertunda?.tanya || 'Lengkapi tugas ini lewat chat.', 'muted')); }
    const reviewLabel = node('label', null, 'caca-workspace-review'); view.review = node('input'); view.review.type = 'checkbox'; reviewLabel.append(view.review, node('span', `Sudah memeriksa isi, lingkup, dan dampak versi ${task.revision || 1}. Persetujuan mencakup seluruh ${task.total || 0} langkah siap; Jeda berhenti setelah langkah berjalan selesai.`));
    view.approve = button(task.cursor ? 'Lanjutkan dari langkah tersimpan' : 'Ya, jalankan draft yang diperiksa', () => execute(task.id), 'primary-btn'); view.review.addEventListener('change', () => updateActions(tasks.get(task.id), view));
    view.pause = button('Jeda sesudah langkah ini', () => { view.pauseRequested = true; renderDetail(tasks.get(task.id)); });
    view.cancel = button('Batalkan draft', () => cancel(task.id));
    view.reload = button('Muat versi server', async () => { if (view.busy) return; try { const result = await request('/' + encodeURIComponent(task.id), {}, queryScope(task)); view.dirty = false; view.renderedRevision = null; view.warning.textContent = ''; put(result.workspace, { force: true, reconcileUncertain: true }); } catch (error) { view.warning.textContent = error.message; } });
    view.actions.append(reviewLabel, view.approve, view.pause, view.cancel, view.reload); draftEditor(task, view); updateActions(task, view);
    if (task.status === 'SAVE_FAILED') view.actions.append(button('Coba simpan draft lagi', () => persist(task.id)));
  }
  function updateActions(task, view) {
    if (!view.approve) return;
    const canRun = ['DRAFT', 'PARTIAL'].includes(task.status) && !!task.draft;
    for (const input of view.inputs || []) input.disabled = !!view.busy || !editable(task);
    view.approve.disabled = !canRun || !!view.dirty || !!view.busy || !view.review.checked;
    view.review.disabled = !canRun || !!view.dirty || !!view.busy;
    view.pause.hidden = !view.busy || !task.total || task.total < 2;
    view.cancel.disabled = !!view.busy || task.cursor > 0 || !['DRAFT', 'NEEDS_INPUT'].includes(task.status);
    view.reload.disabled = !!view.busy || task.ephemeral || task.status === 'SAVING';
  }
  async function refresh() {
    if (!adapter?.getIdentity()) return; if (adapter.getIdentity() !== identity) { reset(); return; }
    ensure(); status('Memuat pekerjaan tersimpan…');
    try { const result = await request(''); for (const task of result.items || []) put(task); status(''); if (!selected && tasks.size) select(tasks.keys().next().value); }
    catch (error) { status('Pekerjaan belum dapat dimuat: ' + error.message); }
  }
  async function persist(id) {
    const task = tasks.get(id); const view = views.get(id); if (!task || task.persisting) return;
    task.persisting = true; task.status = 'SAVING'; put(task); const marker = epoch;
    try {
      const result = await request('', { method: 'POST', body: JSON.stringify({ title: task.title, ...(task.draft ? { draft: task.draft } : { tertunda: task.tertunda }) }) }, queryScope(task));
      if (!live(marker)) return;
      tasks.delete(id); views.delete(id); views.set(result.workspace.id, view || {}); if (selected === id) selected = result.workspace.id; put(result.workspace);
      view?.compact?.setAttribute('data-una-workspace-task', result.workspace.id); if (selected === result.workspace.id) bindPending(tasks.get(result.workspace.id));
    } catch (error) {
      if (!live(marker)) return;
      task.status = error.code === 'CACA_WORKSPACE_SENSITIVE' ? 'DRAFT' : 'SAVE_FAILED'; task.ephemeral = error.code === 'CACA_WORKSPACE_SENSITIVE';
      if (view) { view.warning.textContent = task.ephemeral ? 'Kredensial tidak disimpan ke server. Draft ini hanya hidup di sesi ini; periksa dan setujui secara terpisah.' : 'Draft belum tersimpan. Tidak dapat dijalankan sebelum penyimpanan berhasil. ' + error.message; view.renderedRevision = null; }
      put(task);
    } finally { task.persisting = false; }
  }
  function offerCandidate(view, payload, scope, options, reason) {
    view.candidate = { payload, scope, options };
    view.warning.textContent = reason;
    view.candidates.replaceChildren(node('p', 'Koreksi chat tersedia tanpa mengganti isian yang sedang dikerjakan.', 'muted'));
    view.candidates.append(button('Pertahankan edit lokal (Rekomendasi Codex: isian Anda tetap aman)', () => { view.candidate = null; view.candidates.replaceChildren(); }), button('Buat draft terpisah dari koreksi chat', () => { view.candidate = null; view.candidates.replaceChildren(); capture({ ...payload, revisi: false, _workspaceContext: null }, scope, options); }));
    status('Koreksi chat belum mengganti tugas yang sedang diedit.');
  }
  function capture(payload, scope, options = {}) {
    ensure(); const draft = payload.draft || null; const pending = payload.tertunda || null;
    const context = payload._workspaceContext; const existing = context?.id && tasks.get(context.id);
    if ((payload.revisi || existing?.status === 'NEEDS_INPUT') && existing && queryScope(existing) === scope) {
      const view = views.get(existing.id) || {};
      if (view.dirty || context.revision !== existing.revision) { offerCandidate(view, payload, scope, options, 'Edit lokal atau versi yang lebih baru dipertahankan. Periksa koreksi chat secara terpisah.'); return existing.id; }
      void (async () => {
        try { const result = await request('/' + encodeURIComponent(existing.id), { method: 'PATCH', body: JSON.stringify({ revision: context.revision, ...(draft ? { draft } : { tertunda: pending }) }) }, scope); views.get(existing.id).sesudah = options.sesudah || view.sesudah; put(result.workspace); if (selected === existing.id) bindPending(tasks.get(result.workspace.id)); }
        catch (error) { if (view.warning) offerCandidate(view, payload, scope, options, 'Koreksi belum tersimpan: ' + error.message); }
      })(); return existing.id;
    }
    const id = 'local-' + ++localId; const task = { id, title: titleFor(draft, pending), draft, tertunda: pending, scope: { lingkup: scope === '__entity__' ? 'entity' : 'gerai', storeCode: scope === '__entity__' ? '' : scope, label: adapter.scopeLabel(scope) }, status: 'SAVING', revision: 1, cursor: 0, total: countFor(draft), results: [], updatedAt: new Date().toISOString() };
    const compact = adapter.addCompact(summary(task), id); const view = { compact, sesudah: options.sesudah }; views.set(id, view); tasks.set(id, task);
    compact.addEventListener('click', event => { event.preventDefault?.(); openWorkspace([...views.entries()].find(([, v]) => v === view)?.[0] || id); });
    if (!current() || !views.get(selected)?.dirty) select(id); else renderList(); void persist(id); return id;
  }
  async function cancel(id = selected) {
    const task = tasks.get(id); const view = views.get(id); if (!task || task.cursor || view?.busy || !['DRAFT', 'NEEDS_INPUT'].includes(task.status)) return false;
    try { const updated = task.ephemeral ? { ...task, status: 'CANCELLED' } : (await request('/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ revision: task.revision, cancel: true }) }, queryScope(task))).workspace; put(updated); if (selected === id) adapter.setPending(null); view?.sesudah?.('batal'); adapter.onCancel?.(updated); return true; }
    catch (error) { if (view) view.warning.textContent = error.message; return false; }
  }
  async function execute(id) {
    let task = tasks.get(id); const view = views.get(id); if (!task || !view?.review?.checked || view.dirty || view.busy || !['DRAFT', 'PARTIAL'].includes(task.status)) return;
    const marker = epoch; view.busy = true; view.pauseRequested = false; updateActions(task, view); view.warning.textContent = '';
    try {
      while (live(marker)) {
        const response = task.ephemeral ? await adapter.executeEphemeral(task.draft, queryScope(task), task.draft.bertahap ? task.cursor : null) : await request('/' + encodeURIComponent(task.id) + '/catat', { method: 'POST', body: JSON.stringify({ revision: task.revision, expectedCursor: task.cursor }) }, queryScope(task));
        assertSession(marker);
        if (task.ephemeral) { task.results.push({ index: task.cursor, result: response.result }); task.cursor++; task.status = task.cursor >= task.total ? 'COMPLETED' : 'PARTIAL'; task.revision++; }
        else task = response.workspace;
        put(task); updateActions(task, view);
        if (task.status === 'COMPLETED') {
          if (!view.finishedNotified) { view.finishedNotified = true; await adapter.onCompleted(task, response, view.card); if (live(marker)) view.sesudah?.('tercatat'); }
          break;
        }
        if (task.status !== 'PARTIAL' || view.pauseRequested) break;
      }
    } catch (error) {
      if (live(marker)) {
        view.warning.textContent = 'Pemrosesan terhenti: ' + error.message + ' Muat versi server untuk memeriksa langkah terakhir sebelum melanjutkan.';
        view.localUncertain = true; task.status = 'INDETERMINATE'; put(task);
        if (!task.ephemeral && error.payload?.workspace) { task = error.payload.workspace; put(task, { reconcileUncertain: true }); }
        else if (!task.ephemeral) { try { const latest = await request('/' + encodeURIComponent(task.id), {}, queryScope(task)); put(latest.workspace, { reconcileUncertain: true }); task = latest.workspace; } catch {} }
      }
    } finally { view.busy = false; view.pauseRequested = false; if (live(marker)) { view.review.checked = false; if (selected === id) renderDetail(tasks.get(task.id)); updateActions(tasks.get(task.id), view); } }
  }
  function alignViewport() {
    const panel = $('cacaWorkspace'); if (!panel || !open) return;
    if (window.innerWidth <= 900) { const vv = window.visualViewport; panel.style.top = `${Math.round(vv?.offsetTop || 0)}px`; panel.style.height = `${Math.max(150, Math.round((vv?.height || window.innerHeight) - 98))}px`; panel.style.bottom = 'auto'; }
    else { panel.style.top = ''; panel.style.height = ''; panel.style.bottom = ''; }
  }
  function scopeChanged() { selected = null; adapter?.setPending(null); if(adapter)window.UnaLembar?.configure({...adapter,selectTask:select}); renderList(); $('cacaWorkspaceDetail')?.replaceChildren(node('p', 'Pilih tugas yang ingin dibahas. Setiap tugas mempertahankan gerai asalnya.', 'muted')); if (open) void refresh(); }
  function showWorkspace() { ensure(); open = true; $('cacaWorkspace').classList.remove('hidden'); $('cacaPanel')?.classList.add('caca-workspace-chat-open'); $('cacaWorkspaceToggle')?.setAttribute('aria-expanded', 'true'); alignViewport(); }
  function openWorkspace(id = null) { showWorkspace(); if (id) window.UnaLembar?.showTasks(id); else void window.UnaLembar?.restore().catch(error=>status(error.message)); if (id && tasks.has(id)) select(id); void refresh().then(() => { if (open && id && tasks.has(id)) select(id); }); }

  function closeWorkspace() { open = false; $('cacaWorkspace')?.classList.add('hidden'); $('cacaPanel')?.classList.remove('caca-workspace-chat-open'); $('cacaWorkspaceToggle')?.setAttribute('aria-expanded', 'false'); $('cacaPertanyaan')?.focus(); }
  function reset() { epoch++; window.UnaLembar?.reset(); closeWorkspace(); tasks.clear(); views.clear(); selected = null; identity = ''; $('cacaWorkspaceList')?.replaceChildren(); $('cacaWorkspaceDetail')?.replaceChildren(); status(''); }
  window.UnaWorkspace = { configure, capture, open: openWorkspace, show:showWorkspace, close: closeWorkspace, refresh, select, taskState:id=>{const t=tasks.get(id);return t?{id:t.id,revision:t.revision}:null;}, cancelSelected: () => cancel(), context, scopeChanged, chatScope: () => context()?.scope || null, isSelected: id => selected === id, hasDirtySelection: () => !!views.get(selected)?.dirty, reset, get isOpen() { return open; } };
  window.addEventListener('resize', alignViewport); window.visualViewport?.addEventListener('resize', alignViewport); window.visualViewport?.addEventListener('scroll', alignViewport);
  window.addEventListener('focus', () => { if (open) void refresh(); });
  window.addEventListener('storage', () => { if (adapter && adapter.getIdentity() !== identity) { reset(); adapter.onAccountChange?.(); } });
  document.addEventListener('una-workspace:proposal', event => { if (adapter && adapter.getIdentity() === identity && event.detail?.payload) capture(event.detail.payload, event.detail.scope, event.detail.options); });
  document.addEventListener('una-workspace:select', event => { if (adapter && adapter.getIdentity() === identity) select(event.detail?.id); });
})();
