import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleUiProfileApi } from '../src/ui-profile.js';
import { UI_SKIN_KEY, setTenantPolicySetting } from '../src/tenant-policy.js';
import { assetRoute } from '../src/index.js';

// Skin D = "Mode Warung" (DESAIN-SKIN-D-WARUNG.md): bukan hanya tampilan,
// tapi kasir satu layar + layar Pemilik "Hari ini" -- dan hanya untuk tenant
// yang memilih D.
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() { const r = this.db.prepare(this.sql).run(...this.params); return { meta: { changes: Number(r.changes || 0) } }; }
}
class D1Database { constructor(db) { this.db = db; } prepare(sql) { return new D1Statement(this.db, sql); } }

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}

test('pilihan D menjadi skin "d" hanya untuk tenant yang memilihnya', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    await setTenantPolicySetting(env.DB, 'TEN-LAB-TAMPILAN', UI_SKIN_KEY, 'D', { role: 'OWNER', id: 'test' });
    const profile = async query => (await handleUiProfileApi(new Request(`https://example.test/api/ui-profile?${query}`), env, '/api/ui-profile')).json();
    assert.equal((await profile('store=LAB01')).skin, 'd');
    assert.equal((await profile('store=G001')).skin, 'classic');
  } finally {
    db.close();
  }
});

test('/s/<kode>/warung membuka halaman Mode Warung', () => {
  assert.equal(assetRoute('/s/LAB01/warung'), '/warung');
  assert.equal(assetRoute('/s/LAB01/warung/'), '/warung');
  assert.equal(assetRoute('/s/LAB01/cashier'), '/cashier');
});

test('Mode Warung menjual lewat jalur kasir yang sama dan tidak membuat ulang absen/laci', () => {
  const ui = read('public/warung.js');
  assert.match(ui, /'\/api\/cashier\/sales', \{ method: 'POST'/);
  assert.match(ui, /\/api\/cashier\/drawer/);
  assert.match(ui, /attendanceStatus !== 'in'/);
  // Absen tidak pernah dibuat ulang di sini. Buka laci langsung hanya untuk
  // skin E (jaga sendiri, server yang menentukan lewat ownerOperated) --
  // skin D tetap lewat Kasir lengkap.
  assert.doesNotMatch(ui, /\/api\/staff\/attendance/);
  assert.match(ui, /state\.solo = Boolean\(cashier\.store\?\.ownerOperated\)/);
  assert.match(ui, /if \(!state\.drawer\) \{ showOpenGate\(\)/);
  // Cara bayar untuk pembeli saja: utang ke supplier & legacy tidak ditawarkan.
  assert.match(ui, /\['PAYABLE', 'NON_CASH'\]/);
  // Tanpa polling periodik (invariant #6).
  assert.doesNotMatch(ui, /setInterval/);
});

test('pintu masuk & layar Pemilik hanya aktif di skin D dan E', () => {
  const entry = read('public/warung-entry.js');
  const owner = read('public/warung-pemilik.js');
  assert.match(entry, /if \(skin !== 'd' && skin !== 'e'\) return/);
  assert.match(owner, /if \(!\['d', 'e'\]\.includes\(window\.MaxiSkin\?\.skin\?\.\(\)\)\) return unmount\(\)/);
  assert.doesNotMatch(owner, /setInterval/);
  assert.match(read('public/cashier.html'), /<script src="\/warung-entry\.js\?v=[^"]+"><\/script>/);
  assert.match(read('public/entity-admin.html'), /<script src="\/warung-pemilik\.js\?v=[^"]+"><\/script>/);
});

test('skin D Workspace Gerai: halaman "Hari ini", menu 6 tombol, Lainnya berkelompok -- hanya skin D', () => {
  const nav = read('public/nav-groups.js');
  assert.match(nav, /id: 'today', icon: '🏠', label: 'Hari ini', home: true/);
  assert.match(nav, /title: 'Lanjutan — jarang dipakai'/);
  // Tab baru dari sesi lain tidak hilang: masuk "Fitur lain".
  assert.match(nav, /title: 'Fitur lain'/);
  const home = read('public/warung-admin.js');
  assert.match(home, /const isOn = \(\) => window\.MaxiSkin\?\.skin\?\.\(\) === 'd'/);
  for (const path of ['/api/admin/reports/net-profit', '/api/management/approval-requests', '/api/admin/drawer/close-permits', '/api/admin/drawers']) assert.ok(home.includes(path), path);
  assert.doesNotMatch(home, /setInterval/);
  // Hanya teks tampil yang diganti -- isian form tidak pernah disentuh.
  assert.match(home, /SKIP = new Set\(\['INPUT', 'TEXTAREA', 'SELECT'/);
  assert.match(read('public/branch-admin.html'), /<script src="\/warung-admin\.js"><\/script>/);
  const approvals = read('public/management-approval-queue.js');
  assert.match(approvals, /window\.MaxiSkin\?\.skin\?\.\(\) === 'd' \? owner : classic/);
  const css = read('public/skin-d.css');
  assert.match(css, /html\[data-skin="d"\] \.admin-top-actions > a:not\(#cashierReadOnlyLink\) \{ display: none; \}/);
});

// Bos Cyo, 2026-10-04: CS Mandala nyangkut di Mode Warung setelah Owner mengganti skin
// ke 0, padahal HP lain sudah ikut skin baru. Layar Warung wajib pulang ke Kasir biasa
// begitu server bilang skinnya bukan D/E lagi -- saat dimuat dan saat HP dibuka lagi.
async function jalankanLayarWarung(skinAwal, skinSesudahRefresh = skinAwal) {
  const { runInNewContext } = await import('node:vm');
  const pindah = [];
  const listeners = { window: {}, document: {} };
  const element = () => new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'classList') return { add() {}, remove() {}, toggle() {} };
      if (key === 'style' || key === 'dataset') return {};
      if (key === 'hidden') return true;
      if (key === 'value') return '';
      if (key === 'addEventListener' || key === 'querySelectorAll') return () => [];
      return () => {};
    },
    set(target, key, value) { target[key] = value; return true; }
  });
  let skin = skinAwal;
  const MaxiSkin = {
    skin: () => skin,
    brand: () => 'MAXI',
    ready: Promise.resolve(),
    refresh: async () => { skin = skinSesudahRefresh; }
  };
  const context = {
    window: { MaxiSkin, LEKER_STORE_CODE: 'MANDALA', lekerStorePath: page => `/s/MANDALA/${page}`, addEventListener: (type, fn) => { listeners.window[type] = fn; } },
    document: { getElementById: element, addEventListener: (type, fn) => { listeners.document[type] = fn; }, documentElement: element(), visibilityState: 'visible' },
    localStorage: { getItem: () => 'token-kasir', setItem() {}, removeItem() {} },
    location: { replace: url => pindah.push(url), href: '/s/MANDALA/warung' },
    fetch: () => new Promise(() => {}),
    setTimeout, clearTimeout, URLSearchParams, Intl, Number, Math, String, JSON, Map, Promise, Boolean, Array, Object
  };
  context.window.document = context.document;
  runInNewContext(read('public/warung.js'), context);
  await new Promise(resolve => setImmediate(resolve));
  return { pindah, listeners, ubahSkin: next => { skin = next; } };
}

test('Mode Warung pulang ke Kasir biasa saat skin tenant sudah bukan D/E (tidak nyangkut di skin lama)', async () => {
  const lama = await jalankanLayarWarung('classic');
  assert.deepEqual(lama.pindah, ['/s/MANDALA/cashier'], 'skin 0 -> langsung ke Kasir biasa');

  const tetap = await jalankanLayarWarung('d');
  assert.deepEqual(tetap.pindah, [], 'skin D tetap di Mode Warung');
  const tetapE = await jalankanLayarWarung('e');
  assert.deepEqual(tetapE.pindah, [], 'skin E tetap di Mode Warung');

  // HP dibiarkan terbuka di Mode Warung, lalu Owner mengganti skin ke A: begitu HP dibuka
  // lagi, skin dicek ulang ke server dan layar pulang.
  const terbuka = await jalankanLayarWarung('d', 'a');
  assert.deepEqual(terbuka.pindah, []);
  terbuka.listeners.document.visibilitychange();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(terbuka.pindah, ['/s/MANDALA/cashier']);

  assert.match(read('public/warung.html'), /\/warung\.js\?v=20261004-pulang-skin-v1/);
});
