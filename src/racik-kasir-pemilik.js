import { json } from './http.js';
import { requireManagement, hashCredential } from './owner-auth.js';
import { resolveStore, DEFAULT_STORE_CODE } from './stores.js';
import { getTenantPolicyChoice, isRacikChoice, UI_SKIN_KEY } from './tenant-policy.js';

// Skin F (Racik Parfum) -- Bos Cyo, 2026-10-06: "di skin itu admin/owner/kasir
// untuk saat ini samakan, boleh langsung jual dan buka laci. di entity kasih
// tombol jual barang dan beli bahan juga operasionalnya".
//
// Penjualan, belanja bahan, dan biaya operasional hanya punya satu jalur:
// jalur kasir (laci, stok, HPP, posting Accounting semuanya di sana). Supaya
// tidak membuat model transaksi kedua, Pemilik/Admin TIDAK diberi hak menulis
// lewat token manajemen. Sebagai gantinya, endpoint ini memberi mereka sesi
// kasir sungguhan atas akun kasir "Pemilik" miliknya sendiri di gerai itu
// (dibuat sekali, otomatis). Akibatnya semua transaksi tetap tercatat atas
// nama orang yang benar, laci tetap satu pemegang, dan semua aturan server
// kasir (stok, izin, harga) berlaku persis sama.
//
// Hanya untuk tenant skin F; tenant lain mendapat 403. Token agen (Una/bot)
// tidak boleh -- sesi kasir hanya untuk manusia yang login.

const SESSION_HOURS = 12;

function actorOf(auth) {
  if (auth.entityAdmin) return { key: `ea_${auth.entityAdmin.id}`, name: auth.entityAdmin.displayName || auth.entityAdmin.username };
  if (auth.admin) return { key: `adm_${auth.admin.id}`, name: auth.admin.displayName || auth.admin.username };
  if (auth.owner) return { key: `own_${auth.owner.id}`, name: auth.owner.displayName || auth.owner.username };
  return null;
}

async function shortHash(value) {
  return (await hashCredential(value)).slice(0, 10);
}

export async function handleRacikKasirPemilikApi(request, env, pathname) {
  if (pathname !== '/api/management/racik/kasir-pemilik') return null;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const db = env.DB;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const actor = actorOf(auth);
  if (!actor) return json({ error: 'Hanya Pemilik atau Admin yang login yang bisa berjualan dari sini.', code: 'HUMAN_LOGIN_REQUIRED' }, 403);

  const storeCode = String(new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE).trim();
  const store = await resolveStore(db, storeCode);
  if (!store) return json({ error: 'Gerai tidak ditemukan atau tidak aktif.' }, 404);
  const choice = store.tenantId ? await getTenantPolicyChoice(db, store.tenantId, UI_SKIN_KEY) : '0';
  if (!isRacikChoice(choice)) {
    return json({ error: 'Jual langsung dari panel Pemilik hanya untuk tampilan Racik Parfum.', code: 'RACIK_ONLY' }, 403);
  }

  // Satu akun kasir "Pemilik" per orang per gerai, id deterministik supaya
  // klik kedua memakai akun yang sama (riwayat laci & penjualan menyatu).
  const suffix = await shortHash(`${actor.key}|${store.id}`);
  const cashierId = `cashier_pemilik_${suffix}`;
  const now = new Date();
  const nowIso = now.toISOString();
  const existing = await db.prepare('SELECT id, store_id, is_active FROM cashiers WHERE id = ?').bind(cashierId).first();
  if (existing && (existing.store_id !== store.id || !existing.is_active)) {
    return json({ error: 'Akun kasir Pemilik untuk gerai ini sedang nonaktif. Aktifkan lagi di Akun Kasir.', code: 'OWNER_CASHIER_INACTIVE' }, 409);
  }
  if (!existing) {
    // Password acak yang tidak pernah diberikan ke siapa pun: akun ini hanya
    // bisa dipakai lewat endpoint ini (login manusia yang sah), bukan login kasir.
    const unusable = await hashCredential(`${crypto.randomUUID()}${crypto.randomUUID()}`);
    await db.prepare(`
      INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).bind(cashierId, `pemilik.${suffix}`, unusable, `${String(actor.name || 'Pemilik').slice(0, 80)} (Pemilik)`, store.id, nowIso, nowIso).run();
  }

  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
  await db.batch([
    db.prepare('DELETE FROM cashier_sessions WHERE expires_at <= ?').bind(nowIso),
    db.prepare('INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await hashCredential(token), cashierId, nowIso, expiresAt)
  ]);
  return json({ token, expiresAt, cashierId, storeCode: store.code, created: !existing }, existing ? 200 : 201);
}
