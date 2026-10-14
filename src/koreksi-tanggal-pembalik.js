import { getAccountingJournal, postAccountingJournal } from './accounting-ledger.js';

// Bos Cyo, 2026-10-14: "pembaliknya ngikutin tanggal transaksi ... ok sekarang kerjain perbaikannya."
// Sebelum perbaikan tanggal pembalik, pembatalan Bea Operasional / hapus transaksi kasir / koreksi HPP
// membuat jurnal pembalik bertanggal HARI DIBATALKAN (mis. Bea Gaji Sugiono 1-10 Sep dibalik 13 Okt),
// jadi untung rugi per tanggal bergeser. Jurnal lama TIDAK diedit atau dihapus (buku tetap jejak); tiap
// pembalik salah tanggal dibetulkan dengan sepasang jurnal lewat mesin jurnal resmi yang sama:
//   1. NETRAL  -- bertanggal pembalik yang salah, membalik pembalik itu (efek di tanggal salah = 0);
//   2. TANGGAL -- bertanggal transaksi asal, membalik jurnal asal (pembatalan jatuh di tanggal benar).
// Label "atas nama" (gaji/piutang per orang) diwarisi otomatis oleh postAccountingJournal karena keduanya
// ditandai reversalOfJournalId. Idempoten lewat idempotency key; jalan sendiri di sinkron Akuntansi.
export const KOREKSI_SOURCE = 'KOREKSI_TANGGAL_PEMBALIK';
const VOID_SOURCES = ['LEKER_ADMIN_VOID', 'LEKER_POS_VOID', 'LEKER_HPP_KOREKSI_VOID'];
const CREATED_BY = { role: 'SYSTEM', id: KOREKSI_SOURCE, note: 'Koreksi tanggal pembalik atas perintah Bos Cyo (14 Okt 2026)' };

const flip = journal => journal.lines.map(line => ({
  accountId: line.accountId,
  side: line.side === 'DEBIT' ? 'CREDIT' : 'DEBIT',
  amountScaled: line.amountScaled,
  description: `Koreksi tanggal · ${line.description || journal.description}`.slice(0, 240)
}));

export async function pembalikSalahTanggal(db, storeId, limit = 50) {
  const rows = await db.prepare(`
    SELECT r.id, r.journal_number, r.business_date, o.id AS original_id, o.journal_number AS original_number,
           o.business_date AS original_date
    FROM accounting_journal_headers r
    JOIN accounting_journal_headers o ON o.id = r.reversal_of_journal_id AND o.store_id = r.store_id
    WHERE r.store_id = ? AND r.source_system IN (${VOID_SOURCES.map(() => '?').join(',')})
      AND r.journal_status = 'POSTED' AND r.business_date <> o.business_date
      AND NOT EXISTS (SELECT 1 FROM accounting_journal_headers k WHERE k.store_id = r.store_id
                        AND k.idempotency_key = '${KOREKSI_SOURCE}:' || r.id || ':TANGGAL')
    ORDER BY o.business_date, r.journal_number
    LIMIT ?
  `).bind(storeId, ...VOID_SOURCES, Math.max(1, Math.min(200, Number(limit) || 50))).all();
  return rows.results ?? [];
}

export async function koreksiTanggalPembalik(db, store, { limit = 50, now = new Date() } = {}) {
  const results = [];
  for (const row of await pembalikSalahTanggal(db, store.id, limit)) {
    const wrong = await getAccountingJournal(db, store.id, row.id);
    const original = await getAccountingJournal(db, store.id, row.original_id);
    if (!wrong || !original) { results.push({ journalId: row.id, status: 'FAILED' }); continue; }
    const common = { occurredAt: now.toISOString(), sourceSystem: KOREKSI_SOURCE, correlationId: row.id, createdBy: CREATED_BY };
    const netral = await postAccountingJournal(db, store, {
      ...common,
      businessDate: row.business_date,
      sourceReferenceId: `NETRAL:${row.id}`,
      idempotencyKey: `${KOREKSI_SOURCE}:${row.id}:NETRAL`,
      description: `Koreksi tanggal: netralkan ${row.journal_number} (pembalik ${row.original_number} seharusnya ${row.original_date})`,
      reversalOfJournalId: wrong.journalId,
      journalLines: flip(wrong)
    });
    if (!netral.ok) { results.push({ journalId: row.id, status: 'FAILED', code: netral.code }); continue; }
    const tanggal = await postAccountingJournal(db, store, {
      ...common,
      businessDate: row.original_date,
      sourceReferenceId: `TANGGAL:${row.id}`,
      idempotencyKey: `${KOREKSI_SOURCE}:${row.id}:TANGGAL`,
      description: `Pembalik ${original.description} · tanggal transaksi (koreksi ${row.journal_number})`.slice(0, 300),
      reversalOfJournalId: original.journalId,
      journalLines: flip(original)
    });
    results.push({ journalId: row.id, status: tanggal.ok ? 'CORRECTED' : 'FAILED', code: tanggal.code || '' });
  }
  return results;
}
