// Penjaga kontrak U0 Una Live (contracts/una-live-workspace-v1.md). Fixture di
// test/fixtures/una-live/ dipakai bersama paket U1–U7; tes ini memastikan bentuknya tetap
// sesuai kontrak dan setiap tombol Entity Admin baru ikut diklasifikasikan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INVENTARIS_FITUR_UNA } from '../generated/inventaris-fitur-una.js';
import { menuUntuk } from '../src/caca-peta.js';

const baca = nama => JSON.parse(readFileSync(new URL(`./fixtures/una-live/${nama}`, import.meta.url), 'utf8'));
const KEMAMPUAN = baca('kemampuan.json');
const LEMBAR = baca('lembar.json');
const AKSI = baca('aksi.json');
const PALSU = baca('keluaran-model-palsu.json');
const KONTROL = baca('kontrol-entity-admin.json');
const HTML = readFileSync(new URL('../public/entity-admin.html', import.meta.url), 'utf8');
const KONTRAK = readFileSync(new URL('../contracts/una-live-workspace-v1.md', import.meta.url), 'utf8');
const PER_ID = new Map(KEMAMPUAN.capabilities.map(c => [c.id, c]));

const KATA_KUNCI = {
  object: ['type', 'properties', 'required', 'additionalProperties', 'default', 'description'],
  string: ['type', 'maxLength', 'enum', 'pattern', 'format', 'default', 'description'],
  integer: ['type', 'minimum', 'maximum', 'default', 'description'],
  boolean: ['type', 'default', 'description'],
  array: ['type', 'items', 'maxItems', 'default', 'description']
};
function cekSkema(skema, jalur) {
  assert.ok(KATA_KUNCI[skema.type], `${jalur}: tipe ${skema.type} di luar subset`);
  for (const k of Object.keys(skema)) {
    if (skema.type === 'object' && k === 'ref') continue;
    assert.ok(KATA_KUNCI[skema.type].includes(k), `${jalur}: kata kunci ${k} di luar subset`);
  }
  if (skema.type === 'object' && skema.ref) { assert.match(skema.ref, /^[a-z]+\.[a-z_]+$/, `${jalur}: ref`); return; }
  if (skema.type === 'object') {
    assert.equal(skema.additionalProperties, false, `${jalur}: additionalProperties wajib false`);
    for (const r of skema.required || []) assert.ok(skema.properties?.[r], `${jalur}: required ${r} tidak ada di properties`);
    for (const [nama, sub] of Object.entries(skema.properties || {})) cekSkema(sub, `${jalur}.${nama}`);
  }
  if (skema.type === 'string') {
    assert.ok(Number.isInteger(skema.maxLength), `${jalur}: string wajib maxLength`);
    if (skema.format) assert.equal(skema.format, 'date', `${jalur}: format hanya date`);
    if (skema.pattern) new RegExp(skema.pattern);
  }
  if (skema.type === 'array') {
    assert.ok(Number.isInteger(skema.maxItems), `${jalur}: array wajib maxItems`);
    cekSkema(skema.items, `${jalur}[]`);
  }
}

test('deskriptor kemampuan sesuai kontrak', () => {
  assert.equal(PER_ID.size, KEMAMPUAN.capabilities.length, 'id kemampuan unik');
  for (const c of KEMAMPUAN.capabilities) {
    assert.match(c.id, /^[a-z]+\.[a-z_]+$/);
    assert.ok(Number.isInteger(c.version) && c.version >= 1, c.id);
    assert.ok(KEMAMPUAN.categories.includes(c.category), c.id);
    assert.ok(KEMAMPUAN.effects.includes(c.effect), c.id);
    assert.ok(KEMAMPUAN.proofs.includes(c.proof), c.id);
    assert.ok(c.roles.length && c.roles.every(r => KEMAMPUAN.roles.includes(r)), c.id);
    assert.ok(c.scopes.length && c.scopes.every(s => ['entity', 'gerai'].includes(s)), c.id);
    assert.ok(c.preconditions.every(p => KEMAMPUAN.preconditions.includes(p)), c.id);
    assert.ok(c.aliases.length > 0, `${c.id}: alias bahasa Indonesia untuk katalog`);
    assert.ok(c.surfaceKind === null || LEMBAR.kinds.includes(c.surfaceKind), c.id);
    if (c.category === 'business_draft') assert.equal(c.effect, 'draft', c.id);
    if (c.effect === 'draft') assert.equal(c.category, 'business_draft', c.id);
    cekSkema(c.params, c.id);
    // Larangan mutlak: tidak ada parameter yang menerima selector, URL, skrip, atau id elemen.
    const namaParam = JSON.stringify(c.params).toLowerCase();
    for (const kata of ['selector', '"url"', 'script', 'elementid', 'domid', 'href']) assert.ok(!namaParam.includes(kata), `${c.id}: ${kata}`);
    assert.ok(KONTRAK.includes('`' + c.id + '`'), `${c.id} wajib tercatat di kontrak`);
  }
});

test('kemampuan yang terikat halaman menunjuk layar yang ada di peta Una', () => {
  for (const c of KEMAMPUAN.capabilities.filter(c => c.page)) {
    const ada = menuUntuk({ skin: 'classic', peran: 'ENTITY_ADMIN', halaman: c.page.halaman }).some(m => m.tab === c.page.tab);
    assert.ok(ada, `${c.id} -> ${c.page.halaman}/${c.page.tab}`);
  }
});

test('kontrol Laporan yang dipakai kontrak ada di entity-admin.html', () => {
  for (const id of ['entityReportFrom', 'entityReportTo', 'entityReportStoreChecklist', 'entityReportRun', 'entityReportStatus', 'entityReportChart', 'entityReportStoreTable', 'entityReportTableWrap', 'entityTab-reports']) {
    assert.match(HTML, new RegExp(`id="${id}"`), id);
  }
});

test('setiap tombol Entity Admin di inventaris sudah diklasifikasikan, tanpa id basi', () => {
  const berkas = [...HTML.matchAll(/src="\/([^"?]+)/g)].map(m => 'public/' + m[1]).concat(['public/entity-admin.html']);
  const inventaris = new Set(INVENTARIS_FITUR_UNA.filter(x => x.jenis === 'tombol' && berkas.includes(x.sumber)).map(x => x.id));
  const kelas = new Map(KONTROL.controls.map(c => [c.id, c]));
  const belum = [...inventaris].filter(id => !kelas.has(id));
  assert.deepEqual(belum, [], 'Tombol baru di Entity Admin: tambahkan klasifikasinya di test/fixtures/una-live/kontrol-entity-admin.json');
  const basi = KONTROL.controls.filter(c => c.id.startsWith('tombol:') && !inventaris.has(c.id)).map(c => c.id);
  assert.deepEqual(basi, [], 'Tombol sudah tidak ada: hapus dari kontrol-entity-admin.json');
});

test('klasifikasi kontrol konsisten dengan kemampuan dan larangan otomatisasi', () => {
  const tabEntity = new Set(menuUntuk({ skin: 'classic', peran: 'ENTITY_ADMIN', halaman: 'entity' }).map(m => m.tab));
  for (const c of KONTROL.controls) {
    assert.ok(KONTROL.classes.includes(c.class), c.id);
    assert.equal(typeof c.automationForbidden, 'boolean', c.id);
    if (c.class === 'supported') {
      assert.ok(PER_ID.has(c.capabilityId), `${c.id}: capabilityId ${c.capabilityId}`);
      assert.equal(c.automationForbidden, false, c.id);
      if (c.capabilityId === 'page.open') assert.ok(tabEntity.has(c.params?.tab), `${c.id}: tab ${c.params?.tab} tidak ada di peta`);
    }
    if (c.id.startsWith('input:')) assert.match(HTML, new RegExp(`id="${c.id.split(':').pop()}"`), c.id);
  }
  // Persetujuan, login/logout, dan kredensial tidak pernah boleh jadi target otomatisasi.
  for (const pola of [/:ACC$/, /:Tolak$/, /Setujui/, /entityAdminLoginBtn/, /entityAdminLogoutBtn/, /Salin password/]) {
    const cocok = KONTROL.controls.filter(c => pola.test(c.id));
    assert.ok(cocok.length > 0, String(pola));
    for (const c of cocok) { assert.equal(c.automationForbidden, true, c.id); assert.notEqual(c.class, 'supported', c.id); }
  }
});

test('lembar contoh sesuai bentuk kontrak', () => {
  for (const s of LEMBAR.surfaces) {
    assert.match(s.id, /^srf_[0-9a-f-]{36}$/);
    assert.ok(['page', 'canvas'].includes(s.kind));
    assert.ok(s.title.length <= 80 && s.revision >= 1 && s.formatVersion === 1);
    assert.ok(!('principal' in s) && !('principalKey' in s) && !('entityId' in s), 'pemilik tidak pernah dikirim ke browser');
    assert.ok(JSON.stringify(s.content).length <= LEMBAR.contentLimitBytes);
    if (s.kind === 'page') {
      assert.ok(!('rows' in s.content) && !('result' in s.content), 'lembar halaman tidak menyimpan angka');
    }
    if (s.kind === 'canvas') {
      const L = LEMBAR.canvasLimits;
      assert.ok(s.content.objects.length <= L.maxObjects);
      for (const o of s.content.objects) {
        assert.ok(LEMBAR.canvasObjectTypes.includes(o.type), o.id);
        assert.match(o.id, /^[\w-]{1,40}$/);
        if (o.color) assert.match(o.color, /^#[0-9a-f]{6}$/i);
        const angka = [o.x, o.y, o.w, o.h, o.x1, o.y1, o.x2, o.y2, ...(o.points || []).flat()].filter(v => v !== undefined);
        assert.ok(angka.every(v => Number.isInteger(v) && v >= L.coordMin && v <= L.coordMax), o.id);
      }
    }
  }
  assert.equal(LEMBAR.conflict.response.status, 409);
  assert.equal(LEMBAR.foreignAccessStatus, 404);
});

test('skenario aksi memakai status, kode, dan kemampuan yang sah', () => {
  for (const sc of AKSI.scenarios) {
    const { command: cmd, receipt: r } = sc;
    assert.ok(PER_ID.has(cmd.capabilityId), sc.name);
    assert.equal(cmd.capabilityVersion, PER_ID.get(cmd.capabilityId).version, sc.name);
    assert.ok(['model', 'code', 'user'].includes(cmd.origin), sc.name);
    for (const rr of [r, sc.earlierReceipt].filter(Boolean)) {
      assert.ok(AKSI.statuses.includes(rr.status), sc.name);
      assert.ok(rr.code === null || AKSI.codes.includes(rr.code), sc.name);
      assert.equal(rr.status === 'ok', rr.code === null, `${sc.name}: ok tanpa kode, selain ok wajib berkode`);
      assert.ok(JSON.stringify(rr.summary).length <= AKSI.maxReceiptSummaryBytes, sc.name);
      if (rr.status === 'ok' && PER_ID.get(rr.capabilityId).proof === 'data_loaded') assert.equal(rr.proof?.kind, 'data_loaded', `${sc.name}: ok wajib berbukti`);
    }
    assert.equal(r.actionId, cmd.actionId, sc.name);
    if (cmd.scopeEpoch !== sc.context.scopeEpoch) assert.equal(r.code, 'SCOPE_CHANGED', sc.name);
  }
  assert.ok(JSON.stringify(AKSI.surfaceContextExample).length <= AKSI.maxSurfaceContextBytes);
  for (const nama of AKSI.events) assert.ok(KONTRAK.includes('`' + nama + '`'), nama);
  for (const kode of AKSI.codes) assert.ok(KONTRAK.includes(kode), kode);
});

test('keluaran model palsu selalu berakhir ditolak atau klarifikasi', () => {
  for (const c of PALSU.cases) {
    assert.ok(['rejected', 'needs_clarification'].includes(c.expect.status), c.name);
    assert.ok(AKSI.codes.includes(c.expect.code), c.name);
    if (c.expect.code === 'UNKNOWN_CAPABILITY') {
      const d = PER_ID.get(c.output.capabilityId);
      assert.ok(!d || (c.output.capabilityVersion ?? d.version) !== d.version, c.name);
    } else {
      assert.ok(PER_ID.has(c.output.capabilityId), c.name);
    }
  }
});
