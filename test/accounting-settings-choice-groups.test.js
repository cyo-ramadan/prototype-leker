import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { getAccountingSettingsBootstrap, handleAccountingSettingsApi } from '../src/accounting-settings.js';
import { ACCOUNTING_AMOUNT_SCALE, postAccountingJournal } from '../src/accounting-ledger.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const settingsSource = readFileSync(new URL('../src/accounting-settings.js', import.meta.url), 'utf8');
const comfortUi = readFileSync(new URL('../public/admin-accounting-settings-comfort.js', import.meta.url), 'utf8');
const flowPresetUi = readFileSync(new URL('../public/admin-accounting-flow-presets.js', import.meta.url), 'utf8');

function d1(sqlite) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bound = args => ({
        _statement: statement,
        _args: args,
        async first() { return statement.get(...args) || null; },
        async all() { return { results: statement.all(...args) }; },
        async run() { return statement.run(...args); }
      });
      return {
        bind(...args) { return bound(args); },
        async first() { return statement.get() || null; },
        async all() { return { results: statement.all() }; },
        async run() { return statement.run(); }
      };
    },
    async batch(bound) {
      return bound.map(item => ({ results: item._statement.all(...item._args) }));
    }
  };
}

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

function store(sqlite) {
  return sqlite.prepare(`SELECT id, code, store_name FROM stores WHERE code = 'G001' LIMIT 1`).get();
}

function account(sqlite, storeId, code) {
  return sqlite.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = ? AND code = ? AND is_active = 1`).get(storeId, code)?.id || null;
}

async function api(sqlite, method, path, body) {
  const url = `http://local${path}${path.includes('?') ? '&' : '?'}store=G001`;
  const request = new Request(url, {
    method,
    headers: {
      'x-admin-pin': '123456',
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const response = await handleAccountingSettingsApi(request, { DB: d1(sqlite) }, new URL(url).pathname);
  return { status: response.status, body: await response.json() };
}

async function bootstrap(sqlite) {
  const s = store(sqlite);
  return getAccountingSettingsBootstrap(d1(sqlite), { id: s.id, code: s.code, storeName: s.store_name });
}

test('Bikin Grup allows a generic option without an Account link', async () => {
  const sqlite = freshDatabase();
  try {
    const group = await api(sqlite, 'POST', '/api/admin/settings/accounting/choice-groups', { name: 'Beban Tetap' });
    assert.equal(group.status, 201);
    assert.equal(group.body.code, 'BEBAN_TETAP');
    const option = await api(sqlite, 'POST', '/api/admin/settings/accounting/choice-options', {
      choiceGroupId: group.body.id, name: 'Listrik', accountId: null, isActive: true, isDefault: true
    });
    assert.equal(option.status, 201);
    assert.equal(option.body.code, 'LISTRIK');
    const data = await bootstrap(sqlite);
    const saved = data.choiceGroups.find(item => item.id === group.body.id);
    assert.ok(saved);
    assert.equal(saved.accountingReady, false);
    assert.equal(saved.options[0].accountId, null);
    assert.equal(saved.options[0].accountingReady, false);
    assert.deepEqual(saved.usedByCategories, []);
  } finally { sqlite.close(); }
});

test('Pasang Grup fails closed until every active option has an active Account', async () => {
  const sqlite = freshDatabase();
  try {
    const s = store(sqlite);
    const operational = sqlite.prepare(`SELECT id FROM transaction_categories WHERE store_id = ? AND code = 'operational'`).get(s.id);
    const expense = account(sqlite, s.id, '6101');
    assert.ok(operational?.id && expense);
    const group = await api(sqlite, 'POST', '/api/admin/settings/accounting/choice-groups', { name: 'Beban Pilihan' });
    const option = await api(sqlite, 'POST', '/api/admin/settings/accounting/choice-options', {
      choiceGroupId: group.body.id, name: 'Listrik', accountId: null, isActive: true, isDefault: true
    });
    const blocked = await api(sqlite, 'POST', '/api/admin/settings/accounting/journal-rules', {
      transactionCategoryId: operational.id, label: 'Beban Pilihan', side: 'DEBIT', sourceType: 'choice_group',
      choiceGroupId: group.body.id, sortOrder: 15, isActive: true
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'NEEDS_CHOICE_ACCOUNT');
    const linked = await api(sqlite, 'PATCH', `/api/admin/settings/accounting/choice-options/${option.body.id}`, {
      choiceGroupId: group.body.id, name: 'Listrik', accountId: expense, isActive: true, isDefault: true
    });
    assert.equal(linked.status, 200);
    const attached = await api(sqlite, 'POST', '/api/admin/settings/accounting/journal-rules', {
      transactionCategoryId: operational.id, label: 'Beban Pilihan', side: 'DEBIT', sourceType: 'choice_group',
      choiceGroupId: group.body.id, sortOrder: 15, isActive: true
    });
    assert.equal(attached.status, 201);
    const data = await bootstrap(sqlite);
    const saved = data.choiceGroups.find(item => item.id === group.body.id);
    assert.equal(saved.accountingReady, true);
    assert.deepEqual(saved.usedByCategories.map(item => [item.code, item.side]), [['operational', 'DEBIT']]);
    const cannotClear = await api(sqlite, 'PATCH', `/api/admin/settings/accounting/choice-options/${option.body.id}`, {
      choiceGroupId: group.body.id, name: 'Listrik', accountId: null, isActive: true, isDefault: true
    });
    assert.equal(cannotClear.status, 409);
    assert.equal(cannotClear.body.code, 'NEEDS_CHOICE_ACCOUNT');
    const cannotDisableGroup = await api(sqlite, 'PATCH', `/api/admin/settings/accounting/choice-groups/${group.body.id}`, {
      name: 'Beban Pilihan', isActive: false
    });
    assert.equal(cannotDisableGroup.status, 409);
    const cannotDisableLast = await api(sqlite, 'PATCH', `/api/admin/settings/accounting/choice-options/${option.body.id}`, {
      choiceGroupId: group.body.id, name: 'Listrik', accountId: expense, isActive: false, isDefault: false
    });
    assert.equal(cannotDisableLast.status, 409);
  } finally { sqlite.close(); }
});

test('Choice Group mirror exposes journal counts without joining historical meaning back to current mapping', async () => {
  const sqlite = freshDatabase();
  try {
    const s = store(sqlite);
    const expense = account(sqlite, s.id, '6101');
    const cash = account(sqlite, s.id, '1101');
    assert.ok(expense && cash);
    const group = await api(sqlite, 'POST', '/api/admin/settings/accounting/choice-groups', { name: 'Beban Historis' });
    const option = await api(sqlite, 'POST', '/api/admin/settings/accounting/choice-options', {
      choiceGroupId: group.body.id, name: 'Listrik', accountId: expense, isActive: true, isDefault: true
    });
    const posted = await postAccountingJournal(d1(sqlite), { id: s.id }, {
      businessDate: '2026-08-20', occurredAt: '2026-08-20T02:00:00.000Z',
      sourceSystem: 'TEST', sourceReferenceId: 'choice_ui_mirror', correlationId: 'choice_ui_mirror',
      idempotencyKey: 'choice_ui_mirror', description: 'Choice mirror',
      journalLines: [
        { accountId: expense, side: 'DEBIT', amountScaled: ACCOUNTING_AMOUNT_SCALE, choiceGroupCode: group.body.code, choiceOptionCode: option.body.code },
        { accountId: cash, side: 'CREDIT', amountScaled: ACCOUNTING_AMOUNT_SCALE }
      ]
    });
    assert.equal(posted.ok, true);
    const data = await bootstrap(sqlite);
    const saved = data.choiceGroups.find(item => item.id === group.body.id);
    assert.equal(saved.journalLineCount, 1);
    assert.equal(saved.options.find(item => item.id === option.body.id).journalLineCount, 1);
    await api(sqlite, 'PATCH', `/api/admin/settings/accounting/choice-options/${option.body.id}`, {
      choiceGroupId: group.body.id, name: 'Listrik Rename', accountId: cash, isActive: true, isDefault: true
    });
    const after = await bootstrap(sqlite);
    assert.equal(after.choiceGroups.find(item => item.id === group.body.id).journalLineCount, 1);
  } finally { sqlite.close(); }
});

test('CHOICE_GROUP_EMPTY is an honest readiness blocker for an attached empty group', async () => {
  const sqlite = freshDatabase();
  try {
    const s = store(sqlite);
    const operational = sqlite.prepare(`SELECT id FROM transaction_categories WHERE store_id = ? AND code = 'operational'`).get(s.id);
    const groupId = 'choice_group_empty_test';
    sqlite.prepare(`INSERT INTO accounting_choice_groups (id, store_id, code, name, is_active) VALUES (?, ?, 'EMPTY_TEST', 'Empty Test', 1)`).run(groupId, s.id);
    sqlite.prepare(`INSERT INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, choice_group_id, is_active, sort_order) VALUES ('choice_empty_rule', ?, ?, 'Empty Choice', 'DEBIT', 'choice_group', ?, 1, 17)`).run(s.id, operational.id, groupId);
    const data = await bootstrap(sqlite);
    const category = data.transactionCategories.find(item => item.code === 'operational');
    assert.equal(category.completeness, 'INCOMPLETE');
    assert.ok(category.blockers.some(item => item.code === 'CHOICE_GROUP_EMPTY'));
  } finally { sqlite.close(); }
});

test('Warehouse production/transfer reject Revenue or Expense Choice Group accounts at save time', async () => {
  const sqlite = freshDatabase();
  try {
    const s = store(sqlite);
    const revenue = account(sqlite, s.id, '4101');
    const transfer = sqlite.prepare(`SELECT id FROM transaction_categories WHERE store_id = ? AND code = 'wh_transfer'`).get(s.id);
    assert.ok(revenue && transfer?.id);
    const group = await api(sqlite, 'POST', '/api/admin/settings/accounting/choice-groups', { name: 'Transfer Salah' });
    await api(sqlite, 'POST', '/api/admin/settings/accounting/choice-options', {
      choiceGroupId: group.body.id, name: 'Pendapatan', accountId: revenue, isActive: true, isDefault: true
    });
    const result = await api(sqlite, 'POST', '/api/admin/settings/accounting/journal-rules', {
      transactionCategoryId: transfer.id, label: 'Transfer Salah', side: 'DEBIT', sourceType: 'choice_group',
      choiceGroupId: group.body.id, sortOrder: 10, isActive: true
    });
    assert.equal(result.status, 409);
    assert.match(result.body.error, /tidak boleh memakai akun Pendapatan atau Beban/i);
  } finally { sqlite.close(); }
});

test('codes stay stable, one default is enforced, and Account Master remains Accounting-owned', async () => {
  const sqlite = freshDatabase();
  try {
    const s = store(sqlite);
    const expense = account(sqlite, s.id, '6101');
    const group = await api(sqlite, 'POST', '/api/admin/settings/accounting/choice-groups', { name: 'Kode Stabil' });
    const first = await api(sqlite, 'POST', '/api/admin/settings/accounting/choice-options', {
      choiceGroupId: group.body.id, name: 'Pilihan Satu', accountId: expense, isActive: true, isDefault: true
    });
    const second = await api(sqlite, 'POST', '/api/admin/settings/accounting/choice-options', {
      choiceGroupId: group.body.id, name: 'Pilihan Dua', accountId: expense, isActive: true, isDefault: true
    });
    assert.equal(second.status, 201);
    const renamed = await api(sqlite, 'PATCH', `/api/admin/settings/accounting/choice-options/${first.body.id}`, {
      choiceGroupId: group.body.id, name: 'Nama Baru', accountId: expense, isActive: true, isDefault: false
    });
    assert.equal(renamed.body.code, 'PILIHAN_SATU');
    const row = sqlite.prepare(`SELECT code FROM accounting_choice_groups WHERE id = ?`).get(group.body.id);
    assert.equal(row.code, 'KODE_STABIL');
    const defaults = sqlite.prepare(`SELECT code FROM accounting_choice_options WHERE choice_group_id = ? AND is_active = 1 AND is_default = 1`).all(group.body.id);
    assert.deepEqual(defaults.map(item => item.code), ['PILIHAN_DUA']);
    const blockedAccountWriter = await api(sqlite, 'POST', '/api/admin/settings/accounting/accounts', { name: 'Tidak Boleh' });
    assert.equal(blockedAccountWriter.status, 405);
    assert.equal(blockedAccountWriter.body.code, 'ACCOUNT_MAINTENANCE_OWNED_BY_ACCOUNTING');
  } finally { sqlite.close(); }
});

test('Setting Transaksi UI exposes Bikin Grup and Pasang Grup without migrating Flow Preset early', () => {
  assert.match(settingsSource, /'choice_group'/);
  assert.match(settingsSource, /choiceGroups/);
  assert.match(settingsSource, /CHOICE_GROUP_EMPTY/);
  assert.match(settingsSource, /NEEDS_CHOICE_ACCOUNT/);
  assert.match(comfortUi, /Setting Transaksi/);
  assert.match(comfortUi, /Bikin Grup/);
  assert.match(comfortUi, /Pasang Grup/);
  assert.match(comfortUi, /Belum dilink ke Akuntansi/);
  assert.match(comfortUi, /Dipakai oleh/);
  assert.match(comfortUi, /journal line historis/);
  assert.match(comfortUi, /choiceGroupId/);
  assert.doesNotMatch(flowPresetUi, /sourceType:\s*'choice_group'|choiceGroupId/);
});
