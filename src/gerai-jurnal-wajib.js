// ADR-054 (Bos Cyo, 2026-10-08): "setiap bikin tenant atau gerai baru wajib banget untuk konekin jurnal
// wajibnya ... urusan konekin akun2 wajib dan permainan jurnal wajib itu kita yang desainin".
//
// Sebagian besar perlengkapan Akuntansi gerai baru dipasang trigger AFTER INSERT ON stores. Dua yang
// tidak: akun 1202 Piutang Karyawan (trigger-nya hilang di D1 produksi -- dibuktikan lewat
// sqlite_schema 2026-10-08, dipasang ulang di migration 0144) dan aturan jurnal Jenis Transaksi
// "operational" (Beban Kasir) yang dulu hanya diisi sekali untuk gerai yang ada (migration 0035).
// Akibatnya setoran CS dan Beban Kasir di gerai baru tertahan di Setting Akuntansi.
//
// Fungsi ini dipanggil SESUDAH gerai dibuat, jadi tidak bergantung pada urutan trigger. Idempotent:
// hanya mengisi yang belum ada, tidak pernah mengganti aturan yang sudah dipasang akuntan.
// SQL-nya sama dengan migration 0144 (yang melengkapi gerai lama).

export async function pasangJurnalWajib(db, storeId) {
  const store = await db.prepare('SELECT id, edition FROM stores WHERE id = ? LIMIT 1').bind(storeId).first();
  if (!store || store.edition !== 'ACCOUNTING') return { ok: true, skipped: true };
  await db.batch([
    db.prepare(`
      INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype, is_active)
      SELECT 'coa_' || s.id || '_1202', s.id, '1202', 'Piutang Karyawan', 'ASSET', 'RECEIVABLE', 1
      FROM stores s
      WHERE s.id = ? AND NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.store_id = s.id AND c.code = '1202')
    `).bind(storeId),
    db.prepare(`
      INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, is_default, sort_order)
      SELECT 'jrule_' || tc.store_id || '_operational_expense', tc.store_id, tc.id, 'Beban Operasional', 'DEBIT',
             'fixed_account', a.id, 1, 10
      FROM transaction_categories tc
      JOIN chart_of_accounts a ON a.store_id = tc.store_id AND a.code = '6101' AND a.is_active = 1
      WHERE tc.store_id = ? AND tc.code = 'operational'
        AND NOT EXISTS (SELECT 1 FROM journal_rules r WHERE r.transaction_category_id = tc.id AND r.side = 'DEBIT' AND r.is_active = 1)
    `).bind(storeId),
    db.prepare(`
      INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, is_default, sort_order)
      SELECT 'jrule_' || tc.store_id || '_operational_payment', tc.store_id, tc.id, 'Pembayaran Operasional', 'CREDIT',
             'payment_method', 1, 20
      FROM transaction_categories tc
      WHERE tc.store_id = ? AND tc.code = 'operational'
        AND NOT EXISTS (SELECT 1 FROM journal_rules r WHERE r.transaction_category_id = tc.id AND r.side = 'CREDIT' AND r.is_active = 1)
    `).bind(storeId)
  ]);
  return { ok: true };
}
