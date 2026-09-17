import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assetRoute } from '../src/index.js';

// 2026-09-17, Bos Cyo: klik "Buka Workspace" gerai dari panel Entity Admin
// membuat address bar sekilas berpindah dari /s/PENDEM/admin ke bare
// /branch-admin (store code hilang) sebelum dilempar balik ke panel Entity.
//
// Root cause: wrangler.jsonc mengeset `html_handling: "auto-trailing-slash"`.
// Di bawah mode itu, Cloudflare Assets me-redirect (307/308) permintaan
// eksplisit ke path berakhiran ".html" menuju bentuk kanonik tanpa
// ekstensi. assetRoute() dulu mengembalikan path BERAKHIRAN ".html" (mis.
// "/branch-admin.html") untuk diminta ke env.ASSETS.fetch() -- binding itu
// balas dengan redirect ke "/branch-admin" (dibangun dari path asset
// INTERNAL yang diminta, bukan dari /s/PENDEM/admin yang sebenarnya
// diketik user), dan handleAsset() meneruskan redirect itu apa adanya ke
// browser -- alamat asli di address bar sungguhan berubah, store code
// hilang dari situ.
//
// Fix: assetRoute() sekarang mengembalikan bentuk KANONIK (tanpa ".html")
// supaya tidak pernah memicu redirect itu -- diminta ke ASSETS.fetch()
// TIDAK dalam bentuk yang auto-trailing-slash anggap "bukan kanonik".

test('assetRoute never returns a path ending in .html -- that shape triggers a redirect under html_handling: auto-trailing-slash', () => {
  const cases = [
    '/', '/customer', '/cashier', '/staff', '/admin', '/owner', '/entity-admin',
    '/s/PENDEM/admin', '/s/PENDEM/customer', '/s/PENDEM/cashier', '/s/PENDEM',
    '/some/unrelated/api/path'
  ];
  for (const pathname of cases) {
    const routed = assetRoute(pathname);
    assert.ok(!routed.endsWith('.html'), `assetRoute(${JSON.stringify(pathname)}) returned ${JSON.stringify(routed)}, which ends in .html and would be redirected away from by Cloudflare Assets`);
  }
});

test('assetRoute resolves /s/:code/admin to the canonical branch-admin path, preserving nothing store-specific (store code lives in the outer URL, not the asset path)', () => {
  assert.equal(assetRoute('/s/PENDEM/admin'), '/branch-admin');
  assert.equal(assetRoute('/s/DERMO/admin'), '/branch-admin');
  assert.equal(assetRoute('/s/PENDEM/customer'), '/customer');
  assert.equal(assetRoute('/s/PENDEM/cashier'), '/cashier');
  assert.equal(assetRoute('/s/PENDEM'), '/customer');
});

test('assetRoute keeps the direct top-level shortcuts working, now extensionless', () => {
  assert.equal(assetRoute('/'), '/customer');
  assert.equal(assetRoute('/customer'), '/customer');
  assert.equal(assetRoute('/cashier'), '/cashier');
  assert.equal(assetRoute('/staff'), '/staff');
  assert.equal(assetRoute('/admin'), '/owner');
  assert.equal(assetRoute('/owner'), '/owner');
  assert.equal(assetRoute('/entity-admin'), '/entity-admin');
});

test('the branch-admin.html post-processing check (admin-voucher.js injection) matches the new extensionless asset path, not the old .html one', () => {
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(source, /assetUrl\.pathname === '\/branch-admin'/);
  assert.doesNotMatch(source, /assetUrl\.pathname === '\/branch-admin\.html'/);
});

test('wrangler.jsonc html_handling stays auto-trailing-slash -- this test documents WHY assetRoute must avoid .html paths, so it fails loudly if that config silently changes underneath this fix', () => {
  const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(wrangler, /"html_handling":\s*"auto-trailing-slash"/);
});
