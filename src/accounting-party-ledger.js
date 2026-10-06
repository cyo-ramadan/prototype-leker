// Sub-buku "atas nama siapa" untuk akun piutang & hutang (Bos Cyo, 2026-10-05:
// "piutang dan hutang wajib kasih nama"). Migration 0138.
//
// Kenapa ada: saldo setoran per karyawan hidup di Operasional, sedangkan akuntan bisa memposting
// jurnal manual ke Piutang Karyawan tanpa menyebut orangnya -> saldo akun dan saldo per karyawan
// tidak sinkron. Aturannya: jurnal MANUAL yang menyentuh akun di PARTY_RULES wajib menyebut pihak
// pada baris itu. Server menolak kalau kosong; UI menyediakan pemilih nama.
//
// Tabel accounting_party_entries hanya MENAMBAH label nama pada baris jurnal -- jurnal posted tidak
// diubah (invariant #2). Ditulis dalam batch yang sama dengan jurnalnya, jadi tidak mungkin ada
// jurnal manual tanpa nama yang lolos lewat jalur ini.

import { ACCOUNTING_AMOUNT_SCALE } from './accounting-ledger.js';

const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);

// EMPLOYEE  : harus karyawan terdaftar (atau pemegang akun kasir yang belum ditautkan, `cashier:<id>`)
//             supaya nyambung dengan saldo setoran / gaji per karyawan.
// SUPPLIER  : pemasok terdaftar di gerai, atau nama bebas kalau pemasoknya belum terdaftar.
// NAME      : nama bebas (minimal 2 huruf).
export const PARTY_RULES = Object.freeze({
  '1202': { kind: 'EMPLOYEE', label: 'karyawan' },
  '2102': { kind: 'EMPLOYEE', label: 'karyawan' },
  '2101': { kind: 'SUPPLIER', label: 'pemasok' },
  '1201': { kind: 'NAME', label: 'nama pelanggan' },
  '2103': { kind: 'NAME', label: 'nama pihak' }
});

const CASHIER_HOLDER_PREFIX = 'cashier:';

function failure(code, error, status = 400) {
  return { ok: false, status, code, error };
}

async function accountCodes(db, storeId, accountIds) {
  const unique = [...new Set(accountIds.filter(Boolean))];
  const byId = new Map();
  for (let offset = 0; offset < unique.length; offset += 50) {
    const chunk = unique.slice(offset, offset + 50);
    const rows = await db.prepare(`
      SELECT id, code, name FROM chart_of_accounts
      WHERE store_id = ? AND id IN (${chunk.map(() => '?').join(',')})
    `).bind(storeId, ...chunk).all();
    for (const row of rows.results ?? []) byId.set(row.id, { code: row.code, name: row.name });
  }
  return byId;
}

async function resolveEmployee(db, store, employeeId) {
  if (employeeId.startsWith(CASHIER_HOLDER_PREFIX)) {
    const cashierId = employeeId.slice(CASHIER_HOLDER_PREFIX.length);
    const row = await db.prepare(`
      SELECT employee_name, username FROM cashiers WHERE id = ? AND store_id = ? LIMIT 1
    `).bind(cashierId, store.id).first();
    if (!row) return null;
    return { employeeId, name: text(row.employee_name || row.username, 120) };
  }
  if (!store.entityId) return null;
  const row = await db.prepare(`
    SELECT id, full_name FROM employees WHERE id = ? AND entity_id = ? AND status = 'ACTIVE' LIMIT 1
  `).bind(employeeId, store.entityId).first();
  return row ? { employeeId: row.id, name: text(row.full_name, 120) } : null;
}

// Validasi nama pihak pada baris-baris jurnal manual. Hasil: `parties` sejajar dengan journalLines
// (null = baris itu tidak butuh nama).
export async function prepareJournalParties(db, store, journalLines) {
  if (!Array.isArray(journalLines)) return { ok: true, parties: [] };
  const accounts = await accountCodes(db, store.id, journalLines.map(line => text(line?.accountId, 180)));
  const parties = [];
  for (let index = 0; index < journalLines.length; index += 1) {
    const line = journalLines[index] || {};
    const account = accounts.get(text(line.accountId, 180));
    const rule = account ? PARTY_RULES[account.code] : null;
    if (!rule) { parties.push(null); continue; }
    const where = `Baris ${index + 1} (${account.code} ${account.name})`;
    const given = line.party && typeof line.party === 'object' ? line.party : {};
    const employeeId = text(given.employeeId, 180);
    const supplierId = text(given.supplierId, 180);
    const name = text(given.name, 120);

    if (rule.kind === 'EMPLOYEE') {
      if (!employeeId) return failure('PARTY_REQUIRED', `${where} wajib memilih nama karyawan. Saldo per karyawan harus sinkron dengan buku.`);
      const employee = await resolveEmployee(db, store, employeeId);
      if (!employee) return failure('PARTY_INVALID', `${where}: karyawan tidak ditemukan / tidak aktif di entity ini.`);
      parties.push({ type: 'EMPLOYEE', employeeId: employee.employeeId, supplierId: null, name: employee.name });
      continue;
    }
    if (rule.kind === 'SUPPLIER') {
      if (supplierId) {
        const supplier = await db.prepare(`
          SELECT id, name FROM suppliers WHERE id = ? AND store_id = ? LIMIT 1
        `).bind(supplierId, store.id).first();
        if (!supplier) return failure('PARTY_INVALID', `${where}: pemasok tidak ditemukan di gerai ini.`);
        parties.push({ type: 'SUPPLIER', employeeId: null, supplierId: supplier.id, name: text(supplier.name, 120) });
        continue;
      }
      if (name.length < 2) return failure('PARTY_REQUIRED', `${where} wajib memilih pemasok (atau mengisi nama pihak yang berhutang).`);
      parties.push({ type: 'OTHER', employeeId: null, supplierId: null, name });
      continue;
    }
    if (name.length < 2) return failure('PARTY_REQUIRED', `${where} wajib diisi ${rule.label}.`);
    parties.push({ type: 'OTHER', employeeId: null, supplierId: null, name });
  }
  return { ok: true, parties };
}

// Statement INSERT sub-buku, dipasang ke batch posting jurnal (lihat `extraStatements` di
// postAccountingJournal) supaya jurnal dan namanya tersimpan atomik.
export function partyEntryStatements(db, store, { journalId, businessDate, lines }, parties, actor = {}) {
  const statements = [];
  lines.forEach((line, index) => {
    const party = parties[index];
    if (!party) return;
    const lineId = `${journalId}:L${String(index + 1).padStart(3, '0')}`;
    statements.push(db.prepare(`
      INSERT INTO accounting_party_entries (
        id, store_id, entity_id, journal_id, journal_line_id, account_id, account_code,
        party_type, employee_id, supplier_id, party_name, side, amount_scaled,
        business_date, description, created_by_role, created_by_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, (SELECT code FROM chart_of_accounts WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `party_${lineId}`, store.id, store.entityId ?? null, journalId, lineId, line.accountId, line.accountId,
      party.type, party.employeeId, party.supplierId, party.name, line.side, line.amountScaled,
      businessDate, text(line.description, 240), actor.role || '', actor.id || '', new Date().toISOString()
    ));
  });
  return statements;
}

// Pilihan nama untuk form jurnal manual: karyawan entity, pemegang akun kasir yang belum ditautkan
// (yang punya piutang setoran), dan pemasok gerai.
export async function listPartyOptions(db, store) {
  const [employees, holders, suppliers] = await Promise.all([
    store.entityId
      ? db.prepare(`SELECT id, full_name FROM employees WHERE entity_id = ? AND status = 'ACTIVE' ORDER BY full_name COLLATE NOCASE`).bind(store.entityId).all()
      : { results: [] },
    db.prepare(`
      SELECT DISTINCT counterparty_id, counterparty_name_snapshot AS name
      FROM operational_receivables_payables
      WHERE store_id = ? AND source_type = 'EMPLOYEE_DEPOSIT' AND counterparty_id LIKE 'cashier:%'
      ORDER BY name COLLATE NOCASE
    `).bind(store.id).all(),
    db.prepare(`SELECT id, name FROM suppliers WHERE store_id = ? AND is_active = 1 ORDER BY name COLLATE NOCASE`).bind(store.id).all()
  ]);
  return {
    employees: [
      ...(employees.results ?? []).map(row => ({ id: row.id, name: row.full_name })),
      ...(holders.results ?? []).map(row => ({ id: row.counterparty_id, name: `${row.name} (akun kasir)` }))
    ],
    suppliers: (suppliers.results ?? []).map(row => ({ id: row.id, name: row.name })),
    rules: Object.fromEntries(Object.entries(PARTY_RULES).map(([code, rule]) => [code, rule.kind]))
  };
}

// Mutasi manual (jurnal Akuntansi) pada Piutang Karyawan 1202, dikelompokkan per karyawan.
// Positif = karyawan makin berhutang ke perusahaan (Debit 1202); negatif = berkurang (Kredit 1202).
export async function manualReceivableByEmployee(db, storeId) {
  const rows = await db.prepare(`
    SELECT e.employee_id, e.party_name AS name, h.journal_number, e.journal_id, e.business_date, e.side,
           e.amount_scaled, e.description
    FROM accounting_party_entries e
    JOIN accounting_journal_headers h ON h.id = e.journal_id
    WHERE e.store_id = ? AND e.account_code = '1202' AND e.employee_id IS NOT NULL AND h.journal_status = 'POSTED'
    ORDER BY e.business_date DESC, h.journal_number DESC
  `).bind(storeId).all();
  const byEmployee = new Map();
  for (const row of rows.results ?? []) {
    const signed = (row.side === 'DEBIT' ? 1 : -1) * Number(row.amount_scaled);
    const entry = byEmployee.get(row.employee_id) || { employeeId: row.employee_id, name: row.name, netScaled: 0, entries: [] };
    entry.netScaled += signed;
    entry.entries.push({
      journalId: row.journal_id,
      journalNumber: row.journal_number,
      businessDate: row.business_date,
      side: row.side,
      amountScaled: Number(row.amount_scaled),
      signedScaled: signed,
      description: row.description || ''
    });
    byEmployee.set(row.employee_id, entry);
  }
  return byEmployee;
}

// Jurnal yang sub-bukunya hidup di setoran CS (Operasional): pengakuan & pelunasan setoran, dan
// pembayaran hutang yang memakai uang setoran CS (Dr Utang / Cr 1202, migration 0139) beserta
// pembatalannya. Semuanya tercermin di saldo setoran per karyawan.
function isSetoranJournal(row) {
  if (row.source_system === 'EMPLOYEE_DEPOSIT') return true;
  const ref = String(row.source_reference_id || '');
  return (row.source_system === 'LEKER_ADMIN' && ref.startsWith('BAYAR_HUTANG:'))
    || (row.source_system === 'LEKER_ADMIN_VOID' && ref.startsWith('VOID:BAYAR_HUTANG:'));
}

export const scaledToSignedRupiah = scaled => Number(scaled) / ACCOUNTING_AMOUNT_SCALE;

// Pemeriksaan sinkron: untuk tiap akun piutang/hutang bernama, pecah saldo buku besar menjadi
//   - bernama   : baris jurnal manual yang punya nama pihak (sub-buku ini),
//   - setoran   : jurnal otomatis setoran CS (sub-bukunya hidup di Operasional),
//   - belum bernama : sisanya -> ini yang harus dibereskan (jurnal lama, atau otomatis lain).
// Saldo dihitung dalam sisi normal akun (aset = Debit-Kredit, kewajiban = Kredit-Debit).
export async function getPartyReconciliation(db, store, { listLimit = 50 } = {}) {
  const codes = Object.keys(PARTY_RULES);
  const accounts = await db.prepare(`
    SELECT id, code, name, type FROM chart_of_accounts
    WHERE store_id = ? AND is_active = 1 AND code IN (${codes.map(() => '?').join(',')})
    ORDER BY code
  `).bind(store.id, ...codes).all();

  const result = [];
  for (const account of accounts.results ?? []) {
    const normalSign = account.type === 'ASSET' ? 1 : -1;
    const lines = await db.prepare(`
      SELECT h.id AS journal_id, h.journal_number, h.business_date, h.source_system, h.source_reference_id, h.description,
             l.id AS line_id, l.side, l.amount_scaled,
             p.party_name
      FROM accounting_journal_lines l
      JOIN accounting_journal_headers h ON h.id = l.journal_id AND h.store_id = l.store_id
      LEFT JOIN accounting_party_entries p ON p.journal_line_id = l.id
      WHERE l.store_id = ? AND l.account_id = ? AND h.journal_status = 'POSTED'
      ORDER BY h.business_date DESC, h.journal_number DESC
    `).bind(store.id, account.id).all();

    let glScaled = 0;
    let namedScaled = 0;
    let setoranScaled = 0;
    let unnamedScaled = 0;
    const unnamedItems = [];
    const byParty = new Map();
    for (const row of lines.results ?? []) {
      const signed = (row.side === 'DEBIT' ? 1 : -1) * normalSign * Number(row.amount_scaled);
      glScaled += signed;
      if (row.party_name) {
        namedScaled += signed;
        byParty.set(row.party_name, (byParty.get(row.party_name) || 0) + signed);
      } else if (account.code === '1202' && isSetoranJournal(row)) {
        setoranScaled += signed;
      } else {
        unnamedScaled += signed;
        if (unnamedItems.length < listLimit) {
          unnamedItems.push({
            journalId: row.journal_id,
            journalNumber: row.journal_number,
            businessDate: row.business_date,
            sourceSystem: row.source_system,
            description: row.description,
            side: row.side,
            amountScaled: Number(row.amount_scaled),
            signedScaled: signed
          });
        }
      }
    }
    for (const value of [glScaled, namedScaled, setoranScaled, unnamedScaled]) {
      if (!Number.isSafeInteger(value)) throw new Error('PARTY_RECONCILIATION_OVERFLOW');
    }
    result.push({
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      requires: PARTY_RULES[account.code].kind,
      glBalanceScaled: glScaled,
      namedScaled,
      setoranScaled,
      unnamedScaled,
      glBalanceRupiah: scaledToSignedRupiah(glScaled),
      namedRupiah: scaledToSignedRupiah(namedScaled),
      setoranRupiah: scaledToSignedRupiah(setoranScaled),
      unnamedRupiah: scaledToSignedRupiah(unnamedScaled),
      inSync: unnamedScaled === 0 && unnamedItems.length === 0,
      unnamedItems,
      parties: [...byParty.entries()].map(([name, scaled]) => ({ name, balanceScaled: scaled, balanceRupiah: scaledToSignedRupiah(scaled) }))
        .sort((a, b) => a.name.localeCompare(b.name))
    });
  }

  // Sub-buku setoran (Operasional) vs jurnal setoran di buku besar: selisih = setoran yang belum/gagal terjurnal.
  const operational = await db.prepare(`
    SELECT COALESCE(SUM(r.original_amount), 0) AS original_amount,
           COALESCE(SUM((SELECT COALESCE(SUM(p.amount), 0) FROM operational_receivable_payable_payments p
                         WHERE p.receivable_payable_id = r.id AND p.store_id = r.store_id AND p.approval_status = 'approved')), 0) AS paid_amount
    FROM operational_receivables_payables r
    WHERE r.store_id = ? AND r.source_type = 'EMPLOYEE_DEPOSIT'
  `).bind(store.id).first();
  const setoranOperationalScaled = Number(operational?.original_amount || 0) - Number(operational?.paid_amount || 0);
  const piutang = result.find(row => row.accountCode === '1202');
  const setoran = piutang
    ? {
        operationalScaled: setoranOperationalScaled,
        operationalRupiah: scaledToSignedRupiah(setoranOperationalScaled),
        ledgerScaled: piutang.setoranScaled,
        ledgerRupiah: scaledToSignedRupiah(piutang.setoranScaled),
        differenceScaled: setoranOperationalScaled - piutang.setoranScaled,
        differenceRupiah: scaledToSignedRupiah(setoranOperationalScaled - piutang.setoranScaled),
        inSync: setoranOperationalScaled === piutang.setoranScaled
      }
    : null;

  return {
    accounts: result,
    setoran,
    allInSync: result.every(row => row.inSync) && (setoran ? setoran.inSync : true)
  };
}
