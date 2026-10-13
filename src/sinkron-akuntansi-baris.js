// Baris "Sinkronisasi Akuntansi" (migration 0153): penyamaan riwayat Operasional dengan buku Akuntansi
// per karyawan/gerai/jenis. Modul baca-tulis tabelnya saja, netral, supaya dipakai panel Entity
// (src/employee-ledger-view.js), Portal Staf (src/staff-portal.js, src/employee-deposit-settlement.js),
// dan tombol sinkronisasi (src/sinkron-akuntansi.js) tanpa impor silang. Tidak pernah dijurnal.

export const SYNC_LABEL = 'Sinkronisasi Akuntansi';
const KIND = { setoran: 'SETORAN', gaji: 'GAJI' };

export const syncKind = kind => KIND[String(kind || '').toLowerCase()] || null;

function mapRow(row) {
  return {
    id: row.id,
    storeId: row.store_id,
    storeCode: row.store_code || '',
    employeeId: row.employee_id,
    kind: row.kind,
    amountScaled: Number(row.amount_scaled),
    bookScaled: Number(row.book_scaled),
    displayedScaled: Number(row.displayed_scaled),
    createdByRole: row.created_by_role,
    createdAt: row.created_at
  };
}

// Baris aktif (belum dibatalkan) satu karyawan; storeId opsional untuk Portal Staf (satu gerai).
export async function listActiveSyncs(db, { employeeId, kind, storeId = null }) {
  const code = syncKind(kind);
  if (!employeeId || !code || String(employeeId).startsWith('cashier:')) return [];
  const rows = await db.prepare(`
    SELECT b.*, s.code AS store_code
    FROM people_balance_syncs b
    JOIN stores s ON s.id = b.store_id
    WHERE b.employee_id = ? AND b.kind = ? AND b.voided_at IS NULL ${storeId ? 'AND b.store_id = ?' : ''}
    ORDER BY b.created_at
  `).bind(...[employeeId, code, ...(storeId ? [storeId] : [])]).all();
  return (rows.results ?? []).map(mapRow);
}

export async function insertSync(db, { entityId, storeId, employeeId, kind, amountScaled, bookScaled, displayedScaled, actor }) {
  const id = `sinkron_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO people_balance_syncs (
      id, entity_id, store_id, employee_id, kind, amount_scaled, book_scaled, displayed_scaled,
      created_by_role, created_by_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, entityId, storeId, employeeId, syncKind(kind), amountScaled, bookScaled, displayedScaled,
    actor.role, actor.id || '', new Date().toISOString()
  ).run();
  return id;
}

export async function voidSync(db, { id, entityId, actor, reason }) {
  const result = await db.prepare(`
    UPDATE people_balance_syncs
    SET voided_at = ?, voided_by_role = ?, voided_by_id = ?, void_reason = ?
    WHERE id = ? AND entity_id = ? AND voided_at IS NULL
  `).bind(new Date().toISOString(), actor.role, actor.id || '', reason, id, entityId).run();
  return Number(result.meta?.changes ?? 0) === 1;
}
