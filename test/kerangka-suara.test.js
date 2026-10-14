import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../public/kerangka-suara.js', import.meta.url), 'utf8');
function setup({ voices = [{ name: 'Indonesia', lang: 'id-ID' }], stored = null, blockedStorage = false } = {}) {
  const spoken = [], timers = new Map(), listeners = new Map(), statuses = [], writes = [];
  let next = 0, cancellations = 0, allowed = true;
  const synth = { getVoices: () => voices, speak: value => spoken.push(value), cancel() { cancellations++; },
    addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
  const context = vm.createContext({ console, Date, BigInt, setTimeout(fn, ms) { timers.set(++next, { fn, ms }); return next; }, clearTimeout: id => timers.delete(id),
    speechSynthesis: synth, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    SpeechRecognition: class { start() { this.started = true; } },
    localStorage: { getItem() { if (blockedStorage) throw Error('Denied'); return stored; }, setItem(k, v) { if (blockedStorage) throw Error('Denied'); writes.push([k, v]); } } });
  vm.runInContext(source, context);
  const api = context.KerangkaSuara;
  const runtime = api.buat({ onStatus: value => statuses.push(value), bolehBicara: () => allowed });
  return { api, runtime, spoken, timers, listeners, statuses, writes, setAllowed: value => { allowed = value; }, setVoices: value => { voices = value; listeners.get('voiceschanged')?.(); }, get cancellations() { return cancellations; } };
}
test('Indonesian selection prefers Natural/Online and never substitutes English', () => {
  const { api } = setup();
  const basic = { name: 'Lokal', lang: 'id-ID' }, online = { name: 'Ardi Online', lang: 'id-ID' }, natural = { name: 'Gadis Online Natural', lang: 'id-ID' };
  assert.equal(api.pilihSuara([{ name: 'English Natural', lang: 'en-US' }, basic, online, natural]), natural);
  assert.equal(api.pilihSuara([basic, online]), online);
  assert.equal(api.pilihSuara([{ name: 'English', lang: 'en-US' }]), null);
});
test('cleaning speaks Indonesian currency and dates while removing markup, tables and emoji', () => {
  const { api } = setup();
  const text = api.bersihkanUntukDibaca('😀 **Total Rp12.500** pada 2026-10-13.\n| Nama | Rahasia? |\n- Lanjut 14/10/2026.');
  // Sensitive labels anywhere fail closed, including table contents.
  assert.equal(text, 'Ada informasi pribadi di layar. Silakan periksa langsung.');
  const clean = api.bersihkanUntukDibaca('😀 **Total Rp12.500** pada 2026-10-13.\n| Nama | Jumlah |\n- Lanjut 14/10/2026.');
  assert.match(clean, /dua belas ribu lima ratus rupiah/);
  assert.match(clean, /tiga belas Oktober dua ribu dua puluh enam/);
  assert.match(clean, /empat belas Oktober/);
  assert.doesNotMatch(clean, /😀|\||\*|Jumlah/);
  assert.match(api.bersihkanUntukDibaca('Saldo Rp-1.250,50'), /minus seribu dua ratus lima puluh koma lima nol rupiah/);
});
test('draft narration discloses count and Workspace review only; never credentials or content', () => {
  const { api } = setup();
  const draft = { muatan: { daftar: [{ password: 'secret-one' }, { nominal: 999999 }] } };
  const clean = api.bersihkanUntukDibaca('password secret-one', { draft });
  assert.match(clean, /draft 2 baris di Workspace/);
  assert.doesNotMatch(clean, /secret-one|999999/);
  for (const text of ['Password awal: abc123', 'Token abc123', 'OTP 456123', 'API_KEY xyz', 'Bearer abc', 'sk-proj-example']) {
    assert.equal(api.bersihkanUntukDibaca(text), 'Ada informasi pribadi di layar. Silakan periksa langsung.');
  }
  assert.equal(api.bersihkanUntukDibaca('jawaban biasa', { rahasia: true }), 'Ada informasi pribadi di layar. Silakan periksa langsung.');
});
test('cleaning is bounded and chunks avoid long utterances', () => {
  const { api } = setup();
  const clean = api.bersihkanUntukDibaca('Kalimat yang panjang. '.repeat(100));
  assert.ok(clean.length <= 600);
  assert.match(clean, /Selengkapnya ada di layar\.$/);
  assert.ok(api.potongKalimat(clean).every(part => part.length <= 140));
});
test('speech is default off, explicit microphone/play override is one-shot, preference survives storage failure', () => {
  const h = setup();
  assert.equal(h.runtime.status().aktif, false);
  assert.equal(h.runtime.ucapkan('Halo'), false);
  assert.equal(h.runtime.ucapkan('Halo', { paksa: true }), true);
  h.spoken[0].onend();
  assert.equal(h.runtime.status().aktif, false);
  assert.equal(h.runtime.ucapkan('Pesan ketikan'), false);
  h.runtime.setAktif(true); assert.deepEqual(h.writes, [['kerangkaSuaraAktif', 'true']]);
  assert.equal(h.runtime.ucapkan('Pesan ketikan'), true);
  const blocked = setup({ blockedStorage: true });
  assert.doesNotThrow(() => blocked.runtime.setAktif(true));
  assert.equal(blocked.runtime.ucapkan('Halo'), true);
});
test('voiceschanged enables delayed Indonesian voice and removes unavailable voice safely', () => {
  const h = setup({ voices: [], stored: 'true' });
  assert.equal(h.runtime.status().tersedia, false);
  assert.equal(h.runtime.ucapkan('Halo'), false);
  h.setVoices([{ name: 'Indonesia', lang: 'id-ID' }]);
  assert.equal(h.runtime.status().tersedia, true);
  h.runtime.ucapkan('Halo');
  h.setVoices([{ name: 'English', lang: 'en-US' }]);
  assert.equal(h.runtime.status().tersedia, false);
  assert.equal(h.runtime.status().membaca, false);
  assert.equal(h.cancellations, 1);
});
test('cancel invalidates late callbacks and new utterance cannot be advanced by the old one', () => {
  const h = setup({ stored: 'true' });
  h.runtime.ucapkan('Pertama. Kedua.'); const old = h.spoken[0];
  h.runtime.hentikan(); h.runtime.ucapkan('Baru.');
  old.onend(); old.onerror();
  assert.equal(h.spoken.length, 2);
  assert.equal(h.runtime.status().membaca, true);
  h.spoken[1].onend();
  assert.equal(h.runtime.status().membaca, false);
  assert.equal(h.timers.size, 0);
});
test('microphone safety gate prevents playback and stalled/error synthesis releases timers', () => {
  const h = setup({ stored: 'true' });
  h.setAllowed(false); assert.equal(h.runtime.ucapkan('Jangan baca'), false);
  h.setAllowed(true); h.runtime.ucapkan('Halo');
  [...h.timers.values()][0].fn();
  assert.equal(h.runtime.status().membaca, false);
  assert.match(h.statuses[0], /dihentikan/);
  h.runtime.ucapkan('Lagi'); h.spoken.at(-1).onerror();
  assert.equal(h.runtime.status().membaca, false);
  assert.equal(h.timers.size, 0);
});
test('recognition factory configures Indonesian dictation and lets host install handlers before start', () => {
  const { api } = setup();
  const recognition = api.dengar({ mulai: false });
  assert.equal(recognition.lang, 'id-ID'); assert.equal(recognition.continuous, true); assert.equal(recognition.interimResults, true);
  assert.equal(recognition.started, undefined); recognition.start(); assert.equal(recognition.started, true);
});
