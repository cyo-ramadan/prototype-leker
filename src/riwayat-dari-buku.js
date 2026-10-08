import { accountingStoreIds, bukuPerOrang, saldoMenurutBuku, scaledToSignedRupiah } from './accounting-party-ledger.js';
import { syncPeopleFacts } from './accounting-auto-sync.js';

// ADR-054 (Bos Cyo, 2026-10-08): "output program wajib masuk akuntansi, data akuntansi itulah yang
// ditampilkan di semua data tentang keuangan ... riwayat gaji dan setoran itu akan tertulis
// ditrigger dari akuntansi, ketika akun tersebut dipanggil". Pembaca bersama untuk riwayat per
// orang: saldo menurut buku (akun bernama, accounting_party_entries) dan baris "Penyesuaian dari
// Akuntansi" untuk jurnal yang bukan cerminan fakta operasional (jurnal manual akuntan, Una, dst.).
// Rincian fakta operasional (jam kerja, foto, status ACC) tetap dibaca dari Operasional oleh
// pemanggil; modul ini hanya membaca, tidak pernah memposting.

export const AKUN_HUTANG_GAJI = '2102';
export const AKUN_PIUTANG_KARYAWAN = '1202';

// Satu orang bisa punya beberapa pemegang di buku: id karyawan, dan `cashier:<id>` untuk jurnal
// dari akun kasirnya sebelum ditautkan ke Master Karyawan.
function gabungBuku(list) {
  if (!list.length) return null;
  const merged = { bookScaled: 0, mirrorScaled: 0, netScaled: 0, entries: [], byStore: new Map() };
  for (const buku of list) {
    merged.bookScaled += buku.bookScaled;
    merged.mirrorScaled += buku.mirrorScaled;
    merged.netScaled += buku.netScaled;
    merged.entries.push(...buku.entries);
    for (const [storeId, value] of buku.byStore) {
      const current = merged.byStore.get(storeId) || { bookScaled: 0, mirrorScaled: 0 };
      merged.byStore.set(storeId, {
        bookScaled: current.bookScaled + value.bookScaled,
        mirrorScaled: current.mirrorScaled + value.mirrorScaled
      });
    }
  }
  return merged;
}

async function entityStores(db, entityId) {
  if (!entityId) return [];
  const rows = await db.prepare('SELECT id, code FROM stores WHERE entity_id = ?').bind(entityId).all();
  return rows.results ?? [];
}

// operationalByStore: Map(storeId -> saldo fakta operasional orang ini, scaled, sisi normal akun).
// sinkron: sambungkan dulu fakta orang ini yang belum terjurnal / pembatalan yang belum dibalik, di
// gerai tempat ia punya fakta (termasuk fakta yang sudah dibatalkan -- syncStoreIds).
export async function riwayatDariBuku(db, { entityId, accountCode, holderIds, operationalByStore = new Map(), syncStoreIds = null, sinkron = true }) {
  if (sinkron) await syncPeopleFacts(db, syncStoreIds || [...operationalByStore.keys()]);
  const stores = await entityStores(db, entityId);
  const storeIds = stores.map(store => store.id);
  const codeById = new Map(stores.map(store => [store.id, store.code]));
  const [perOrang, accountingStores] = await Promise.all([
    bukuPerOrang(db, { storeIds, accountCode }),
    accountingStoreIds(db, storeIds)
  ]);
  const buku = gabungBuku(holderIds.map(id => perOrang.get(id)).filter(Boolean));
  const { balanceScaled, belumMasukBukuScaled } = saldoMenurutBuku({ operationalByStore, buku, accountingStores });
  return {
    balanceRupiah: scaledToSignedRupiah(balanceScaled),
    belumMasukBukuRupiah: scaledToSignedRupiah(belumMasukBukuScaled),
    penyesuaian: (buku?.entries ?? []).map(entry => ({
      journalId: entry.journalId,
      journalNumber: entry.journalNumber,
      businessDate: entry.businessDate,
      createdAt: entry.createdAt || null,
      storeId: entry.storeId,
      storeCode: codeById.get(entry.storeId) || '',
      amountScaled: entry.signedScaled,
      amountRupiah: scaledToSignedRupiah(entry.signedScaled),
      description: entry.description || ''
    }))
  };
}

// Saldo fakta operasional per gerai dari baris-baris riwayat { storeId, amountScaled, aktif }.
export function operasionalPerGerai(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.aktif) continue;
    map.set(row.storeId, (map.get(row.storeId) || 0) + Number(row.amountScaled || 0));
  }
  return map;
}
