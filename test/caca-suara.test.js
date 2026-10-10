import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/caca-chat.js', import.meta.url), 'utf8');
function setup({ supported = true, secure = true } = {}) {
  const elements = new Map();
  for (const id of ['cacaPertanyaan', 'cacaTanyaKirim', 'cacaMikrofon', 'cacaSuaraStatus', 'cacaPanel', 'cacaFab', 'cacaDaftarGerai', 'cacaPilihGerai']) {
    elements.set(id, { value: '', readOnly: false, disabled: false, style: {}, scrollHeight: 30,
      attrs: {}, textContent: '', setAttribute(k, v) { this.attrs[k] = v; },
      classList: { add() {}, toggle() {}, contains() { return false; } } });
  }
  const instances = [];
  const timers = new Map();
  let timerId = 0;
  class Recognition {
    constructor() { instances.push(this); }
    start() { this.started = true; }
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
  }
  const context = vm.createContext({
    window: { SpeechRecognition: supported ? Recognition : undefined, isSecureContext: secure },
    document: { getElementById: id => elements.get(id), addEventListener() {} },
    console, Date, Intl, setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(source, context);
  vm.runInContext('cacaState.siap = true;', context);
  return { elements, instances, timers, run: code => vm.runInContext(code, context) };
}
const result = (...texts) => ({ results: texts.map(transcript => [{ transcript }]) });

test('voice preserves typed prefix, replaces interim text, never sends, and restores readonly', async () => {
  const h = setup();
  const input = h.elements.get('cacaPertanyaan');
  input.value = 'Tambah barang:';
  h.run('cacaToggleSuara()');
  const r = h.instances[0];
  assert.equal(r.lang, 'id-ID');
  assert.equal(r.interimResults, true);
  assert.equal(input.readOnly, true);
  assert.equal(h.elements.get('cacaTanyaKirim').disabled, true);
  r.onresult(result('kop'));
  assert.equal(input.value, 'Tambah barang: kop');
  r.onresult(result('kopi', 'harga lima ribu'));
  assert.equal(input.value, 'Tambah barang: kopi harga lima ribu');
  await h.run('cacaKirim()');
  assert.equal(input.value, 'Tambah barang: kopi harga lima ribu');
  assert.equal(h.run('cacaState.sedangKirim'), false);
  h.run('cacaToggleSuara()');
  assert.equal(r.stopped, true);
  assert.equal(input.readOnly, true);
  r.onend();
  assert.equal(input.readOnly, false);
  assert.equal(h.elements.get('cacaTanyaKirim').disabled, false);
  assert.match(h.elements.get('cacaSuaraStatus').textContent, /tekan Kirim/);
});

test('closing panel aborts and invalidates late callbacks even after a new session', () => {
  const h = setup();
  h.run('cacaToggleSuara()');
  const old = h.instances[0];
  old.onresult(result('pesan pertama'));
  h.run('cacaTutupPanel()');
  assert.equal(old.aborted, true);
  assert.equal(h.elements.get('cacaPertanyaan').readOnly, false);
  h.run('cacaToggleSuara()');
  old.onresult(result('pesan nyasar'));
  old.onerror({ error: 'network' });
  old.onend();
  assert.equal(h.elements.get('cacaPertanyaan').value, 'pesan pertama');
  assert.equal(h.elements.get('cacaPertanyaan').readOnly, true);
  assert.equal(h.run('cacaSuara.sesi.pengenal === null'), false);
});

for (const [error, message] of [
  ['not-allowed', /ditolak/], ['network', /koneksi/], ['no-speech', /belum terdengar/],
  ['audio-capture', /tidak tersedia/], ['service-not-allowed', /diblokir/]
]) {
  test('voice error ' + error + ' restores composer and allows retry', () => {
    const h = setup();
    h.elements.get('cacaPertanyaan').value = 'teks awal';
    h.run('cacaToggleSuara()');
    h.instances[0].onerror({ error });
    h.instances[0].onend();
    assert.equal(h.elements.get('cacaPertanyaan').value, 'teks awal');
    assert.equal(h.elements.get('cacaPertanyaan').readOnly, false);
    assert.equal(h.run('cacaSuara.sesi'), null);
    assert.match(h.elements.get('cacaSuaraStatus').textContent, message);
    h.run('cacaToggleSuara()');
    assert.equal(h.instances.length, 2);
  });
}

test('unsupported browsers and insecure context keep typed input usable', () => {
  for (const options of [{ supported: false }, { secure: false }]) {
    const h = setup(options);
    h.elements.get('cacaPertanyaan').value = 'tetap bisa ketik';
    h.run('cacaToggleSuara(); cacaAturTombol();');
    assert.equal(h.instances.length, 0);
    assert.equal(h.elements.get('cacaPertanyaan').readOnly, false);
    assert.equal(h.elements.get('cacaTanyaKirim').disabled, false);
    assert.match(h.elements.get('cacaSuaraStatus').textContent, /browser|HTTPS/i);
  }
});

test('busy or unready Una cannot start recording; readonly state is preserved', () => {
  const h = setup();
  h.run('cacaState.sedangKirim = true; cacaToggleSuara();');
  assert.equal(h.instances.length, 0);
  h.run('cacaState.sedangKirim = false; cacaState.siap = false; cacaToggleSuara();');
  assert.equal(h.instances.length, 0);
  h.run('cacaState.siap = true;');
  h.elements.get('cacaPertanyaan').readOnly = true;
  h.run('cacaToggleSuara(); cacaHentikanSuara();');
  assert.equal(h.elements.get('cacaPertanyaan').readOnly, true);
});

test('scope changes and pagehide wire to voice cleanup', () => {
  assert.match(source, /function cacaGantiGerai\(scope\)[\s\S]*?cacaHentikanSuara\(\);[\s\S]*?cacaState.scope = scope/);
  assert.match(source, /window.addEventListener\('pagehide', cacaHentikanSuara\)/);
});

test('recording limit and stop timeout release microphone when browser never ends', () => {
  const h = setup();
  h.run('cacaToggleSuara()');
  const limit = [...h.timers.values()].find(t => t.ms === 60000);
  assert.ok(limit);
  limit.fn();
  assert.equal(h.instances[0].stopped, true);
  const fallback = [...h.timers.values()].find(t => t.ms === 3000);
  assert.ok(fallback);
  fallback.fn();
  assert.equal(h.instances[0].aborted, true);
  assert.equal(h.elements.get('cacaPertanyaan').readOnly, false);
  assert.equal(h.run('cacaSuara.sesi'), null);
  assert.equal(h.timers.size, 0);
});

test('normal end clears all voice timers', () => {
  const h = setup();
  h.run('cacaToggleSuara(); cacaToggleSuara();');
  h.instances[0].onend();
  assert.equal(h.timers.size, 0);
});
