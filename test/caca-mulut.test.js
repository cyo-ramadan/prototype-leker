import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../public/caca-chat.js', import.meta.url), 'utf8');
const voice = fs.readFileSync(new URL('../public/kerangka-suara.js', import.meta.url), 'utf8');
function setup() {
  const els = new Map(), spoken = [], listeners = new Map(); let cancelled = 0;
  for (const id of ['cacaPertanyaan', 'cacaPanel', 'cacaMulutToggle', 'cacaMulutStop', 'cacaPercakapan', 'cacaSuaraStatus', 'cacaTanyaKirim', 'cacaMikrofon']) {
    els.set(id, { value: '', readOnly: false, style: {}, attrs: {}, dataset: {}, scrollHeight: 30, children: [],
      setAttribute(k,v) { this.attrs[k]=v; }, addEventListener(k,fn) { listeners.set(id+':'+k,fn); }, appendChild(n) { this.children.push(n); }, querySelectorAll() { return []; },
      classList: { toggle() {}, contains() { return false; } }, focus() {} });
  }
  const window = { speechSynthesis: { getVoices: () => [{ lang: 'id-ID', name: 'Indonesia' }], speak: v => spoken.push(v), cancel() { cancelled++; }, addEventListener() {} },
    SpeechSynthesisUtterance: class { constructor(text) { this.text=text; } }, isSecureContext: true, SpeechRecognition: class { start() {} }, setTimeout, clearTimeout };
  const context = vm.createContext({ window, document: { hidden: false, getElementById: id => els.get(id), addEventListener() {}, createElement() { return { dataset: {}, classList: { toggle() {} } }; } },
    localStorage: { getItem: key => key === 'lekerEntityAdminToken' ? 'login-1' : null, setItem() {} }, console, Date, Intl, setTimeout, clearTimeout });
  vm.runInContext(voice, context); vm.runInContext(source, context);
  vm.runInContext("cacaState.siap=true; cacaState.scope='G001'; cacaSimpanPercakapan=()=>{}; cacaPasangMulut();", context);
  return { els, spoken, listeners, run: code => vm.runInContext(code, context), get cancelled() { return cancelled; } };
}
test('microphone-origin next reply auto speaks once while subsequent typed reply stays silent', async () => {
  const h=setup();
  h.run("cacaKirimTeks=async function(teks,konteks){ const p={jawaban:'Jawaban '+teks}; cacaMulutKonteks.set(p,konteks); cacaBacakanBalasan(p,cacaEl('cacaPercakapan')); }; cacaSuara.dariMikrofon=true;");
  h.els.get('cacaPertanyaan').value='suara'; await h.run('cacaKirim()');
  assert.equal(h.spoken[0].text,'Jawaban suara');
  h.els.get('cacaPertanyaan').value='ketikan'; await h.run('cacaKirim()');
  assert.equal(h.spoken.length,1); assert.equal(h.cancelled,1);
  h.run('cacaDiam()');
});
test('late response cannot speak after stop or store switch, but still gets manual playback button', () => {
  const h=setup();
  h.run("var p={jawaban:'Balasan terlambat'}; cacaMulutKonteks.set(p,{generasi:cacaMulutGenerasi,scope:'G001',login:cacaSidikLogin(),suara:true}); cacaDiam(); cacaState.scope='G002'; cacaBacakanBalasan(p,cacaEl('cacaPercakapan'));");
  assert.equal(h.spoken.length,0);
  const button=h.els.get('cacaPercakapan').children[0]; assert.equal(button.dataset.cacaScope,'G001'); assert.equal(button.dataset.cacaDengar,'Balasan terlambat');
});
test('pressing microphone interrupts narration and no synthesis starts during recognition', () => {
  const h=setup(); h.run("cacaMulut.ucapkan('Kalimat pertama. Kalimat kedua.',{paksa:true});");
  const old=h.spoken[0]; h.run('cacaToggleSuara()'); assert.equal(h.cancelled,1);
  old.onend(); assert.equal(h.spoken.length,1);
  assert.equal(h.run("cacaMulut.ucapkan('Suara baru',{paksa:true})"),false);
  h.run('cacaHentikanSuara()');
});
test('draft narration and play button contain only review notice, never secret or transaction contents', () => {
  const h=setup();
  h.run("var p={jawaban:'password awal abc',rahasia:{nilai:'abc'},perluKonfirmasi:true,draft:{muatan:{daftar:[{password:'abc'},{nominal:12345}]}}}; cacaMulutKonteks.set(p,{generasi:cacaMulutGenerasi,scope:'G001',login:cacaSidikLogin(),suara:true}); cacaBacakanBalasan(p,cacaEl('cacaPercakapan'));");
  assert.match(h.spoken[0].text,/draft 2 baris di Workspace/); assert.doesNotMatch(h.spoken[0].text,/abc|12345/);
  assert.doesNotMatch(h.els.get('cacaPercakapan').children[0].dataset.cacaDengar,/abc|12345/); h.run('cacaDiam()');
});
