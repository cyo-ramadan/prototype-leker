import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const sources = await Promise.all([
  '../public/leker-menu-asset-base.js',
  '../public/leker-menu-asset-sprite-a.js',
  '../public/leker-menu-asset-sprite-b.js',
  '../public/leker-menu-visuals.js'
].map(path => readFile(new URL(path, import.meta.url), 'utf8')));

function loadApi() {
  const sandbox = { window: {} };
  sources.forEach(source => vm.runInNewContext(source, sandbox));
  return sandbox.window.LekerMenuVisuals;
}

test('leker visual mapping composes modular toppings from menu names', () => {
  const api = loadApi();
  assert.deepEqual(Array.from(api.resolveToppings('Leker Susu Cokelat')), ['chocolate', 'milk']);
  assert.deepEqual(Array.from(api.resolveToppings('Blueberry + Keju')), ['cheese', 'blueberry']);
  assert.deepEqual(Array.from(api.resolveToppings('Jagung Keju')), ['cheese', 'corn']);
  assert.deepEqual(Array.from(api.resolveToppings('Sosis Mayo')), ['sausage', 'milk']);
  assert.deepEqual(Array.from(api.resolveToppings('Leker Special Maxi')), ['chocolate', 'cheese', 'banana']);
  assert.deepEqual(Array.from(api.resolveToppings('Choco Crunch + Pisang')), ['chocchips', 'banana']);
});

test('Dermo catalog aliases and three-part variants keep their visible ingredients', () => {
  const api = loadApi();
  assert.deepEqual(Array.from(api.resolveToppings('Leker Blueberry + Gula')), ['blueberry', 'palm_sugar']);
  assert.deepEqual(Array.from(api.resolveToppings('Leker Strawberry + Gula')), ['strawberry', 'palm_sugar']);
  assert.deepEqual(Array.from(api.resolveToppings('Leker Marsmellow')), ['marshmallow']);
  assert.deepEqual(Array.from(api.resolveToppings('Leker Nuttela + Mozarella')), ['chocolate', 'cheese']);
  assert.deepEqual(Array.from(api.resolveToppings('Leker Choco Crunch + Pisang + Keju')), ['chocchips', 'cheese', 'banana']);
  assert.deepEqual(Array.from(api.resolveToppings('Leker Ovomaltine + Kacang + Keju')), ['chocolate', 'cheese', 'peanut']);
  assert.deepEqual(Array.from(api.resolveToppings('Leker Chocomaltine + Kacang + Keju')), ['chocolate', 'cheese', 'peanut']);
});

test('leker visual mapping leaves unrelated products untouched', () => {
  const api = loadApi();
  assert.equal(api.recognizes('Es Teh Jasmine'), false);
  assert.equal(api.artMarkup('Es Teh Jasmine'), '');
  assert.equal(api.recognizes('Leker Original'), true);
  assert.match(api.artMarkup('Leker Original'), /leker-menu-generated/);
});

test('leker visual assets are embedded once and reused as a sprite', () => {
  const api = loadApi();
  assert.match(api.BASE_URL, /^data:image\/webp;base64,UklG/);
  assert.match(api.SPRITE_URL, /^data:image\/webp;base64,UklG/);
  assert.equal(Object.keys(api.SPRITES).length, 20);
});
