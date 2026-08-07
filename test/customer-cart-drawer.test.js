import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const customerHtmlUrl = new URL('../public/customer.html', import.meta.url);
const customerJsUrl = new URL('../public/customer.js', import.meta.url);
const stylesUrl = new URL('../public/styles.css', import.meta.url);

test('customer UI exposes a side cart drawer without replacing the order API flow', async () => {
  const [html, js, css] = await Promise.all([
    readFile(customerHtmlUrl, 'utf8'),
    readFile(customerJsUrl, 'utf8'),
    readFile(stylesUrl, 'utf8')
  ]);

  assert.match(html, /id="cartHandle"/);
  assert.match(html, /id="cartDrawer"/);
  assert.match(html, /id="cartBackdrop"/);
  assert.match(html, /FIX PESANAN · KIRIM KE KASIR/);

  assert.match(js, /function openCart\(\)/);
  assert.match(js, /function closeCart\(\)/);
  assert.match(js, /data-menu-action="minus"/);
  assert.match(js, /CART_EDGE_GESTURE_PX/);
  assert.match(js, /fetch\('\/api\/orders'/);

  assert.match(css, /\.cart-drawer/);
  assert.match(css, /transform: translateX\(105%\)/);
  assert.match(css, /\.menu-card\.selected/);
});
