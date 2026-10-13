import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

function uiHarness(initialSkin) {
  let skin = initialSkin;
  const elements = new Map(), events = new Map(), stored = new Map();
  const classes = () => {
    const values = new Set();
    return { add: (...items) => items.forEach(x => values.add(x)), remove: (...items) => items.forEach(x => values.delete(x)), contains: x => values.has(x) };
  };
  const element = (tag, attrs = {}) => ({
    tagName: tag, dataset: {}, style: {}, classList: classes(), textContent: '', placeholder: '',
    getAttribute: key => attrs[key] ?? null,
    remove() { elements.delete(this.id); },
    addEventListener() {}
  });
  const label = element('button', { 'data-skin-text': 'Barang' }); label.textContent = 'Master Barang';
  const input = element('input', { 'data-skin-placeholder': 'Cari barang' }); input.placeholder = 'Cari nama atau kode';
  const nav = element('nav');
  const buttons = ['Profil Gerai', 'Master Barang', 'Detail Laci'];
  nav.querySelectorAll = () => buttons;
  nav.insertAdjacentElement = () => assert.fail('classic/I must not insert grouped navigation');
  const root = element('html');
  const document = {
    documentElement: root, body: element('body'), title: 'MAXI Admin', readyState: 'complete', visibilityState: 'visible',
    head: { appendChild(node) { elements.set(node.id, node); } },
    createElement: element, getElementById: id => elements.get(id) || null,
    querySelector: selector => selector === '.admin-tabs' ? nav : null,
    querySelectorAll: selector => selector === '[data-skin-text]' ? [label] : selector === '[data-skin-placeholder]' ? [input] : [],
    addEventListener() {}
  };
  const window = {
    LEKER_STORE_CODE: 'LAB01', LEKER_PAGE_CONTEXT: 'admin',
    addEventListener(type, fn) { const handlers = events.get(type) || []; handlers.push(fn); events.set(type, handlers); },
    dispatchEvent(event) { for (const fn of events.get(event.type) || []) fn(event); }
  };
  window.parent = window;
  const context = {
    window, document, location: { search: '', hash: '' }, URLSearchParams,
    localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) },
    fetch: async () => ({ ok: true, json: async () => ({ skin, brandName: 'OwnerTenang' }) }),
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: callback => callback()
  };
  runInNewContext(read('public/ui-skin.js'), context);
  return { window, document, elements, label, input, nav, buttons, context,
    async change(value) { skin = value; await window.MaxiSkin.refresh(); } };
}

test('I retains the classic labels/menu and restores them when leaving H, while loading only its beach CSS', async () => {
  const h = uiHarness('h');
  await h.window.MaxiSkin.ready;
  assert.equal(h.label.textContent, 'Barang');
  assert.ok(h.elements.has('maxiSkinFont'));
  await h.change('i');
  assert.equal(h.document.documentElement.dataset.skin, 'i');
  assert.match(h.elements.get('maxiSkinCss').href, /^\/skin-i\.css\?v=/);
  assert.equal(h.elements.has('maxiSkinFont'), false, 'keep the typography loaded by the classic page');
  assert.equal(h.window.MaxiSkin.isOn(), false, 'classic navigation/renderers must stay active');
  assert.equal(h.window.MaxiSkin.pick('Master Barang', 'Barang'), 'Master Barang');
  assert.equal(h.label.textContent, 'Master Barang');
  assert.equal(h.input.placeholder, 'Cari nama atau kode');
  runInNewContext(read('public/nav-groups.js'), h.context);
  assert.equal(h.nav.classList.contains('nav-grouped-source'), false);
  assert.deepEqual(h.buttons, ['Profil Gerai', 'Master Barang', 'Detail Laci']);
  assert.match(h.elements.get('maxiUiSkinStyle').textContent, /html\[data-skin\]:not\(\[data-skin="i"\]\)/);
  for (const skin of ['classic', 'i', 'classic']) {
    await h.change(skin);
    assert.equal(h.label.textContent, 'Master Barang');
    assert.equal(h.input.placeholder, 'Cari nama atau kode');
    assert.equal(h.nav.classList.contains('nav-grouped-source'), false);
    assert.equal(h.elements.has('maxiSkinCss'), skin === 'i');
    assert.equal(h.elements.has('maxiSkinFont'), false);
  }
});

test('I paint layer cannot change classic geometry, typography, visibility or responsive layout', () => {
  const css = read('public/skin-i.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const paint = new Set(['color', 'background', 'background-color', 'background-image', 'background-position',
    'background-size', 'background-repeat', 'background-attachment', 'border-color', 'border-radius',
    'box-shadow', 'accent-color']);
  for (const [, body] of css.matchAll(/\{([^{}]*)\}/g)) {
    for (const declaration of body.split(';').map(x => x.trim()).filter(Boolean)) {
      const property = declaration.slice(0, declaration.indexOf(':')).trim();
      assert.ok(property.startsWith('--') || paint.has(property), 'geometry/behavior override: ' + property);
    }
  }
  assert.doesNotMatch(css, /--[\w-]*(?:font|width|height|padding|margin|gap|spacing)\s*:/i);
  assert.match(css, /owner-beach-h-v1\.png/);
  assert.doesNotMatch(css, /ownerEntity|h-inline-recipe|nav-group|data-skin="h"/);
});

// The customer page has an early inline guard before the shared loader arrives.
test('customer early skin guard preserves the classic buttons for I', () => {
  const html = read('public/customer.html');
  assert.match(html, /html\[data-skin\]:not\(\[data-skin="i"\]\) \[data-skin-hide\]\{display:none!important\}/);
  assert.match(html, /html\[data-skin="i"\] \[data-skin-only\]\{display:none!important\}/);
});
