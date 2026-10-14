import { getAccountingJournal, postAccountingJournal } from './accounting-ledger.js';
import { getJakartaBusinessDate } from './time.js';

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const oppositeSide = side => side === 'DEBIT' ? 'CREDIT' : 'DEBIT';

async function postedDelivery(db, storeId, factType, factId) {
  return db.prepare(`
    SELECT status, journal_id
    FROM accounting_bridge_deliveries
    WHERE store_id = ? AND producer_module = 'POS' AND fact_type = ? AND fact_id = ?
    LIMIT 1
  `).bind(storeId, factType, factId).first();
}

export async function reversePostedPosAccountingFact(db, store, {
  factType,
  factId,
  permitId,
  occurredAt,
  reason
}) {
  const delivery = await postedDelivery(db, store.id, factType, factId);
  if (!delivery || delivery.status !== 'POSTED' || !delivery.journal_id) {
    return {
      ok: true,
      accountingStatus: 'NOT_REQUIRED',
      originalJournalId: null,
      reversalJournalId: null,
      detail: 'Business fact belum pernah mempunyai jurnal POSTED; fact voided tidak perlu dijurnal lalu dibalik.'
    };
  }

  const original = await getAccountingJournal(db, store.id, delivery.journal_id);
  if (!original) {
    return {
      ok: false,
      accountingStatus: 'FAILED',
      code: 'ORIGINAL_ACCOUNTING_JOURNAL_NOT_FOUND',
      error: 'Jurnal Accounting sumber tidak ditemukan untuk reversal.',
      originalJournalId: delivery.journal_id,
      reversalJournalId: null
    };
  }

  const effectiveAt = new Date(occurredAt || new Date().toISOString());
  const description = `Pembalik ${original.description}${reason ? ` · ${text(reason, 180)}` : ''}`.slice(0, 300);
  // Bos Cyo, 2026-10-14: "pembaliknya ngikutin tanggal transaksi, perhitungan juga ngikutin tanggal
  // transaksi." Jurnal pembalik memakai TANGGAL TRANSAKSI jurnal asalnya (business_date), bukan tanggal
  // dibatalkan -- membatalkan transaksi September tidak boleh menggeser untung rugi ke Oktober. Waktu
  // pembatalan tetap tersimpan sebagai tanggal entry (occurred_at/posted_at).
  // Pembuat jurnal pembalik (migration 0156) = yang meng-ACC hapus transaksinya.
  let approver = null;
  try { approver = await db.prepare('SELECT approved_by_role AS role, approved_by_id AS id FROM approval_permits WHERE id = ?').bind(permitId).first(); } catch { approver = null; }
  const posted = await postAccountingJournal(db, store, {
    createdBy: approver?.role ? { role: approver.role, id: approver.id || '', note: 'ACC hapus transaksi kasir' } : null,
    businessDate: original.businessDate || getJakartaBusinessDate(effectiveAt),
    occurredAt: effectiveAt.toISOString(),
    sourceSystem: 'LEKER_POS_VOID',
    sourceReferenceId: `VOID:${factType}:${factId}:${permitId}`,
    correlationId: permitId,
    idempotencyKey: `LEKER_POS_VOID:${permitId}`,
    description,
    reversalOfJournalId: original.journalId,
    journalLines: original.lines.map(line => ({
      accountId: line.accountId,
      side: oppositeSide(line.side),
      amountScaled: line.amountScaled,
      description: `Pembalik · ${line.description || original.description}`.slice(0, 240),
      isSystemGenerated: line.isSystemGenerated
    }))
  });

  if (!posted.ok) {
    return {
      ok: false,
      accountingStatus: 'FAILED',
      code: posted.code || 'ACCOUNTING_REVERSAL_FAILED',
      error: posted.error || 'Jurnal pembalik gagal diposting.',
      originalJournalId: original.journalId,
      reversalJournalId: null
    };
  }

  return {
    ok: true,
    accountingStatus: 'REVERSED',
    originalJournalId: original.journalId,
    reversalJournalId: posted.journal.journalId,
    reversalJournalNumber: posted.journal.journalNumber,
    duplicate: Boolean(posted.duplicate),
    detail: 'Jurnal sumber dibalik exact dengan nominal yang sama dan sisi Debit/Kredit ditukar.'
  };
}
