// U4 Una Live: jalur penuh dengan modul asli. Konteks disusun dispatcher (U4), dibersihkan dan
// diterjemahkan server (U4), divalidasi registry + validator (U1), dijalankan adapter laporan (U3)
// di atas pemuat laporan asli entity-admin.js. Hanya shell lembar (U2, DOM) yang ditiru.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { TextEncoder } from 'node:util';
import { perintahLembar, bersihkanKonteksLembar } from '../src/una-perintah-lembar.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const S = 'srf_3f9d2a10-7c1e-4b8a-9d55-0a1b2c3d4e5f';
const HARI_INI = '2026-10-15';
const tick = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

function setup({ aktif = true } = {}) {
  const listeners = new Map();
  const box = {
    TextEncoder, console, JSON, Promise, Date, Math, structuredClone,
    crypto: globalThis.crypto,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    addEventListener: (n, fn) => { if (!listeners.has(n)) listeners.set(n, []); listeners.get(n).push(fn); },
    dispatchEvent: e => { for (const fn of listeners.get(e.type) || []) fn(e); return true; }
  };
  box.window = box;
  vm.createContext(box);

  // Pemuat laporan asli.
  const nodes = Object.fromEntries(['entityReportFrom', 'entityReportTo', 'entityReportStatus', 'entityReportChart', 'entityReportStoreTable', 'entityReportTableWrap']
    .map(id => [id, { value: '', textContent: '', replaceChildren() {} }]));
  nodes.entityReportFrom.value = '2026-10-01'; nodes.entityReportTo.value = '2026-10-15';
  const requests = []; const rendered = [];
  Object.assign(box, {
    entityAdminEl: id => nodes[id], selectedReportStoreCodes: () => ['G001', 'G002'],
    entityAdminState: { token: 't1', entityAdmin: { entityId: 'E1' } }, anyEntityStoreCode: () => 'G001',
    entityAdminApi: url => new Promise((resolve, reject) => requests.push({ url, resolve, reject })),
    renderEntityReportTable: p => rendered.push(p), renderEntityReportMetricButtons() {}, renderEntityReportChart() {}
  });

  // Shell lembar tiruan: revisi naik saat edit tersimpan; edit manual Bos ditandai dirty.
  const lembar = { rev: 2, una: false, manual: false, active: aktif ? S : null, filters: { from: '2026-10-01', to: '2026-10-15' } };
  box.UnaLembar = {
    context: () => ({
      scopeEpoch: 7, role: 'ENTITY_ADMIN', lingkup: 'entity', skin: 'classic', activeSurfaceId: lembar.active,
      surface: lembar.active ? { id: lembar.active, kind: 'page', revision: lembar.rev, content: { halaman: 'entity', tab: 'reports', filters: lembar.filters } } : null,
      pageMounted: !!lembar.active, dirty: lembar.manual
    }),
    save: async () => { if (lembar.una || lembar.manual) { lembar.rev++; lembar.una = false; lembar.manual = false; } return true; },
    client: () => ({ get: () => ({ dirty: lembar.una || lembar.manual }) }),
    surfaceForPanel: () => lembar.active ? { id: lembar.active, revision: lembar.rev } : null
  };

  vm.runInContext(read('../public/una-kemampuan-data.js'), box);
  vm.runInContext(read('../public/una-registry.js'), box);
  vm.runInContext(read('../public/una-adapter-laporan.js'), box);
  // Pemuat dimuat sesudah adapter supaya adapter tidak memasang diri ke DOM sungguhan.
  const src = read('../public/entity-admin.js');
  vm.runInContext(src.slice(src.indexOf('let entityReportRequestKey ='), src.indexOf('\nasync function saveEntityEmployee')), box);
  const registry = box.UnaRegistry.create({ getContext: () => box.UnaLembar.context() });
  box.UnaRegistry = registry;
  const adapter = box.UnaReportAdapter.create({
    readState: box.readEntityReportState, refresh: box.runEntityReport, invalidate: box.invalidateEntityReport,
    storeCodes: () => ['G001', 'G002'], surface: () => box.UnaLembar.surfaceForPanel(),
    onFilters: f => { lembar.filters = f; lembar.una = true; }, save: () => box.UnaLembar.save(),
    writeFilters: p => { nodes.entityReportFrom.value = p.from; nodes.entityReportTo.value = p.to; }
  });
  adapter.bind(registry);
  box.UnaPageAdapters = { 'entity:reports': adapter };
  vm.runInContext(read('../public/una-dispatcher.js'), box);
  const d = box.UnaDispatcher;

  // Satu giliran: browser menyusun konteks, server menerjemahkan, browser menjalankan.
  function giliran(pesan) {
    const turnId = d.turn();
    const basis = d.context({ conversationId: 'c1', turnId });
    const hasil = perintahLembar(pesan, { peran: 'Entity Admin', lingkup: 'entity', hariIni: HARI_INI, surfaceContext: bersihkanKonteksLembar(JSON.parse(JSON.stringify(basis))) });
    return { hasil, jalan: hasil?.uiActions?.length ? d.run(hasil.uiActions, { turnId, basis }) : Promise.resolve([]) };
  }
  return { box, d, nodes, requests, rendered, lembar, registry, giliran };
}

test('skenario Bos: 1–10 Oktober lalu "eh sampai tanggal 8 aja" saat yang pertama masih memuat', async () => {
  const t = setup();
  const g1 = t.giliran('ganti range tanggal 1 sampai 10 oktober');
  assert.equal(g1.hasil.uiActions[0].target.surfaceId, S);
  await tick();
  assert.equal(t.requests.length, 1, 'laporan 1-10 sedang dimuat');
  assert.equal(t.nodes.entityReportTo.value, '2026-10-10');
  // Autosave filter Una selesai ketika pesan koreksi sedang di jalan: revisi naik.
  const g2 = t.giliran('eh sampai tanggal 8 aja');
  assert.deepEqual(JSON.parse(JSON.stringify(g2.hasil.uiActions[0].params)), { from: '2026-10-01', to: '2026-10-08' });
  await t.box.UnaLembar.save();
  await tick();
  assert.equal(t.requests.length, 2, 'koreksi tidak ditolak REVISION_CONFLICT');
  t.requests[1].resolve({ totals: 'sampai-8' });
  await tick();
  t.requests[0].resolve({ totals: 'sampai-10-terlambat' });
  const [r1, r2] = [await g1.jalan, await g2.jalan];
  assert.equal(r1[0].status, 'superseded');
  assert.equal(t.d.conclude(r1, g1.hasil), null, 'hasil lama tidak diumumkan');
  assert.equal(r2[0].status, 'ok', JSON.stringify(r2[0]));
  assert.equal(r2[0].proof.filters.to, '2026-10-08');
  assert.equal(t.d.conclude(r2, g2.hasil).text, 'Laporan 1–8 Oktober 2026 untuk 2 gerai sudah tampil di Workspace, Bos.');
  assert.deepEqual(t.rendered.map(p => p.totals), ['sampai-8'], 'respons tanggal 10 yang terlambat tidak digambar');
  assert.equal(t.nodes.entityReportTo.value, '2026-10-08');
});

test('Bos mengubah filter sendiri sesudah mengirim pesan: tidak diikat ulang, konflik dilaporkan', async () => {
  const t = setup();
  const g = t.giliran('ganti tanggal 1 sampai 10 oktober');
  // Sebelum aksi jalan, Bos mengetik tanggal lain di layar.
  t.nodes.entityReportTo.value = '2026-10-12'; t.lembar.manual = true;
  const r = await g.jalan;
  assert.equal(r[0].status, 'rejected');
  assert.equal(r[0].code, 'REVISION_CONFLICT');
  assert.equal(t.nodes.entityReportTo.value, '2026-10-12', 'ketikan Bos tidak ditimpa');
  assert.equal(t.requests.length, 0);
  assert.equal(t.d.conclude(r, g.hasil).ask, true);
});

test('laporan belum di Workspace: page.open dulu, filter diikat ke lembar hasil page.open', async () => {
  const t = setup({ aktif: false });
  t.registry.register('page.open', {
    execute: async () => { t.lembar.active = S; t.lembar.rev = 1; return { ok: true, surfaceId: S, resultRevision: 1, summary: { kind: 'page' }, proof: { kind: 'state_read', at: new Date().toISOString() } }; },
    verify: r => r.surfaceId === S
  });
  const g = t.giliran('buka laporan tanggal 1 sampai 10 oktober');
  assert.deepEqual(g.hasil.uiActions.map(a => a.capabilityId), ['page.open', 'report.set_filters']);
  assert.equal(g.hasil.uiActions[1].target, null);
  await tick();
  t.requests[0].resolve({ totals: 'x' });
  const r = await g.jalan;
  assert.equal(r.map(x => x.status).join(','), 'ok,ok', JSON.stringify(r));
  assert.equal(r[1].surfaceId, S);
});

test('target null tanpa page.open sebelumnya tetap ditolak; stop membatalkan render bacaan', async () => {
  const t = setup();
  const aksi = { actionId: 'act_x1', turnId: 'turn_x', capabilityId: 'report.set_filters', capabilityVersion: 1, params: { from: '2026-10-01', to: '2026-10-05' }, target: null, scopeEpoch: 7, origin: 'code' };
  const [r] = await t.d.run([aksi], { turnId: 'turn_x' });
  assert.equal(r.status, 'rejected');
  assert.equal(r.code, 'PRECONDITION_FAILED');
  const g = t.giliran('ganti tanggal 1 sampai 3 oktober');
  await tick();
  assert.ok(t.d.cancelReads() >= 1);
  t.requests.at(-1).resolve({ totals: 'dibatalkan' });
  const hasil = await g.jalan;
  assert.notEqual(hasil[0].status, 'ok');
  assert.equal(t.d.conclude(hasil, g.hasil), null);
  assert.ok(!t.rendered.some(p => p.totals === 'dibatalkan'), 'hasil yang dihentikan tidak digambar');
});
