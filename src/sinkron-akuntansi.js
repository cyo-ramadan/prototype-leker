import { json, readJson } from './http.js';
import { entityAdminFromRequest } from './owner-auth.js';
import { bukuPerOrang, scaledToSignedRupiah } from './accounting-party-ledger.js';
import { syncPeopleFacts } from './accounting-auto-sync.js';
import { AKUN_HUTANG_GAJI, AKUN_PIUTANG_KARYAWAN } from './riwayat-dari-buku.js';
import { linkedAccounts, operationalEntries } from './employee-ledger-view.js';
import { listActiveSyncs, insertSync, voidSync } from './sinkron-akuntansi-baris.js';

// Bos Cyo, 2026-10-13: riwayat di panel Entity, Portal Staf, buku besar dan Akuntansi tidak sinkron
// karena aturan pencatatan dulu belum ketat (akun belum ditautkan ke nama karyawan, gerai belum
// tersambung ke Akuntansi). Keputusan: buku Akuntansi = satu angka acuan dan tidak disentuh; tombol
// "Sinkronisasi Akuntansi" di Entity Admin menambah satu baris di sisi Operasional supaya riwayat
// sama dengan buku. "menekan satu kali ... yang mau disinkronkan" -> pratinjau per orang/gerai/jenis
// dengan centang, lalu sekali simpan.
//
// Per karyawan, per gerai berAkuntansi, per jenis (Setoran = Piutang Karyawan 1202, Gaji = Hutang
// Gaji 2102), dalam sisi normal akunnya:
//   tampil  = fakta operasional + jurnal penyesuaian + sinkronisasi aktif   (riwayat Portal/Entity)
//   buku    = jurnal otomatis fakta (mirror) + jurnal penyesuaian            (Akuntansi)
//   selisih = buku - tampil = mirror - fakta operasional - sinkronisasi aktif
// Gerai tanpa Akuntansi tidak punya buku, jadi tidak ikut. Karyawan yang tidak ditautkan ke akun mana
// pun tetap dihitung dari jurnal atas namanya.

const KINDS = ['setoran', 'gaji'];
const ACCOUNT_CODE = { setoran: AKUN_PIUTANG_KARYAWAN, gaji: AKUN_HUTANG_GAJI };
const SCALE = 1_000_000;
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);

function addTo(map, key, value) {
  map.set(key, (map.get(key) || 0) + Number(value || 0));
}

export async function hitungSelisih(db, { employeeId, entityId }) {
  const employee = await db.prepare('SELECT id, full_name FROM employees WHERE id = ? AND entity_id = ?').bind(employeeId, entityId).first();
  if (!employee) return null;
  const stores = (await db.prepare('SELECT id, code, store_name, edition FROM stores WHERE entity_id = ?').bind(entityId).all()).results ?? [];
  const accountingStores = stores.filter(store => store.edition === 'ACCOUNTING');
  const accounts = await linkedAccounts(db, employee.id, entityId);
  const holderIds = [employee.id, ...accounts.map(account => `cashier:${account.accountId}`)];
  const items = [];
  for (const kind of KINDS) {
    const operational = await operationalEntries(db, employee.id, entityId, accounts, kind);
    // Sama dengan riwayat: fakta yang belum terjurnal disambungkan dulu, supaya yang tersisa memang
    // selisih yang tidak bisa disambungkan otomatis.
    await syncPeopleFacts(db, [...new Set(operational.map(entry => entry.storeId).filter(Boolean))]);
    const perOrang = await bukuPerOrang(db, { storeIds: accountingStores.map(store => store.id), accountCode: ACCOUNT_CODE[kind] });
    const book = new Map();
    const mirror = new Map();
    for (const holderId of holderIds) {
      for (const [storeId, value] of perOrang.get(holderId)?.byStore ?? []) {
        addTo(book, storeId, value.bookScaled);
        addTo(mirror, storeId, value.mirrorScaled);
      }
    }
    const facts = new Map();
    for (const entry of operational) if (entry.status === 'POSTED') addTo(facts, entry.storeId, entry.amountScaled);
    const synced = new Map();
    for (const row of await listActiveSyncs(db, { employeeId: employee.id, kind })) addTo(synced, row.storeId, row.amountScaled);
    for (const store of accountingStores) {
      const selisihScaled = (mirror.get(store.id) || 0) - (facts.get(store.id) || 0) - (synced.get(store.id) || 0);
      if (!selisihScaled) continue;
      const bookScaled = book.get(store.id) || 0;
      items.push({ kind, storeId: store.id, storeCode: store.code, storeName: store.store_name, bookScaled, displayedScaled: bookScaled - selisihScaled, selisihScaled });
    }
  }
  return { employee: { id: employee.id, fullName: employee.full_name }, accounts, items };
}

const toView = item => ({
  kind: item.kind,
  storeId: item.storeId,
  storeCode: item.storeCode,
  storeName: item.storeName,
  bookRupiah: scaledToSignedRupiah(item.bookScaled),
  displayedRupiah: scaledToSignedRupiah(item.displayedScaled),
  selisihRupiah: scaledToSignedRupiah(item.selisihScaled)
});

// Simpan baris sinkronisasi untuk item yang dicentang. Selisih dihitung ulang di server: item yang
// sudah sama dilewati (klik berkali-kali tidak dobel), item yang angkanya berubah sejak pratinjau
// ditolak supaya tidak menyimpan angka basi.
export async function simpanSinkronisasi(db, { employeeId, entityId, selected, actor }) {
  const current = await hitungSelisih(db, { employeeId, entityId });
  if (!current) return null;
  const results = [];
  for (const pick of selected) {
    const kind = text(pick?.kind, 20).toLowerCase();
    const storeId = text(pick?.storeId, 120);
    const item = current.items.find(row => row.kind === kind && row.storeId === storeId);
    if (!item) { results.push({ kind, storeId, status: 'SUDAH_SAMA' }); continue; }
    if (Math.round(Number(pick?.selisihRupiah) * SCALE) !== item.selisihScaled) {
      results.push({ kind, storeId, status: 'BERUBAH', selisihRupiah: scaledToSignedRupiah(item.selisihScaled) });
      continue;
    }
    const id = await insertSync(db, {
      entityId, storeId, employeeId: current.employee.id, kind,
      amountScaled: item.selisihScaled, bookScaled: item.bookScaled, displayedScaled: item.displayedScaled, actor
    });
    results.push({ kind, storeId, status: 'TERSINKRON', syncId: id, selisihRupiah: scaledToSignedRupiah(item.selisihScaled) });
  }
  return { employee: current.employee, results };
}

export async function handleSinkronAkuntansiApi(request, env, pathname) {
  const preview = pathname.match(/^\/api\/entity-admin\/employees\/([^/]+)\/sync-preview$/);
  const save = pathname.match(/^\/api\/entity-admin\/employees\/([^/]+)\/sync$/);
  const cancel = pathname.match(/^\/api\/entity-admin\/balance-syncs\/([^/]+)\/void$/);
  if (!preview && !save && !cancel) return null;
  const entityAdmin = await entityAdminFromRequest(request, env.DB);
  if (!entityAdmin) return json({ error: 'Login Entity Admin diperlukan.', code: 'ENTITY_ADMIN_REQUIRED' }, 401);
  const actor = { role: 'ENTITY_ADMIN', id: entityAdmin.id };

  if (preview) {
    if (request.method !== 'GET') return json({ error: 'Method tidak didukung.' }, 405);
    const result = await hitungSelisih(env.DB, { employeeId: decodeURIComponent(preview[1]), entityId: entityAdmin.entityId });
    if (!result) return json({ error: 'Karyawan tidak ditemukan di entity ini.' }, 404);
    return json({ employee: result.employee, linkedAccounts: result.accounts.length, items: result.items.map(toView) });
  }

  if (request.method !== 'POST') return json({ error: 'Method tidak didukung.' }, 405);
  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);

  if (save) {
    const selected = Array.isArray(body.value?.items) ? body.value.items.slice(0, 20) : [];
    if (!selected.length) return json({ error: 'Pilih minimal satu baris yang disinkronkan.' }, 400);
    const result = await simpanSinkronisasi(env.DB, { employeeId: decodeURIComponent(save[1]), entityId: entityAdmin.entityId, selected, actor });
    if (!result) return json({ error: 'Karyawan tidak ditemukan di entity ini.' }, 404);
    return json({ ok: true, ...result });
  }

  const reason = text(body.value?.reason, 500);
  if (reason.length < 3) return json({ error: 'Alasan pembatalan wajib diisi.' }, 400);
  const ok = await voidSync(env.DB, { id: decodeURIComponent(cancel[1]), entityId: entityAdmin.entityId, actor, reason });
  if (!ok) return json({ error: 'Baris sinkronisasi tidak ditemukan atau sudah dibatalkan.' }, 404);
  return json({ ok: true });
}
