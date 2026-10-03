import { activePendingPosFacts, dispatchPosAccountingFact } from './accounting-pos-bridge.js';
import { dispatchAdminAccountingFact, pendingAdminFacts } from './accounting-admin-bridge.js';
import { postPendingHppCorrections } from './hpp-recalculation.js';
import { postPendingEmployeeDepositJournals } from './employee-deposit-settlement.js';

// Sinkron Akuntansi (Bos Cyo, 2026-10-02: "sinkron itu jadikan auto sinkron aja").
// Satu mesin dipakai dua jalur:
//   - tombol sinkron manual: semua yang tertunda dicoba sekarang;
//   - otomatis (lazy, tanpa cron/polling -- pola yang sama dengan jadwal jurnal
//     ADR-049): saat panel Akuntansi dibuka dan saat Laporan Untung Rugi dibaca.
//     Yang baru saja dicoba dan macet karena setelan dilewati selama COOLDOWN,
//     supaya membuka laporan tidak mengulang kerja yang pasti gagal lagi.
// Hanya gerai yang memakai Akuntansi (edition ACCOUNTING) yang ikut otomatis.

export const AUTO_SYNC_LIMIT = 25;
export const AUTO_SYNC_COOLDOWN_MINUTES = 15;

async function recentlyAttempted(db, storeId, producer, rows, since) {
  if (!since || !rows.length) return new Set();
  const ids = rows.map(row => row.fact_id);
  const found = await db.prepare(`
    SELECT fact_type, fact_id FROM accounting_bridge_deliveries
    WHERE store_id = ? AND producer_module = ? AND last_attempt_at > ?
      AND fact_id IN (${ids.map(() => '?').join(',')})
  `).bind(storeId, producer, since, ...ids).all();
  return new Set((found.results ?? []).map(row => `${row.fact_type}:${row.fact_id}`));
}

export async function syncStoreAccounting(db, store, { limit = 50, cooldownMinutes = 0, now = new Date() } = {}) {
  const since = cooldownMinutes > 0 ? new Date(now.getTime() - cooldownMinutes * 60_000).toISOString() : null;
  const results = [];

  const posRows = await activePendingPosFacts(db, store.id, limit);
  const posSkip = await recentlyAttempted(db, store.id, 'POS', posRows, since);
  for (const row of posRows) {
    if (posSkip.has(`${row.fact_type}:${row.fact_id}`)) continue;
    const result = await dispatchPosAccountingFact(db, store, { factType: row.fact_type, factId: row.fact_id });
    results.push({ factType: row.fact_type, factId: row.fact_id, status: result.status, code: result.code || '', journalId: result.journalId || null });
  }

  // ADR-051: fakta admin (Bea, gaji presensi, pelunasan hutang, uang muka) dan
  // koreksi Hitung Ulang HPP -- hanya gerai yang memakai Akuntansi.
  const edition = await db.prepare('SELECT edition FROM stores WHERE id = ? LIMIT 1').bind(store.id).first();
  if (edition?.edition === 'ACCOUNTING') {
    const adminRows = await pendingAdminFacts(db, store.id, limit);
    const adminSkip = await recentlyAttempted(db, store.id, 'ADMIN', adminRows, since);
    for (const row of adminRows) {
      if (adminSkip.has(`${row.fact_type}:${row.fact_id}`)) continue;
      const result = await dispatchAdminAccountingFact(db, row.fact_type, row.fact_id);
      results.push({ factType: row.fact_type, factId: row.fact_id, status: result.status, code: result.code || '', journalId: result.journalId || null });
    }
    for (const row of await postPendingHppCorrections(db, store.id, limit, { retryAfter: since })) {
      results.push({ factType: 'HPP_KOREKSI', factId: row.factId, status: row.status, code: '', journalId: null });
    }
    // Setoran kasir: piutang yang belum terjurnal / pelunasan disetujui yang belum terjurnal.
    for (const row of await postPendingEmployeeDepositJournals(db, store.id, limit)) {
      results.push({ factType: row.factType, factId: row.factId, status: row.status, code: '', journalId: null });
    }
  }
  return results;
}

// Jalur otomatis: tidak pernah menggagalkan permintaan pemanggil (laporan /
// panel Akuntansi tetap tampil walau sinkron error).
export async function autoSyncAccounting(db, stores, { now = new Date() } = {}) {
  const ids = stores.map(store => store.id);
  if (!ids.length) return [];
  const editions = await db.prepare(`SELECT id FROM stores WHERE edition = 'ACCOUNTING' AND id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  const accounting = new Set((editions.results ?? []).map(row => row.id));
  const results = [];
  for (const store of stores) {
    if (!accounting.has(store.id)) continue;
    try {
      results.push(...await syncStoreAccounting(db, store, { limit: AUTO_SYNC_LIMIT, cooldownMinutes: AUTO_SYNC_COOLDOWN_MINUTES, now }));
    } catch (error) {
      console.warn('auto-sync akuntansi gagal', store.code, error?.message);
    }
  }
  return results;
}
