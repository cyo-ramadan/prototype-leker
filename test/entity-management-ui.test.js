import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.textContent = ''; this.attributes = {}; this.hidden = false; this.listeners = new Map(); const classes = new Set(); this.classList = { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle: (c, on) => on ? classes.add(c) : classes.delete(c) }; }
  append(...nodes) { for (const n of nodes) { n.parent?.children.splice(n.parent.children.indexOf(n), 1); n.parent = this; this.children.push(n); } }
  replaceChildren(...nodes) { for (const child of this.children) child.parent = null; this.children = []; this.textContent = ''; this.append(...nodes); }
  get childNodes() { return this.children; }
  insertBefore(item, reference) { if (item.parent) item.parent.children.splice(item.parent.children.indexOf(item), 1); item.parent = this; const index = this.children.indexOf(reference); if (index < 0) throw new Error('Missing anchor'); this.children.splice(index, 0, item); }
  setAttribute(k, v) { this.attributes[k] = v; }
  addEventListener(k, v) { this.listeners.set(k, v); }
  removeEventListener(k) { this.listeners.delete(k); }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  focus() {}
  get firstElementChild() { return this.children[0]; }
  set innerHTML(_) { throw new Error('Untrusted markup must never be used'); }
}
const descendants = element => [element, ...element.children.flatMap(descendants)];
const text = element => descendants(element).map(n => n.textContent).join(' ');
function environment() {
  const elements = new Map(); const root = new Element('main');
  const document = { hidden: false, visibilityState: 'visible', body: root, createElement: tag => new Element(tag), createComment: value => new Element('#comment'), querySelector: () => null, querySelectorAll: () => [], getElementById: id => { if (!elements.has(id)) elements.set(id, new Element('div')); return elements.get(id); }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  const stored = new Map();
  const context = { document, navigator: {}, URL, URLSearchParams, Intl, Date, Uint8Array, AbortController, CustomEvent: class {}, setTimeout, clearTimeout, location: { origin: 'https://maxi.test', protocol: 'https:', pathname: '/entity-admin' }, localStorage: { getItem: k => stored.get(k) || null, setItem: (k, v) => stored.set(k, v), removeItem: k => stored.delete(k) }, addEventListener() {}, removeEventListener() {} };
  context.window = context; vm.createContext(context); return { context, root, document, elements, stored };
}
const inboxSource = readFileSync(new URL('../public/user-notifications.js', import.meta.url), 'utf8');
const managementSource = readFileSync(new URL('../public/entity-management.js', import.meta.url), 'utf8');

test('inbox renders text safely, rejects external links, marks one item with authenticated POST', async () => {
  const { context, root } = environment(); const calls = [];
  context.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => url.endsWith('/read') ? {} : { items: [{ id: 'n1', title: '<img onerror=alert(1)>', body: 'Gerai belum buka', url: 'https://evil.test/admin', createdAt: '2026-10-11T01:00:00Z' }], unreadCount: 1, preferences: { soundEnabled: false, pushEnabled: false } } }; };
  vm.runInContext(inboxSource, context); const api = context.MaxiNotifications;
  await api.init({ token: 'secret', mount: root });
  assert.match(text(root), /<img onerror=alert\(1\)>/);
  assert.equal(descendants(root).filter(n => n.tagName === 'a').length, 0);
  const read = descendants(root).find(n => n.textContent === 'Tandai dibaca'); await read.onclick();
  const action = calls.find(c => c.url.endsWith('/read'));
  assert.equal(action.opts.headers.Authorization, 'Bearer secret'); assert.deepEqual(JSON.parse(action.opts.body), { id: 'n1' });
  assert.equal(api.safePath('/entity-admin?token=secret'), null); assert.equal(api.safePath('javascript:alert(1)'), null); assert.equal(api.safePath('/owner'), '/owner');
  await api.destroy(); assert.equal(root.children.length, 0);
});

test('push permission is never requested on login; missing VAPID is explained after explicit action', async () => {
  const { context, root } = environment(); let prompts = 0;
  context.Notification = { permission: 'default', requestPermission: async () => { prompts++; return 'granted'; } }; context.PushManager = class {};
  context.navigator.serviceWorker = { addEventListener() {}, removeEventListener() {} };
  context.fetch = async url => ({ ok: true, json: async () => url.endsWith('/push-key') ? { configured: false, publicKey: null } : { items: [], preferences: {} } });
  vm.runInContext(inboxSource, context); await context.MaxiNotifications.init({ token: 'secret', mount: root });
  assert.equal(prompts, 0); await context.MaxiNotifications.enablePush(); assert.equal(prompts, 1);
  assert.match(text(root), /belum dikonfigurasi/); await context.MaxiNotifications.destroy();
});

test('logout revokes on server before removing local push even when network fails', async () => {
  const { context, root, stored } = environment(); const steps = [];
  stored.set('maxiNotificationPushBinding', JSON.stringify({ actorKey: 'ENTITY_ADMIN:first', endpoint: 'https://push.test/id', id: 'first' }));
  context.Notification = {}; context.PushManager = class {};
  context.navigator.serviceWorker = { addEventListener() {}, removeEventListener() {}, getRegistration: async () => ({ pushManager: { getSubscription: async () => ({ endpoint: 'https://push.test/id', unsubscribe: async () => steps.push('unsubscribe') }) } }) };
  context.fetch = async (url, opts) => { if (opts?.method === 'DELETE') { steps.push('delete'); throw new Error('offline'); } return { ok: true, json: async () => ({ items: [], preferences: {}, actor: { key: 'ENTITY_ADMIN:first' } }) }; };
  vm.runInContext(inboxSource, context); await context.MaxiNotifications.init({ token: 'secret', mount: root });
  await context.MaxiNotifications.destroy({ revokePush: true }); assert.deepEqual(steps, ['delete', 'unsubscribe']); assert.equal(root.children.length, 0);
});

const actualPinTabs = { profit: 'reports', setoran: 'setorancs', drawerstatus: 'drawerstatus', stores: 'stores', customers: 'customers', ledger: 'ledger', sharedaccounts: 'sharedaccounts', productmasters: 'productmasters', entityrecipes: 'entityrecipes', entitystock: 'entitystock', storereport: 'storereport', employees: 'employees' };
async function homeEnvironment(homePins = ['profit']) {
  const e = environment(); const { context, document } = e; const sources = new Map(); const loaderCalls = [];
  context.dispatchEvent=()=>{};
  for (const tab of Object.values(actualPinTabs)) {
    const source = document.getElementById('entityTab-' + tab);
    const nodes = [new Element('#text'), new Element('form'), new Element('#text'), new Element('article'), new Element('article')];
    nodes[1].value = 'Filter/user draft'; nodes[1].onclick = () => 'original handler';
    source.append(...nodes); sources.set(tab, { source, nodes });
  }
  context.entityAdminState = { token: 'secret', stores: [{ id: 's1', code: 'G001', storeName: 'Gerai Satu' }] };
  context.entityAdminApi = async () => { throw new Error('Home must call the existing menu loader'); };
  context.entityAdminToast = () => {};
  context.loadEntityTabContent = async (name, options) => { loaderCalls.push({ name, options }); };
  const snapshot = { preferences: { homePins, startTab: 'home' }, capabilities: { canManageRules: false } };
  let onChange;
  context.MaxiNotifications = { init: async opts => { onChange = opts.onChange; onChange(snapshot); return snapshot; }, destroy: async () => {} };
  context.switchEntityTab = name => { context.EntityManagement.onTab(name); for (const id of ['home', 'settings', ...Object.values(actualPinTabs)]) document.getElementById('entityTab-' + id).classList.toggle('active', id === name); };
  vm.runInContext(readFileSync(new URL('../public/una-mount.js',import.meta.url),'utf8'),context);
  vm.runInContext(managementSource, context); await context.EntityManagement.init(); await new Promise(resolve => setImmediate(resolve));
  return { ...e, sources, loaderCalls, updatePins: list => onChange({ ...snapshot, preferences: { ...snapshot.preferences, homePins: list } }) };
}
test('profit pin reuses the complete existing Laporan panel and its report loader without copying controls', async () => {
  const { document, context, sources, loaderCalls } = await homeEnvironment(['profit']);
  const original = sources.get('reports'); const homeNodes = descendants(document.getElementById('entityHomePins'));
  for (const item of original.nodes) assert.ok(homeNodes.includes(item));
  assert.equal(original.nodes[1].value, 'Filter/user draft'); assert.equal(original.nodes[1].onclick(), 'original handler');
  assert.deepEqual(JSON.parse(JSON.stringify(loaderCalls)), [{ name: 'reports', options: { autoReport: true } }]);
  context.switchEntityTab('reports'); assert.deepEqual(original.source.childNodes, original.nodes); assert.equal(original.nodes[1].onclick(), 'original handler');
  await context.EntityManagement.destroy();
});
test('all pinned menu child nodes return to their exact source order on leaving home and logout', async () => {
  const { document, context, sources } = await homeEnvironment(['profit', 'setoran', 'drawerstatus']);
  const home = document.getElementById('entityHomePins');
  for (const tab of ['reports', 'setorancs', 'drawerstatus']) {
    for (const item of sources.get(tab).nodes) assert.ok(descendants(home).includes(item));
    assert.ok(sources.get(tab).source.childNodes.some(n => n.tagName === '#comment'));
    assert.ok(!sources.get(tab).source.childNodes.some(n=>sources.get(tab).nodes.includes(n)));
    assert.ok(descendants(sources.get(tab).source).some(n=>n.tagName==='button'),'The menu offers reclaiming its original panel');
  }
  context.switchEntityTab('stores');
  for (const { source, nodes } of sources.values()) assert.deepEqual(source.childNodes, nodes);
  context.switchEntityTab('home'); await context.EntityManagement.destroy();
  for (const { source, nodes } of sources.values()) assert.deepEqual(source.childNodes, nodes);
});
test('unpin restores the original panel and a remote pin change never steals a menu currently open', async () => {
  const { context, sources, updatePins } = await homeEnvironment(['profit', 'drawerstatus']);
  updatePins(['profit']); assert.deepEqual(sources.get('drawerstatus').source.childNodes, sources.get('drawerstatus').nodes);
  context.switchEntityTab('reports'); updatePins(['profit', 'setoran']);
  for (const { source, nodes } of sources.values()) assert.deepEqual(source.childNodes, nodes);
  context.switchEntityTab('home'); assert.ok(!sources.get('setorancs').source.childNodes.some(n=>sources.get('setorancs').nodes.includes(n)));
  await context.EntityManagement.destroy();
});
test('every pin choice refers to an existing Entity menu, including both drawer panels and all report cards', async () => {
  const html = readFileSync(new URL('../public/entity-admin.html', import.meta.url), 'utf8');
  for (const tab of Object.values(actualPinTabs)) assert.ok(html.includes('id="entityTab-' + tab + '"'));
  const { context, document, sources, loaderCalls } = await homeEnvironment(Object.keys(actualPinTabs));
  const home = document.getElementById('entityHomePins'); assert.equal(home.children.length, Object.keys(actualPinTabs).length);
  for (const { nodes } of sources.values()) for (const item of nodes) assert.equal(descendants(home).filter(n => n === item).length, 1);
  assert.deepEqual(loaderCalls.map(c => c.name).sort(), Object.values(actualPinTabs).sort());
  await context.EntityManagement.destroy();
});
test('notification refresh keeps pinned node identity and user-entered filter state in place', async () => {
  const { context, document, updatePins, sources } = await homeEnvironment(['profit']); const wrapper = document.getElementById('entityHomePins').children[0];
  sources.get('reports').nodes[1].value = 'User-selected date and stores'; updatePins(['profit']);
  assert.equal(document.getElementById('entityHomePins').children[0], wrapper); assert.equal(sources.get('reports').nodes[1].value, 'User-selected date and stores');
  await context.EntityManagement.destroy();
});
test('service worker honors muted push, uses generic lockscreen content and blocks an external destination', async () => {
  const handlers = {}; const shown = []; const opened = [];
  const context = { URL, self: { location: { origin: 'https://maxi.test' }, addEventListener: (type, fn) => handlers[type] = fn, registration: { showNotification: async (...args) => shown.push(args) }, clients: { matchAll: async () => [], openWindow: async path => opened.push(path) } } };
  vm.runInNewContext(readFileSync(new URL('../public/notifications-sw.js', import.meta.url), 'utf8'), context);
  let pending; handlers.push({ data: { json: () => ({ title: 'Rp1000000', body: 'secret', url: 'https://evil.test/admin', silent: true }) }, waitUntil: task => pending = task }); await pending;
  assert.equal(shown[0][1].silent, true); assert.doesNotMatch(shown[0].join(' '), /Rp1000000|secret/);
  handlers.notificationclick({ notification: { close() {}, data: { url: 'https://evil.test/admin' } }, waitUntil: task => pending = task }); await pending; assert.deepEqual(opened, ['/login']);
  assert.equal(handlers.fetch, undefined);
});

test('a changed account token never leaks the old inbox to a request using the new token', async () => {
  const { context, root } = environment(); let token = 'first'; const headers = [];
  context.fetch = async (url, opts) => { headers.push(opts.headers.Authorization); return { ok: true, json: async () => ({ items: [], preferences: {} }) }; };
  vm.runInContext(inboxSource, context); await context.MaxiNotifications.init({ getToken: () => token, mount: root });
  token = 'second'; await context.MaxiNotifications.refresh();
  assert.deepEqual(headers, ['Bearer first']); assert.equal(root.children.length, 0);
});

test('store workspace notification adapter uses the same owner/entity/admin priority as workspace authentication', async () => {
  const { context, stored } = environment(); const headers = [];
  context.location.pathname = '/s/G001/admin'; stored.set('lekerOwnerToken', 'owner'); stored.set('lekerEntityAdminToken', 'entity'); stored.set('lekerAdminToken', 'admin');
  context.fetch = async (url, opts) => { headers.push(opts.headers.Authorization); return { ok: true, json: async () => ({ items: [], preferences: {} }) }; };
  vm.runInContext(inboxSource, context); await context.MaxiNotifications.startForStoredSession(); assert.equal(headers[0], 'Bearer owner'); await context.MaxiNotifications.destroy();
  stored.delete('lekerOwnerToken'); await context.MaxiNotifications.startForStoredSession(); assert.equal(headers[1], 'Bearer entity'); await context.MaxiNotifications.destroy();
});

test('a delayed old-account response is discarded after the account token changes', async () => {
  const { context, root } = environment(); let token = 'first'; let resolveResponse; let changes = 0;
  context.fetch = async () => ({ ok: true, json: () => new Promise(resolve => { resolveResponse = resolve; }) });
  vm.runInContext(inboxSource, context);
  const pending = context.MaxiNotifications.init({ getToken: () => token, mount: root, onChange: () => changes++ });
  await new Promise(resolve => setImmediate(resolve)); token = 'second';
  resolveResponse({ items: [{ title: 'Private old account data' }], preferences: {}, actor: { key: 'ENTITY_ADMIN:first' } });
  await pending; assert.equal(changes, 0); assert.equal(root.children.length, 0); assert.equal(context.MaxiNotifications.snapshot, null);
});

test('an old tab logout cannot remove a subscription rebound to a new account', async () => {
  const { context, root, stored } = environment(); const steps = [];
  const first = { actorKey: 'ENTITY_ADMIN:first', endpoint: 'https://push.test/id', id: 'first' };
  const second = { actorKey: 'ENTITY_ADMIN:second', endpoint: 'https://push.test/id', id: 'second' };
  stored.set('maxiNotificationPushBinding', JSON.stringify(first));
  context.Notification = {}; context.PushManager = class {};
  context.navigator.serviceWorker = { addEventListener() {}, removeEventListener() {}, getRegistration: async () => ({ pushManager: { getSubscription: async () => ({ endpoint: first.endpoint, unsubscribe: async () => steps.push('unsubscribe') }) } }) };
  context.fetch = async (url, options) => { if (options?.method === 'DELETE') steps.push('delete'); return { ok: true, json: async () => ({ items: [], preferences: {}, actor: { key: first.actorKey } }) }; };
  vm.runInContext(inboxSource, context); await context.MaxiNotifications.init({ token: 'first', mount: root });
  stored.set('maxiNotificationPushBinding', JSON.stringify(second)); await context.MaxiNotifications.destroy({ revokePush: true });
  assert.deepEqual(steps, []); assert.deepEqual(JSON.parse(stored.get('maxiNotificationPushBinding')), second);
});

test('subscription ownership is checked again after a pending server revoke resolves', async () => {
  const { context, root, stored } = environment(); let finishDelete; let unsubscribed = false;
  const first = { actorKey: 'ENTITY_ADMIN:first', endpoint: 'https://push.test/id', id: 'first' };
  const second = { actorKey: 'ENTITY_ADMIN:second', endpoint: first.endpoint, id: 'second' };
  stored.set('maxiNotificationPushBinding', JSON.stringify(first)); context.Notification = {}; context.PushManager = class {};
  context.navigator.serviceWorker = { addEventListener() {}, removeEventListener() {}, getRegistration: async () => ({ pushManager: { getSubscription: async () => ({ endpoint: first.endpoint, unsubscribe: async () => { unsubscribed = true; } }) } }) };
  context.fetch = async (url, options) => { if (options?.method === 'DELETE') return new Promise(resolve => { finishDelete = resolve; }); return { ok: true, json: async () => ({ items: [], preferences: {}, actor: { key: first.actorKey } }) }; };
  vm.runInContext(inboxSource, context); await context.MaxiNotifications.init({ token: 'first', mount: root });
  const pending = context.MaxiNotifications.destroy({ revokePush: true }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(root.children.length, 0); stored.set('maxiNotificationPushBinding', JSON.stringify(second)); finishDelete({ ok: true }); await pending;
  assert.equal(unsubscribed, false); assert.deepEqual(JSON.parse(stored.get('maxiNotificationPushBinding')), second);
});

test('successful push activation binds the device marker to the authenticated actor without storing credentials', async () => {
  const { context, root, stored } = environment();
  context.Notification = { permission: 'granted' }; context.PushManager = class {}; context.atob = atob;
  const subscription = { endpoint: 'https://push.test/id', toJSON: () => ({ endpoint: 'https://push.test/id', keys: { p256dh: 'public', auth: 'auth' } }) };
  const registration = { pushManager: { getSubscription: async () => subscription } };
  context.navigator.serviceWorker = { addEventListener() {}, removeEventListener() {}, register: async () => registration, ready: Promise.resolve(registration) };
  context.fetch = async url => ({ ok: true, json: async () => url.endsWith('/push-key') ? { configured: true, publicKey: 'AQ' } : { items: [], preferences: {}, actor: { key: 'ENTITY_ADMIN:first' } } });
  vm.runInContext(inboxSource, context); await context.MaxiNotifications.init({ token: 'private-bearer', mount: root }); await context.MaxiNotifications.enablePush();
  const marker = JSON.parse(stored.get('maxiNotificationPushBinding')); assert.equal(marker.actorKey, 'ENTITY_ADMIN:first'); assert.equal(marker.endpoint, subscription.endpoint); assert.ok(marker.id); assert.doesNotMatch(JSON.stringify(marker), /private-bearer/); await context.MaxiNotifications.destroy();
});
