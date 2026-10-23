import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Bos Cyo, 2026-10-24: "pengaturan apapun harus scrol sampe kebawah, bikin aja subtombol pengaturan
// berdasarkan apa yang diatur" -- Pengaturan Entity Admin dibagi per kelompok.
const read = name => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('Pengaturan Entity Admin: tiap kartu ada di satu kelompok, tiap kelompok punya sub-tombol', () => {
  const html = read('entity-admin.html');
  const js = read('entity-settings-groups.js');
  const section = html.slice(html.indexOf('<section id="entityTab-settings"'), html.indexOf('<section id="entityTab-stores"'));
  assert.match(section, /id="entitySettingsGroupNav"/);
  const wrappers = [...section.matchAll(/data-settings-group="([a-z]+)"/g)].map(match => match[1]);
  const buttons = [...js.matchAll(/\{ id: '([a-z]+)', label:/g)].map(match => match[1]);
  assert.deepEqual(wrappers, buttons, 'urutan wadah = urutan sub-tombol');
  for (const id of ['cacaPengaturanHost', 'entityDanaApresiasi', 'entityFinaPengaturan', 'entityFinaSurat', 'entityFinaRekrut', 'entityFinaKanal', 'entityFinaInbox', 'entityAlarmAdmin', 'entitySettingsGerai']) {
    const at = section.indexOf(`id="${id}"`);
    assert.ok(at > 0, id);
    const opened = section.lastIndexOf('data-settings-group=', at);
    assert.ok(opened > 0, `${id} harus di dalam kelompok`);
  }
  assert.match(html, /entity-settings-groups\.js\?v=/);
  assert.match(js, /#tab=daily-task/);
});

test('Workspace Gerai membuka tab dari tautan #tab= di semua skin', () => {
  assert.match(read('admin-daily-task.js'), /get\('tab'\)/);
});
