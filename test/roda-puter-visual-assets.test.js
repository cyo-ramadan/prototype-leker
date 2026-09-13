import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const customerHtml = readFileSync(new URL('../public/customer.html', import.meta.url), 'utf8');
const productArt = readFileSync(new URL('../public/roda-puter-product-art.js', import.meta.url), 'utf8');
const dermoCatalog = readFileSync(new URL('../migrations/0083_dermo_leker_catalog_and_recipes.sql', import.meta.url), 'utf8');
const spriteUrl = new URL('../public/roda-puter-tea-icons.webp', import.meta.url);

const teaRewardNames = [
  'es teh matcha besar',
  'es teh milktea lemon honey besar',
  'es teh poci jasmine',
  'es milktea leci besar',
  'es milktea apel besar',
  'es milktea blackcurrant besar',
  'es milktea orange besar',
  'es milktea mangga besar',
  'es teh milktea besar',
  'es teh thaitea besar',
  'es teh cappuccino besar',
  'es teh coklat besar',
  'es teh leci besar',
  'es teh apel besar',
  'es teh lemon honey besar',
  'es teh blackcurrant besar',
  'es teh orange besar',
  'es teh mangga besar',
  'es teh poci original vanilla besar'
];

test('Roda Puter loads the canonical Product Master visual renderer', () => {
  assert.match(customerHtml, /roda-puter-product-art\.js\?v=20260913-master-visual-v1/);
  assert.doesNotMatch(customerHtml, /function decorateRodaPuter\(/, 'renderer belongs in one external asset, not duplicated inline');
});

test('Roda Puter product art prefers Product Master image then visual key before compatibility fallback', () => {
  assert.match(productArt, /const product = menuProductForReward\(reward\)/);
  assert.match(productArt, /if \(product\?\.imageData\)/);
  assert.match(productArt, /product\?\.imageVisualKey/);
  assert.match(productArt, /artMarkupForVisualKey/);
  assert.match(productArt, /token\.dataset\.artSource = 'product-image'/);
  assert.match(productArt, /token\.dataset\.artSource = 'master-visual-key'/);
  assert.match(productArt, /setTeaSprite/);
  assert.match(productArt, /setSymbolFallback/);

  const imagePriority = productArt.indexOf('if (product?.imageData)');
  const compatibilityPriority = productArt.indexOf('setNonImageFallback(token, reward, product);', imagePriority);
  assert.ok(imagePriority >= 0 && compatibilityPriority > imagePriority, 'explicit Product Master image must win before compatibility sources');
});

test('Roda Puter keeps deterministic placement and visible emergency symbols', () => {
  assert.match(productArt, /name\.includes\('leker'\).*'LEKER'/);
  assert.match(productArt, /return 'DRINK'/);
  assert.match(productArt, /roda-reward-symbol-leker/);
  assert.match(productArt, /roda-reward-symbol-drink/);
  assert.match(productArt, /roda-reward-symbol-gift/);
  assert.match(productArt, /wheel\.getBoundingClientRect\(\)\.width/);
  assert.match(productArt, /translateY\(-\$\{radialOffset\}px\)/);
  assert.match(productArt, /midpointBasisPoints \* 360 \/ 10000/);
  assert.match(productArt, /wheel\.querySelectorAll\('\.roda-reward-token'\)\.length === rewards\.length/);
  assert.match(productArt, /leker-menu-visuals-ready/);
  assert.match(productArt, /MutationObserver/);
  assert.doesNotMatch(productArt, /calc\(-1 \* min/);

  assert.match(dermoCatalog, /'Leker Original'/);
  assert.match(dermoCatalog, /'Leker Pisang'/);
});

test('Pendem tea sprite remains a compatibility source only after Master visual resolution', () => {
  assert.match(productArt, /roda-puter-tea-icons\.webp\?v=20260908-v3/);
  assert.match(productArt, /image\.addEventListener\('error', \(\) => setSymbolFallback/);

  for (const name of teaRewardNames) {
    assert.ok(productArt.includes(`['${name}',`), `missing roda icon mapping for ${name}`);
  }

  assert.ok(statSync(spriteUrl).size > 10000);
});
