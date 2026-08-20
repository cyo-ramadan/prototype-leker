import { readFileSync, writeFileSync } from 'node:fs';

function replaceBetween(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Missing ${label} markers`);
  return source.slice(0, start) + replacement + '\n\n  ' + source.slice(end);
}

function replaceExact(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing ${label}`);
  return source.replace(before, after);
}

const uiPath = 'public/admin-accounting-settings-comfort.js';
let ui = readFileSync(uiPath, 'utf8');
ui = replaceExact(
  ui,
  "    selectedChoiceGroupId: '',\n    choiceMode: 'create',\n    drafts: new Map()",
  "    selectedChoiceGroupId: '',\n    draftChoiceGroup: null,\n    drafts: new Map()",
  'choice-group state'
);
ui = replaceExact(
  ui,
  "return `<option value=\"\">Pilih Setting Transaksi…</option>${groups.map(group =>",
  "return `<option value=\"\">Pilih Grup Transaksi…</option>${groups.map(group =>",
  'choice-group select label'
);

const choiceEditor = `function renderChoiceGroups(host) {
    const savedGroups = state.accounting.choiceGroups || [];
    const groups = state.draftChoiceGroup ? [state.draftChoiceGroup, ...savedGroups] : savedGroups;
    if (!groups.some(group => group.id === state.selectedChoiceGroupId)) state.selectedChoiceGroupId = groups[0]?.id || '';
    const selected = groups.find(group => group.id === state.selectedChoiceGroupId) || null;
    host.innerHTML = \`<div class="acc-page">
      <div class="acc-head"><h2>Setting Transaksi</h2><p>Susun satu Grup Transaksi lengkap dengan seluruh komponen dan link akun. Semua komponen disiapkan dulu, lalu simpan grup dengan satu tombol.</p></div>
      \${choiceGroupLibraryHtml(groups, selected)}
    </div>\`;
    bindChoiceLibrary(host, selected);
  }

  function choiceGroupLibraryHtml(groups, selected) {
    return \`<div class="acc-rules-layout" style="margin:0;min-height:520px">
      <aside class="acc-tx-list">
        <div class="acc-new-tx" style="padding:12px">
          <button id="accStartChoiceGroup" class="acc-mini primary" style="width:100%" type="button">＋ Grup Transaksi</button>
          <div class="acc-muted" style="margin-top:7px">Nama dan semua komponen baru disimpan setelah tombol Simpan Grup ditekan.</div>
        </div>
        \${groups.map(group => \`<button type="button" class="acc-tx \${group.id === state.selectedChoiceGroupId ? 'active' : ''}" data-select-choice-group="\${esc(group.id)}">
          <div class="acc-tx-line"><span>\${esc(group.name || 'Grup baru')}</span><span class="\${group.accountingReady ? 'acc-status-ok' : 'acc-status-warn'}">\${group.accountingReady ? '●' : '▲'}</span></div>
          <div class="acc-tx-code">\${String(group.id).startsWith('draft_choice_group_') ? 'BELUM DISIMPAN' : \`${esc(group.code)} · \${group.isActive ? 'aktif' : 'nonaktif'}\`}</div>
        </button>\`).join('') || '<div class="acc-muted" style="padding:14px">Belum ada grup.</div>'}
      </aside>
      <section class="acc-rules-editor">\${selected ? choiceGroupDetailHtml(selected) : '<div class="acc-muted">Tekan Grup Transaksi untuk mulai menyusun grup.</div>'}</section>
    </div>\`;
  }

  function choiceGroupDetailHtml(group) {
    const draft = String(group.id).startsWith('draft_choice_group_');
    const usage = group.usedByCategories || [];
    return \`<div class="acc-rule-title"><h2>\${draft ? 'Grup Transaksi Baru' : esc(group.name)}</h2><span class="acc-chip \${usage.length ? 'ok' : ''}">\${draft ? 'Belum disimpan' : usage.length ? 'Terhubung Akuntansi' : 'Generic'}</span>\${draft ? '' : \`<span class="acc-chip \${group.accountingReady ? 'ok' : 'warn'}">\${group.accountingReady ? 'Account ready' : 'Perlu mapping akun'}</span>\`}</div>
      <div class="acc-field" style="margin:12px 0"><label>Nama Grup</label><input class="acc-input" data-choice-group-name value="\${esc(group.name || '')}" placeholder="contoh: Beban 1" /></div>
      \${draft ? '' : \`<div class="acc-rule-desc"><span class="acc-code">\${esc(group.code)}</span> · \${group.journalLineCount} journal line historis.</div>\`}
      \${!draft && usage.length ? \`<div class="acc-card" style="padding:10px;margin-bottom:12px"><div class="acc-muted">Dipakai oleh</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">\${usage.map(item => \`<span class="acc-chip">\${esc(item.name)} · \${esc(item.side)}</span>\`).join('')}</div></div>\` : ''}
      <div class="acc-card">
        <div style="padding:11px 12px;border-bottom:1px solid #efede6"><b style="font-size:12px">Komponen Grup</b><div class="acc-muted" style="margin-top:3px">Masukkan semua komponen dan akun link-nya dulu.</div></div>
        <div id="accChoiceOptionRows">\${(group.options || []).map(choiceOptionRow).join('')}</div>
        <button id="accAddChoiceOption" class="acc-add" type="button">＋ Tambah Komponen</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:14px">
        <button class="acc-mini primary" data-save-choice-group type="button">Simpan Grup</button>
        \${draft ? '' : \`<button class="acc-mini \${group.isActive ? 'danger' : 'primary'}" data-toggle-choice-group type="button">\${group.isActive ? 'Nonaktifkan Grup' : 'Aktifkan Grup'}</button>\`}
      </div>\`;
  }

  function choiceOptionRow(option) {
    const draft = String(option.id).startsWith('draft_choice_');
    return \`<div class="acc-form-row" data-choice-option="\${esc(option.id)}" data-draft="\${draft ? '1' : '0'}" style="grid-template-columns:minmax(150px,1fr) minmax(220px,1.4fr) 78px 86px \${draft ? '42px' : ''}">
      <div><input class="acc-input" data-choice-option-name value="\${esc(option.name || '')}" placeholder="Nama komponen" /><div class="acc-muted" style="margin-top:4px">\${draft ? 'kode otomatis saat grup disimpan' : \`${esc(option.code)} · \${Number(option.journalLineCount || 0)} jurnal\`}</div></div>
      <div><select class="acc-select" data-choice-option-account>\${accountOptions('', option.accountId || '', true).replace('Pilih akun…','Belum dilink ke Akuntansi')}</select><div class="acc-muted" style="margin-top:4px">\${option.accountingReady ? 'Siap Accounting' : 'Link akun optional selama generic'}</div></div>
      <label class="acc-muted"><input type="checkbox" data-choice-option-active \${option.isActive !== false ? 'checked' : ''}/> Aktif</label>
      <label class="acc-muted"><input type="checkbox" data-choice-option-default \${option.isDefault ? 'checked' : ''}/> Default</label>
      \${draft ? '<button class="acc-trash" data-remove-choice-option type="button" title="Hapus komponen draft">×</button>' : ''}
    </div>\`;
  }

  function readChoiceGroupDraft(host, group) {
    const name = host.querySelector('[data-choice-group-name]')?.value.trim() || '';
    const rows = [...host.querySelectorAll('[data-choice-option]')];
    const options = rows.map((row, index) => ({
      id: row.dataset.choiceOption,
      draft: row.dataset.draft === '1',
      name: row.querySelector('[data-choice-option-name]').value.trim(),
      accountId: row.querySelector('[data-choice-option-account]').value || null,
      isActive: row.querySelector('[data-choice-option-active]').checked,
      isDefault: row.querySelector('[data-choice-option-default]').checked,
      sortOrder: (index + 1) * 10
    }));
    if (!name) throw new Error('Nama grup wajib diisi');
    if (!options.length) throw new Error('Tambahkan minimal satu komponen sebelum menyimpan grup');
    if (options.some(option => !option.name)) throw new Error('Nama setiap komponen wajib diisi');
    if (options.filter(option => option.isActive && option.isDefault).length > 1) throw new Error('Hanya satu komponen aktif yang boleh menjadi default');
    return { name, options, group };
  }

  async function saveChoiceGroupBundle(host, group) {
    const draft = readChoiceGroupDraft(host, group);
    const isNewGroup = String(group.id).startsWith('draft_choice_group_');
    let groupId = group.id;
    try {
      if (isNewGroup) {
        const created = await api('/api/admin/settings/accounting/choice-groups', {
          method: 'POST', body: JSON.stringify({ name: draft.name })
        });
        groupId = created.id;
      } else {
        await api(\`/api/admin/settings/accounting/choice-groups/\${encodeURIComponent(groupId)}\`, {
          method: 'PATCH', body: JSON.stringify({ name: draft.name, isActive: group.isActive })
        });
      }

      for (const option of draft.options) {
        await api(option.draft ? '/api/admin/settings/accounting/choice-options' : \`/api/admin/settings/accounting/choice-options/\${encodeURIComponent(option.id)}\`, {
          method: option.draft ? 'POST' : 'PATCH',
          body: JSON.stringify({
            choiceGroupId: groupId,
            name: option.name,
            accountId: option.accountId,
            isActive: option.isActive,
            isDefault: option.isDefault,
            sortOrder: option.sortOrder
          })
        });
      }

      state.selectedChoiceGroupId = groupId;
      if (isNewGroup) state.draftChoiceGroup = null;
      await load(true);
      toast('Grup transaksi tersimpan');
    } catch (error) {
      if (isNewGroup && groupId !== group.id) {
        state.draftChoiceGroup = null;
        state.selectedChoiceGroupId = groupId;
        await load(true).catch(() => {});
      }
      throw error;
    }
  }

  function bindChoiceLibrary(host, selected) {
    host.querySelectorAll('[data-select-choice-group]').forEach(button => button.addEventListener('click', () => {
      state.selectedChoiceGroupId = button.dataset.selectChoiceGroup;
      renderChoiceGroups(host);
    }));
    el('accStartChoiceGroup')?.addEventListener('click', () => {
      const id = \`draft_choice_group_\${Date.now()}\`;
      state.draftChoiceGroup = {
        id, code: '', name: '', isActive: true, accountingReady: false,
        usedByCategories: [], journalLineCount: 0, options: []
      };
      state.selectedChoiceGroupId = id;
      renderChoiceGroups(host);
    });
    el('accAddChoiceOption')?.addEventListener('click', () => {
      if (!selected) return;
      selected.options = [...(selected.options || []), {
        id: \`draft_choice_\${Date.now()}_\${(selected.options || []).length}\`,
        name: '', accountId: null, accountingReady: false,
        isActive: true, isDefault: false,
        sortOrder: (selected.options || []).length * 10 + 10,
        journalLineCount: 0
      }];
      renderChoiceGroups(host);
    });
    host.querySelectorAll('[data-remove-choice-option]').forEach(button => button.addEventListener('click', () => {
      const row = button.closest('[data-choice-option]');
      selected.options = (selected.options || []).filter(option => option.id !== row.dataset.choiceOption);
      renderChoiceGroups(host);
    }));
    host.querySelector('[data-save-choice-group]')?.addEventListener('click', async () => {
      try { await saveChoiceGroupBundle(host, selected); }
      catch (error) { toast(error.message); }
    });
    host.querySelector('[data-toggle-choice-group]')?.addEventListener('click', async () => {
      if (!selected || String(selected.id).startsWith('draft_choice_group_')) return;
      try {
        await api(\`/api/admin/settings/accounting/choice-groups/\${encodeURIComponent(selected.id)}\`, {
          method: 'PATCH', body: JSON.stringify({ name: host.querySelector('[data-choice-group-name]')?.value.trim() || selected.name, isActive: !selected.isActive })
        });
        await load(true); toast(selected.isActive ? 'Grup dinonaktifkan' : 'Grup diaktifkan');
      } catch (error) { toast(error.message); }
    });
  }

  function choiceGroupPreviewHtml(groupId) {
    const group = (state.accounting.choiceGroups || []).find(item => item.id === groupId);
    if (!group) return '<div class="acc-muted" style="margin-top:7px">Pilih grup untuk melihat komponen dan akun link.</div>';
    const options = (group.options || []).filter(option => option.isActive);
    if (!options.length) return '<div class="acc-muted" style="margin-top:7px">Grup ini belum punya komponen aktif.</div>';
    return \`<div class="acc-card" style="margin-top:8px;padding:8px 10px">
      <div class="acc-muted" style="margin-bottom:5px">Komponen dalam \${esc(group.name)}</div>
      \${options.map(option => {
        const account = option.account ? \`\${option.account.code} — \${option.account.name}\` : 'Belum dilink ke akun';
        return \`<div style="display:grid;grid-template-columns:minmax(110px,.8fr) minmax(170px,1.2fr);gap:8px;padding:5px 0;border-bottom:1px solid #efede6;font-size:11px"><b>\${esc(option.name)}</b><span>\${esc(account)}</span></div>\`;
      }).join('')}
    </div>\`;
  }`;

ui = replaceBetween(ui, 'function renderChoiceGroups(host) {', 'function renderRules(host) {', choiceEditor, 'choice editor');

const ruleCard = `function ruleCard(rule) {
    return \`<div class="acc-rule" data-rule-id="\${esc(rule.id)}" data-rule-side="\${esc(rule.side)}" data-draft="\${String(rule.id).startsWith('draft_') ? '1' : '0'}"><div class="acc-rule-top"><input class="acc-input" data-rule-label value="\${esc(rule.label || '')}"/><button class="acc-trash" data-disable-rule type="button" title="Nonaktifkan">×</button></div><select class="acc-select" data-rule-source>\${(state.accounting.sourceTypes || []).map(source => \`<option value="\${esc(source)}" \${source === rule.sourceType ? 'selected' : ''}>\${esc(SOURCE_LABELS[source] || source)}</option>\`).join('')}</select><div class="acc-source-detail" data-rule-fixed-wrap \${rule.sourceType === 'fixed_account' ? '' : 'hidden'}><select class="acc-select" data-rule-fixed>\${accountOptions('', rule.fixedAccountId || '', true)}</select></div><div class="acc-source-detail" data-rule-choice-wrap \${rule.sourceType === 'choice_group' ? '' : 'hidden'}><select class="acc-select" data-rule-choice>\${choiceGroupOptions(rule.choiceGroupId || '', true)}</select><div data-rule-choice-preview>\${choiceGroupPreviewHtml(rule.choiceGroupId || '')}</div></div><button class="acc-mini primary" data-save-rule type="button" style="margin-top:8px">Simpan</button></div>\`;
  }`;
ui = replaceBetween(ui, 'function ruleCard(rule) {', 'function previewRow(rule) {', ruleCard, 'rule card');

const oldSourceBinding = `host.querySelectorAll('[data-rule-source]').forEach(select => select.addEventListener('change', () => {
      const card = select.closest('[data-rule-id]');
      card.querySelector('[data-rule-fixed-wrap]').hidden = select.value !== 'fixed_account';
      card.querySelector('[data-rule-choice-wrap]').hidden = select.value !== 'choice_group';
    }));`;
const newSourceBinding = `host.querySelectorAll('[data-rule-source]').forEach(select => select.addEventListener('change', () => {
      const card = select.closest('[data-rule-id]');
      card.querySelector('[data-rule-fixed-wrap]').hidden = select.value !== 'fixed_account';
      card.querySelector('[data-rule-choice-wrap]').hidden = select.value !== 'choice_group';
    }));
    host.querySelectorAll('[data-rule-choice]').forEach(select => select.addEventListener('change', () => {
      const card = select.closest('[data-rule-id]');
      card.querySelector('[data-rule-choice-preview]').innerHTML = choiceGroupPreviewHtml(select.value);
    }));`;
ui = replaceExact(ui, oldSourceBinding, newSourceBinding, 'rule choice preview binding');
writeFileSync(uiPath, ui);

const testPath = 'test/accounting-settings-choice-groups.test.js';
let tests = readFileSync(testPath, 'utf8');
const testStart = "test('Setting Transaksi UI exposes Bikin Grup and Pasang Grup without migrating Flow Preset early', () => {";
const testIndex = tests.indexOf(testStart);
if (testIndex < 0) throw new Error('Missing Fase 4 UI test');
tests = tests.slice(0, testIndex) + `test('Setting Transaksi UI saves one group bundle and attaches it only from Aturan Transaksi', () => {
  assert.match(settingsSource, /'choice_group'/);
  assert.match(settingsSource, /choiceGroups/);
  assert.match(settingsSource, /CHOICE_GROUP_EMPTY/);
  assert.match(settingsSource, /NEEDS_CHOICE_ACCOUNT/);
  assert.match(comfortUi, /Setting Transaksi/);
  assert.match(comfortUi, /Grup Transaksi/);
  assert.match(comfortUi, /Komponen Grup/);
  assert.match(comfortUi, /Simpan Grup/);
  assert.match(comfortUi, /data-save-choice-group/);
  assert.doesNotMatch(comfortUi, /data-save-choice-option/);
  assert.doesNotMatch(comfortUi, /Pasang Grup/);
  assert.match(comfortUi, /data-rule-choice-preview/);
  assert.match(comfortUi, /choiceGroupPreviewHtml/);
  assert.match(comfortUi, /Belum dilink ke akun/);
  assert.match(comfortUi, /choiceGroupId/);
  assert.doesNotMatch(flowPresetUi, /sourceType:\\s*'choice_group'|choiceGroupId/);
});
`;
writeFileSync(testPath, tests);

const contractPath = 'contracts/accounting-choice-groups-v1.md';
let contract = readFileSync(contractPath, 'utf8');
const contractStart = contract.indexOf('## 7. Fase 4 — API/UI Setting Transaksi');
const contractEnd = contract.indexOf('## 8. Invariant test wajib', contractStart);
if (contractStart < 0 || contractEnd < 0) throw new Error('Missing contract Fase 4 section');
const newContractSection = `## 7. Fase 4 — API/UI Setting Transaksi

Fase 4 menyediakan dua surface dengan tanggung jawab yang tegas:

1. **Grup Transaksi** di Setting Transaksi untuk menyusun satu paket reusable;
2. **Aturan Transaksi** untuk memasang paket tersebut ke lane Debit/Kredit Accounting.

### 7.1 Grup Transaksi

Editor grup memakai **satu tombol \`Simpan Grup\`**. Admin mengisi nama grup, seluruh
komponen, status aktif/default, dan link Account terlebih dahulu. Tidak ada tombol
\`Simpan\` per komponen. Satu klik \`Simpan Grup\` adalah satu submit action dari sudut
pandang admin; API canonical di bawah tetap menyimpan group dan option sebagai entitas
terpisah agar schema/ownership Fase 4 tidak berubah.

Bootstrap \`GET /api/admin/settings/accounting\` menambah \`choiceGroups\` dan mirror
penggunaan group, termasuk kategori yang memakai group dan jumlah journal line historis.

Target route tetap:

| Method | Path |
|---|---|
| \`POST\` | \`/api/admin/settings/accounting/choice-groups\` |
| \`PATCH\` | \`/api/admin/settings/accounting/choice-groups/{id}\` |
| \`POST\` | \`/api/admin/settings/accounting/choice-options\` |
| \`PATCH\` | \`/api/admin/settings/accounting/choice-options/{id}\` |

Tidak ada route \`DELETE\`; lifecycle menggunakan \`isActive\`.

### 7.2 Pemasangan hanya dari Aturan Transaksi

Tidak ada lagi surface **Pasang Grup** terpisah di Setting Transaksi. Pemasangan dilakukan
langsung pada baris **Aturan Transaksi** dengan memilih \`sourceType: "choice_group"\`
dan \`choiceGroupId\`.

Ketika admin memilih grup, misalnya **Beban 1**, tepat di bawah selector harus tampil
preview semua komponen aktif dalam grup tersebut beserta Account yang sedang ter-link.
Preview ini read-only dan bersumber dari bootstrap Setting Akuntansi; ia tidak membuat
registry Account kedua.

\`POST/PATCH /journal-rules\` tetap menerima \`sourceType: "choice_group"\` +
\`choiceGroupId\`.

Runtime Fase 4 menjaga:

- option generic boleh disimpan dengan \`accountId = null\`;
- setelah group dipasang ke Accounting, readiness tidak boleh menyatakan siap jika
  option yang dapat dipilih belum memiliki Account aktif;
- group tanpa option aktif membuat kategori pemakainya \`INCOMPLETE\` dengan blocker
  \`CHOICE_GROUP_EMPTY\`;
- group yang masih dipakai rule aktif tidak boleh dinonaktifkan sembarangan;
- Account Master tetap read-only dari Setting Akuntansi.

`;
contract = contract.slice(0, contractStart) + newContractSection + contract.slice(contractEnd);
writeFileSync(contractPath, contract);

console.log('Accounting Settings group-save/Aturan Transaksi preview revision applied.');
