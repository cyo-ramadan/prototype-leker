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
  'es teh capucino besar',
  'es teh coklat besar',
  'es teh leci besar',
  'es teh apel besar',
  'es teh lemon honey besar',
  'es teh black curent besar',
  'es teh orange besar',
  'es teh mangga besar',
  'es teh poci original vanilla besar'
];

test('Roda Puter customer wheel decorates reward wedges with the 19 tea product assets', () => {
  assert.match(customerHtml, /roda-puter-tea-icons\.webp/);
  assert.match(customerHtml, /className = 'roda-reward-token'/);
  assert.match(customerHtml, /conic-gradient/);
  assert.match(customerHtml, /MutationObserver/);
  for (const name of rewardNames) {
    assert.ok(customerHtml.includes(`['${name}',`), `missing roda icon mapping for ${name}`);
  }
  assert.ok(statSync(spriteUrl).size > 10000);
});
