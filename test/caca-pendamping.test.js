import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { handleEntityAdminApi, hashCredential } from '../src/owner-auth.js';
import { bangunJalurAksi } from '../src/caca-chat.js';
import { cariAksi } from '../src/caca-aksi.js';

// Una sebagai pendamping pengguna baru (UNA-PENDAMPING.md), diuji ujung ke
// ujung dengan migration asli. Gerai uji sengaja IKAN01 (Galeh): di produksi
// gerai itu sudah 41 hari tanpa satu barang pun — kasus nyata yang melahirkan
// fitur ini.

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}

class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) {
    return statements.map((statement) => (/^\s*select/i.test(statement.sql) ? statement.all() : statement.run()));
  }
}

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}

function request(pathname, { token, method = 'GET', body } = {}) {
  return new Request(`https://example.test${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function siapkanGalehh() {
  const db = migratedDatabase();
  const password = 'rahasia123';
  db.prepare(`
    INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active)
    VALUES ('entity_admin_una', 'ENT-GALEH', 'entityadmin.una', ?, 'Admin Galeh', 1)
  `).run(await hashCredential(password));
  const env = { DB: new D1Database(db) };
  const login = await handleEntityAdminApi(
    request('/api/entity-admin/login', { method: 'POST', body: { username: 'entityadmin.una', password } }),
    env,
    '/api/entity-admin/login'
  );
  const { token } = await login.json();
  const panggil = async (pathname, pilihan = {}) => {
    const response = await worker.fetch(request(pathname, { token, ...pilihan }), env);
    return { status: response.status, body: await response.json() };
  };
  return { db, env, token, panggil };
}

async function draftBarangBanyak({ env, token }, tangkapan) {
  const jalur = bangunJalurAksi(request('/api/caca/tanya?store=IKAN01', { token }), env, {
    storeCode: 'IKAN01',
    jalurUtama: (permintaan) => worker.fetch(permintaan, env)
  });
  const disiapkan = await cariAksi('buat_barang_banyak').siapkan(tangkapan, {
    ...jalur, hariIni: '2026-10-02', namaLingkup: 'Galeh - Ikan dari Petani', lingkup: 'gerai', storeCode: 'IKAN01'
  });
  assert.equal(disiapkan.ok, true, disiapkan.tanya);
  return { ...disiapkan.draft, tangkapan };
}

const MENU = {
  daftar_barang: [
    { nama: 'Es Teh', harga_jual: '5rb' },
    { nama: 'Kopi Susu', harga_jual: '12rb', harga_beli: '4rb' },
    { nama: 'Roti Bakar', harga_jual: '15.000', kategori: 'Makanan' }
  ],
  daftar_kategori: '',
  daftar_jenis: 'jualan'
};

test('gerai kosong: Una menyapa dengan langkah menu dulu — tanpa mesin AI', async () => {
  const { db, panggil } = await siapkanGalehh();
  try {
    const { status, body } = await panggil('/api/caca/kesiapan?store=IKAN01');
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.kesiapan.siapJualan, false);
    assert.equal(body.kesiapan.berikutnya, 'menu');
    const menu = body.kesiapan.langkah.find((l) => l.id === 'menu');
    assert.equal(menu.selesai, false);
    assert.ok(menu.tawaran.some((t) => t.jenis === 'foto_menu'), 'tawaran foto daftar menu');
    assert.match(body.sapaan, /masih kosong/);
    assert.equal(body.kesiapan.langkah.find((l) => l.id === 'kasir').selesai, false);
  } finally {
    db.close();
  }
});

test('kesiapan gerai di luar entity tetap ditolak pemeriksaan wewenang aslinya', async () => {
  const { db, panggil } = await siapkanGalehh();
  try {
    const { status } = await panggil('/api/caca/kesiapan?store=G001');
    assert.equal(status, 403);
  } finally {
    db.close();
  }
});

test('isi barang massal: diposting bertahap, persis seperti draft, tanpa kembar', async () => {
  const galeh = await siapkanGalehh();
  const { db, panggil } = galeh;
  try {
    const draft = await draftBarangBanyak(galeh, MENU);
    assert.equal(draft.muatan.daftar.length, 3);

    const hasil = [];
    for (let bagian = 0; bagian < 3; bagian += 1) {
      const { status, body } = await panggil('/api/caca/catat?store=IKAN01', { method: 'POST', body: { draft, bagian } });
      assert.equal(status, 200, JSON.stringify(body));
      hasil.push(body);
    }
    assert.deepEqual(hasil.map((h) => h.hasil), ['dibuat', 'dibuat', 'dibuat']);
    assert.equal(hasil[2].selesai, true);

    const storeId = db.prepare("SELECT id FROM stores WHERE code = 'IKAN01'").get().id;
    const barang = db.prepare(`
      SELECT p.name, p.category, p.price, p.purchase_price, p.is_active, u.code AS unit, t.code AS tipe
      FROM products p JOIN units u ON u.id = p.base_unit_id JOIN item_types t ON t.id = p.item_type_id
      WHERE p.store_id = ? ORDER BY p.id
    `).all(storeId);
    assert.deepEqual(barang.map((b) => ({ ...b })), [
      { name: 'Es Teh', category: 'Menu', price: 5000 * 1_000_000, purchase_price: 0, is_active: 1, unit: 'PCS', tipe: 'FINISHED_GOOD' },
      { name: 'Kopi Susu', category: 'Menu', price: 12000 * 1_000_000, purchase_price: 4000 * 1_000_000, is_active: 1, unit: 'PCS', tipe: 'FINISHED_GOOD' },
      { name: 'Roti Bakar', category: 'Makanan', price: 15000 * 1_000_000, purchase_price: 0, is_active: 1, unit: 'PCS', tipe: 'FINISHED_GOOD' }
    ]);

    // Tombol tertekan dua kali / koneksi putus lalu diulang: tidak kembar.
    const ulang = await panggil('/api/caca/catat?store=IKAN01', { method: 'POST', body: { draft, bagian: 0 } });
    assert.equal(ulang.status, 200);
    assert.equal(ulang.body.hasil, 'sudah_ada');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products WHERE store_id = ?').get(storeId).n, 3);

    // Sesudahnya Una menunjuk langkah berikutnya: akun kasir.
    const kesiapan = await panggil('/api/caca/kesiapan?store=IKAN01');
    assert.equal(kesiapan.body.kesiapan.langkah.find((l) => l.id === 'menu').selesai, true);
    assert.equal(kesiapan.body.kesiapan.berikutnya, 'kasir');
  } finally {
    db.close();
  }
});

test('isi barang massal: draft yang diutak-atik di browser ditolak', async () => {
  const galeh = await siapkanGalehh();
  const { db, panggil } = galeh;
  try {
    const draft = await draftBarangBanyak(galeh, MENU);
    const diubah = structuredClone(draft);
    diubah.muatan.daftar[0].price = 1;
    const { status } = await panggil('/api/caca/catat?store=IKAN01', { method: 'POST', body: { draft: diubah, bagian: 0 } });
    assert.equal(status, 409);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM products p JOIN stores s ON s.id = p.store_id WHERE s.code = 'IKAN01'").get().n, 0);
  } finally {
    db.close();
  }
});

test('isi barang massal tanpa urutan baris ditolak, bukan diposting semuanya sekaligus', async () => {
  const galeh = await siapkanGalehh();
  const { db, panggil } = galeh;
  try {
    const draft = await draftBarangBanyak(galeh, MENU);
    for (const bagian of [undefined, -1, 3, '0']) {
      const { status } = await panggil('/api/caca/catat?store=IKAN01', { method: 'POST', body: { draft, bagian } });
      assert.equal(status, 400, `bagian ${bagian}`);
    }
  } finally {
    db.close();
  }
});

test('batalkan yang barusan: draft dari id barang, dinonaktifkan bertahap, tidak dihapus', async () => {
  const galeh = await siapkanGalehh();
  const { db, panggil } = galeh;
  try {
    const draftBuat = await draftBarangBanyak(galeh, MENU);
    const id = [];
    for (let bagian = 0; bagian < 3; bagian += 1) {
      const { body } = await panggil('/api/caca/catat?store=IKAN01', { method: 'POST', body: { draft: draftBuat, bagian } });
      id.push(body.id);
    }

    const siap = await panggil('/api/caca/siapkan?store=IKAN01', {
      method: 'POST', body: { aksi: 'nonaktifkan_barang', tangkapan: { nonaktif_id: id.slice(0, 2) } }
    });
    assert.equal(siap.status, 200, JSON.stringify(siap.body));
    assert.equal(siap.body.perluKonfirmasi, true);
    assert.deepEqual(siap.body.draft.tabel.isi, [['Es Teh'], ['Kopi Susu']]);

    for (let bagian = 0; bagian < 2; bagian += 1) {
      const { status, body } = await panggil('/api/caca/catat?store=IKAN01', { method: 'POST', body: { draft: siap.body.draft, bagian } });
      assert.equal(status, 200, JSON.stringify(body));
      assert.equal(body.hasil, 'dinonaktifkan');
    }
    const ulang = await panggil('/api/caca/catat?store=IKAN01', { method: 'POST', body: { draft: siap.body.draft, bagian: 0 } });
    assert.equal(ulang.body.hasil, 'sudah_nonaktif');

    const status = db.prepare('SELECT name, is_active FROM products WHERE id IN (?, ?, ?) ORDER BY id').all(...id).map((r) => ({ ...r }));
    assert.deepEqual(status, [
      { name: 'Es Teh', is_active: 0 },
      { name: 'Kopi Susu', is_active: 0 },
      { name: 'Roti Bakar', is_active: 1 }
    ]);
  } finally {
    db.close();
  }
});

test('siapkan langsung hanya untuk draft yang memang boleh disusun tanpa mesin AI', async () => {
  const { db, panggil } = await siapkanGalehh();
  try {
    const { status } = await panggil('/api/caca/siapkan?store=IKAN01', {
      method: 'POST', body: { aksi: 'buat_jurnal', tangkapan: {} }
    });
    assert.equal(status, 400);
  } finally {
    db.close();
  }
});

test('kamus: dijawab tanpa mesin AI, hanya untuk yang login', async () => {
  const { db, panggil, env } = await siapkanGalehh();
  try {
    const hpp = await panggil('/api/caca/jelaskan?topik=hpp');
    assert.equal(hpp.status, 200);
    assert.equal(hpp.body.judul, 'HPP (harga pokok)');
    assert.match(hpp.body.jawaban, /rata-rata/);

    const asing = await panggil('/api/caca/jelaskan?topik=blockchain');
    assert.equal(asing.body.dikenal, false);
    assert.ok(asing.body.tawaran.length > 3);

    const tanpaLogin = await worker.fetch(request('/api/caca/jelaskan?topik=hpp'), env);
    assert.equal(tanpaLogin.status, 401);
  } finally {
    db.close();
  }
});

test('foto daftar menu: dibaca jadi draft isi barang, harga singkat ditafsir ribuan dan ditulis terang', async () => {
  const galeh = await siapkanGalehh();
  const { db, panggil, env } = galeh;
  env.GEMINI_API_KEY = 'kunci-uji';
  const fetchAsli = globalThis.fetch;
  let dikirim = null;
  globalThis.fetch = async (url, init) => {
    dikirim = JSON.parse(init.body);
    const bacaan = {
      barang: [
        { nama: 'ES TEH MANIS', harga: '5', kategori: 'MINUMAN' },
        { nama: 'KOPI SUSU', harga: '12', kategori: 'MINUMAN' },
        { nama: 'Pisang Goreng', harga: '', kategori: 'CAMILAN' }
      ]
    };
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(bacaan) }] } }] }), { status: 200 });
  };
  try {
    const { status, body } = await panggil('/api/caca/baca-menu?store=IKAN01', {
      method: 'POST', body: { gambar: { media_type: 'image/jpeg', data: 'QUJD' } }
    });
    assert.equal(status, 200, JSON.stringify(body));
    assert.ok(dikirim.contents[0].parts.some((p) => p.inline_data), 'foto dikirim ke pembaca');
    assert.equal(body.perluKonfirmasi, true);
    assert.deepEqual(body.draft.tabel.isi, [
      ['Es Teh Manis', 'Minuman', '5.000', '—', 'pcs'],
      ['Kopi Susu', 'Minuman', '12.000', '—', 'pcs']
    ]);
    assert.ok(body.draft.dampak.some((d) => /ribuan/.test(d)), 'tafsiran ribuan disebut terang');
    assert.ok(body.draft.dampak.some((d) => /Pisang Goreng \(harga jualnya belum ada\)/.test(d)), 'baris tanpa harga disebut, bukan diisi 0');

    // Draft dari foto lolos pemeriksaan ulang yang sama dengan jalur ketik.
    const simpan = await panggil('/api/caca/catat?store=IKAN01', { method: 'POST', body: { draft: body.draft, bagian: 0 } });
    assert.equal(simpan.status, 200, JSON.stringify(simpan.body));
    assert.equal(simpan.body.hasil, 'dibuat');
  } finally {
    globalThis.fetch = fetchAsli;
    db.close();
  }
});
