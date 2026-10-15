import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/una-dispatcher.js', import.meta.url), 'utf8');
const SURFACE = 'srf_3f9d2a10-7c1e-4b8a-9d55-0a1b2c3d4e5f';

// Registry tiruan dengan aturan kontrak 3.2: perintah lebih baru untuk kunci yang sama
// membuat yang lama superseded. Registry asli (U1) diuji di paketnya sendiri.
function setup({ surface = null, state = null, gagal = null } = {}) {
  const listeners = new Map(); const events = [];
  const report = { ...(state || { from: '2026-10-01', to: '2026-10-15', stores: ['G001', 'G002'], status: 'ready' }) };
  const latest = new Map(); const tunda = [];
  const w = {
    crypto: { randomUUID: () => '00000000-0000-4000-8000-' + String(Math.random()).slice(2, 14).padEnd(12, '0') },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    addEventListener: (n, fn) => { if (!listeners.has(n)) listeners.set(n, []); listeners.get(n).push(fn); },
    dispatchEvent: e => { events.push(e); for (const fn of listeners.get(e.type) || []) fn(e); },
    UnaLembar: { context: () => ({ scopeEpoch: 7, lingkup: 'entity', surface }) },
    UnaPageAdapters: { 'entity:reports': { readState: () => ({ ...report }) } },
    UnaRegistry: {
      execute: aksi => new Promise(resolve => {
        const key = 'entity:reports'; const seq = (latest.get(key) || 0) + 1; latest.set(key, seq);
        tunda.push({ aksi, selesai: () => {
          let r;
          if (latest.get(key) !== seq) r = { actionId: aksi.actionId, capabilityId: aksi.capabilityId, status: 'superseded', code: 'SUPERSEDED', summary: {} };
          else if (gagal === aksi.capabilityId) r = { actionId: aksi.actionId, capabilityId: aksi.capabilityId, status: 'failed', code: 'DATA_FAILED', message: 'Gagal memuat laporan', summary: {} };
          else {
            if (aksi.params.from) Object.assign(report, { from: aksi.params.from, to: aksi.params.to });
            r = { actionId: aksi.actionId, capabilityId: aksi.capabilityId, status: 'ok', code: null, message: 'Selesai.', summary: { storeCount: 2 }, proof: aksi.capabilityId === 'report.set_filters' ? { kind: 'data_loaded', filters: { from: report.from, to: report.to } } : { kind: 'state_read' } };
          }
          w.dispatchEvent(new w.CustomEvent('una-live:receipt', { detail: r }));
          resolve(r);
        } });
      })
    }
  };
  vm.createContext(w); w.window = w;
  vm.runInContext(source, w);
  const jalankanSemua = async () => { while (tunda.length) { tunda.shift().selesai(); await new Promise(r => setImmediate(r)); } };
  const selesaikan = async i => { const [t] = tunda.splice(i, 1); t.selesai(); await new Promise(r => setImmediate(r)); };
  return { w, d: w.UnaDispatcher, events, report, tunda, jalankanSemua, selesaikan };
}
const plain = v => JSON.parse(JSON.stringify(v));
const aksi = (capabilityId, params, n) => ({ actionId: 'act_' + n, turnId: 'turn_' + n, capabilityId, capabilityVersion: 1, params, target: null, scopeEpoch: 7, origin: 'code' });

test('konteks giliran membaca filter yang sedang tampil, termasuk ubahan manual', () => {
  const { d, report, events } = setup({ surface: { id: SURFACE, kind: 'page', revision: 3, content: { halaman: 'entity', tab: 'reports', filters: {} } } });
  const ctx = d.context({ conversationId: 'c1', turnId: 'turn_x' });
  assert.deepEqual(plain(ctx.page), { halaman: 'entity', tab: 'reports' });
  assert.equal(ctx.activeSurfaceId, SURFACE);
  assert.equal(ctx.surfaceKind, 'page');
  assert.deepEqual(plain(ctx.filters), { from: '2026-10-01', to: '2026-10-15', stores: ['G001', 'G002'] });
  Object.assign(report, { from: '2026-09-05', to: '2026-09-20' }); // Bos mengubah sendiri
  assert.equal(d.context({ turnId: 'turn_y' }).filters.from, '2026-09-05');
  assert.ok(events.some(e => e.type === 'una-live:context'));
  assert.ok(JSON.stringify(ctx).length <= 4096);
});

test('laporan di menu biasa ikut dikenali lewat event tab', () => {
  const { w, d } = setup();
  w.dispatchEvent(new w.CustomEvent('entity-admin-tab', { detail: { name: 'reports' } }));
  const ctx = d.context({ turnId: 'turn_z' });
  assert.deepEqual(plain(ctx.page), { halaman: 'entity', tab: 'reports' });
  assert.equal(ctx.surfaceKind, null);
  assert.equal(ctx.activeSurfaceId, null);
});

test('aksi berurutan dengan progres nyata; kalimat akhir dari tanda terima', async () => {
  const { d, events, jalankanSemua } = setup();
  const langkah = [];
  const jalan = d.run([aksi('page.open', { halaman: 'entity', tab: 'reports' }, 1), aksi('report.set_filters', { from: '2026-10-01', to: '2026-10-10' }, 2)], { turnId: 'turn_1', onStep: s => langkah.push(s.label) });
  await jalankanSemua(); await jalankanSemua();
  const tanda = await jalan;
  assert.deepEqual(plain(tanda.map(r => r.status)), ['ok', 'ok']);
  assert.deepEqual(plain(langkah), ['Buka halaman di Workspace', 'Atur tanggal laporan dan muat datanya']);
  const fase = events.filter(e => e.type === 'una-live:progress').map(e => e.detail.phase);
  assert.deepEqual(plain(fase), ['start', 'done', 'start', 'done']);
  assert.equal(d.conclude(tanda, { rentang: { dibaca: '1–10 Oktober 2026' } }).text, 'Laporan 1–10 Oktober 2026 untuk 2 gerai sudah tampil di Workspace, Bos.');
  // lastAction ikut ke giliran berikutnya.
  assert.equal(d.context({ turnId: 'turn_2' }).lastAction.capabilityId, 'report.set_filters');
});

test('koreksi "sampai tanggal 8" saat tanggal 10 masih memuat: hasil lama tidak diumumkan', async () => {
  const { d, report, selesaikan } = setup();
  const lama = d.run([aksi('report.set_filters', { from: '2026-10-01', to: '2026-10-10' }, 1)], { turnId: 'turn_1' });
  const baru = d.run([aksi('report.set_filters', { from: '2026-10-01', to: '2026-10-08' }, 2)], { turnId: 'turn_2' });
  await selesaikan(1); // respons tanggal 8 datang duluan
  await selesaikan(0); // respons tanggal 10 terlambat
  const [tLama, tBaru] = [await lama, await baru];
  assert.equal(tLama[0].status, 'superseded');
  assert.equal(d.conclude(tLama, {}), null, 'yang digantikan diam');
  assert.match(d.conclude(tBaru, { rentang: { dibaca: '1–8 Oktober 2026' } }).text, /1–8 Oktober 2026/);
  assert.equal(report.to, '2026-10-08');
});

test('gagal berhenti di langkah itu dan tidak mengaku sudah tampil', async () => {
  const { d, jalankanSemua } = setup({ gagal: 'report.set_filters' });
  const jalan = d.run([aksi('report.set_filters', { from: '2026-10-01', to: '2026-10-10' }, 1), aksi('report.refresh', {}, 2)], { turnId: 'turn_1' });
  await jalankanSemua();
  const tanda = await jalan;
  assert.equal(tanda.length, 1);
  const hasil = d.conclude(tanda, { jawaban: 'Una tampilkan laporan 1–10 Oktober 2026, Bos.' });
  assert.equal(hasil.text, 'Gagal memuat laporan');
  assert.equal(hasil.ask, true);
  assert.match(d.conclude([], {}).text, /belum siap/);
});

test('stop: berhenti menunggu tanpa mengumumkan hasil; ganti lingkup membersihkan', async () => {
  const { w, d, jalankanSemua } = setup();
  const jalan = d.run([aksi('report.set_filters', { from: '2026-10-01', to: '2026-10-10' }, 1)], { turnId: 'turn_1' });
  assert.equal(d.pending(), 1);
  assert.equal(d.cancelReads(), 1);
  await jalankanSemua();
  const tanda = await jalan;
  assert.equal(tanda[0].status, 'cancelled');
  assert.equal(d.conclude(tanda, {}), null);
  w.dispatchEvent(new w.CustomEvent('caca-scope-change', {}));
  assert.equal(d.context({ turnId: 'turn_3' }).lastAction, null);
});

test('tanpa registry/lembar: tidak ada konteks dan tidak ada aksi', async () => {
  const { w, d } = setup();
  delete w.UnaRegistry;
  assert.equal(d.context({ turnId: 'turn_1' }), null);
  assert.deepEqual(plain(await d.run([aksi('report.refresh', {}, 1)], {})), []);
});
