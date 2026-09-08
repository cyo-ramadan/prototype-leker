import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const customerHtml = readFileSync(new URL('../public/customer.html', import.meta.url), 'utf8');
const spriteUrl = new URL('../public/roda-puter-tea-icons.webp', import.meta.url);

const rewardNames = [
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

test('Roda Puter renders product art with mobile-safe radial positioning and fallback', () => {
  assert.match(customerHtml, /roda-puter-tea-icons\.webp\?v=20260908-v3/);
  assert.match(customerHtml, /className = 'roda-reward-token'/);
  assert.match(customerHtml, /class="roda-reward-sprite"/);
  assert.match(customerHtml, /menuImageForProduct/);
  assert.match(customerHtml, /roda-reward-fallback/);
  assert.match(customerHtml, /state\.rodaRewards/);
  assert.match(customerHtml, /token\.dataset\.productId/);
  assert.match(customerHtml, /token\.style\.height/);
  assert.match(customerHtml, /wheel\.getBoundingClientRect\(\)\.width/);
  assert.match(customerHtml, /translateY\(-\$\{radialOffset\}px\)/);
  assert.match(customerHtml, /productArtCount/);
  assert.match(customerHtml, /addEventListener\('error'/);
  assert.match(customerHtml, /conic-gradient/);
  assert.match(customerHtml, /MutationObserver/);
  assert.doesNotMatch(customerHtml, /calc\(-1 \* min/);
  assert.doesNotMatch(customerHtml, /background-size:500% 400%/);

  for (const name of rewardNames) {
    assert.ok(customerHtml.includes(`['${name}',`), `missing roda icon mapping for ${name}`);
  }

  assert.ok(statSync(spriteUrl).size > 10000);
});
