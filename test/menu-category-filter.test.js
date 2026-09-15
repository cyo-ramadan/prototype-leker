import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// 2026-09-15, Bos Cyo: "kalo tujuannya kasir vs customer ya biar engga kerja
// 2x" -- public/menu-category-filter.js is the one module both Kasir
// (cashier.js) and Customer (customer.js) call for the group/sub-category
// chip filter, instead of each keeping its own copy of the logic. This test
// actually EXECUTES the module against a small hand-built fake DOM (this
// repo has no jsdom dependency) so the click-driven state machine is proven
// to work, not just asserted by reading the source.

const source = readFileSync(new URL('../public/menu-category-filter.js', import.meta.url), 'utf8');
const cashierJs = readFileSync(new URL('../public/cashier.js', import.meta.url), 'utf8');
const customerJs = readFileSync(new URL('../public/customer.js', import.meta.url), 'utf8');

function toCamel(key) {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// Fake <div> that supports exactly what the module needs: .hidden,
// .innerHTML (parsed back into clickable button descriptors) and
// .querySelectorAll('[data-x]'). Tightly coupled to the module's own
// <button class="..." data-x="..." type="button">label</button> shape --
// if that markup shape ever changes this test's parser must change with it.
class FakeRow {
  constructor() { this.hidden = false; this._html = ''; this.buttons = []; }
  set innerHTML(html) {
    this._html = html;
    this.buttons = [];
    const re = /<button class="([^"]*)" data-([a-z-]+)="([^"]*)" type="button">([^<]*)<\/button>/g;
    let match;
    while ((match = re.exec(html))) {
      this.buttons.push({ className: match[1], dataset: { [toCamel(match[2])]: match[3] }, label: match[4], onclick: null });
    }
  }
  get innerHTML() { return this._html; }
  querySelectorAll(selector) {
    const attr = selector.match(/\[data-([a-z-]+)\]/)[1];
    const key = toCamel(attr);
    return this.buttons.filter(button => key in button.dataset);
  }
  clickByLabel(label) {
    const button = this.buttons.find(b => b.label === label);
    assert.ok(button, `no chip labeled "${label}" -- got [${this.buttons.map(b => b.label).join(', ')}]`);
    button.onclick();
  }
}

function loadModule() {
  const window = {};
  vm.runInNewContext(source, { window });
  return window.MAXICategoryFilter;
}

function makeFilter(MAXICategoryFilter, groupRowEl, categoryRowEl) {
  return MAXICategoryFilter.create({
    groupRowEl, categoryRowEl,
    groupBtnClass: 'group-btn', categoryBtnClass: 'cat-btn',
    escapeHtml: value => String(value)
  });
}

test('module attaches itself as window.MAXICategoryFilter with a create() factory', () => {
  const MAXICategoryFilter = loadModule();
  assert.equal(typeof MAXICategoryFilter.create, 'function');
});

test('when nothing is grouped yet, the group row stays hidden and behavior is the old flat single-tier filter', () => {
  const MAXICategoryFilter = loadModule();
  const groupRow = new FakeRow();
  const categoryRow = new FakeRow();
  const filter = makeFilter(MAXICategoryFilter, groupRow, categoryRow);

  const items = [
    { id: 1, category: 'Minuman', categoryGroup: null },
    { id: 2, category: 'Camilan', categoryGroup: null }
  ];
  filter.render(items);

  assert.equal(groupRow.hidden, true, 'group row must stay hidden when no product is grouped');
  assert.equal(groupRow.buttons.length, 0);
  assert.deepEqual(categoryRow.buttons.map(b => b.label), ['Semua', 'Minuman', 'Camilan']);
  assert.deepEqual(filter.filtered(items).map(i => i.id), [1, 2]);

  categoryRow.clickByLabel('Minuman');
  assert.deepEqual(filter.filtered(items).map(i => i.id), [1]);
});

test('once at least two distinct groups exist, the group row appears and narrows the sub-category chips', () => {
  const MAXICategoryFilter = loadModule();
  const groupRow = new FakeRow();
  const categoryRow = new FakeRow();
  const filter = makeFilter(MAXICategoryFilter, groupRow, categoryRow);

  const items = [
    { id: 1, category: 'Es Teh', categoryGroup: 'Minuman & Snack' },
    { id: 2, category: 'Kerupuk', categoryGroup: 'Minuman & Snack' },
    { id: 3, category: 'Leker Original', categoryGroup: 'Makanan Utama' },
    { id: 4, category: 'Sisa Lama', categoryGroup: null } // pre-existing, never grouped
  ];
  filter.render(items);

  assert.equal(groupRow.hidden, false);
  assert.deepEqual(groupRow.buttons.map(b => b.label), ['Semua', 'Minuman & Snack', 'Makanan Utama', 'Lainnya']);
  // Nothing selected yet -> every sub-category across all groups is offered.
  assert.deepEqual(categoryRow.buttons.map(b => b.label), ['Semua', 'Es Teh', 'Kerupuk', 'Leker Original', 'Sisa Lama']);
  assert.equal(filter.filtered(items).length, 4);

  groupRow.clickByLabel('Minuman & Snack');
  assert.deepEqual(categoryRow.buttons.map(b => b.label), ['Semua', 'Es Teh', 'Kerupuk'], 'sub-category chips must narrow to the selected group only');
  assert.deepEqual(filter.filtered(items).map(i => i.id), [1, 2]);

  categoryRow.clickByLabel('Es Teh');
  assert.deepEqual(filter.filtered(items).map(i => i.id), [1]);

  // Switching group again must reset the now-stale sub-category selection
  // back to "Semua" instead of silently filtering to nothing.
  groupRow.clickByLabel('Makanan Utama');
  assert.deepEqual(categoryRow.buttons.map(b => b.label), ['Semua', 'Leker Original']);
  assert.deepEqual(filter.filtered(items).map(i => i.id), [3]);

  // The pre-existing ungrouped category is reachable under "Lainnya", not lost.
  groupRow.clickByLabel('Lainnya');
  assert.deepEqual(filter.filtered(items).map(i => i.id), [4]);
});

test('onSelect fires on both group and sub-category clicks so callers can re-render their product grid', () => {
  const MAXICategoryFilter = loadModule();
  const groupRow = new FakeRow();
  const categoryRow = new FakeRow();
  const filter = makeFilter(MAXICategoryFilter, groupRow, categoryRow);
  let calls = 0;
  filter.onSelect(() => { calls += 1; });

  const items = [
    { id: 1, category: 'A', categoryGroup: 'G1' },
    { id: 2, category: 'B', categoryGroup: 'G2' }
  ];
  filter.render(items);
  groupRow.clickByLabel('G1');
  categoryRow.clickByLabel('A');
  assert.equal(calls, 2);
});

test('Kasir and Customer both delegate to the shared module instead of keeping their own duplicated chip-building logic', () => {
  for (const [name, source] of [['cashier.js', cashierJs], ['customer.js', customerJs]]) {
    assert.match(source, /window\.MAXICategoryFilter\.create\(/, `${name} must use the shared filter`);
    assert.match(source, /categoryFilter\.filtered\(/, `${name} must read filtered results from the shared filter`);
    assert.doesNotMatch(source, /new Set\(state\.(products|menu)\.map\(\w+\s*=>\s*\w+\.category\)/, `${name} must not keep its own duplicated flat category-list logic`);
  }
});
