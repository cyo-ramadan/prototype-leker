import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

// The sales landing pages (/produk/ dan /produk/kemitraan/) may only promise what
// is live and sellable today (HANDOFF-STRATEGI-PENJUALAN.md §8/§10). Features not
// built yet must not be advertised: a buyer who is promised them and does not find
// them is lost, and the page reads "prototype" to them.
//
// 2026-10-05, Bos Cyo: Una boleh tampil -- TAPI wajib berlabel "sedang kami uji"
// dan setiap perubahan oleh Una harus lewat draft + "Ya" dari pemilik.
const PAGES = ['../public/produk/index.html', '../public/produk/kemitraan/index.html'];

function load(path) {
  const html = readFileSync(new URL(path, import.meta.url), 'utf8');
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase();
  const hasWord = (word) => new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(visible);
  return { html, visible, hasWord };
}

for (const path of PAGES) {
  const { html, visible, hasWord } = load(path);
  const name = path.replace('../public', '');

  test(`${name}: does not look like a prototype or carry internal names`, () => {
    for (const word of ['prototype', 'leker', 'karen', 'hana', 'adr-', 'segera hadir', 'coming soon', 'beta']) {
      assert.ok(!hasWord(word), `${name} shows "${word}"`);
    }
  });

  test(`${name}: does not promise hidden or unbuilt features`, () => {
    const forbidden = [
      'caca', 'ai', 'asisten', 'chatbot',
      'game', 'roda', 'poin', 'loyalty',
      'offline', 'tap kartu', 'qris terintegrasi', 'aplikasi pelanggan',
      'jurnal', 'neraca', 'buku besar', 'akuntan',
      'free trial', 'daftar gratis', '100% aman', 'tidak pernah salah', 'royalti otomatis'
    ];
    for (const word of forbidden) {
      assert.ok(!hasWord(word), `${name} promises "${word}"`);
    }
  });

  test(`${name}: Una only appears with the "sedang kami uji" label`, () => {
    if (!hasWord('una')) return;
    assert.ok(visible.includes('sedang kami uji'), `${name} mentions Una without the testing label`);
  });

  test(`${name}: brand and WhatsApp number live in one config block`, () => {
    assert.match(html, /const LANDING = \{[\s\S]*BRAND:[\s\S]*WA_NUMBER:[\s\S]*\};/);
    assert.match(html, /function waHref\(extra\)/);
    assert.ok(html.includes('data-wa'), 'CTA buttons must be wired through data-wa');
    const number = html.match(/WA_NUMBER:\s*'([^']*)'/)?.[1];
    assert.match(number, /^62\d{8,13}$/);
  });

  test(`${name}: self-contained (no external font/script/image), one h1, lang id, under 200 KB`, () => {
    assert.doesNotMatch(html, /<link[^>]+href="https?:/i);
    assert.doesNotMatch(html, /<script[^>]+src=/i);
    assert.doesNotMatch(html, /<img[^>]+src="https?:/i);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
    assert.match(html, /<html lang="id">/);
    assert.ok(statSync(new URL(path, import.meta.url)).size < 200 * 1024);
  });
}

test('/produk/: Una simulation changes nothing without the owner saying "Ya"', () => {
  const { html } = load(PAGES[0]);
  assert.match(html, /belum disimpan/);
  assert.match(html, />Ya, simpan</);
  assert.match(html, /tidak ada yang disimpan/i);
});
