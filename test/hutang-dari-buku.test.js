import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import { namesSimilar, normalizeName } from '../src/nama-pihak.js';

// Bos Cyo, 2026-10-14: hutang sewa lapak yang dicatat akuntan lewat jurnal manual (Debit 1401 Deposit /
// Kredit 2101 Utang Usaha atas nama "Spbu Beji") tidak muncul di Pembayaran Hutang. Pembayaran Hutang
// membaca dari BUKU per nama (seperti gaji, ADR-054), pelunasannya jurnal atas nama orang yang sama,
// dan hutang dari Bea Operasional (sudah dijurnal ke 2101 bernama) tidak terhitung dua kali.
// Plus master nama fleksibel: nama yang sama/mirip memakai nama yang sudah ada.

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}
class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) {
    this.db.exec('BEGIN');
    try { const out = statements.map(s => s.run()); this.db.exec('COMMIT'); return out; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_hb', 'owner_hb', 'x', 'Bos')`).run();
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_hb', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('owner-hb'));
  db.prepare(`INSERT INTO suppliers (id, store_id, name) VALUES ('sup_poci', 'store_pendem', 'Suplier Poci Malang')`).run();
  const acc = code => db.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = 'store_pendem' AND code = ?`).get(code).id;
  return { db, env: { DB: new D1Database(db) }, acc };
}

const call = (env, path, body, method) => worker.fetch(new Request(`https://example.test${path}${path.includes('?') ? '&' : '?'}store=PENDEM`, {
  method: method || (body ? 'POST' : 'GET'),
  headers: { Authorization: 'Bearer owner-hb', ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined
}), env);

async function hutangSewa(env, acc, { name = 'Spbu Beji', amount = '3750000' } = {}) {
  const res = await call(env, '/api/admin/accounting/journals', {
    businessDate: '2026-10-01', description: 'Sewa lapak Okt-Des', sourceReferenceId: `manual_${crypto.randomUUID()}`,
    journalLines: [
      { accountId: acc('1401'), side: 'DEBIT', amountExact: amount },
      { accountId: acc('2101'), side: 'CREDIT', amountExact: amount, description: 'hutang sewa', party: { name } }
    ]
  });
  assert.equal(res.status, 201, await res.clone().text());
  return res.json();
}

const findAccount = (summary, name, account) => summary.persons
  .find(person => person.counterpartyName === name)?.accounts.find(item => item.account === account);

// Saldo 2101 per nama menurut buku (Kredit - Debit), rupiah.
const bukuNama = (db, name) => Number(db.prepare(`
  SELECT COALESCE(SUM(CASE WHEN side = 'CREDIT' THEN amount_scaled ELSE -amount_scaled END), 0) AS n
  FROM accounting_party_entries WHERE account_code = '2101' AND party_name = ?
`).get(name).n) / 1_000_000;

test('hutang dari jurnal manual muncul di Pembayaran Hutang, dibayar = jurnal atas nama yang sama, batal = kembali', async () => {
  const { db, env, acc } = await setup();
  try {
    await hutangSewa(env, acc);
    let summary = await (await call(env, '/api/admin/hutang-piutang')).json();
    const account = findAccount(summary, 'Spbu Beji', 'BUKU:2101');
    assert.ok(account, 'hutang dari buku tampil per nama');
    assert.equal(account.balanceRupiah, 3_750_000);
    assert.equal(account.payableByAdmin, true);
    assert.equal(account.fromBook, true);
    assert.equal(account.items.length, 1);

    const paid = await call(env, '/api/admin/hutang-piutang/payments', { accountKey: account.accountKey, amount: 1_250_000, paymentMethod: 'KAS', businessDate: '2026-10-14' });
    assert.equal(paid.status, 201, await paid.clone().text());
    const body = await paid.json();
    assert.equal(body.accounting.deliveries[0].bridgeStatus, 'POSTED', JSON.stringify(body.accounting));
    assert.equal(body.payment.hutangLabel, 'Utang Usaha (buku Akuntansi)');
    assert.equal(findAccount(body, 'Spbu Beji', 'BUKU:2101').balanceRupiah, 2_500_000);
    assert.equal(findAccount(body, 'Spbu Beji', 'BUKU:2101').belumMasukBukuRupiah, 0);
    assert.equal(bukuNama(db, 'Spbu Beji'), 2_500_000, 'buku per nama ikut turun (Debit 2101 atas nama Spbu Beji)');

    const batal = await call(env, `/api/admin/hutang-piutang/payments/${body.payment.id}/void`, { reason: 'salah' });
    assert.equal(batal.status, 200, await batal.clone().text());
    summary = await batal.json();
    assert.equal(findAccount(summary, 'Spbu Beji', 'BUKU:2101').balanceRupiah, 3_750_000);
    assert.equal(bukuNama(db, 'Spbu Beji'), 3_750_000, 'pembalik mewarisi nama');
  } finally { db.close(); }
});

test('hutang Bea Operasional yang sudah dijurnal ke 2101 bernama tidak terhitung dua kali', async () => {
  const { db, env } = await setup();
  try {
    const bea = await call(env, '/api/admin/operational-expenses', { category: 'BEA_LAPAK', counterpartyType: 'OTHER', counterpartyName: 'Pemilik Lapak', amount: 1_650_000, description: 'Sewa lapak' });
    assert.equal(bea.status, 201, await bea.clone().text());
    const summary = await (await call(env, '/api/admin/hutang-piutang')).json();
    const person = summary.persons.find(item => item.counterpartyName === 'Pemilik Lapak');
    assert.deepEqual(person.accounts.map(item => [item.account, item.balanceRupiah]), [['BEA_LAPAK', 1_650_000]]);
    assert.equal(person.hutangRupiah, 1_650_000);
  } finally { db.close(); }
});

test('nama sama beda huruf/spasi memakai nama yang sudah ada; nama pemasok jadi pemasok', async () => {
  const { db, env, acc } = await setup();
  try {
    await hutangSewa(env, acc, { amount: '1000000' });
    await hutangSewa(env, acc, { name: '  SPBU   beji ', amount: '500000' });
    await hutangSewa(env, acc, { name: 'suplier poci malang', amount: '200000' });
    const names = db.prepare(`SELECT DISTINCT party_type, supplier_id, party_name FROM accounting_party_entries ORDER BY party_name`).all().map(row => ({ ...row }));
    assert.deepEqual(names, [
      { party_type: 'OTHER', supplier_id: null, party_name: 'Spbu Beji' },
      { party_type: 'SUPPLIER', supplier_id: 'sup_poci', party_name: 'Suplier Poci Malang' }
    ]);
    const summary = await (await call(env, '/api/admin/hutang-piutang')).json();
    assert.equal(findAccount(summary, 'Spbu Beji', 'BUKU:2101').balanceRupiah, 1_500_000);

    const check = await (await call(env, `/api/admin/accounting/party-names/check?name=${encodeURIComponent('Spbu Bejii')}`)).json();
    assert.equal(check.exact, null);
    assert.deepEqual(check.similar.map(item => item.name), ['Spbu Beji'], 'salah ketik -> "Maksudnya Spbu Beji?"');
    const exact = await (await call(env, `/api/admin/accounting/party-names/check?name=${encodeURIComponent('spbu beji')}`)).json();
    assert.equal(exact.exact.name, 'Spbu Beji');
    const baru = await (await call(env, `/api/admin/accounting/party-names/check?name=${encodeURIComponent('Toko Sinar Jaya')}`)).json();
    assert.deepEqual([baru.exact, baru.similar], [null, []], 'nama baru -> tawarkan tambah ke master');

    const options = await (await call(env, '/api/admin/accounting/party-options')).json();
    assert.deepEqual(options.names.map(item => [item.kind, item.name]), [['NAME', 'Spbu Beji'], ['SUPPLIER', 'Suplier Poci Malang']]);
  } finally { db.close(); }
});

test('pencocok nama: sama, mirip, dan berbeda', () => {
  assert.equal(normalizeName('  SPBU-Beji. '), 'spbu beji');
  assert.equal(namesSimilar('Spbu Beji', 'spbubeji'), true);
  assert.equal(namesSimilar('Spbu Beji', 'Spbu Bejii'), true);
  assert.equal(namesSimilar('Spbu Beji', 'Beji'), true);
  assert.equal(namesSimilar('Spbu Beji', 'Spbu Genengan'), false);
  assert.equal(namesSimilar('Kaliurang', 'Kaliurangg'), true);
  assert.equal(namesSimilar('Kaliurang', 'Toko Maju'), false);
});

test('UI: form nama bebas memakai konfirmasi nama, skrip baru dimuat', () => {
  const html = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
  assert.match(html, /nama-pihak-ui\.js\?v=20261014-nama-fleksibel-v1/);
  assert.ok(html.indexOf('nama-pihak-ui.js') < html.indexOf('admin-accounting-workspace.js'));
  const workspace = readFileSync(new URL('../public/admin-accounting-workspace.js', import.meta.url), 'utf8');
  assert.match(workspace, /konfirmasiNamaPihak/);
  const bea = readFileSync(new URL('../public/admin-operational-expense.js', import.meta.url), 'utf8');
  assert.match(bea, /konfirmasiNamaPihak/);
  const ui = readFileSync(new URL('../public/nama-pihak-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /Maksudnya '/);
  assert.match(ui, /sebagai \$\{asSupplier \? 'pemasok' : 'nama'\} baru\?/);
});
