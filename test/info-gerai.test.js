import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleInfoGeraiApi } from '../src/info-gerai.js';
import { getCashierRaportFacts } from '../src/staff-raport.js';
import { hashCredential } from '../src/owner-auth.js';

// Info Gerai (Bos Cyo, 2026-10-16): kontak darurat, laporan masalah dari CS/sidak, dan panduan
// "masalah -> cara mengatasi". Laporan yang selesai wajib menulis solusinya dan otomatis jadi
// panduan, supaya CS baru bisa membaca cara mengatasinya sendiri.

const migrationDir = new URL('../migrations/', import.meta.url);

function d1(sqlite) {
  function prepared(sql) {
    const statement = sqlite.prepare(sql);
    return {
      bind(...args) {
        return {
          _statement: statement,
          _args: args,
          async first() { return statement.get(...args) || null; },
          async all() { return { results: statement.all(...args) }; },
          async run() {
            const result = statement.run(...args);
            return { ...result, success: true, meta: { changes: result.changes } };
          }
        };
      }
    };
  }
  return {
    prepare: prepared,
    async batch(bound) {
      return bound.map(item => {
        const result = item._statement.run(...item._args);
        return { success: true, meta: { changes: result.changes } };
      });
    }
  };
}

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

async function session(sqlite, table, column, id, token) {
  sqlite.prepare(`INSERT INTO ${table} (token_hash, ${column}, created_at, expires_at) VALUES (?, ?, '2026-10-16T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), id);
  return token;
}

async function fixture() {
  const sqlite = freshDatabase();
  const env = { DB: d1(sqlite) };
  const owner = sqlite.prepare('SELECT id FROM owner_accounts ORDER BY id LIMIT 1').get();
  return {
    sqlite,
    env,
    kasir: await session(sqlite, 'cashier_sessions', 'cashier_id', 'cashier_pendem_pilot', 'ig-kasir'),
    admin: await session(sqlite, 'store_admin_sessions', 'admin_id', 'admin_pendem_pilot', 'ig-admin'),
    owner: await session(sqlite, 'owner_sessions', 'owner_id', owner.id, 'ig-owner')
  };
}

async function call(env, pathname, { token, method = 'GET', body, store = 'PENDEM' } = {}) {
  const url = new URL(`https://example.test${pathname}`);
  if (store) url.searchParams.set('store', store);
  const response = await handleInfoGeraiApi(new Request(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  }), env, pathname);
  return { status: response.status, body: await response.json() };
}

test('kasir: melaporkan masalah (selalu Umum), tidak bisa menambah kontak/panduan atau mengubah status', async () => {
  const f = await fixture();
  try {
    const lapor = await call(f.env, '/api/info-gerai', { token: f.kasir, method: 'POST', body: { kind: 'LAPORAN', title: 'Lampu neon box mati', category: 'Listrik', visibility: 'RAHASIA', severity: 'KUNING' } });
    assert.equal(lapor.status, 201);
    const row = f.sqlite.prepare('SELECT * FROM info_gerai_entries WHERE id = ?').get(lapor.body.id);
    assert.equal(row.visibility, 'UMUM');
    assert.equal(row.source, 'CS');
    assert.equal(row.status, 'BARU');
    assert.equal(row.store_id, 'store_pendem');
    const reportFacts = await getCashierRaportFacts(f.env.DB, 'store_pendem', 'cashier_pendem_pilot');
    assert.equal(reportFacts.facts.infoGeraiReports.submitted, 1);
    assert.ok(reportFacts.assessmentInputs.some(input => input.code === 'info_gerai_reports'));
    assert.equal((await getCashierRaportFacts(f.env.DB, 'store_genengan', 'cashier_pendem_pilot')).facts.infoGeraiReports.submitted, 0);
    assert.equal((await getCashierRaportFacts(f.env.DB, 'store_pendem', 'cashier_lain')).facts.infoGeraiReports.submitted, 0);


    assert.equal((await call(f.env, '/api/info-gerai', { token: f.kasir, method: 'POST', body: { kind: 'KONTAK', title: 'Es Batu Pak Darto' } })).status, 403);
    assert.equal((await call(f.env, '/api/info-gerai', { token: f.kasir, method: 'POST', body: { kind: 'PANDUAN', title: 'Listrik' } })).status, 403);
    assert.equal((await call(f.env, `/api/info-gerai/${lapor.body.id}/status`, { token: f.kasir, method: 'POST', body: { status: 'DITANGANI' } })).status, 403);

    // "Saya juga lihat" sekali per orang.
    assert.equal((await call(f.env, `/api/info-gerai/${lapor.body.id}/aktivitas`, { token: f.kasir, method: 'POST', body: { kind: 'SAYA_JUGA' } })).status, 201);
    assert.equal((await call(f.env, `/api/info-gerai/${lapor.body.id}/aktivitas`, { token: f.kasir, method: 'POST', body: { kind: 'SAYA_JUGA' } })).status, 409);
    const list = await call(f.env, '/api/info-gerai', { token: f.kasir });
    assert.equal(list.body.canManage, false);
    assert.equal(list.body.entries[0].sayaJuga, 1);
  } finally { f.sqlite.close(); }
});

test('sifat catatan: kasir hanya melihat Umum, admin gerai + Admin, Owner + Rahasia', async () => {
  const f = await fixture();
  try {
    for (const visibility of ['UMUM', 'ADMIN', 'RAHASIA']) {
      const created = await call(f.env, '/api/info-gerai', { token: f.owner, method: 'POST', body: { kind: 'PANDUAN', title: `Panduan ${visibility}`, body: 'isi', visibility } });
      assert.equal(created.status, 201);
    }
    const titles = async token => (await call(f.env, '/api/info-gerai', { token })).body.entries.map(entry => entry.title).sort();
    assert.deepEqual(await titles(f.kasir), ['Panduan UMUM']);
    assert.deepEqual(await titles(f.admin), ['Panduan ADMIN', 'Panduan UMUM']);
    assert.deepEqual(await titles(f.owner), ['Panduan ADMIN', 'Panduan RAHASIA', 'Panduan UMUM']);
    // Admin gerai tidak boleh membuat yang Rahasia.
    assert.equal((await call(f.env, '/api/info-gerai', { token: f.admin, method: 'POST', body: { kind: 'PANDUAN', title: 'x', visibility: 'RAHASIA' } })).status, 403);
  } finally { f.sqlite.close(); }
});

test('kontak "semua gerai" dari Owner tampil di gerai lain, tapi admin gerai tidak bisa mengubahnya', async () => {
  const f = await fixture();
  try {
    const created = await call(f.env, '/api/info-gerai', { token: f.owner, method: 'POST', body: { kind: 'KONTAK', title: 'Es Batu Pak Darto', category: 'Es Batu', phone: '0812 3456', mapsUrl: 'javascript:alert(1)', allStores: true } });
    assert.equal(created.status, 201);
    const row = f.sqlite.prepare('SELECT store_id, maps_url FROM info_gerai_entries WHERE id = ?').get(created.body.id);
    assert.equal(row.store_id, null);
    assert.equal(row.maps_url, '');
    const other = await call(f.env, '/api/info-gerai', { token: f.owner, store: 'GENENGAN' });
    assert.ok(other.body.entries.some(entry => entry.id === created.body.id && entry.allStores));
    const adminView = (await call(f.env, '/api/info-gerai', { token: f.admin })).body.entries.find(entry => entry.id === created.body.id);
    assert.equal(adminView.canEdit, false);
    assert.equal((await call(f.env, `/api/info-gerai/${created.body.id}`, { token: f.admin, method: 'PATCH', body: { phone: '0000' } })).status, 403);
    assert.equal((await call(f.env, '/api/info-gerai', { token: f.admin, method: 'POST', body: { kind: 'KONTAK', title: 'x', allStores: true } })).status, 403);
  } finally { f.sqlite.close(); }
});

test('laporan selesai wajib berisi solusi dan otomatis jadi panduan yang bisa dibaca kasir', async () => {
  const f = await fixture();
  try {
    const lapor = await call(f.env, '/api/info-gerai', { token: f.kasir, method: 'POST', body: { kind: 'LAPORAN', title: 'Listrik turun saat ramai', body: 'MCB jeglek', category: 'Listrik' } });
    assert.equal((await call(f.env, `/api/info-gerai/${lapor.body.id}/status`, { token: f.admin, method: 'POST', body: { status: 'DITANGANI' } })).status, 200);
    assert.equal((await call(f.env, `/api/info-gerai/${lapor.body.id}/status`, { token: f.admin, method: 'POST', body: { status: 'SELESAI' } })).status, 400);
    const selesai = await call(f.env, `/api/info-gerai/${lapor.body.id}/status`, { token: f.admin, method: 'POST', body: { status: 'SELESAI', resolution: 'Kompor listrik dan freezer jangan nyala bersamaan; naikkan MCB.' } });
    assert.equal(selesai.status, 200);
    assert.ok(selesai.body.guideId);

    const kasirView = (await call(f.env, '/api/info-gerai', { token: f.kasir })).body.entries;
    const guide = kasirView.find(entry => entry.id === selesai.body.guideId);
    assert.equal(guide.kind, 'PANDUAN');
    assert.equal(guide.sourceEntryId, lapor.body.id);
    assert.match(guide.body, /Cara mengatasi: Kompor listrik/);
    const report = kasirView.find(entry => entry.id === lapor.body.id);
    assert.equal(report.status, 'SELESAI');
    assert.deepEqual(report.activity.map(item => item.kind), ['STATUS', 'STATUS']);

    // Panduan bisa dinilai; laporan yang sudah tertutup tidak lagi masuk hitungan "belum beres".
    assert.equal((await call(f.env, `/api/info-gerai/${guide.id}/aktivitas`, { token: f.kasir, method: 'POST', body: { kind: 'MEMBANTU' } })).status, 201);
    const ringkasan = await call(f.env, '/api/info-gerai/ringkasan', { token: f.kasir });
    assert.equal(ringkasan.body.enabled, true);
    assert.deepEqual(ringkasan.body.stores, []);
  } finally { f.sqlite.close(); }
});

test('laporan 🔴 langsung jadi notifikasi untuk admin & owner, bukan untuk kasir', async () => {
  const f = await fixture();
  try {
    const lapor = await call(f.env, '/api/info-gerai', { token: f.kasir, method: 'POST', body: { kind: 'LAPORAN', title: 'Freezer mati', severity: 'MERAH' } });
    assert.equal(lapor.status, 201);
    const recipients = f.sqlite.prepare("SELECT recipient_key FROM management_notifications WHERE kind = 'INFO_GERAI_URGENT'").all().map(row => row.recipient_key);
    assert.ok(recipients.includes('ADMIN:admin_pendem_pilot'));
    assert.ok(recipients.some(key => key.startsWith('OWNER:')));
    assert.ok(!recipients.some(key => key.startsWith('CASHIER:')));
    const ringkasan = await call(f.env, '/api/info-gerai/ringkasan', { token: f.owner });
    assert.deepEqual(ringkasan.body.stores, [{ storeCode: 'PENDEM', open: 1, urgent: 1 }]);
  } finally { f.sqlite.close(); }
});

test('saklar tenant Info Gerai mati: ringkasan bilang nonaktif dan API menolak', async () => {
  const f = await fixture();
  try {
    const tenant = f.sqlite.prepare("SELECT t.tenant_id FROM entity_tenancy t JOIN stores s ON s.entity_id = t.entity_id WHERE s.code = 'PENDEM' AND t.effective_to IS NULL").get().tenant_id;
    f.sqlite.prepare("INSERT INTO tenant_policy_settings (tenant_id, setting_key, setting_value) VALUES (?, 'info_gerai', '0')").run(tenant);
    assert.deepEqual((await call(f.env, '/api/info-gerai/ringkasan', { token: f.kasir })).body, { enabled: false, stores: [] });
    assert.equal((await call(f.env, '/api/info-gerai', { token: f.kasir })).status, 403);
  } finally { f.sqlite.close(); }
});
