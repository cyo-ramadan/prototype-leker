import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { handleEntityAdminApi, hashCredential } from '../src/owner-auth.js';
import { bangunJalurAksi } from '../src/caca-chat.js';
import { cariAksi, periksaUlangDraft } from '../src/caca-aksi.js';
import { jawabPertanyaan } from '../src/caca-agen.js';

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

// Bos Cyo 2026-10-03: "ganti harga aja masa ga bisa ... kan uda bisa bikin
// barang, masak edit ga bisa". Diuji ujung ke ujung dengan migration asli.

const MENU = {
  daftar_barang: [
    { nama: 'Es Teh Blackcurrant', harga_jual: '6rb', harga_beli: '2rb', kategori: 'Minuman' },
    { nama: 'Es Teh Lemon', harga_jual: '5rb' },
    { nama: 'Kopi Susu', harga_jual: '12rb' }
  ],
  daftar_kategori: '',
  daftar_jenis: 'jualan'
};

async function isiMenu(galeh) {
  const draft = await draftBarangBanyak(galeh, MENU);
  for (let bagian = 0; bagian < draft.muatan.daftar.length; bagian += 1) {
    const { status, body } = await galeh.panggil('/api/caca/catat?store=IKAN01', { method: 'POST', body: { draft, bagian } });
    assert.equal(status, 200, JSON.stringify(body));
  }
}

function jalurUna({ env, token }) {
  const jalur = bangunJalurAksi(new Request('https://example.test/api/caca/tanya?store=IKAN01', { headers: { authorization: `Bearer ${token}` } }), env, {
    storeCode: 'IKAN01', jalurUtama: (permintaan) => worker.fetch(permintaan, env)
  });
  return { ...jalur, hariIni: '2026-10-03', namaLingkup: 'Galeh', lingkup: 'gerai', storeCode: 'IKAN01' };
}

const barangDb = (db, nama) => db.prepare(`
  SELECT p.name, p.price, p.purchase_price, p.category, p.is_active, p.emoji, p.points_per_unit
  FROM products p JOIN stores s ON s.id = p.store_id WHERE s.code = 'IKAN01' AND p.name = ?`).get(nama);

const aksi = () => cariAksi('ubah_barang');

test('ganti harga jual: salah ketik nama dibaca kode dan disebut di draft; posting hanya mengubah harga', async () => {
  const galeh = await siapkanGalehh();
  try {
    await isiMenu(galeh);
    const sebelum = barangDb(galeh.db, 'Es Teh Blackcurrant');
    const tangkapan = { ubah_daftar: [{ barang: 'es teh blackcurent', harga_jual: '7rb' }] };
    const hasil = await aksi().siapkan(tangkapan, jalurUna(galeh));
    assert.equal(hasil.ok, true, hasil.tanya);
    assert.deepEqual(hasil.draft.tabel.isi, [['Es Teh Blackcurrant', 'Harga jual', 'Rp6.000', 'Rp7.000']]);
    assert.ok(hasil.draft.dampak.some((d) => /Una membaca "es teh blackcurent" sebagai "Es Teh Blackcurrant"/.test(d)));
    assert.equal(hasil.draft.bertahap, true);

    const diperiksa = await periksaUlangDraft({ ...hasil.draft, tangkapan }, jalurUna(galeh));
    assert.equal(diperiksa.ok, true, diperiksa.error);
    const { status, body } = await galeh.panggil('/api/caca/catat?store=IKAN01', { method: 'POST', body: { draft: { ...hasil.draft, tangkapan }, bagian: 0 } });
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.hasil, 'diubah');
    assert.equal(body.selesai, true);

    const sesudah = barangDb(galeh.db, 'Es Teh Blackcurrant');
    assert.equal(sesudah.price, 7000 * 1_000_000);
    assert.equal(sesudah.purchase_price, sebelum.purchase_price, 'harga beli tidak ikut berubah');
    assert.equal(sesudah.category, sebelum.category);
    assert.equal(sesudah.emoji, sebelum.emoji);
    assert.equal(sesudah.is_active, 1);
  } finally { galeh.db.close(); }
});

test('banyak barang sekaligus: harga beli, nama, kategori; potongan berikutnya tetap lolos setelah potongan pertama berubah', async () => {
  const galeh = await siapkanGalehh();
  try {
    await isiMenu(galeh);
    const tangkapan = { ubah_daftar: [
      { barang: 'Es Teh Lemon', harga_jual: '6rb', harga_beli: '2,5rb' },
      { barang: 'kopi susu', nama_baru: 'Kopi Susu Gula Aren', kategori: 'Kopi' }
    ] };
    const hasil = await aksi().siapkan(tangkapan, jalurUna(galeh));
    assert.equal(hasil.ok, true, hasil.tanya);
    assert.equal(hasil.draft.tabel.isi.length, 4);
    assert.ok(hasil.draft.dampak.some((d) => /hanya Harga Beli di Master Barang/.test(d)));

    const draft = { ...hasil.draft, tangkapan };
    for (let bagian = 0; bagian < 2; bagian += 1) {
      // Draft harus lolos periksa-ulang di tiap potongan, juga sesudah potongan sebelumnya mengubah datanya.
      const { status, body } = await galeh.panggil('/api/caca/catat?store=IKAN01', { method: 'POST', body: { draft, bagian } });
      assert.equal(status, 200, JSON.stringify(body));
    }
    assert.deepEqual({ ...barangDb(galeh.db, 'Es Teh Lemon') }, { name: 'Es Teh Lemon', price: 6000e6, purchase_price: 2500e6, category: 'Menu', is_active: 1, emoji: barangDb(galeh.db, 'Es Teh Lemon').emoji, points_per_unit: 0 });
    const kopi = barangDb(galeh.db, 'Kopi Susu Gula Aren');
    assert.equal(kopi.category, 'Kopi');
    assert.equal(kopi.price, 12000e6, 'harga tidak berubah karena tidak disebut');
    assert.equal(barangDb(galeh.db, 'Kopi Susu'), undefined);
    assert.equal(galeh.db.prepare("SELECT COUNT(*) AS n FROM categories c JOIN stores s ON s.id = c.store_id WHERE s.code = 'IKAN01' AND c.name = 'Kopi'").get().n, 1, 'kategori baru ikut terdaftar');
  } finally { galeh.db.close(); }
});

test('yang ragu ditanyakan, yang tidak perlu diubah dikatakan, yang kembar ditolak', async () => {
  const galeh = await siapkanGalehh();
  try {
    await isiMenu(galeh);
    const siap = (daftar) => aksi().siapkan({ ubah_daftar: daftar }, jalurUna(galeh));

    const ambigu = await siap([{ barang: 'es teh', harga_jual: '7rb' }]);
    assert.equal(ambigu.ok, false);
    assert.match(ambigu.tanya, /Es Teh Blackcurrant/);
    assert.match(ambigu.tanya, /Es Teh Lemon/);

    const asing = await siap([{ barang: 'sate ayam madura', harga_jual: '7rb' }]);
    assert.equal(asing.ok, false);
    assert.match(asing.tanya, /tidak ketemu/);

    const sama = await siap([{ barang: 'Kopi Susu', harga_jual: '12rb' }]);
    assert.equal(sama.ok, false);
    assert.match(sama.tanya, /sudah seperti itu/);

    const kosong = await siap([{ barang: 'Kopi Susu' }]);
    assert.match(kosong.tanya, /Mau diubah apanya/);

    const kembar = await siap([{ barang: 'Kopi Susu', nama_baru: 'es teh lemon' }]);
    assert.match(kembar.tanya, /Sudah ada barang "Es Teh Lemon"/);

    const dobel = await siap([{ barang: 'Kopi Susu', harga_jual: '13rb' }, { barang: 'kopi susu', harga_jual: '14rb' }]);
    assert.match(dobel.tanya, /disebut dua kali/);

    const kebesaran = await siap([{ barang: 'Kopi Susu', harga_jual: '50jt' }]);
    assert.match(kebesaran.tanya, /kebesaran/);
  } finally { galeh.db.close(); }
});

test('barang nonaktif tidak diubah diam-diam; draft yang diutak-atik tetap hanya mengubah barang di gerai sendiri', async () => {
  const galeh = await siapkanGalehh();
  try {
    await isiMenu(galeh);
    const id = galeh.db.prepare("SELECT p.id FROM products p JOIN stores s ON s.id = p.store_id WHERE s.code = 'IKAN01' AND p.name = 'Kopi Susu'").get().id;
    galeh.db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(id);
    const nonaktif = await aksi().siapkan({ ubah_daftar: [{ barang: 'Kopi Susu', harga_jual: '13rb' }] }, jalurUna(galeh));
    assert.equal(nonaktif.ok, false);
    assert.match(nonaktif.tanya, /sedang nonaktif/);

    // Barang gerai lain: id produk G001 dimasukkan ke draft buatan sendiri.
    const milikLain = galeh.db.prepare("SELECT p.id, p.name, p.price FROM products p JOIN stores s ON s.id = p.store_id WHERE s.code = 'G001' LIMIT 1").get();
    const draftPalsu = {
      aksi: 'ubah_barang', bertahap: true, tangkapan: {},
      muatan: { daftar: [{ id: milikLain.id, name: milikLain.name, perubahan: { price: 1 }, sebelum: { price: 'Rp1' } }], catatan: [] },
      judul: 'x', baris: [], dampak: []
    };
    const { status } = await galeh.panggil('/api/caca/catat?store=IKAN01', { method: 'POST', body: { draft: draftPalsu, bagian: 0 } });
    assert.ok(status >= 400, `barang gerai lain tidak boleh diubah (status ${status})`);
    assert.equal(galeh.db.prepare('SELECT price FROM products WHERE id = ?').get(milikLain.id).price, milikLain.price);
  } finally { galeh.db.close(); }
});

test('agen: "ganti harga ... jadi 7rb" menuju ubah_barang dengan riwayat; prompt tidak lagi bilang tidak bisa mengubah', async () => {
  const galeh = await siapkanGalehh();
  try {
    await isiMenu(galeh);
    const panggilan = [];
    const hasil = await jawabPertanyaan('harga es teh blackcurent di mandala ganti jadi 7rb ya', {
      nama: 'Bos', peran: 'Entity Admin', lingkup: 'gerai', namaLingkup: 'Galeh', storeCode: 'IKAN01', storeName: 'Galeh', hariIni: '2026-10-03', riwayat: []
    }, {
      jalurAksi: jalurUna(galeh),
      panggilModel: async (_env, permintaan) => {
        panggilan.push(permintaan);
        return { ok: true, value: { alat: 'ubah_barang', ubah_daftar: [{ barang: 'es teh blackcurent', harga_jual: '7rb' }] } };
      }
    });
    assert.equal(hasil.perluKonfirmasi, true);
    assert.equal(hasil.draft.aksi, 'ubah_barang');
    assert.equal(panggilan.length, 1);
    assert.match(panggilan[0].system, /ubah_barang: /);
    assert.doesNotMatch(panggilan[0].system, /tidak memiliki alat/);
    assert.match(panggilan[0].system, /mengubah barang \(ubah_barang/);
  } finally { galeh.db.close(); }
});

test('daftar barang ringkas: tanpa foto, jalur editor biasa tetap membawa foto', async () => {
  const galeh = await siapkanGalehh();
  try {
    await isiMenu(galeh);
    const id = galeh.db.prepare("SELECT p.id FROM products p JOIN stores s ON s.id = p.store_id WHERE s.code = 'IKAN01' AND p.name = 'Kopi Susu'").get().id;
    galeh.db.prepare("UPDATE products SET image_data = 'data:image/png;base64,AAAA' WHERE id = ?").run(id);
    const ringkas = await galeh.panggil('/api/admin/master/products/editor?store=IKAN01&ringkas=1');
    assert.equal(ringkas.status, 200);
    assert.ok(ringkas.body.products.every((p) => p.imageData === ''), 'foto tidak ikut');
    assert.equal(ringkas.body.products.find((p) => p.name === 'Kopi Susu').price, 12000);
    const penuh = await galeh.panggil('/api/admin/master/products/editor?store=IKAN01');
    assert.equal(penuh.body.products.find((p) => p.name === 'Kopi Susu').imageData, 'data:image/png;base64,AAAA');
  } finally { galeh.db.close(); }
});
