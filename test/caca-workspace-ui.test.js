import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../public/caca-workspace.js', import.meta.url), 'utf8');
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = new Map(); this.attributes = {}; this.style = {}; this.textContent = ''; this.className = ''; this.classList = { contains: c => this.className.split(' ').includes(c), add: c => { if (!this.classList.contains(c)) this.className += ' ' + c; }, remove: c => { this.className = this.className.split(' ').filter(s => s !== c).join(' '); }, toggle: (c, on) => on ? this.classList.add(c) : this.classList.remove(c) }; }
  append(...nodes) { for (const item of nodes) { item.remove(); item.parent = this; this.children.push(item); } }
  appendChild(node) { this.append(node); return node; }
  remove() { if (this.parent) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); this.parent = null; } }
  replaceChildren(...nodes) { for (const child of this.children) child.parent = null; this.children = []; this.textContent = ''; this.append(...nodes); }
  get firstElementChild() { return this.children[0]; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn); }
  async fire(name) { return Promise.all((this.listeners.get(name) || []).map(fn => fn({ target: this }))); }
  async click() { if (!this.disabled) return this.fire('click'); }
  focus() {}
}
const all = root => [root, ...root.children.flatMap(all)];
const text = root => all(root).map(n => n.textContent).join(' ');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const draft = (name = 'Kopi') => ({ aksi: 'buat_barang_banyak', bertahap: true, judul: 'Buat barang', tangkapan: { daftar_barang: [{ nama: name, harga_jual: '5000' }, { nama: 'Teh', harga_jual: '3000' }] }, muatan: { daftar: [{ name }, { name: 'Teh' }] }, dampak: ['Barang masuk ke gerai pilihan'] });
function setup(options = {}) {
  const root = new Element('body'); const chat = new Element('section'); chat.id = 'cacaPanel'; const toggle = new Element('button'); toggle.id = 'cacaWorkspaceToggle'; const input = new Element('textarea'); input.id = 'cacaPertanyaan'; root.append(chat, toggle, input);
  let token = 'first'; let scope = 'G001'; let pending = null; let completed = 0; let nextId = 0; const calls = []; const server = new Map();
  const document = { body: root, createElement: tag => new Element(tag), getElementById: id => all(root).find(n => n.id === id) || null, addEventListener() {}, dispatchEvent() {} };
  const context = { document, Date, JSON, Promise, Math, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } }, innerWidth: 1280, innerHeight: 900, addEventListener() {} }; context.window = context; vm.createContext(context); vm.runInContext(source, context);
  const fromInput = (id, body) => ({ id, title: body.title || 'Buat barang', scope: { lingkup: 'gerai', storeCode: scope, label: scope }, status: body.draft ? 'DRAFT' : 'NEEDS_INPUT', draft: body.draft || null, tertunda: body.tertunda || null, revision: 1, cursor: 0, total: body.draft ? body.draft.bertahap ? body.draft.muatan.daftar.length : 1 : 0, results: [] });
  const api = async (path, opts = {}) => {
    calls.push({ path, opts }); const url = new URL(path, 'https://maxi.test'); const body = opts.body ? JSON.parse(opts.body) : {};
    const match = url.pathname.match(/workspace\/([^/]+)(\/catat)?$/); const id = match?.[1];
    if (options.api) { const result = await options.api(path, opts, { server, body, id }); if (result !== undefined) return result; }
    if (!id && opts.method === 'POST') { const task = fromInput('task-' + ++nextId, body); server.set(task.id, task); return { workspace: structuredClone(task) }; }
    if (!id) return { items: [...server.values()].map(value => structuredClone(value)) };
    const task = server.get(id); if (!task) throw new Error('Not found');
    if (opts.method === 'PATCH') { if (body.revision !== task.revision) throw Object.assign(new Error('Versi sudah berubah'), { status: 409 }); if (body.cancel) task.status = 'CANCELLED'; if (body.tangkapan) task.draft.tangkapan = body.tangkapan; if (body.draft) task.draft = body.draft; task.revision++; return { workspace: structuredClone(task) }; }
    if (match[2]) { task.results.push({ index: task.cursor, status: 'COMPLETED', result: { hasil: 'dibuat', nama: task.draft.muatan.daftar[task.cursor].name } }); task.cursor++; task.status = task.cursor >= task.total ? 'COMPLETED' : 'PARTIAL'; return { workspace: structuredClone(task) }; }
    return { workspace: structuredClone(task) };
  };
  context.UnaWorkspace.configure({ api, getIdentity: () => token, getScope: () => scope, scopeQuery: value => 'store=' + value, scopeLabel: value => value,
    renderDraft: value => { const card = new Element('div'); card.textContent = value.judul; return card; }, setPending: value => { pending = value; },
    addCompact: (value, id) => { const compact = new Element('button'); compact.textContent = value; chat.append(compact); return compact; },
    executeEphemeral: options.executeEphemeral || (async () => ({ result: { jawaban: 'Selesai' } })), onCompleted: options.onCompleted || (async () => { completed++; }), onCancel() {} });
  const get = id => document.getElementById(id); const find = label => all(root).find(n => n.tagName === 'button' && n.textContent === label);
  const review = async () => { const checkbox = all(get('cacaWorkspaceDetail')).find(n => n.type === 'checkbox'); checkbox.checked = true; await checkbox.fire('change'); };
  return { context, root, chat, server, calls, get, find, review, api: context.UnaWorkspace, setToken: value => { token = value; }, setScope: value => { scope = value; context.UnaWorkspace.scopeChanged(); }, get pending() { return pending; }, get completed() { return completed; } };
}

test('empty workspace is available immediately and opening it keeps chat/composer mounted', async () => {
  const h = setup(); const chat = h.chat; const composer = h.get('cacaPertanyaan'); h.api.open(); await flush();
  assert.match(text(h.get('cacaWorkspaceList')), /Belum ada tugas/); assert.equal(h.get('cacaPanel'), chat); assert.equal(h.get('cacaPertanyaan'), composer); h.api.close(); assert.equal(h.get('cacaPertanyaan'), composer);
});
test('chat holds a compact task button while full draft is rendered only in workspace', async () => {
  const h = setup(); h.api.capture({ draft: draft() }, 'G001'); await flush();
  assert.match(text(h.chat), /2 draft/); assert.doesNotMatch(text(h.chat), /Barang masuk/); assert.match(text(h.get('cacaWorkspaceDetail')), /Buat barang/); assert.equal(h.api.context().id, 'task-1');
});
test('generic persistence failure blocks execution rather than falling back to legacy writes', async () => {
  let legacy = 0; const h = setup({ api: (path, opts) => { if (opts.method === 'POST') throw new Error('Server offline'); }, executeEphemeral: async () => { legacy++; } }); h.api.capture({ draft: draft() }, 'G001'); await flush(); await h.review(); await h.find('Ya, jalankan draft yang diperiksa').click();
  assert.match(text(h.get('cacaWorkspaceDetail')), /Draft belum tersimpan/); assert.equal(legacy, 0); assert.equal(h.calls.filter(c => c.path.includes('/catat')).length, 0);
});
test('only exact sensitive rejection permits an explicit memory-only credential draft', async () => {
  const h = setup({ api: (path, opts) => { if (opts.method === 'POST') throw Object.assign(new Error('Sensitive draft'), { code: 'CACA_WORKSPACE_SENSITIVE' }); } }); h.api.capture({ draft: { aksi: 'buat_karyawan', judul: 'Buat akun', tangkapan: {}, muatan: {} } }, 'G001'); await flush();
  assert.match(text(h.get('cacaWorkspaceDetail')), /hanya disimpan dalam sesi ini/); await h.review(); assert.equal(h.find('Ya, jalankan draft yang diperiksa').disabled, false); h.api.reset(); assert.equal(text(h.get('cacaWorkspaceDetail')), '');
});
test('manual bulk edits survive a late chat correction and can become a separate draft', async () => {
  const h = setup(); h.api.capture({ draft: draft() }, 'G001'); await flush(); const context = h.api.context();
  const input = all(h.get('cacaWorkspaceDetail')).find(n => n.type === 'text'); input.value = 'Kopi Manual'; await input.fire('input');
  h.api.capture({ draft: draft('Kopi Chat'), revisi: true, _workspaceContext: context }, 'G001'); await flush();
  assert.equal(input.value, 'Kopi Manual'); assert.equal(h.calls.filter(c => c.opts.method === 'PATCH').length, 0);
  assert.ok(h.find('Buat draft terpisah dari koreksi chat')); await h.find('Buat draft terpisah dari koreksi chat').click(); await flush(); assert.equal(h.server.size, 2); assert.equal(input.value, 'Kopi Manual');
});
test('saving edits reprepares with revision CAS and requires fresh review before approval', async () => {
  const h = setup(); h.api.capture({ draft: draft() }, 'G001'); await flush(); await h.review(); const input = all(h.get('cacaWorkspaceDetail')).find(n => n.type === 'text'); input.value = 'Kopi Koreksi'; await input.fire('input');
  assert.equal(h.find('Ya, jalankan draft yang diperiksa').disabled, true); await h.find('Simpan koreksi & susun ulang').click(); await flush();
  const patch = h.calls.find(c => c.opts.method === 'PATCH'); assert.equal(JSON.parse(patch.opts.body).revision, 1); assert.equal(JSON.parse(patch.opts.body).tangkapan.daftar_barang[0].nama, 'Kopi Koreksi'); assert.equal(h.api.context().revision, 2); assert.equal(h.find('Ya, jalankan draft yang diperiksa').disabled, true);
  assert.doesNotMatch(text(h.get('cacaWorkspaceDetail')), /Ada edit lokal yang belum disimpan/);
  const checkbox = all(h.get('cacaWorkspaceDetail')).find(n => n.type === 'checkbox'); assert.equal(checkbox.disabled, false); await h.review(); assert.equal(h.find('Ya, jalankan draft yang diperiksa').disabled, false);
});
test('pause stops between canonical items and resume uses the server cursor without duplicate prefix', async () => {
  let finish; let first = true; const h = setup({ api: async (path, opts, info) => { if (path.includes('/catat') && first) { first = false; await new Promise(resolve => { finish = resolve; }); } } }); h.api.capture({ draft: draft() }, 'G001'); await flush(); await h.review();
  const running = h.find('Ya, jalankan draft yang diperiksa').click(); await flush(); await h.find('Jeda sesudah langkah ini').click(); finish(); await running; await flush();
  assert.equal(h.server.get('task-1').cursor, 1); assert.equal(h.completed, 0); assert.match(text(h.get('cacaWorkspaceDetail')), /Hasil langkah tersimpan/);
  await h.review(); await h.find('Lanjutkan dari langkah tersimpan').click(); await flush(); assert.equal(h.server.get('task-1').cursor, 2); assert.equal(h.completed, 1);
  const cursors = h.calls.filter(c => c.path.includes('/catat')).map(c => JSON.parse(c.opts.body).expectedCursor); assert.deepEqual(cursors, [0, 1]); assert.equal(h.api.context(), null);
});
test('uncertain execution never enables an automatic retry when readback also fails', async () => {
  let failed = false; const h = setup({ api: (path, opts, info) => { if (path.includes('/catat')) { failed = true; throw new Error('Connection lost'); } if (failed && info.id) throw new Error('Readback offline'); } }); h.api.capture({ draft: draft() }, 'G001'); await flush(); await h.review(); await h.find('Ya, jalankan draft yang diperiksa').click();
  assert.match(text(h.get('cacaWorkspaceDetail')), /Hasil belum pasti/); assert.equal(h.find('Ya, jalankan draft yang diperiksa').disabled, true); assert.equal(h.calls.filter(c => c.path.includes('/catat')).length, 1);
});
test('changing scope removes task correction context without changing the durable task scope', async () => {
  const h = setup(); h.api.capture({ draft: draft() }, 'G001'); await flush(); h.setScope('G002'); assert.equal(h.api.context(), null); assert.equal(h.pending, null); h.api.select('task-1'); assert.equal(h.api.chatScope(), 'G001'); assert.equal(h.server.get('task-1').scope.storeCode, 'G001');
});
test('restored compact task opens the requested server task after async hydration', async () => {
  const h = setup(); h.api.capture({ draft: draft('A') }, 'G001'); h.api.capture({ draft: draft('B') }, 'G001'); await flush(); h.api.reset(); h.api.configure({ api: async () => ({ items: [...h.server.values()] }), getIdentity: () => 'first', getScope: () => 'G001', scopeQuery: x => 'store=' + x, scopeLabel: x => x, renderDraft: value => { const n = new Element('div'); n.textContent = value.judul; return n; }, setPending() {} });
  h.api.open('task-2'); await flush(); assert.equal(h.api.context().id, 'task-2');
});
test('a late account response cannot repopulate a reset workspace', async () => {
  let finish; const h = setup({ api: (path, opts) => { if (opts.method === 'POST') return new Promise(resolve => { finish = resolve; }); } }); h.api.capture({ draft: draft() }, 'G001'); await flush(); h.setToken('second'); h.api.reset(); finish({ workspace: { id: 'old-account', status: 'DRAFT', scope: { storeCode: 'G001' }, revision: 1, draft: draft() } }); await flush(); assert.equal(text(h.get('cacaWorkspaceDetail')), ''); assert.equal(h.api.context(), null);
});

test('requested rows and rows excluded from prepared execution are both visible', async () => {
  const h = setup(); const value = draft(); value.tangkapan.daftar_barang.push({ nama: 'Belum lengkap', harga_jual: '' }); h.api.capture({ draft: value }, 'G001'); await flush();
  assert.match(text(h.chat), /3 draft/); assert.match(text(h.chat), /2 siap · 1 belum ikut/); assert.match(text(h.get('cacaWorkspaceDetail')), /3 baris diminta; hanya 2 baris masuk eksekusi/);
});
test('a stale chat revision never replaces a newer server revision and offers a separate draft', async () => {
  const h = setup(); h.api.capture({ draft: draft() }, 'G001'); await flush(); const context = h.api.context();
  h.server.get('task-1').revision = 2; await h.api.refresh();
  h.api.capture({ draft: draft('Late correction'), revisi: true, _workspaceContext: context }, 'G001'); await flush();
  assert.equal(h.calls.filter(c => c.opts.method === 'PATCH').length, 0); assert.equal(h.api.context().revision, 2); assert.ok(h.find('Buat draft terpisah dari koreksi chat'));
});
test('finishing a running task does not switch the workspace away from another selected task', async () => {
  let finish; let first = true; const h = setup({ api: async path => { if (path.includes('/catat') && first) { first = false; await new Promise(resolve => { finish = resolve; }); } } }); h.api.capture({ draft: draft('A') }, 'G001'); h.api.capture({ draft: draft('B') }, 'G001'); await flush(); h.api.select('task-1'); await h.review();
  const running = h.find('Ya, jalankan draft yang diperiksa').click(); await flush(); h.api.select('task-2'); const visible = h.get('cacaWorkspaceDetail').firstElementChild; finish(); await running;
  assert.equal(h.api.context().id, 'task-2'); assert.equal(h.get('cacaWorkspaceDetail').firstElementChild, visible); assert.equal(h.pending.tangkapan.daftar_barang[0].nama, 'B');
});

test('actual chat reply adapter preserves current pending context when a response targets an older revision', async () => {
  const h = setup(); h.api.capture({ draft: draft('Original') }, 'G001'); await flush(); const requestContext = h.api.context();
  const task = h.server.get('task-1'); task.revision = 2; task.draft = draft('Server revision 2'); await h.api.refresh();
  const pending = h.pending; h.context.cacaState = { tertunda: pending, kerjaTertunda: null };
  h.context.cacaTampilkanBalasan = (payload, scope) => { h.api.capture(payload, scope); return 'draft'; };
  h.context.cacaGantiDraftLama = () => {};
  const chatSource = readFileSync(new URL('../public/caca-chat.js', import.meta.url), 'utf8');
  const start = chatSource.indexOf('function cacaTampilkanBalasanAgen('); const end = chatSource.indexOf('\n/**', start);
  vm.runInContext(chatSource.slice(start, end), h.context);
  h.context.cacaTampilkanBalasanAgen({ draft: draft('Late revision 1'), revisi: true, perluKonfirmasi: true, _workspaceContext: requestContext }, 'koreksi', 'G001');
  await flush();
  assert.equal(h.context.cacaState.tertunda, pending); assert.equal(h.pending, pending); assert.equal(h.api.context().revision, 2);
  assert.equal(h.calls.filter(c => c.opts.method === 'PATCH').length, 0); assert.ok(h.find('Buat draft terpisah dari koreksi chat'));
  h.context.cacaTampilkanBalasanAgen({ tertunda: { alat: 'buat_barang_banyak', tangkapan: { daftar_barang: [] } }, _workspaceContext: h.api.context() }, 'lanjut', 'G001');
  assert.equal(h.context.cacaState.tertunda.tangkapan.daftar_barang.length, 0);
});

test('a list snapshot started before execution cannot regress completed progress or restore approval', async () => {
  let release; let delay = false; const h = setup({ api: (path, opts, info) => {
    if (delay && !info.id && !opts.method) { delay = false; const items = [...info.server.values()].map(value => structuredClone(value)); return new Promise(resolve => { release = () => resolve({ items }); }); }
  } });
  h.api.capture({ draft: draft() }, 'G001'); await flush(); delay = true; const refresh = h.api.refresh(); await flush();
  await h.review(); await h.find('Ya, jalankan draft yang diperiksa').click(); await flush(); assert.equal(h.completed, 1);
  release(); await refresh;
  assert.equal(h.api.context(), null); assert.match(text(h.get('cacaWorkspaceDetail')), /2\/2 langkah selesai/); assert.match(text(h.get('cacaWorkspaceDetail')), /Hasil langkah tersimpan/);
  assert.equal(h.find('Lanjutkan dari langkah tersimpan').disabled, true); assert.equal(h.calls.filter(c => c.path.includes('/catat')).length, 2);
});
test('a stale same-cursor list cannot clear uncertain status but direct readback can resolve local uncertainty', async () => {
  let failReadback = true; const h = setup({ api: (path, opts, info) => {
    if (path.includes('/catat')) throw new Error('Connection lost before response');
    if (info.id && !opts.method && failReadback) throw new Error('Readback offline');
  } });
  h.api.capture({ draft: draft() }, 'G001'); await flush(); await h.review(); await h.find('Ya, jalankan draft yang diperiksa').click();
  await h.api.refresh(); assert.match(text(h.get('cacaWorkspaceDetail')), /Hasil belum pasti/); assert.equal(h.find('Ya, jalankan draft yang diperiksa').disabled, true);
  failReadback = false; await h.find('Muat versi server').click(); assert.match(text(h.get('cacaWorkspaceDetail')), /Menunggu pemeriksaan/);
  assert.equal(h.find('Ya, jalankan draft yang diperiksa').disabled, true); await h.review(); assert.equal(h.find('Ya, jalankan draft yang diperiksa').disabled, false);
  assert.equal(h.calls.filter(c => c.path.includes('/catat')).length, 1);
});

test('focus refresh updates selected pending capture to the accepted server draft without manual reselection', async () => {
  const h = setup(); h.api.capture({ draft: draft() }, 'G001'); await flush();
  const before = h.pending; const task = h.server.get('task-1'); task.revision = 2; task.draft.tangkapan.daftar_barang[0].harga_jual = '6000';
  await h.api.refresh();
  assert.equal(h.api.context().revision, 2); assert.notEqual(h.pending, before); assert.equal(h.pending.tangkapan.daftar_barang[0].harga_jual, '6000');
  await h.review(); await h.find('Ya, jalankan draft yang diperiksa').click();
  const recordedFollowup = h.pending; recordedFollowup.alat = 'ubah_barang'; recordedFollowup.tangkapan = { nama: 'Kopi tercatat' };
  await h.api.refresh(); assert.equal(h.pending, recordedFollowup); assert.equal(h.pending.alat, 'ubah_barang'); assert.equal(h.pending.tangkapan.nama, 'Kopi tercatat');
});
