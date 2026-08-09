import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../public/customer.html', import.meta.url);
const jsUrl = new URL('../public/customer-repeat-order.js', import.meta.url);
const cssUrl = new URL('../public/customer-repeat-order.css', import.meta.url);

test('customer can return to menu and create another order without cancelling the submitted order', async () => {
  const [html, js, css] = await Promise.all([
    readFile(htmlUrl, 'utf8'),
    readFile(jsUrl, 'utf8'),
    readFile(cssUrl, 'utf8')
  ]);

  assert.match(html, /customer-repeat-order\.css/);
  assert.match(html, /customer-repeat-order\.js/);
  assert.match(js, /PILIH MENU LAGI/);
  assert.match(js, /state\.activeOrder = null/);
  assert.match(js, /localStorage\.removeItem\('lekerActiveOrderId'\)/);
  assert.match(js, /state\.cart = \[\]/);
  assert.match(js, /renderCart\(\)/);
  assert.match(js, /renderMenu\(\)/);
  assert.doesNotMatch(js, /fetch\(/);
  assert.match(css, /\.repeat-order-actions/);
});
