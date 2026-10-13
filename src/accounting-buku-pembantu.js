import { PARTY_RULES, prepareJournalParties, scaledToSignedRupiah } from './accounting-party-ledger.js';

// Bos Cyo, 2026-10-13: "engga usah bikin buku baru, yang lama aja yang dipakai, tapi bikin visualnya
// lebih gampang ... tampilan seperti buku pembantu/hutang piutang saja di panel akuntansi."
//
// Tampilan saja di atas data yang sudah ada (ADR-054): akun kontrol di buku besar (1202, 2102, 2101,
// 1201, 2103) dan label "atas nama" tiap barisnya (accounting_party_entries, migration 0138/0143).
// Seperti rekening per nasabah di bank: saldo akun kontrol = jumlah saldo semua nama + "belum
// bernama"; tujuan akhirnya "belum bernama" = 0. Tidak ada tabel atau angka baru.
//
// Pemegang `cashier:<id>` (jurnal akun kasir sebelum ditautkan ke Master Karyawan) digabung ke
// karyawan yang sekarang tertaut, sama dengan riwayat per orang dan tombol Sinkronisasi Akuntansi
// (src/sinkron-akuntansi.js), sehingga angka per karyawan di sini = angka "Buku Akuntansi" di sana.

export const UNNAMED_KEY = '__belum_bernama__';
const ACCOUNT_ORDER = ['1202', '2102', '2101', '1201', '2103'];

async function partyAccounts(db, storeId) {
  const rows = await db.prepare(`
    SELECT id, code, name, type FROM chart_of_accounts
    WHERE store_id = ? AND is_active = 1 AND code IN (${ACCOUNT_ORDER.map(() => '?').join(',')})
  `).bind(storeId, ...ACCOUNT_ORDER).all();
  return (rows.results ?? []).sort((a, b) => ACCOUNT_ORDER.indexOf(a.code) - ACCOUNT_ORDER.indexOf(b.code));
}

// cashier:<id> -> karyawan tertaut (id + nama), untuk menggabung saldo akun kasir lama ke orangnya.
async function cashierOwners(db, store) {
  if (!store.entityId) return new Map();
  const rows = await db.prepare(`
    SELECT DISTINCT l.account_id, e.id AS employee_id, e.full_name
    FROM employee_account_links l
    JOIN employees e ON e.id = l.employee_id
    WHERE l.entity_id = ? AND l.account_type = 'CASHIER'
  `).bind(store.entityId).all();
  return new Map((rows.results ?? []).map(row => [`cashier:${row.account_id}`, { employeeId: row.employee_id, name: row.full_name }]));
}

function partyKey(row, owners) {
  if (row.employee_id) {
    const owner = owners.get(row.employee_id);
    if (owner) return { key: `employee:${owner.employeeId}`, name: owner.name, type: 'EMPLOYEE', viaCashier: true };
    if (String(row.employee_id).startsWith('cashier:')) return { key: `employee:${row.employee_id}`, name: `${row.party_name} (akun kasir, belum ditautkan)`, type: 'EMPLOYEE' };
    return { key: `employee:${row.employee_id}`, name: row.employee_name || row.party_name, type: 'EMPLOYEE' };
  }
  if (row.supplier_id) return { key: `supplier:${row.supplier_id}`, name: row.supplier_name || row.party_name, type: 'SUPPLIER' };
  if (row.party_name) return { key: `name:${String(row.party_name).trim().toLowerCase()}`, name: row.party_name, type: 'OTHER' };
  return { key: UNNAMED_KEY, name: 'Belum bernama', type: 'UNNAMED' };
}

// Semua baris jurnal POSTED satu akun kontrol, tiap baris dengan pemegang dan nilai bertanda dalam
// sisi normal akun (aset = Debit-Kredit, kewajiban = Kredit-Debit), urut terlama dulu.
async function accountLines(db, store, account, owners) {
  const sign = account.type === 'ASSET' ? 1 : -1;
  const rows = await db.prepare(`
    SELECT l.id AS line_id, h.id AS journal_id, h.journal_number, h.business_date, h.source_system,
           h.description AS journal_description, l.description AS line_description, l.side, l.amount_scaled,
           p.employee_id, p.supplier_id, p.party_name, e.full_name AS employee_name, s.name AS supplier_name
    FROM accounting_journal_lines l
    JOIN accounting_journal_headers h ON h.id = l.journal_id AND h.store_id = l.store_id
    LEFT JOIN accounting_party_entries p ON p.journal_line_id = l.id
    LEFT JOIN employees e ON e.id = p.employee_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE l.store_id = ? AND l.account_id = ? AND h.journal_status = 'POSTED'
    ORDER BY h.business_date, h.journal_number, l.line_number
  `).bind(store.id, account.id).all();
  return (rows.results ?? []).map(row => ({
    ...partyKey(row, owners),
    lineId: row.line_id,
    journalId: row.journal_id,
    journalNumber: row.journal_number,
    businessDate: row.business_date,
    sourceSystem: row.source_system,
    description: row.line_description || row.journal_description || '',
    side: row.side,
    amountScaled: Number(row.amount_scaled),
    signedScaled: (row.side === 'DEBIT' ? 1 : -1) * sign * Number(row.amount_scaled)
  }));
}

function accountView(account) {
  const rule = PARTY_RULES[account.code];
  return { accountId: account.id, code: account.code, name: account.name, partyKind: rule?.kind || 'NAME', partyLabel: rule?.label || 'nama' };
}

// Ringkasan: per akun kontrol, saldo buku besar, saldo tiap nama, dan bagian belum bernama.
export async function bukuPembantuRingkasan(db, store) {
  const owners = await cashierOwners(db, store);
  const result = [];
  for (const account of await partyAccounts(db, store.id)) {
    const people = new Map();
    let glScaled = 0;
    for (const line of await accountLines(db, store, account, owners)) {
      glScaled += line.signedScaled;
      const person = people.get(line.key) || { key: line.key, name: line.name, type: line.type, balanceScaled: 0, lineCount: 0, lastDate: '' };
      person.balanceScaled += line.signedScaled;
      person.lineCount += 1;
      person.lastDate = line.businessDate;
      people.set(line.key, person);
    }
    const unnamed = people.get(UNNAMED_KEY);
    people.delete(UNNAMED_KEY);
    result.push({
      ...accountView(account),
      glRupiah: scaledToSignedRupiah(glScaled),
      unnamedRupiah: scaledToSignedRupiah(unnamed?.balanceScaled || 0),
      unnamedCount: unnamed?.lineCount || 0,
      people: [...people.values()]
        .map(person => ({ key: person.key, name: person.name, type: person.type, balanceRupiah: scaledToSignedRupiah(person.balanceScaled), balanceScaled: person.balanceScaled, lineCount: person.lineCount, lastDate: person.lastDate }))
        .sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }))
    });
  }
  return { store: { id: store.id, code: store.code }, accounts: result };
}

// Mutasi satu nama (atau "belum bernama") pada satu akun kontrol, dengan saldo berjalan.
export async function bukuPembantuMutasi(db, store, { accountCode, key }) {
  const account = (await partyAccounts(db, store.id)).find(row => row.code === accountCode);
  if (!account) return null;
  const owners = await cashierOwners(db, store);
  let balance = 0;
  const lines = (await accountLines(db, store, account, owners)).filter(line => line.key === key).map(line => {
    balance += line.signedScaled;
    return {
      lineId: line.lineId,
      journalNumber: line.journalNumber,
      businessDate: line.businessDate,
      sourceSystem: line.sourceSystem,
      description: line.description,
      side: line.side,
      amountRupiah: scaledToSignedRupiah(line.amountScaled),
      signedRupiah: scaledToSignedRupiah(line.signedScaled),
      balanceRupiah: scaledToSignedRupiah(balance)
    };
  });
  return { account: accountView(account), key, balanceRupiah: scaledToSignedRupiah(balance), lines: lines.reverse() };
}

// "Beri nama" untuk baris jurnal lama yang belum bernama: hanya MENAMBAH label atas nama (sama dengan
// migration 0143). Jurnal posted tidak diubah (invariant #2), nominal dan sisi disalin apa adanya.
// Validasi nama sama dengan jurnal manual (prepareJournalParties). Baris yang sudah bernama ditolak.
export async function beriNamaBarisJurnal(db, store, { lineId, party, actor }) {
  const line = await db.prepare(`
    SELECT l.id, l.journal_id, l.account_id, l.side, l.amount_scaled, l.description, h.business_date, h.journal_status, c.code
    FROM accounting_journal_lines l
    JOIN accounting_journal_headers h ON h.id = l.journal_id AND h.store_id = l.store_id
    JOIN chart_of_accounts c ON c.id = l.account_id
    WHERE l.id = ? AND l.store_id = ? LIMIT 1
  `).bind(lineId, store.id).first();
  if (!line) return { ok: false, status: 404, error: 'Baris jurnal tidak ditemukan di gerai ini.' };
  if (line.journal_status !== 'POSTED') return { ok: false, status: 409, error: 'Hanya baris jurnal posted yang bisa diberi nama.' };
  if (!PARTY_RULES[line.code]) return { ok: false, status: 400, error: 'Akun ini tidak memakai nama pihak.' };
  const existing = await db.prepare('SELECT party_name FROM accounting_party_entries WHERE journal_line_id = ? LIMIT 1').bind(line.id).first();
  if (existing) return { ok: false, status: 409, error: `Baris ini sudah bernama (${existing.party_name}).` };
  const prepared = await prepareJournalParties(db, store, [{ accountId: line.account_id, party }]);
  if (!prepared.ok) return prepared;
  const named = prepared.parties[0];
  const result = await db.prepare(`
    INSERT OR IGNORE INTO accounting_party_entries (
      id, store_id, entity_id, journal_id, journal_line_id, account_id, account_code,
      party_type, employee_id, supplier_id, party_name, side, amount_scaled,
      business_date, description, created_by_role, created_by_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    `party_${line.id}`, store.id, store.entityId ?? null, line.journal_id, line.id, line.account_id, line.code,
    named.type, named.employeeId, named.supplierId, named.name, line.side, Number(line.amount_scaled),
    line.business_date, String(line.description || '').slice(0, 240), actor.role, actor.id || '', new Date().toISOString()
  ).run();
  if (Number(result.meta?.changes ?? 0) !== 1) return { ok: false, status: 409, error: 'Baris ini sudah diberi nama oleh permintaan lain.' };
  return { ok: true, lineId: line.id, party: { type: named.type, name: named.name } };
}
