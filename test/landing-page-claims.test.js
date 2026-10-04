import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The sales landing page (/produk/) may only promise what is live and sellable
// today (HANDOFF-STRATEGI-PENJUALAN.md §10). Features hidden for new tenants or
// not built yet must not be advertised: a buyer who is promised them and does
// not find them is lost, and the page reads "prototype" to them.
const html = readFileSync(new URL('../public/produk/index.html', import.meta.url), 'utf8');
const visible = html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .toLowerCase();
const hasWord = (word) => new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(visible);

test('landing page does not look like a prototype or carry internal names', () => {
  for (const word of ['prototype', 'leker', 'karen', 'hana', 'adr-', 'segera hadir', 'coming soon', 'beta']) {
    assert.ok(!hasWord(word), `landing page shows "${word}"`);
  }
});

test('landing page does not promise hidden or unbuilt features', () => {
  const forbidden = [
    'caca', 'una', 'ai', 'asisten', 'chatbot',
    'game', 'roda', 'poin', 'loyalty',
    'offline', 'tap kartu', 'qris terintegrasi',
    'jurnal', 'neraca', 'buku besar', 'akuntan'
  ];
  for (const word of forbidden) {
    assert.ok(!hasWord(word), `landing page promises "${word}"`);
  }
});

test('brand and WhatsApp number live in one config block', () => {
  assert.match(html, /const LANDING = \{[\s\S]*BRAND:[\s\S]*WA_NUMBER:[\s\S]*\};/);
  assert.ok(html.includes('data-wa'), 'CTA buttons must be wired through data-wa');
});

test('WhatsApp number, once set, is in international format (wa.me rejects a leading 0)', () => {
  const number = html.match(/WA_NUMBER:\s*'([^']*)'/)?.[1];
  assert.notEqual(number, undefined);
  if (number) assert.match(number, /^62\d{8,13}$/);
});
