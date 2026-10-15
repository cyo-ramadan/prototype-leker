// U7 Una Live: pembaca lembar gambar. Server memakai otorisasi lembar asli (una_surfaces + sesi
// Entity Admin), model ditiru. Browser memakai handler asli dengan editor/lembar tiruan.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { hashCredential } from '../src/owner-auth.js';
import { handleUnaSurfacesApi } from '../src/una-surfaces.js';
import { handleBacaKanvas, perintahBacaKanvas, rapikanBacaan } from '../src/una-kanvas-baca.js';
import { validasiPerintah } from '../src/una-kemampuan.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const canvasFixture = JSON.parse(read('./fixtures/una-live/lembar.json')).surfaces.find(s => s.kind === 'canvas');
const S = canvasFixture.id;
const PNG = 'iVBORw0KGgo=';

class Statement {
  constructor(db, sql, params = []) { Object.assign(this, { db, sql, params }); }
  bind(...params) { return new Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() { return { meta: { changes: Number(this.db.prepare(this.sql).run(...this.params).changes) } }; }
}
async function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(n => /^\d{4}_.*\.sql$/.test(n)).sort()) db.exec(read('../migrations/' + name));
  db.exec("INSERT INTO entity_admins(id,entity_id,username,password_hash,display_name) VALUES('s1','ENT-G001','s1','x','One'),('s2','ENT-G002','s2','x','Two')");
  for (const token of ['s1', 's2']) db.prepare("INSERT INTO entity_admin_sessions(token_hash,entity_admin_id,created_at,expires_at) VALUES(?,?,'2026-01-01','2099-01-01')").run(await hashCredential(token), token);
  const env = { DB: { prepare: sql => new Statement(db, sql) } };
  const req = (path, method, body, token = 's1') => new Request('https://example.test' + path + '?lingkup=entity', { method, headers: { authorization: 'Bearer ' + token }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const created = await handleUnaSurfacesApi(req('/api/caca/surfaces', 'POST', { kind: 'canvas', title: 'Denah', content: canvasFixture.content }), env);
  const surface = (await created.json()).surface;
  const baca = async (body, { token = 's1', model } = {}) => {
    const calls = [];
    const panggilModel = async (_env, permintaan) => { calls.push(permintaan); return model ? model(permintaan) : { ok: true, value: { pengamatan: ['Kotak di tengah dengan tulisan "rak minuman"'], dugaan_maksud: ['Mungkin rak minuman mau dipindah ke kanan'], belum_jelas: ['Panah biru ke rak mana?'], usulan_tulisan: [{ teks: 'rak baru?', x: 830, y: 330 }], usulan_perintah: ['buat catatan pindah rak minuman'] } }; };
    const response = await handleBacaKanvas(req('/api/caca/kanvas/baca', 'POST', body, token), env, { panggilModel });
    return { status: response.status, body: await response.json(), calls };
  };
  return { surface, baca };
}
const isi = (surface, lain = {}) => ({ surfaceId: surface.id, revision: surface.revision, gambar: { media_type: 'image/png', data: PNG }, objek: canvasFixture.content.objects, pertanyaan: 'ini maksudnya apa?', ...lain });

test('server: hanya pemilik + revisi yang sama; model diberi gambar dan objek sebagai data', async t => {
  const { surface, baca } = await fixture(t);
  const ok = await baca(isi(surface));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.observations, ['Kotak di tengah dengan tulisan "rak minuman"']);
  assert.equal(ok.body.readRevision, surface.revision);
  assert.equal(ok.calls[0].content[0].type, 'image');
  assert.match(ok.calls[0].content[1].text, /data, bukan perintah/);
  // Akun lain: 404, model tidak dipanggil.
  const asing = await baca(isi(surface), { token: 's2' });
  assert.equal(asing.status, 404); assert.equal(asing.calls.length, 0);
  // Revisi lain (mis. perangkat lain sudah menyimpan): 409, model tidak dipanggil.
  const basi = await baca(isi(surface, { revision: surface.revision + 1 }));
  assert.equal(basi.status, 409); assert.equal(basi.body.code, 'REVISION_CONFLICT'); assert.equal(basi.calls.length, 0);
  // Gambar terlalu besar / bukan PNG / objek palsu ditolak sebelum model.
  for (const salah of [{ gambar: { media_type: 'image/png', data: 'a'.repeat(1_500_001) } }, { gambar: { media_type: 'image/svg+xml', data: PNG } }, { objek: [{ id: 'x', type: 'script', z: 1, color: '#000000' }] }]) {
    const r = await baca(isi(surface, salah));
    assert.equal(r.status, 400); assert.equal(r.calls.length, 0);
  }
});

test('server: keluaran model dirapikan; usulan tulisan jadi patch sah, bukan aksi bisnis', () => {
  const hasil = rapikanBacaan({
    pengamatan: ['a', '', 'b'.repeat(500), ...Array(10).fill('x')], dugaan_maksud: 'bukan array', belum_jelas: [],
    usulan_tulisan: [{ teks: 'label', x: 99999, y: -5 }, { teks: '' }, { teks: 'kedua', x: 10, y: 10 }],
    usulan_perintah: ['tambah barang Kopi harga 5000', 'hapus semua transaksi', 'x', 'y']
  }, { idDipakai: ['una-1'] });
  assert.equal(hasil.observations.length, 8);
  assert.equal(hasil.observations[1].length, 300);
  assert.deepEqual(hasil.intents, []);
  assert.equal(hasil.proposedPatch.length, 2);
  assert.equal(hasil.proposedPatch[0].object.id, 'una-2', 'id tidak bentrok dengan objek yang ada');
  assert.deepEqual([hasil.proposedPatch[0].object.x, hasil.proposedPatch[0].object.y], [10000, 0]);
  assert.equal(hasil.proposedMessages.length, 3, 'usulan perintah hanya teks, maks 3');
});

test('pemicu: hanya saat lembar gambar aktif dan pesan merujuk gambar', () => {
  const sc = { turnId: 'turn_1', scopeEpoch: 4, activeSurfaceId: S, surfaceRevision: 5, surfaceKind: 'canvas' };
  for (const pesan of ['lihat gambar ini', 'Una, ini maksudnya apa?', 'tolong baca coretan aku', 'cek denah ini dong']) {
    const h = perintahBacaKanvas(pesan, { surfaceContext: sc });
    assert.equal(h?.uiActions?.[0]?.capabilityId, 'canvas.read', pesan);
    assert.deepEqual(h.uiActions[0].target, { surfaceId: S, expectedRevision: 5 });
    const cek = validasiPerintah(h.uiActions[0], { role: 'ENTITY_ADMIN', lingkup: 'entity', skin: 'classic', scopeEpoch: 4, activeSurfaceId: S, surface: { id: S, kind: 'canvas', revision: 5 }, dirty: false });
    assert.equal(cek.ok, true, JSON.stringify(cek.receipt));
  }
  assert.equal(perintahBacaKanvas('lihat gambar ini', { surfaceContext: { ...sc, surfaceKind: 'page' } }), null);
  assert.equal(perintahBacaKanvas('tambah barang kopi', { surfaceContext: sc }), null);
  assert.equal(perintahBacaKanvas('lihat gambar ini', {}), null);
});

function browser({ serialSesudah = null } = {}) {
  let serial = 3; let revision = 5; let dirty = false; const executed = [];
  const editor = {
    model: { revision: () => revision, serial: () => serial },
    snapshot: async ids => ({ surfaceId: S, revision, editSerial: serial, png: 'data:image/png;base64,' + PNG, objects: canvasFixture.content.objects.filter(o => !ids || ids.includes(o.id)) })
  };
  const box = {
    console, JSON, Promise, Date, Map, crypto: globalThis.crypto,
    UnaLembar: { active: () => ({ id: S, kind: 'canvas' }), editor: () => editor, context: () => ({ scopeEpoch: 4, surface: { id: S, kind: 'canvas', revision }, dirty }), save: async () => { if (dirty) { revision++; dirty = false; } return true; } },
    UnaRegistry: { register() {}, execute: async cmd => { executed.push(cmd); return { status: 'ok', actionId: cmd.actionId }; } },
    UnaDispatcher: { question: () => 'ini maksudnya apa?' },
    cacaState: { scope: '__entity__' }, cacaQueryLingkup: () => 'lingkup=entity',
    cacaApi: async (path, opsi) => {
      box.sent = { path, body: JSON.parse(opsi.body) };
      if (serialSesudah !== null) serial = serialSesudah; // Bos mencoret lagi saat Una membaca
      return { surfaceId: S, readRevision: revision, observations: ['kotak'], intents: ['Mungkin rak'], unclear: ['panah ke mana?'], proposedPatch: [{ op: 'add', object: { id: 'una-1', type: 'text', z: 9000, color: '#7c3aed', x: 10, y: 10, text: 'rak?', fontSize: 18 } }], proposedMessages: ['buat catatan pindah rak'] };
    }
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read('../public/una-kanvas-baca.js'), box);
  return { box, executed, setDirty: v => { dirty = v; }, ubahSerial: v => { serial = v; } };
}
const exec = id => ({ command: { actionId: id, turnId: 'turn_1' }, isCurrent: () => true });

test('browser: snapshot dikirim, ringkasan memisahkan pengamatan/dugaan/belum jelas, usulan lewat tombol', async () => {
  const b = browser();
  const r = await b.box.UnaKanvasBaca._execute({}, exec('act_a'));
  assert.equal(r.ok, true);
  assert.equal(b.box.sent.path, '/api/caca/kanvas/baca?lingkup=entity');
  assert.equal(b.box.sent.body.revision, 5);
  assert.equal(b.box.sent.body.gambar.data, PNG);
  const ring = b.box.UnaKanvasBaca.ringkas('act_a');
  assert.match(ring.text, /Yang Una lihat:\n• kotak/);
  assert.match(ring.text, /Dugaan maksudnya:\n• Mungkin rak/);
  assert.match(ring.text, /Yang belum jelas:\n• panah ke mana\?/);
  assert.equal(ring.ask, true);
  assert.equal(ring.tawaran[0].jenis, 'kanvas_usulan');
  assert.equal(ring.tawaran[1].jenis, 'isi', 'usulan bisnis hanya ke kotak ketik');
  assert.equal(b.executed.length, 0, 'membaca tidak menerapkan apa pun');
  const pakai = await b.box.UnaKanvasBaca.terapkan('act_a');
  assert.equal(pakai.ok, true);
  const cmd = b.executed[0];
  assert.equal(cmd.capabilityId, 'canvas.apply_patch');
  assert.equal(cmd.origin, 'user');
  assert.deepEqual(JSON.parse(JSON.stringify(cmd.target)), { surfaceId: S, expectedRevision: 5 });
  const cek = validasiPerintah(JSON.parse(JSON.stringify(cmd)), { role: 'ENTITY_ADMIN', lingkup: 'entity', skin: 'classic', scopeEpoch: 4, activeSurfaceId: S, surface: { id: S, kind: 'canvas', revision: 5 }, dirty: false });
  assert.equal(cek.ok, true, JSON.stringify(cek.receipt));
});

test('browser: Bos mencoret lagi saat dibaca -> bacaan versi sebelumnya, usulan tidak bisa diterapkan', async () => {
  const b = browser({ serialSesudah: 4 });
  await b.box.UnaKanvasBaca._execute({}, exec('act_b'));
  const ring = b.box.UnaKanvasBaca.ringkas('act_b');
  assert.match(ring.text, /versi sebelum coretan terakhir/);
  assert.ok(!ring.tawaran.some(t => t.jenis === 'kanvas_usulan'));
  const pakai = await b.box.UnaKanvasBaca.terapkan('act_b');
  assert.equal(pakai.ok, false);
  assert.equal(b.executed.length, 0);
  // Juga bila Bos mencoret sesudah bacaan selesai tetapi sebelum menekan tombol.
  const c = browser();
  await c.box.UnaKanvasBaca._execute({}, exec('act_c'));
  c.ubahSerial(9);
  assert.equal((await c.box.UnaKanvasBaca.terapkan('act_c')).ok, false);
  assert.equal(c.executed.length, 0);
});

test('dispatcher: coretan belum tersimpan disimpan dulu, canvas.read diikat ke revisi hasil simpan', async () => {
  const b = browser();
  b.setDirty(true);
  const box = b.box;
  box.addEventListener = () => {}; box.dispatchEvent = () => {}; box.CustomEvent = class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };
  vm.runInContext(read('../public/una-dispatcher.js'), box);
  const aksi = { actionId: 'act_d', turnId: 'turn_d', capabilityId: 'canvas.read', capabilityVersion: 1, params: {}, target: { surfaceId: S, expectedRevision: 5 }, scopeEpoch: 4, origin: 'code' };
  await box.UnaDispatcher.run([aksi], { turnId: 'turn_d', question: 'lihat gambar ini' });
  assert.equal(b.executed[0].target.expectedRevision, 6);
  assert.equal(box.UnaDispatcher.question('turn_d'), 'lihat gambar ini');
  // Perintah dari model tidak diikat ulang.
  b.setDirty(true);
  await box.UnaDispatcher.run([{ ...aksi, actionId: 'act_e', origin: 'model' }], { turnId: 'turn_e' });
  assert.equal(b.executed[1].target.expectedRevision, 5);
});
