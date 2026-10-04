import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker, { marketingAssetPath } from '../src/index.js';

// Alamat utama domain jualan membuka landing page /produk/; alamat utama host
// lain (gerai) tidak boleh berubah perilakunya sama sekali.

function fakeEnv() {
  const seen = [];
  return {
    seen,
    ASSETS: { fetch: async (request) => { seen.push(new URL(request.url).pathname); return new Response('asset', { status: 200 }); } }
  };
}

test('domain jualan: "/" dialihkan ke landing page, termasuk www dan huruf besar', () => {
  assert.equal(marketingAssetPath('ownertenang.biz.id', '/'), '/produk/');
  assert.equal(marketingAssetPath('www.ownertenang.biz.id', '/'), '/produk/');
  assert.equal(marketingAssetPath('OwnerTenang.ID', '/'), '/produk/');
});

test('hanya alamat utama yang dialihkan; path lain dan host lain tidak', () => {
  assert.equal(marketingAssetPath('ownertenang.biz.id', '/login'), null);
  assert.equal(marketingAssetPath('ownertenang.biz.id', '/produk/'), null);
  assert.equal(marketingAssetPath('prototype-leker-v2.daily-napkin.workers.dev', '/'), null);
  assert.equal(marketingAssetPath('evil-ownertenang.biz.id.example.com', '/'), null);
  assert.equal(marketingAssetPath(undefined, '/'), null);
});

test('Worker: "/" di domain jualan meminta /produk/ dari ASSETS', async () => {
  const env = fakeEnv();
  const response = await worker.fetch(new Request('https://ownertenang.biz.id/'), env);
  assert.equal(response.status, 200);
  assert.deepEqual(env.seen, ['/produk/']);
});

test('Worker: "/" di host gerai diteruskan apa adanya (tetap index.html lewat ASSETS)', async () => {
  const env = fakeEnv();
  await worker.fetch(new Request('https://prototype-leker-v2.daily-napkin.workers.dev/'), env);
  assert.deepEqual(env.seen, ['/']);
});

test('wrangler.jsonc: "/" ikut run_worker_first, /api/* tetap ada', () => {
  const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(wrangler, /"run_worker_first":\s*\["\/api\/\*",\s*"\/"\]/);
});
