import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

test('Ikan desktop layout expands without changing the existing phone breakpoint', () => {
  assert.match(html, /@media\s*\(min-width:421px\)/);
  assert.match(html, /width:min\(1180px,calc\(100vw - 48px\)\)/);
  assert.match(html, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(html, /@media\(max-width:420px\)\{\.device\{width:100vw;height:100vh/);
});

test('Ikan UI remains isolated under its own public path', () => {
  assert.match(html, /<style id="ikan-desktop-layout">/);
  assert.match(html, /<div class="device"><div class="screen">/);
});
