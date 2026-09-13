import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const customerHtml = readFileSync(new URL('../public/customer.html', import.meta.url), 'utf8');
const gameHtml = readFileSync(new URL('../public/game.html', import.meta.url), 'utf8');
const gameCss = readFileSync(new URL('../public/game.css', import.meta.url), 'utf8');

test('customer keeps Game out of the ordering page and exposes a floating entry above cart', () => {
  assert.match(customerHtml, /id="gameHandle"[^>]*class="game-handle"[^>]*href="\/game\.html"/);
  assert.match(customerHtml, /\.game-handle\{position:fixed;[^}]*top:calc\(47% - 82px\)/);
  assert.match(customerHtml, /window\.mountRodaPuterDemo = async \(\) => \{\};/);
  assert.doesNotMatch(customerHtml, /src="\/roda-puter-product-art\.js/);
});

test('dedicated Game page owns the Roda surface and preserves store-aware return navigation', () => {
  assert.match(gameHtml, /id="rodaPuterDemo"/);
  assert.match(gameHtml, /id="rodaPuterWheel"/);
  assert.match(gameHtml, /id="rodaPuterSpin"/);
  assert.match(gameHtml, /data-store-page="customer"/);
  assert.match(gameHtml, /\/api\/roda-puter\/rewards/);
  assert.match(gameHtml, /\/api\/roda-puter\/demo/);
  assert.match(gameHtml, /src="\/roda-puter-product-art\.js\?v=20260913-master-visual-v1"/);
  assert.match(gameCss, /\.roda-demo\.ready\{display:grid/);
});
