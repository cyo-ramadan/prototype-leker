import { getAccountingJournal, postAccountingJournal } from './accounting-ledger.js';
import { getJakartaBusinessDate } from './time.js';
import { prepareJournalParties } from './accounting-party-ledger.js';

// ADR-049, Bos Cyo 2026-09-28: "Pembuat & Split Jurnal Beban" -- mengganti pekerjaan
// akuntan manusia. Satu mesin jadwal dipakai untuk dua fitur:
//   - RECURRING: beban berulang (Beban Lapak, Listrik, WiFi, dst), tanpa batas kemunculan
//     sampai dimatikan. Bisa auto-post atau menunggu konfirmasi admin (per template).
//   - SPLIT: satu jurnal yang sudah ada dipecah jadi beban harian merata selama periode
//     manfaatnya. Jumlah kemunculan tetap (hari-hari dalam rentang), selalu auto-post
//     (keputusannya sudah diambil sekali waktu "Buat Split" diklik).
//
// Posting SELALU lewat postAccountingJournal() -- modul ini TIDAK PERNAH INSERT
// langsung ke accounting_journal_headers/lines (invariant #4). Jurnal sumber Split
// tidak pernah disentuh/diubah (invariant #2).
//
// Tanpa cron/Durable Object: dicek lazy tiap bootstrap Akuntansi dibuka, pola yang
// sama dengan forceCloseOverdueSessions (src/staff-attendance.js).

export const ACCOUNTING_SCHEDULE_CONTRACT = 'MAXI_ACCOUNTING_JOURNAL_SCHEDULE_V1';

const RECURRENCE_TYPES = Object.freeze(['DAILY', 'WEEKLY_ON_DAY', 'MONTHLY_ON_DAY']);
const SCALE = 1_000_000;
// Batas jaga-jaga: kalau satu schedule sudah lama tidak dibuka (mis. berbulan-bulan),
// jangan sekaligus menggenjot ratusan posting dalam satu request bootstrap -- itu
// bisa membuat satu request jadi sangat berat/lambat. Sisanya akan menyusul lengkap
// dengan sendirinya di bootstrap-bootstrap berikutnya (mengejar sedikit demi sedikit).
const MAX_CATCH_UP_PER_SCHEDULE_PER_CALL = 90;

const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function positiveScaledFromRupiah(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  const scaled = number * SCALE;
  return Number.isSafeInteger(scaled) ? scaled : null;
}

function daysInMonthUTC(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function addDaysISO(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function daysBetweenInclusive(startStr, endStr) {
  const [ys, ms, ds] = startStr.split('-').map(Number);
  const [ye, me, de] = endStr.split('-').map(Number);
  const start = Date.UTC(ys, ms - 1, ds);
  const end = Date.UTC(ye, me - 1, de);
  return Math.round((end - start) / 86400000) + 1;
}

// Tanggal kemunculan berikutnya SESUDAH `fromDate`, mengikuti pola perulangan.
// MONTHLY_ON_DAY di-clamp ke jumlah hari bulan tujuan (tanggal 31 di Februari -> 28/29).
function advanceDate(fromDate, recurrenceType, recurrenceValue) {
  if (recurrenceType === 'DAILY') return addDaysISO(fromDate, 1);
  if (recurrenceType === 'WEEKLY_ON_DAY') return addDaysISO(fromDate, 7);
  const [y, m] = fromDate.split('-').map(Number);
  let year = y;
  let month = m + 1;
  if (month > 12) { month = 1; year += 1; }
  const day = Math.min(recurrenceValue || Number(fromDate.split('-')[2]), daysInMonthUTC(year, month - 1));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function activeAccountOfType(db, storeId, accountId, expectedTypes) {
  const row = await db.prepare(`
    SELECT id, code, name, type FROM chart_of_accounts WHERE id = ? AND store_id = ? AND is_active = 1
  `).bind(accountId, storeId).first();
  if (!row) return null;
  if (expectedTypes && !expectedTypes.includes(row.type)) return null;
  return row;
}

function scheduleRowToObject(row) {
  return {
    scheduleId: row.id,
    kind: row.kind,
    name: row.name,
    debitAccountId: row.debit_account_id,
    creditAccountId: row.credit_account_id,
    amountScaled: row.amount_scaled === null ? null : Number(row.amount_scaled),
    totalAmountScaled: row.total_amount_scaled === null ? null : Number(row.total_amount_scaled),
    startDate: row.start_date,
    endDate: row.end_date || null,
    recurrenceType: row.recurrence_type,
    recurrenceValue: Number(row.recurrence_value || 0),
    totalOccurrences: row.total_occurrences === null ? null : Number(row.total_occurrences),
    autoCreate: Boolean(row.auto_create),
    sourceJournalId: row.source_journal_id || null,
    occurrencesGenerated: Number(row.occurrences_generated || 0),
    lastGeneratedDate: row.last_generated_date || null,
    isActive: Boolean(row.is_active)
  };
}

function occurrenceRowToObject(row) {
  return {
    occurrenceId: row.id,
    scheduleId: row.schedule_id,
    occurrenceDate: row.occurrence_date,
    amountScaled: Number(row.amount_scaled),
    status: row.status,
    journalId: row.journal_id || null
  };
}

export async function createRecurringSchedule(db, store, input) {
  const name = text(input?.name, 100);
  const amountScaled = positiveScaledFromRupiah(input?.amount);
  const startDate = text(input?.startDate, 10);
  const endDate = input?.endDate ? text(input.endDate, 10) : null;
  const recurrenceType = text(input?.recurrenceType, 20).toUpperCase();
  let recurrenceValue = Number(input?.recurrenceValue);
  if (!name) return { ok: false, status: 400, code: 'SCHEDULE_NAME_REQUIRED', error: 'Nama beban wajib diisi.' };
  if (!amountScaled) return { ok: false, status: 400, code: 'SCHEDULE_AMOUNT_INVALID', error: 'Nominal wajib bilangan bulat positif.' };
  if (!isValidDate(startDate)) return { ok: false, status: 400, code: 'SCHEDULE_START_DATE_INVALID', error: 'Tanggal mulai tidak valid.' };
  if (endDate && (!isValidDate(endDate) || endDate < startDate)) return { ok: false, status: 400, code: 'SCHEDULE_END_DATE_INVALID', error: 'Tanggal akhir tidak valid.' };
  if (!RECURRENCE_TYPES.includes(recurrenceType)) return { ok: false, status: 400, code: 'SCHEDULE_RECURRENCE_INVALID', error: 'Pola perulangan tidak valid.' };
  if (recurrenceType === 'MONTHLY_ON_DAY') {
    if (!Number.isInteger(recurrenceValue) || recurrenceValue < 1 || recurrenceValue > 31) recurrenceValue = Number(startDate.split('-')[2]);
  } else if (recurrenceType === 'WEEKLY_ON_DAY') {
    if (!Number.isInteger(recurrenceValue) || recurrenceValue < 0 || recurrenceValue > 6) {
      recurrenceValue = new Date(`${startDate}T00:00:00Z`).getUTCDay();
    }
  } else {
    recurrenceValue = 0;
  }
  const debitAccount = await activeAccountOfType(db, store.id, text(input?.debitAccountId, 180), ['EXPENSE']);
  if (!debitAccount) return { ok: false, status: 400, code: 'DEBIT_ACCOUNT_INVALID', error: 'Akun Beban wajib akun EXPENSE aktif.' };
  const creditAccount = await activeAccountOfType(db, store.id, text(input?.creditAccountId, 180), null);
  if (!creditAccount) return { ok: false, status: 400, code: 'CREDIT_ACCOUNT_INVALID', error: 'Akun Lawan wajib akun aktif.' };
  if (creditAccount.id === debitAccount.id) return { ok: false, status: 400, code: 'SCHEDULE_ACCOUNTS_SAME', error: 'Akun Beban dan Akun Lawan tidak boleh sama.' };

  const id = `sched_${store.id}_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO accounting_journal_schedules (
      id, store_id, kind, name, debit_account_id, credit_account_id, amount_scaled,
      start_date, end_date, recurrence_type, recurrence_value, auto_create
    ) VALUES (?, ?, 'RECURRING', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, store.id, name, debitAccount.id, creditAccount.id, amountScaled, startDate, endDate, recurrenceType, recurrenceValue, input?.autoCreate ? 1 : 0).run();
  return { ok: true, scheduleId: id };
}

export async function updateRecurringSchedule(db, store, scheduleId, input) {
  const current = await db.prepare(`SELECT * FROM accounting_journal_schedules WHERE id = ? AND store_id = ? AND kind = 'RECURRING'`).bind(scheduleId, store.id).first();
  if (!current) return { ok: false, status: 404, code: 'SCHEDULE_NOT_FOUND', error: 'Beban Rutin tidak ditemukan.' };
  const name = input?.name === undefined ? current.name : text(input.name, 100);
  const amountScaled = input?.amount === undefined ? Number(current.amount_scaled) : positiveScaledFromRupiah(input.amount);
  const autoCreate = input?.autoCreate === undefined ? Number(current.auto_create) : (input.autoCreate ? 1 : 0);
  const isActive = input?.isActive === undefined ? Number(current.is_active) : (input.isActive ? 1 : 0);
  if (!name) return { ok: false, status: 400, code: 'SCHEDULE_NAME_REQUIRED', error: 'Nama beban wajib diisi.' };
  if (!amountScaled) return { ok: false, status: 400, code: 'SCHEDULE_AMOUNT_INVALID', error: 'Nominal wajib bilangan bulat positif.' };
  await db.prepare(`
    UPDATE accounting_journal_schedules SET name = ?, amount_scaled = ?, auto_create = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND store_id = ?
  `).bind(name, amountScaled, autoCreate, isActive, scheduleId, store.id).run();
  return { ok: true, scheduleId };
}

// SPLIT hanya ditawarkan untuk jurnal sederhana: persis 2 baris, salah satunya
// DEBIT ke akun bertipe ASSET (uang muka/deposit/dibayar dimuka). Bentuk lain
// (lebih dari 2 baris, atau tidak ada sisi ASSET) berisiko salah tafsir akuntansi
// kalau dipaksakan otomatis -- ADR-049 bagian 5.
export function splitEligibility(journal) {
  if (!journal || !Array.isArray(journal.lines) || journal.lines.length !== 2) {
    return { eligible: false, reason: 'Split hanya untuk jurnal dengan persis 2 baris.' };
  }
  const assetDebitLine = journal.lines.find(line => line.side === 'DEBIT' && line.accountType === 'ASSET');
  if (!assetDebitLine) {
    return { eligible: false, reason: 'Split perlu satu sisi Debit ke akun ASSET (uang muka/deposit/dibayar dimuka).' };
  }
  return { eligible: true, assetLine: assetDebitLine };
}

// Pembagian exact: semua hari kecuali terakhir dapat pembagian genap (dibulatkan ke bawah), sisanya
// ditambahkan ke hari TERAKHIR -- bukan dibiarkan hilang, bukan lewat akun Penyesuaian (invariant #1
// dan #3: uang integer, tanpa toleransi untuk hasil algoritma sendiri).
// unitScaled: satuan pembagian. Split lama membagi exact sampai 6 desimal (unit 1); Jurnal Split baru
// membagi per rupiah utuh (unit SCALE) supaya nominal harian sama dengan pratinjau di form.
function splitShares(totalAmountScaled, totalDays, unitScaled = 1) {
  const baseShare = Math.floor(totalAmountScaled / totalDays / unitScaled) * unitScaled;
  return { baseShare, lastShare: totalAmountScaled - baseShare * (totalDays - 1) };
}

function splitRange(input) {
  const startDate = text(input?.startDate, 10);
  const endDate = text(input?.endDate, 10);
  if (!isValidDate(startDate) || !isValidDate(endDate) || endDate < startDate) {
    return { ok: false, status: 400, code: 'SPLIT_DATE_RANGE_INVALID', error: 'Rentang tanggal split tidak valid.' };
  }
  const totalDays = daysBetweenInclusive(startDate, endDate);
  if (totalDays < 1 || totalDays > 1096) { // ~3 tahun, pagar akal sehat
    return { ok: false, status: 400, code: 'SPLIT_RANGE_TOO_LONG', error: 'Rentang tanggal split terlalu panjang.' };
  }
  return { ok: true, startDate, endDate, totalDays };
}

function occurrenceStatements(db, store, scheduleId, { startDate, totalDays, baseShare, lastShare }) {
  const statements = [];
  for (let i = 0; i < totalDays; i += 1) {
    statements.push(db.prepare(`
      INSERT INTO accounting_journal_schedule_occurrences (id, schedule_id, store_id, occurrence_date, amount_scaled)
      VALUES (?, ?, ?, ?, ?)
    `).bind(`occ_${scheduleId}_${i}`, scheduleId, store.id, addDaysISO(startDate, i), i === totalDays - 1 ? lastShare : baseShare));
  }
  return statements;
}

// Bos Cyo, 2026-10-13: "entry baru tapi di split langsung ... ini untuk semua akun." Jurnal Split
// tanpa jurnal sumber: akun debit & kredit bebas (semua akun aktif, harus berbeda), total dibagi rata
// per hari pada rentang tanggal. Hari yang sudah tiba langsung diposting; hari berikutnya diposting
// otomatis saat tanggalnya tiba (lazy catch-up yang sama dengan Split/Beban Rutin, ADR-049). Akun
// hutang/piutang per orang wajib "atas nama" (sama dengan jurnal manual) dan nama itu ikut di setiap
// jurnal hariannya (migration 0154).
export async function createDirectSplit(db, store, input, { today = getJakartaBusinessDate() } = {}) {
  const name = text(input?.name, 100);
  if (!name) return { ok: false, status: 400, code: 'SPLIT_NAME_REQUIRED', error: 'Keterangan jurnal wajib diisi.' };
  const totalAmountScaled = positiveScaledFromRupiah(input?.totalAmount);
  if (!totalAmountScaled) return { ok: false, status: 400, code: 'SPLIT_AMOUNT_INVALID', error: 'Total wajib bilangan bulat rupiah positif.' };
  const range = splitRange(input);
  if (!range.ok) return range;
  const debitAccount = await activeAccountOfType(db, store.id, text(input?.debitAccountId, 180), null);
  const creditAccount = await activeAccountOfType(db, store.id, text(input?.creditAccountId, 180), null);
  if (!debitAccount || !creditAccount) return { ok: false, status: 400, code: 'SPLIT_ACCOUNT_INVALID', error: 'Akun Debit dan Kredit wajib akun aktif gerai ini.' };
  if (debitAccount.id === creditAccount.id) return { ok: false, status: 400, code: 'SPLIT_ACCOUNT_SAME', error: 'Akun Debit dan Kredit harus berbeda.' };
  const prepared = await prepareJournalParties(db, store, [
    { accountId: debitAccount.id, party: input?.debitParty },
    { accountId: creditAccount.id, party: input?.creditParty }
  ]);
  if (!prepared.ok) return prepared;
  const [debitParty, creditParty] = prepared.parties;
  if (totalAmountScaled < range.totalDays * SCALE) {
    return { ok: false, status: 400, code: 'SPLIT_AMOUNT_TOO_SMALL', error: 'Total terlalu kecil untuk dibagi ke semua hari (minimal Rp1 per hari).' };
  }
  const { baseShare, lastShare } = splitShares(totalAmountScaled, range.totalDays, SCALE);
  const scheduleId = `sched_${store.id}_${crypto.randomUUID()}`;
  await db.batch([
    db.prepare(`
      INSERT INTO accounting_journal_schedules (
        id, store_id, kind, name, debit_account_id, credit_account_id, total_amount_scaled,
        start_date, end_date, recurrence_type, recurrence_value, total_occurrences,
        auto_create, source_journal_id, debit_party_json, credit_party_json
      ) VALUES (?, ?, 'SPLIT', ?, ?, ?, ?, ?, ?, 'DAILY', 0, ?, 1, NULL, ?, ?)
    `).bind(
      scheduleId, store.id, name, debitAccount.id, creditAccount.id, totalAmountScaled,
      range.startDate, range.endDate, range.totalDays,
      debitParty ? JSON.stringify(debitParty) : null, creditParty ? JSON.stringify(creditParty) : null
    ),
    ...occurrenceStatements(db, store, scheduleId, { startDate: range.startDate, totalDays: range.totalDays, baseShare, lastShare })
  ]);
  const processed = await processDueSchedules(db, store, { today });
  const postedNow = processed.posted.filter(row => row.scheduleId === scheduleId).length;
  const failed = processed.failed.find(row => row.scheduleId === scheduleId) || null;
  return {
    ok: true,
    scheduleId,
    totalDays: range.totalDays,
    totalAmountScaled,
    perDayAmountScaled: baseShare,
    lastDayAmountScaled: lastShare,
    postedNow,
    waiting: range.totalDays - postedNow,
    failure: failed ? { code: failed.code, error: failed.error } : null
  };
}

export async function createSplitPlan(db, store, input) {
  const sourceJournalId = text(input?.sourceJournalId, 180);
  const journal = sourceJournalId ? await getAccountingJournal(db, store.id, sourceJournalId) : null;
  if (!journal) return { ok: false, status: 404, code: 'SOURCE_JOURNAL_NOT_FOUND', error: 'Jurnal sumber tidak ditemukan.' };
  const existing = await db.prepare(`SELECT id FROM accounting_journal_schedules WHERE source_journal_id = ? AND store_id = ?`).bind(sourceJournalId, store.id).first();
  if (existing) return { ok: false, status: 409, code: 'SOURCE_JOURNAL_ALREADY_SPLIT', error: 'Jurnal ini sudah pernah di-split.' };
  const eligibility = splitEligibility(journal);
  if (!eligibility.eligible) return { ok: false, status: 400, code: 'SOURCE_JOURNAL_NOT_ELIGIBLE', error: eligibility.reason };

  const startDate = text(input?.startDate, 10);
  const endDate = text(input?.endDate, 10);
  if (!isValidDate(startDate) || !isValidDate(endDate) || endDate < startDate) {
    return { ok: false, status: 400, code: 'SPLIT_DATE_RANGE_INVALID', error: 'Rentang tanggal split tidak valid.' };
  }
  const totalDays = daysBetweenInclusive(startDate, endDate);
  if (totalDays < 1 || totalDays > 1096) { // ~3 tahun, pagar akal sehat
    return { ok: false, status: 400, code: 'SPLIT_RANGE_TOO_LONG', error: 'Rentang tanggal split terlalu panjang.' };
  }

  const expenseAccount = await activeAccountOfType(db, store.id, text(input?.expenseAccountId, 180), ['EXPENSE']);
  if (!expenseAccount) return { ok: false, status: 400, code: 'EXPENSE_ACCOUNT_INVALID', error: 'Akun Beban wajib akun EXPENSE aktif.' };
  const contraAccountId = text(input?.contraAccountId, 180) || eligibility.assetLine.accountId;
  const contraAccount = await activeAccountOfType(db, store.id, contraAccountId, null);
  if (!contraAccount) return { ok: false, status: 400, code: 'CONTRA_ACCOUNT_INVALID', error: 'Akun Lawan wajib akun aktif.' };

  const totalAmountScaled = eligibility.assetLine.amountScaled;
  const { baseShare, lastShare } = splitShares(totalAmountScaled, totalDays);

  const scheduleId = `sched_${store.id}_${crypto.randomUUID()}`;
  const statements = [
    db.prepare(`
      INSERT INTO accounting_journal_schedules (
        id, store_id, kind, name, debit_account_id, credit_account_id, total_amount_scaled,
        start_date, end_date, recurrence_type, recurrence_value, total_occurrences,
        auto_create, source_journal_id
      ) VALUES (?, ?, 'SPLIT', ?, ?, ?, ?, ?, ?, 'DAILY', 0, ?, 1, ?)
    `).bind(
      scheduleId, store.id, text(input?.name, 100) || `Split ${journal.description}`, expenseAccount.id, contraAccount.id,
      totalAmountScaled, startDate, endDate, totalDays, sourceJournalId
    )
  ];
  statements.push(...occurrenceStatements(db, store, scheduleId, { startDate, totalDays, baseShare, lastShare }));
  await db.batch(statements);
  return { ok: true, scheduleId, totalDays, totalAmountScaled, perDayAmountScaled: baseShare, lastDayAmountScaled: lastShare };
}

function parseParty(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

async function postOccurrence(db, store, schedule, occurrence, businessDate) {
  const description = schedule.kind === 'SPLIT'
    ? `${schedule.name} · hari ${occurrence.occurrence_date}`
    : `${schedule.name} (${occurrence.occurrence_date})`;
  const sourceReferenceId = `schedule_${schedule.id}_${occurrence.occurrence_date}`;
  const result = await postAccountingJournal(db, store, {
    businessDate,
    occurredAt: new Date().toISOString(),
    sourceSystem: 'ACCOUNTING_SCHEDULE',
    sourceReferenceId,
    correlationId: schedule.id,
    idempotencyKey: `ACCOUNTING_SCHEDULE:${store.id}:${schedule.id}:${occurrence.occurrence_date}`,
    description,
    journalLines: [
      { accountId: schedule.debit_account_id, side: 'DEBIT', amountScaled: occurrence.amount_scaled, description },
      { accountId: schedule.credit_account_id, side: 'CREDIT', amountScaled: occurrence.amount_scaled, description }
    ],
    // "Atas nama" per sisi (migration 0154) -- jurnal harian akun hutang/piutang ikut bernama.
    lineParties: [parseParty(schedule.debit_party_json), parseParty(schedule.credit_party_json)]
  });
  if (result?.ok === false) return result;
  const journalId = result.journal?.journalId;
  await db.batch([
    db.prepare(`UPDATE accounting_journal_schedule_occurrences SET status = 'POSTED', journal_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(journalId, occurrence.id),
    db.prepare(`
      UPDATE accounting_journal_schedules
      SET occurrences_generated = occurrences_generated + 1, last_generated_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(occurrence.occurrence_date, schedule.id)
  ]);
  return { ok: true, journalId };
}

// Lazy catch-up -- dipanggil dari bootstrap GET /api/admin/accounting. Tidak ada
// cron/scheduled worker; ini pola yang sama dengan forceCloseOverdueSessions.
export async function processDueSchedules(db, store, { today = getJakartaBusinessDate() } = {}) {
  const posted = [];
  const failed = [];
  const schedules = await db.prepare(`
    SELECT * FROM accounting_journal_schedules WHERE store_id = ? AND is_active = 1
  `).bind(store.id).all();

  for (const schedule of schedules.results ?? []) {
    if (schedule.kind === 'SPLIT') {
      const due = await db.prepare(`
        SELECT * FROM accounting_journal_schedule_occurrences
        WHERE schedule_id = ? AND status = 'PLANNED' AND occurrence_date <= ?
        ORDER BY occurrence_date ASC LIMIT ?
      `).bind(schedule.id, today, MAX_CATCH_UP_PER_SCHEDULE_PER_CALL).all();
      for (const occurrence of due.results ?? []) {
        const result = await postOccurrence(db, store, schedule, occurrence, occurrence.occurrence_date);
        if (result.ok) posted.push({ scheduleId: schedule.id, occurrenceId: occurrence.id, journalId: result.journalId });
        else { failed.push({ scheduleId: schedule.id, occurrenceId: occurrence.id, error: result.error, code: result.code }); break; }
      }
      const remaining = await db.prepare(`
        SELECT COUNT(*) AS n FROM accounting_journal_schedule_occurrences WHERE schedule_id = ? AND status = 'PLANNED'
      `).bind(schedule.id).first();
      if (Number(remaining?.n || 0) === 0) {
        await db.prepare(`UPDATE accounting_journal_schedules SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(schedule.id).run();
      }
      continue;
    }

    // RECURRING: hitung jatuh tempo berikutnya dari last_generated_date (atau
    // start_date kalau belum pernah), lalu maju sesuai pola perulangan.
    let cursor = schedule.last_generated_date || null;
    let nextDue = cursor ? advanceDate(cursor, schedule.recurrence_type, schedule.recurrence_value) : schedule.start_date;
    let iterations = 0;
    while (nextDue <= today && (!schedule.end_date || nextDue <= schedule.end_date) && iterations < MAX_CATCH_UP_PER_SCHEDULE_PER_CALL) {
      iterations += 1;
      let occurrence = await db.prepare(`
        SELECT * FROM accounting_journal_schedule_occurrences WHERE schedule_id = ? AND occurrence_date = ?
      `).bind(schedule.id, nextDue).first();
      if (!occurrence) {
        const occurrenceId = `occ_${schedule.id}_${nextDue}`;
        await db.prepare(`
          INSERT INTO accounting_journal_schedule_occurrences (id, schedule_id, store_id, occurrence_date, amount_scaled)
          VALUES (?, ?, ?, ?, ?)
        `).bind(occurrenceId, schedule.id, store.id, nextDue, schedule.amount_scaled).run();
        occurrence = { id: occurrenceId, schedule_id: schedule.id, occurrence_date: nextDue, amount_scaled: schedule.amount_scaled, status: 'PLANNED' };
      }
      if (occurrence.status !== 'PLANNED') { nextDue = advanceDate(nextDue, schedule.recurrence_type, schedule.recurrence_value); continue; }
      if (!schedule.auto_create) break; // menunggu admin klik "Buat Sekarang"/"Lewati" -- jangan buat baris berikutnya dulu
      const result = await postOccurrence(db, store, schedule, occurrence, nextDue);
      if (result.ok) {
        posted.push({ scheduleId: schedule.id, occurrenceId: occurrence.id, journalId: result.journalId });
        nextDue = advanceDate(nextDue, schedule.recurrence_type, schedule.recurrence_value);
      } else {
        failed.push({ scheduleId: schedule.id, occurrenceId: occurrence.id, error: result.error, code: result.code });
        break;
      }
    }
    if (schedule.end_date && nextDue > schedule.end_date) {
      await db.prepare(`UPDATE accounting_journal_schedules SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(schedule.id).run();
    }
  }
  return { posted, failed };
}

export async function postOccurrenceNow(db, store, occurrenceId) {
  const occurrence = await db.prepare(`SELECT * FROM accounting_journal_schedule_occurrences WHERE id = ? AND store_id = ?`).bind(occurrenceId, store.id).first();
  if (!occurrence) return { ok: false, status: 404, code: 'OCCURRENCE_NOT_FOUND', error: 'Rencana jurnal tidak ditemukan.' };
  if (occurrence.status !== 'PLANNED') return { ok: false, status: 409, code: 'OCCURRENCE_NOT_PLANNED', error: 'Rencana jurnal ini sudah diproses.' };
  const schedule = await db.prepare(`SELECT * FROM accounting_journal_schedules WHERE id = ? AND store_id = ?`).bind(occurrence.schedule_id, store.id).first();
  if (!schedule) return { ok: false, status: 404, code: 'SCHEDULE_NOT_FOUND', error: 'Jadwal tidak ditemukan.' };
  return postOccurrence(db, store, schedule, occurrence, occurrence.occurrence_date);
}

export async function skipOccurrenceNow(db, store, occurrenceId) {
  const occurrence = await db.prepare(`SELECT * FROM accounting_journal_schedule_occurrences WHERE id = ? AND store_id = ?`).bind(occurrenceId, store.id).first();
  if (!occurrence) return { ok: false, status: 404, code: 'OCCURRENCE_NOT_FOUND', error: 'Rencana jurnal tidak ditemukan.' };
  if (occurrence.status !== 'PLANNED') return { ok: false, status: 409, code: 'OCCURRENCE_NOT_PLANNED', error: 'Rencana jurnal ini sudah diproses.' };
  await db.batch([
    db.prepare(`UPDATE accounting_journal_schedule_occurrences SET status = 'SKIPPED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(occurrenceId),
    db.prepare(`
      UPDATE accounting_journal_schedules SET occurrences_generated = occurrences_generated + 1, last_generated_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(occurrence.occurrence_date, occurrence.schedule_id)
  ]);
  return { ok: true };
}

// --- Jurnal Split sebagai satu kesatuan (Bos Cyo, 2026-10-14) ------------------------------------------
// "split tanggal 1-7 aku pilih hapus maka hapusnya sudah semua jurnal di tanggal itu" + "jurnal ... tanggal
// lebih besar dari hari ini ... kasih pilihan, post sekarang?" Berlaku juga untuk split lama. Batas per
// panggilan supaya satu request tidak memposting ratusan jurnal; UI mengulang sampai `remaining` 0.
const SPLIT_BATCH_PER_CALL = 60;

async function splitSchedule(db, store, scheduleId) {
  return db.prepare(`SELECT * FROM accounting_journal_schedules WHERE id = ? AND store_id = ? AND kind = 'SPLIT'`)
    .bind(text(scheduleId, 200), store.id).first();
}

// Daftar semua Jurnal Split gerai beserta hitungan per status -- satu query agregat (tanpa subquery per baris,
// KNOWN_PITFALLS kuota baca D1).
export async function listSplitSchedules(db, storeId) {
  const [schedules, counts, accounts] = await Promise.all([
    db.prepare(`SELECT * FROM accounting_journal_schedules WHERE store_id = ? AND kind = 'SPLIT' ORDER BY created_at DESC LIMIT 200`).bind(storeId).all(),
    db.prepare(`
      SELECT o.schedule_id,
             SUM(CASE WHEN o.status = 'POSTED' THEN 1 ELSE 0 END) AS posted,
             SUM(CASE WHEN o.status = 'PLANNED' THEN 1 ELSE 0 END) AS planned,
             SUM(CASE WHEN o.status = 'SKIPPED' THEN 1 ELSE 0 END) AS skipped,
             SUM(CASE WHEN o.status = 'POSTED' AND EXISTS (
               SELECT 1 FROM accounting_journal_headers r WHERE r.store_id = o.store_id AND r.reversal_of_journal_id = o.journal_id
             ) THEN 1 ELSE 0 END) AS reversed
      FROM accounting_journal_schedule_occurrences o
      JOIN accounting_journal_schedules s ON s.id = o.schedule_id AND s.kind = 'SPLIT'
      WHERE o.store_id = ?
      GROUP BY o.schedule_id
    `).bind(storeId).all(),
    db.prepare(`SELECT id, code, name FROM chart_of_accounts WHERE store_id = ?`).bind(storeId).all()
  ]);
  const countById = new Map((counts.results ?? []).map(row => [row.schedule_id, row]));
  const accountById = new Map((accounts.results ?? []).map(row => [row.id, `${row.code} ${row.name}`]));
  return (schedules.results ?? []).map(row => {
    const count = countById.get(row.id) || {};
    return {
      ...scheduleRowToObject(row),
      debitAccountLabel: accountById.get(row.debit_account_id) || '',
      creditAccountLabel: accountById.get(row.credit_account_id) || '',
      debitPartyName: parseParty(row.debit_party_json)?.name || '',
      creditPartyName: parseParty(row.credit_party_json)?.name || '',
      postedCount: Number(count.posted || 0),
      plannedCount: Number(count.planned || 0),
      skippedCount: Number(count.skipped || 0),
      reversedCount: Number(count.reversed || 0),
      cancelledAt: row.cancelled_at || null,
      cancelReason: row.cancel_reason || ''
    };
  });
}

// Posting sekarang: semua hari yang belum diposting (termasuk tanggal yang belum tiba) diposting dengan
// tanggal transaksinya masing-masing -- entry tanggal 14 boleh memposting jurnal bertanggal 15, 16, dst.
export async function postSplitNow(db, store, scheduleId) {
  const schedule = await splitSchedule(db, store, scheduleId);
  if (!schedule) return { ok: false, status: 404, code: 'SPLIT_NOT_FOUND', error: 'Jurnal Split tidak ditemukan.' };
  if (schedule.cancelled_at) return { ok: false, status: 409, code: 'SPLIT_CANCELLED', error: 'Jurnal Split ini sudah dihapus.' };
  const due = await db.prepare(`
    SELECT * FROM accounting_journal_schedule_occurrences WHERE schedule_id = ? AND status = 'PLANNED'
    ORDER BY occurrence_date ASC LIMIT ?
  `).bind(schedule.id, SPLIT_BATCH_PER_CALL).all();
  let posted = 0;
  for (const occurrence of due.results ?? []) {
    const result = await postOccurrence(db, store, schedule, occurrence, occurrence.occurrence_date);
    if (!result.ok) return { ok: false, status: 409, code: result.code || 'SPLIT_POST_FAILED', error: result.error || 'Posting gagal.', posted };
    posted += 1;
  }
  const remaining = Number((await db.prepare(`
    SELECT COUNT(*) AS n FROM accounting_journal_schedule_occurrences WHERE schedule_id = ? AND status = 'PLANNED'
  `).bind(schedule.id).first())?.n || 0);
  if (!remaining) await db.prepare(`UPDATE accounting_journal_schedules SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(schedule.id).run();
  return { ok: true, scheduleId: schedule.id, posted, remaining };
}

// Hapus split: tandai dihapus + hari yang belum diposting dilewati (sekali, atomik), lalu setiap jurnal harian
// yang sudah diposting dibalik dengan pembalik bertanggal sama (nama "atas nama" diwarisi). Idempoten: dipanggil
// ulang hanya melanjutkan pembalik yang belum ada.
export async function cancelSplit(db, store, scheduleId, { actor = {}, reason = '' } = {}) {
  const schedule = await splitSchedule(db, store, scheduleId);
  if (!schedule) return { ok: false, status: 404, code: 'SPLIT_NOT_FOUND', error: 'Jurnal Split tidak ditemukan.' };
  const why = text(reason, 200);
  if (!schedule.cancelled_at) {
    await db.batch([
      db.prepare(`
        UPDATE accounting_journal_schedules
        SET cancelled_at = ?, cancelled_by_role = ?, cancelled_by_id = ?, cancel_reason = ?, is_active = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND cancelled_at IS NULL
      `).bind(new Date().toISOString(), text(actor.role, 40), text(actor.id, 180), why, schedule.id),
      db.prepare(`
        UPDATE accounting_journal_schedule_occurrences SET status = 'SKIPPED', updated_at = CURRENT_TIMESTAMP
        WHERE schedule_id = ? AND status = 'PLANNED'
      `).bind(schedule.id)
    ]);
  }
  const pending = await db.prepare(`
    SELECT o.occurrence_date, o.journal_id FROM accounting_journal_schedule_occurrences o
    WHERE o.schedule_id = ? AND o.status = 'POSTED' AND o.journal_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM accounting_journal_headers r WHERE r.store_id = o.store_id AND r.reversal_of_journal_id = o.journal_id)
    ORDER BY o.occurrence_date ASC LIMIT ?
  `).bind(schedule.id, SPLIT_BATCH_PER_CALL + 1).all();
  const rows = pending.results ?? [];
  let reversed = 0;
  for (const row of rows.slice(0, SPLIT_BATCH_PER_CALL)) {
    const original = await getAccountingJournal(db, store.id, row.journal_id);
    if (!original) continue;
    const result = await postAccountingJournal(db, store, {
      businessDate: original.businessDate,
      occurredAt: new Date().toISOString(),
      sourceSystem: 'ACCOUNTING_SCHEDULE_VOID',
      sourceReferenceId: `schedule_void_${schedule.id}_${row.occurrence_date}`,
      correlationId: schedule.id,
      idempotencyKey: `ACCOUNTING_SCHEDULE_VOID:${store.id}:${schedule.id}:${row.occurrence_date}`,
      description: `Hapus Jurnal Split · ${schedule.name} · hari ${row.occurrence_date}${why ? ` · ${why}` : ''}`.slice(0, 300),
      reversalOfJournalId: original.journalId,
      createdBy: actor.role ? { role: actor.role, id: actor.id || '', note: 'Hapus Jurnal Split' } : undefined,
      journalLines: original.lines.map(line => ({
        accountId: line.accountId,
        side: line.side === 'DEBIT' ? 'CREDIT' : 'DEBIT',
        amountScaled: line.amountScaled,
        description: `Pembalik · ${line.description || original.description}`.slice(0, 240)
      }))
    });
    if (!result?.ok) return { ok: false, status: 409, code: result?.code || 'SPLIT_REVERSAL_FAILED', error: result?.error || 'Jurnal pembalik gagal diposting.', reversed };
    reversed += 1;
  }
  return { ok: true, scheduleId: schedule.id, reversed, remaining: Math.max(0, rows.length - reversed) };
}

export async function listRecurringSchedules(db, storeId) {
  const rows = await db.prepare(`
    SELECT * FROM accounting_journal_schedules WHERE store_id = ? AND kind = 'RECURRING' ORDER BY name
  `).bind(storeId).all();
  return (rows.results ?? []).map(scheduleRowToObject);
}

// Occurrence RECURRING yang menunggu konfirmasi admin (auto_create = 0, sudah
// jatuh tempo) -- untuk banner "N jurnal menunggu dibuat".
export async function listPendingOccurrences(db, storeId, { today = getJakartaBusinessDate() } = {}) {
  const rows = await db.prepare(`
    SELECT o.*, s.name AS schedule_name FROM accounting_journal_schedule_occurrences o
    JOIN accounting_journal_schedules s ON s.id = o.schedule_id AND s.store_id = o.store_id
    WHERE o.store_id = ? AND o.status = 'PLANNED' AND s.auto_create = 0 AND o.occurrence_date <= ?
    ORDER BY o.occurrence_date ASC
  `).bind(storeId, today).all();
  return (rows.results ?? []).map(row => ({ ...occurrenceRowToObject(row), scheduleName: row.schedule_name }));
}

// Occurrence sebuah Split, untuk pelacakan balik dari jurnal sumber.
export async function getSplitOccurrencesForJournal(db, storeId, sourceJournalId) {
  const schedule = await db.prepare(`
    SELECT * FROM accounting_journal_schedules WHERE store_id = ? AND source_journal_id = ?
  `).bind(storeId, sourceJournalId).first();
  if (!schedule) return null;
  const rows = await db.prepare(`
    SELECT * FROM accounting_journal_schedule_occurrences WHERE schedule_id = ? ORDER BY occurrence_date ASC
  `).bind(schedule.id).all();
  return { schedule: scheduleRowToObject(schedule), occurrences: (rows.results ?? []).map(occurrenceRowToObject) };
}
