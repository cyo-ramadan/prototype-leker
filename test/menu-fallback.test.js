import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const menuUrl = new URL('../public/menu.json', import.meta.url);

test('static menu fallback contains the canonical 20 leker products', async () => {
  const menu = JSON.parse(await readFile(menuUrl, 'utf8'));
  assert.equal(menu.length, 20);
  assert.equal(new Set(menu.map(item => item.id)).size, 20);
  assert.deepEqual(menu[0], { id: 1, name: 'Leker Cokelat', price: 8000, category: 'Classic', emoji: '🍫' });
  assert.deepEqual(menu[19], { id: 20, name: 'Leker Special Maxi', price: 15000, category: 'Signature', emoji: '👑' });
});
