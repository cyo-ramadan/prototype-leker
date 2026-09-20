import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { resolveStore } from './stores.js';

// Bos Cyo, 2026-09-20: "central account shared per entity" -- Rekening
// Bersama (mis. "Rekening Maxi Malang", atau akun informal seperti "Rekening
// Bos Cyo"/"Hutang Bos Cyo"). Satu Entity boleh punya banyak Rekening
// Bersama; satu Rekening Bersama dipakai lintas semua store_id di entity itu
// dan komposisinya (siapa "punya" berapa) dipecah per store_id.
//
// SENGAJA di luar Akuntansi -- lihat migrations/0111_entity_shared_accounts.sql
// untuk alasan lengkap dan invarian yang dijaga di level schema (trigger
// immutability + FK scope guard). File ini tidak mengimpor apa pun dari
// modul Akuntansi (chart_of_accounts/journal_rules/entity_journal_*), dan
// amount di sini disimpan sebagai rupiah polos (INTEGER), bukan scaled
// x1.000.000 -- pola yang sama dengan operational_receivables_payables dan
// cash_ledger_entries (ledger operasional non-Akuntansi), bukan pola journal
// Akuntansi (CLAUDE.md invariant #1 berlaku untuk Average Cost/HPP/journal
// amount authoritative, bukan setiap catatan uang operasional).

const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function mapAccount(row) {
  return row ? {
    id: row.id,
    entityId: row.entity_id,
    name: row.name,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : null;
}

function mapTransfer(row) {
  return row ? {
    id: row.id,
    sharedAccountId: row.shared_account_id,
    entityId: row.entity_id,
    fromStoreId: row.from_store_id,
    fromStoreCode: row.from_store_code || null,
    fromStoreName: row.from_store_name || null,
    toStoreId: row.to_store_id,
    toStoreCode: row.to_store_code || null,
    toStoreName: row.to_store_name || null,
    amount: Number(row.amount),
    status: row.status,
    reason: row.reason || '',
    createdByRole: row.created_by_role || '',
    createdById: row.created_by_id || '',
    createdAt: row.created_at,
    completedByRole: row.completed_by_role || '',
    completedById: row.completed_by_id || '',
    completedAt: row.completed_at || null
  } : null;
}

async function getAccount(db, id) {
  const row = await db.prepare(`SELECT * FROM entity_shared_accounts WHERE id = ?`).bind(id).first();
  return mapAccount(row);
}

async function listAccountsForEntity(db, entityId) {
  const rows = await db.prepare(`
    SELECT * FROM entity_shared_accounts WHERE entity_id = ? ORDER BY name COLLATE NOCASE
  `).bind(entityId).all();
  return (rows.results || []).map(mapAccount);
}

async function getTransfer(db, id) {
  const row = await db.prepare(`
    SELECT t.*, sFrom.code AS from_store_code, sFrom.store_name AS from_store_name,
           sTo.code AS to_store_code, sTo.store_name AS to_store_name
    FROM entity_shared_account_transfers t
    JOIN stores sFrom ON sFrom.id = t.from_store_id
    JOIN stores sTo ON sTo.id = t.to_store_id
    WHERE t.id = ?
  `).bind(id).first();
  return mapTransfer(row);
}

// Saldo per store = SUM(IN) - SUM(OUT) atas SEMUA baris ledger (termasuk
// kedua kaki TRANSFER) -- lihat catatan invarian di kepala migration untuk
// kenapa ini benar tanpa perlu filter status transfer sama sekali: kaki OUT
// sebuah transfer langsung mengurangi from_store saat dibuat (bukan ditunda),
// cuma kaki IN ke to_store yang ditunda sampai complete.
async function storeBreakdown(db, sharedAccountId) {
  const rows = await db.prepare(`
    SELECT l.store_id, s.code AS store_code, s.store_name,
           COALESCE(SUM(CASE WHEN l.direction = 'IN' THEN l.amount ELSE -l.amount END), 0) AS balance
    FROM entity_shared_account_ledger l
    JOIN stores s ON s.id = l.store_id
    WHERE l.shared_account_id = ?
    GROUP BY l.store_id, s.code, s.store_name
    ORDER BY s.code
  `).bind(sharedAccountId).all();
  return (rows.results || []).map(row => ({
    storeId: row.store_id,
    storeCode: row.store_code,
    storeName: row.store_name,
    balance: Number(row.balance || 0)
  }));
}

async function storeBalance(db, sharedAccountId, storeId) {
  const row = await db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END), 0) AS balance
    FROM entity_shared_account_ledger
    WHERE shared_account_id = ? AND store_id = ?
  `).bind(sharedAccountId, storeId).first();
  return Number(row?.balance || 0);
}

// Total riil rekening: net dari baris NON-TRANSFER saja. Transfer murni
// realokasi komposisi, tidak pernah mengubah berapa uang yang benar-benar
// ada di rekening ini.
async function realTotal(db, sharedAccountId) {
  const row = await db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END), 0) AS total
    FROM entity_shared_account_ledger
    WHERE shared_account_id = ? AND source_type <> 'TRANSFER'
  `).bind(sharedAccountId).first();
  return Number(row?.total || 0);
}

async function inTransitTransfers(db, sharedAccountId) {
  const rows = await db.prepare(`
    SELECT t.*, sFrom.code AS from_store_code, sFrom.store_name AS from_store_name,
           sTo.code AS to_store_code, sTo.store_name AS to_store_name
    FROM entity_shared_account_transfers t
    JOIN stores sFrom ON sFrom.id = t.from_store_id
    JOIN stores sTo ON sTo.id = t.to_store_id
    WHERE t.shared_account_id = ? AND t.status = 'IN_TRANSIT'
    ORDER BY t.created_at DESC
  `).bind(sharedAccountId).all();
  return (rows.results || []).map(mapTransfer);
}

async function entityAccountView(db, account) {
  const [breakdown, inTransit] = await Promise.all([
    storeBreakdown(db, account.id),
    inTransitTransfers(db, account.id)
  ]);
  const inTransitTotal = inTransit.reduce((sum, transfer) => sum + transfer.amount, 0);
  return {
    account,
    total: await realTotal(db, account.id),
    storeBreakdown: breakdown,
    inTransit: { total: inTransitTotal, transfers: inTransit }
  };
}

// POS Core -> ledger hook. Dipanggil sesudah Sale/Purchase/Expense sudah
// commit (best-effort, tidak boleh menggagalkan transaksi operasionalnya
// sendiri kalau ini gagal -- lihat pemanggil di src/index.js). Tidak
// melakukan apa pun kalau payment method transaksi itu tidak ditandai ke
// Rekening Bersama mana pun.
//
// sales/purchases/expenses menyimpan `payment_method` sebagai CODE teks
// (migration 0008), bukan payment_methods.id -- resolvePosPaymentMethod di
// src/pos-payment-methods.js pun resolve by code, bukan by id. Jadi lookup
// di sini juga wajib by (store_id, code), sama seperti pemanggil lain.
export async function postSharedAccountLedgerForPaymentMethod(db, { storeId, paymentMethodCode, direction, amount, sourceType, sourceId, actorRole, actorId, note }) {
  const code = String(paymentMethodCode || '').trim().toUpperCase();
  if (!code || !positiveInteger(amount)) return null;
  const method = await db.prepare(`
    SELECT shared_account_id FROM payment_methods WHERE store_id = ? AND code = ? AND shared_account_id IS NOT NULL
  `).bind(storeId, code).first();
  if (!method?.shared_account_id) return null;

  const id = `shared_ledger_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO entity_shared_account_ledger (
      id, shared_account_id, entity_id, store_id, direction, amount, source_type, source_id, note, created_by_role, created_by_id, created_at
    )
    SELECT ?, sa.id, sa.entity_id, ?, ?, ?, ?, ?, ?, ?, ?, ?
    FROM entity_shared_accounts sa WHERE sa.id = ?
  `).bind(id, storeId, direction, amount, sourceType, sourceId, note || '', actorRole || '', actorId || '', now, method.shared_account_id).run();
  return id;
}

async function sharedAccountScope(request, env) {
  const auth = await requireManagement(request, env.DB, env);
  if (!auth.ok) return auth;
  if (auth.authType === 'LEGACY_PIN') {
    return { ok: false, response: json({ error: 'Rekening Bersama membutuhkan akun Admin Gerai, Entity Admin, atau Owner.', code: 'ACCOUNT_REQUIRED' }, 403) };
  }

  const url = new URL(request.url);
  const storeToken = text(url.searchParams.get('store'), 80);

  if (auth.admin) {
    const store = await resolveStore(env.DB, auth.admin.store.code, { includeInactive: true });
    return { ...auth, storeId: store.id, entityId: store.entityId, canManageAccounts: false };
  }

  if (auth.entityAdmin) {
    let storeId = null;
    if (storeToken) {
      const store = await resolveStore(env.DB, storeToken, { includeInactive: true });
      storeId = store?.id || null;
    }
    return { ...auth, storeId, entityId: auth.entityAdmin.entityId, canManageAccounts: true };
  }

  // Owner: tidak terikat satu gerai/entity, jadi harus resolve eksplisit
  // dari query -- sama seperti managementScope di src/approval-queue.js.
  let storeId = null;
  let entityId = text(url.searchParams.get('entity'), 80) || null;
  if (storeToken) {
    const store = await resolveStore(env.DB, storeToken, { includeInactive: true });
    if (!store) return { ok: false, response: json({ error: 'Gerai tidak ditemukan.' }, 404) };
    storeId = store.id;
    entityId = entityId || store.entityId;
  }
  return { ...auth, storeId, entityId, canManageAccounts: true };
}

async function handleEntitySettingsRoutes(request, env, pathname, scope) {
  if (!pathname.startsWith('/api/entity/shared-accounts')) return null;
  if (!scope.canManageAccounts) return json({ error: 'Rekening Bersama hanya bisa dikelola Entity Admin atau Owner.', code: 'SHARED_ACCOUNT_MANAGE_FORBIDDEN' }, 403);
  if (!scope.entityId) return json({ error: 'Rekening Bersama butuh konteks entity (?store= atau ?entity=).' }, 400);

  if (request.method === 'GET' && pathname === '/api/entity/shared-accounts') {
    return json({ accounts: await listAccountsForEntity(env.DB, scope.entityId) });
  }

  if (request.method === 'POST' && pathname === '/api/entity/shared-accounts') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload Rekening Bersama tidak valid.' }, 400);
    const name = text(body.value?.name, 120);
    if (!name) return json({ error: 'Nama Rekening Bersama wajib diisi.' }, 400);
    const id = `shared_acc_${crypto.randomUUID()}`;
    try {
      await env.DB.prepare(`INSERT INTO entity_shared_accounts (id, entity_id, name) VALUES (?, ?, ?)`)
        .bind(id, scope.entityId, name).run();
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE')) return json({ error: 'Rekening Bersama dengan nama itu sudah ada di entity ini.' }, 409);
      throw error;
    }
    return json({ ok: true, account: await getAccount(env.DB, id) }, 201);
  }

  const viewMatch = pathname.match(/^\/api\/entity\/shared-accounts\/([^/]+)\/view$/);
  if (request.method === 'GET' && viewMatch) {
    const account = await getAccount(env.DB, decodeURIComponent(viewMatch[1]));
    if (!account || account.entityId !== scope.entityId) return json({ error: 'Rekening Bersama tidak ditemukan.' }, 404);
    return json(await entityAccountView(env.DB, account));
  }

  const patchMatch = pathname.match(/^\/api\/entity\/shared-accounts\/([^/]+)$/);
  if (request.method === 'PATCH' && patchMatch) {
    const account = await getAccount(env.DB, decodeURIComponent(patchMatch[1]));
    if (!account || account.entityId !== scope.entityId) return json({ error: 'Rekening Bersama tidak ditemukan.' }, 404);
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload Rekening Bersama tidak valid.' }, 400);
    const name = body.value?.name === undefined ? account.name : text(body.value.name, 120);
    const isActive = body.value?.isActive === undefined ? account.isActive : Boolean(body.value.isActive);
    if (!name) return json({ error: 'Nama Rekening Bersama wajib diisi.' }, 400);
    try {
      await env.DB.prepare(`UPDATE entity_shared_accounts SET name = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(name, isActive ? 1 : 0, account.id).run();
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE')) return json({ error: 'Rekening Bersama dengan nama itu sudah ada di entity ini.' }, 409);
      throw error;
    }
    return json({ ok: true, account: await getAccount(env.DB, account.id) });
  }

  return json({ error: 'Route Rekening Bersama (entity) tidak ditemukan.' }, 404);
}

async function handleStoreRoutes(request, env, pathname, scope) {
  if (!pathname.startsWith('/api/admin/shared-accounts')) return null;

  if (request.method === 'GET' && pathname === '/api/admin/shared-accounts') {
    if (!scope.storeId) return json({ error: 'Rekening Bersama butuh konteks gerai (?store=).' }, 400);
    const accounts = await listAccountsForEntity(env.DB, scope.entityId);
    const rows = await Promise.all(accounts.filter(account => account.isActive).map(async account => ({
      ...account,
      balance: await storeBalance(env.DB, account.id, scope.storeId)
    })));
    // Gerai saudara (entity sama, bukan gerai ini sendiri) -- dipakai UI Admin
    // Gerai sebagai daftar pilihan tujuan transfer. Admin Gerai tidak punya
    // endpoint lain untuk melihat daftar gerai di entity-nya sendiri (yang
    // ada, /api/entity-admin/stores, khusus Entity Admin), jadi disertakan
    // langsung di sini.
    const siblingRows = await env.DB.prepare(`
      SELECT id, code, store_name FROM stores WHERE entity_id = ? AND id <> ? AND is_active = 1 ORDER BY code
    `).bind(scope.entityId, scope.storeId).all();
    const siblingStores = (siblingRows.results || []).map(row => ({ id: row.id, code: row.code, storeName: row.store_name }));
    return json({ accounts: rows, siblingStores });
  }

  const transfersListMatch = pathname.match(/^\/api\/admin\/shared-accounts\/([^/]+)\/transfers$/);
  if (request.method === 'GET' && transfersListMatch) {
    const account = await getAccount(env.DB, decodeURIComponent(transfersListMatch[1]));
    if (!account || account.entityId !== scope.entityId) return json({ error: 'Rekening Bersama tidak ditemukan.' }, 404);
    const conditions = ['t.shared_account_id = ?'];
    const values = [account.id];
    if (scope.storeId && !scope.canManageAccounts) {
      conditions.push('(t.from_store_id = ? OR t.to_store_id = ?)');
      values.push(scope.storeId, scope.storeId);
    }
    const rows = await env.DB.prepare(`
      SELECT t.*, sFrom.code AS from_store_code, sFrom.store_name AS from_store_name,
             sTo.code AS to_store_code, sTo.store_name AS to_store_name
      FROM entity_shared_account_transfers t
      JOIN stores sFrom ON sFrom.id = t.from_store_id
      JOIN stores sTo ON sTo.id = t.to_store_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY t.created_at DESC
      LIMIT 200
    `).bind(...values).all();
    return json({ transfers: (rows.results || []).map(mapTransfer) });
  }

  if (request.method === 'POST' && transfersListMatch) {
    if (!scope.storeId) return json({ error: 'Transfer Rekening Bersama butuh konteks gerai pengirim (?store=).' }, 400);
    const account = await getAccount(env.DB, decodeURIComponent(transfersListMatch[1]));
    if (!account || account.entityId !== scope.entityId) return json({ error: 'Rekening Bersama tidak ditemukan.' }, 404);
    if (!account.isActive) return json({ error: 'Rekening Bersama ini nonaktif.' }, 400);

    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload transfer tidak valid.' }, 400);
    const amount = positiveInteger(body.value?.amount);
    if (!amount) return json({ error: 'Nominal transfer wajib bulat positif.' }, 400);
    const toStoreToken = text(body.value?.toStore, 80);
    if (!toStoreToken) return json({ error: 'Gerai tujuan transfer wajib diisi.' }, 400);
    const toStore = await resolveStore(env.DB, toStoreToken, { includeInactive: true });
    if (!toStore) return json({ error: 'Gerai tujuan tidak ditemukan.' }, 404);
    if (toStore.entityId !== scope.entityId) return json({ error: 'Gerai tujuan harus berada di entity yang sama.', code: 'SHARED_ACCOUNT_ENTITY_MISMATCH' }, 400);
    if (toStore.id === scope.storeId) return json({ error: 'Gerai tujuan tidak boleh sama dengan gerai pengirim.' }, 400);
    const reason = text(body.value?.reason, 300);

    const now = new Date().toISOString();
    const ledgerId = `shared_ledger_${crypto.randomUUID()}`;
    const transferId = `shared_transfer_${crypto.randomUUID()}`;
    const actorRole = scope.owner ? 'OWNER' : scope.entityAdmin ? 'ENTITY_ADMIN' : 'ADMIN';
    const actorId = scope.owner?.id || scope.entityAdmin?.id || scope.admin?.id || '';

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO entity_shared_account_ledger (id, shared_account_id, entity_id, store_id, direction, amount, source_type, source_id, note, created_by_role, created_by_id, created_at)
        VALUES (?, ?, ?, ?, 'OUT', ?, 'TRANSFER', ?, ?, ?, ?, ?)
      `).bind(ledgerId, account.id, scope.entityId, scope.storeId, amount, transferId, reason, actorRole, actorId, now),
      env.DB.prepare(`
        INSERT INTO entity_shared_account_transfers (id, shared_account_id, entity_id, from_store_id, to_store_id, amount, status, reason, out_ledger_id, created_by_role, created_by_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'IN_TRANSIT', ?, ?, ?, ?, ?)
      `).bind(transferId, account.id, scope.entityId, scope.storeId, toStore.id, amount, reason, ledgerId, actorRole, actorId, now)
    ]);

    return json({ ok: true, transfer: await getTransfer(env.DB, transferId) }, 201);
  }

  const completeMatch = pathname.match(/^\/api\/admin\/shared-accounts\/([^/]+)\/transfers\/([^/]+)\/complete$/);
  if (request.method === 'PATCH' && completeMatch) {
    const account = await getAccount(env.DB, decodeURIComponent(completeMatch[1]));
    if (!account || account.entityId !== scope.entityId) return json({ error: 'Rekening Bersama tidak ditemukan.' }, 404);
    const current = await getTransfer(env.DB, decodeURIComponent(completeMatch[2]));
    if (!current || current.sharedAccountId !== account.id) return json({ error: 'Transfer tidak ditemukan.' }, 404);
    if (!scope.canManageAccounts && scope.storeId !== current.toStoreId) {
      return json({ error: 'Hanya gerai tujuan (atau Entity Admin/Owner) yang boleh menyelesaikan transfer ini.', code: 'TRANSFER_COMPLETE_FORBIDDEN' }, 403);
    }
    if (current.status === 'COMPLETED') return json({ error: 'Transfer ini sudah pernah diselesaikan sebelumnya.', code: 'TRANSFER_ALREADY_COMPLETED' }, 409);

    const body = await readJson(request);
    const note = body.ok ? text(body.value?.note, 300) : '';
    const now = new Date().toISOString();
    const ledgerId = `shared_ledger_${crypto.randomUUID()}`;
    const actorRole = scope.owner ? 'OWNER' : scope.entityAdmin ? 'ENTITY_ADMIN' : 'ADMIN';
    const actorId = scope.owner?.id || scope.entityAdmin?.id || scope.admin?.id || '';

    // WHERE hanya id -- guard "tidak boleh complete dua kali" ditegakkan oleh
    // trg_shared_transfer_no_uncomplete (BEFORE UPDATE OF status, RAISE ABORT
    // kalau OLD.status sudah COMPLETED), bukan oleh WHERE status='IN_TRANSIT'.
    // Kalau WHERE yang menyaring, baris yang sudah COMPLETED tidak match sama
    // sekali sehingga trigger TIDAK PERNAH menyala dan UPDATE "sukses" dengan
    // 0 baris berubah -- padahal INSERT ledger IN di batch yang sama sudah
    // terlanjur commit, dobel-mencatat transfer yang sama. RAISE ABORT di
    // trigger membatalkan SELURUH batch (satu transaksi D1), termasuk INSERT
    // ledger-nya -- itu yang bikin race ini aman.
    try {
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO entity_shared_account_ledger (id, shared_account_id, entity_id, store_id, direction, amount, source_type, source_id, note, created_by_role, created_by_id, created_at)
          VALUES (?, ?, ?, ?, 'IN', ?, 'TRANSFER', ?, ?, ?, ?, ?)
        `).bind(ledgerId, account.id, scope.entityId, current.toStoreId, current.amount, current.id, note, actorRole, actorId, now),
        env.DB.prepare(`
          UPDATE entity_shared_account_transfers SET status = 'COMPLETED', in_ledger_id = ?, completed_by_role = ?, completed_by_id = ?, completed_at = ? WHERE id = ?
        `).bind(ledgerId, actorRole, actorId, now, current.id)
      ]);
    } catch (error) {
      if (String(error?.message || '').includes('SHARED_TRANSFER_ALREADY_COMPLETED')) {
        return json({ error: 'Transfer ini sudah pernah diselesaikan sebelumnya.', code: 'TRANSFER_ALREADY_COMPLETED' }, 409);
      }
      throw error;
    }

    return json({ ok: true, transfer: await getTransfer(env.DB, current.id) });
  }

  return json({ error: 'Route Rekening Bersama (gerai) tidak ditemukan.' }, 404);
}

export async function handleEntitySharedAccountApi(request, env, pathname) {
  if (!pathname.startsWith('/api/entity/shared-accounts') && !pathname.startsWith('/api/admin/shared-accounts')) return null;
  const scope = await sharedAccountScope(request, env);
  if (!scope.ok) return scope.response;

  const entityResponse = await handleEntitySettingsRoutes(request, env, pathname, scope);
  if (entityResponse) return entityResponse;
  return handleStoreRoutes(request, env, pathname, scope);
}

// Dipakai admin-accounting-settings-comfort.js (dropdown "Rekening Bersama"
// di form metode pembayaran) dan getAccountingSettingsBootstrap -- daftar
// ringan, tidak butuh breakdown/total.
export async function listActiveSharedAccountsForStore(db, storeId) {
  const store = await db.prepare(`SELECT entity_id FROM stores WHERE id = ?`).bind(storeId).first();
  if (!store?.entity_id) return [];
  const rows = await db.prepare(`
    SELECT id, name FROM entity_shared_accounts WHERE entity_id = ? AND is_active = 1 ORDER BY name COLLATE NOCASE
  `).bind(store.entity_id).all();
  return (rows.results || []).map(row => ({ id: row.id, name: row.name }));
}
