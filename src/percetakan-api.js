// Route /api/percetakan/* (ADR-055). Login karyawan (kasir) atau manajemen (Owner/Admin
// Gerai/Entity Admin + ?store=). Semua query dikunci store_id dari login, dan tenant gerainya wajib
// memilih skin G · Percetakan (percetakanAktif) -- tenant lain tidak merasakan modul ini sama sekali.
import { json, readJson } from './http.js';
import { resolveStore } from './stores.js';
import { requireCashier } from './cashier-auth.js';
import { requireManagement } from './owner-auth.js';
import {
  MANAGEMENT_ROLES, UNITS, buatOrder, percetakanAktif, detailOrder, machinesForStore, mapItem, mapOrder, normalizePhone,
  productsForStore, rupiahToScaled, scaledToRupiahText, ubahStatus
} from './percetakan.js';
import { r2Bucket, simulasiPesan, terimaWebhookMeta, unduhMediaMeta, verifikasiLangganan } from './percetakan-wa.js';
import { bacaChatOrder } from './percetakan-una.js';
import { aiConfigured } from './caca-ai-client.js';
import { MODES, modeGerai, pendingMessages, simpanDraft, simpanMode, draftedMessageIds } from './percetakan-otomatis.js';
import { buatKunciMesin, handleAgenApi } from './percetakan-mesin.js';

const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const code = value => String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);

/** Siapa yang memanggil + gerai mana. Kasir: gerai akunnya. Manajemen: ?store= yang sudah dicek wewenangnya. */
async function aktor(request, env) {
  const db = env.DB;
  const kasir = await requireCashier(request, db);
  let store;
  let actor;
  if (kasir.ok && !kasir.readOnly) {
    store = await resolveStore(db, kasir.cashier.store.id);
    actor = { role: 'CASHIER', id: kasir.cashier.id, name: kasir.cashier.employeeName || kasir.cashier.username };
  } else {
    const storeParam = new URL(request.url).searchParams.get('store');
    if (!storeParam) return { ok: false, response: json({ error: 'Pilih gerai dulu (?store=).' }, 400) };
    const management = await requireManagement(request, db, env);
    if (!management.ok) return management;
    // Tanpa identitas orang (PIN lama / token agen) tidak boleh menulis riwayat order.
    const roleByAuth = { OWNER: 'OWNER', ADMIN: 'ADMIN', ENTITY_ADMIN: 'ENTITY_ADMIN' };
    const role = roleByAuth[management.authType];
    if (!role) return { ok: false, response: json({ error: 'Login Owner/Admin dengan akun sendiri diperlukan.' }, 403) };
    const person = management.owner || management.admin || management.entityAdmin;
    store = await resolveStore(db, storeParam, { includeInactive: true });
    actor = { role, id: person.id, name: person.displayName || person.username };
  }
  if (!store) return { ok: false, response: json({ error: 'Gerai tidak ditemukan.' }, 404) };
  if (!await percetakanAktif(db, store.tenantId)) {
    return { ok: false, response: json({ error: 'Fitur Percetakan belum aktif: pilih skin "G · Percetakan" di Kebijakan tenant.', code: 'SKIN_PERCETAKAN_OFF' }, 403) };
  }
  return { ok: true, store, actor, isManagement: MANAGEMENT_ROLES.includes(actor.role) };
}

const onlyManagement = auth => (auth.isManagement ? null : json({ error: 'Hanya Owner atau Admin yang boleh mengubah ini.' }, 403));

function mapProduct(product) {
  return {
    id: product.id,
    code: product.code,
    name: product.name,
    unit: product.unit,
    unitPriceText: scaledToRupiahText(product.unit_price_scaled),
    unitPriceRupiah: Number(BigInt(product.unit_price_scaled) / 1_000_000n),
    machineId: product.machine_id,
    machineName: product.machine_name,
    keywords: product.keywords,
    isActive: Boolean(product.is_active)
  };
}

async function upsertMachine(db, storeId, body) {
  const machineCode = code(body?.code);
  const name = text(body?.name, 80);
  if (!machineCode || !name) return json({ error: 'Kode dan nama mesin wajib diisi.' }, 400);
  const isActive = body?.isActive === false ? 0 : 1;
  await db.prepare(`
    INSERT INTO print_machines (id, store_id, code, name, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (store_id, code) DO UPDATE SET name = excluded.name, is_active = excluded.is_active,
      sort_order = excluded.sort_order, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(`pmac_${crypto.randomUUID()}`, storeId, machineCode, name, isActive, Number.parseInt(body?.sortOrder, 10) || 0).run();
  return json({ ok: true }, 201);
}

async function upsertProduct(db, storeId, body) {
  const productCode = code(body?.code);
  const name = text(body?.name, 120);
  const unit = text(body?.unit, 10).toUpperCase();
  const price = rupiahToScaled(body?.unitPriceRupiah);
  if (!productCode || !name) return json({ error: 'Kode dan nama produk wajib diisi.' }, 400);
  if (!UNITS.includes(unit)) return json({ error: 'Satuan wajib M2, LEMBAR, atau PCS.' }, 400);
  if (price === null) return json({ error: 'Harga wajib rupiah bulat.' }, 400);
  const machine = await db.prepare('SELECT id FROM print_machines WHERE id = ? AND store_id = ?').bind(text(body?.machineId, 80), storeId).first();
  if (!machine) return json({ error: 'Mesin tujuan tidak ditemukan di gerai ini.' }, 400);
  await db.prepare(`
    INSERT INTO print_products (id, store_id, code, name, unit, unit_price_scaled, machine_id, keywords, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (store_id, code) DO UPDATE SET name = excluded.name, unit = excluded.unit,
      unit_price_scaled = excluded.unit_price_scaled, machine_id = excluded.machine_id, keywords = excluded.keywords,
      is_active = excluded.is_active, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(`pprd_${crypto.randomUUID()}`, storeId, productCode, name, unit, Number(price), machine.id,
    text(body?.keywords, 300), body?.isActive === false ? 0 : 1).run();
  return json({ ok: true }, 201);
}

async function inbox(db, storeId) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = (await db.prepare(`
    SELECT m.id, m.from_number, m.from_name, m.kind, m.body_text, m.media_file_name, m.sent_at, m.provider,
           f.id AS file_id, f.status AS file_status, f.error AS file_error, f.size_bytes
    FROM wa_inbound_messages m LEFT JOIN print_files f ON f.message_id = m.id
    WHERE m.store_id = ? AND m.sent_at >= ?
    ORDER BY m.sent_at DESC LIMIT 500
  `).bind(storeId, since).all()).results ?? [];
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.from_number)) groups.set(row.from_number, { fromNumber: row.from_number, fromName: '', lastAt: row.sent_at, messages: [] });
    const group = groups.get(row.from_number);
    if (!group.fromName && row.from_name) group.fromName = row.from_name;
    group.messages.push({
      id: row.id,
      sentAt: row.sent_at,
      kind: row.kind,
      text: row.body_text,
      simulated: row.provider === 'SIMULATOR',
      file: row.file_id ? { id: row.file_id, status: row.file_status, fileName: row.media_file_name || '', error: row.file_error, sizeBytes: row.size_bytes } : null
    });
  }
  const result = [];
  for (const group of groups.values()) {
    const drafted = await draftedMessageIds(db, storeId, group.fromNumber);
    group.messages.reverse();
    for (const message of group.messages) message.processed = drafted.has(message.id);
    group.unprocessed = group.messages.filter(message => !message.processed).length;
    result.push(group);
  }
  return result;
}

function mapDraft(row) {
  let proposal = {};
  let messageIds = [];
  try { proposal = JSON.parse(row.proposal_json); } catch { proposal = {}; }
  try { messageIds = JSON.parse(row.message_ids_json); } catch { messageIds = []; }
  return {
    id: row.id,
    fromNumber: row.from_number,
    source: row.source,
    aiModel: row.ai_model,
    status: row.status,
    proposal,
    messageIds,
    orderId: row.order_id,
    createdAt: row.created_at
  };
}

async function listOrders(db, storeId, url) {
  const status = text(url.searchParams.get('status'), 20).toUpperCase();
  const phone = normalizePhone(url.searchParams.get('phone'));
  const where = ['store_id = ?'];
  const args = [storeId];
  if (status === 'AKTIF') where.push("status NOT IN ('DIAMBIL', 'BATAL')");
  else if (status) { where.push('status = ?'); args.push(status); }
  if (phone) { where.push('customer_phone = ?'); args.push(phone); }
  const rows = (await db.prepare(`SELECT * FROM print_orders WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 200`).bind(...args).all()).results ?? [];
  return rows.map(mapOrder);
}

async function antrian(db, storeId, machineId) {
  const rows = (await db.prepare(`
    SELECT m.id AS machine_id, m.name AS machine_name, t.queue_no, t.business_date, o.id AS order_id, o.order_no,
           o.status, o.customer_name, o.customer_phone, o.due_at, o.created_by_role, i.product_name, i.qty, i.width_cm,
           i.height_cm, i.file_id, i.note, t.dispatched_at
    FROM print_queue_tickets t
    JOIN print_machines m ON m.id = t.machine_id
    JOIN print_order_items i ON i.id = t.order_item_id
    JOIN print_orders o ON o.id = i.order_id
    WHERE t.store_id = ? AND (? = '' OR t.machine_id = ?)
      AND o.status IN ('BARU', 'DESAIN', 'SIAP_CETAK', 'DICETAK', 'FINISHING')
    ORDER BY m.sort_order, m.name, t.business_date, t.queue_no
  `).bind(storeId, machineId || '', machineId || '').all()).results ?? [];
  const machines = new Map();
  for (const row of rows) {
    if (!machines.has(row.machine_id)) machines.set(row.machine_id, { machineId: row.machine_id, machineName: row.machine_name, tickets: [] });
    machines.get(row.machine_id).tickets.push({
      queueNo: row.queue_no,
      businessDate: row.business_date,
      orderId: row.order_id,
      orderNo: row.order_no,
      status: row.status,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      dueAt: row.due_at,
      productName: row.product_name,
      qty: row.qty,
      widthCm: row.width_cm,
      heightCm: row.height_cm,
      fileId: row.file_id,
      note: row.note,
      automatic: row.created_by_role === 'SYSTEM',
      dispatchedAt: row.dispatched_at
    });
  }
  return [...machines.values()];
}

export async function handlePercetakanApi(request, env, pathname, { waitUntil } = {}) {
  if (!pathname.startsWith('/api/percetakan/')) return null;
  const db = env.DB;
  const url = new URL(request.url);

  // Webhook Meta: tanpa login, dijaga verify token (GET) dan tanda tangan HMAC (POST).
  if (pathname === '/api/percetakan/wa/webhook') {
    if (request.method === 'GET') return verifikasiLangganan(url, env);
    if (request.method === 'POST') return terimaWebhookMeta(request, env, { waitUntil });
    return json({ error: 'Method tidak didukung.' }, 405);
  }

  // Agen cetak di PC mesin: login pakai kunci mesin, bukan akun orang.
  if (pathname.startsWith('/api/percetakan/agen/')) return handleAgenApi(request, env, pathname);

  const auth = await aktor(request, env);
  if (!auth.ok) return auth.response;
  const storeId = auth.store.id;
  const body = ['POST', 'PATCH'].includes(request.method) && !pathname.startsWith('/api/percetakan/files/')
    ? await readJson(request) : { ok: true, value: {} };
  // Tombol tanpa isi (mis. "Buat kunci agen") boleh tanpa body; JSON rusak tetap ditolak.
  if (!body.ok && (request.headers.get('content-type') || '').includes('json')) return json({ error: 'Payload tidak valid.' }, 400);
  const input = body.value ?? {};

  if (request.method === 'GET' && pathname === '/api/percetakan/setup') {
    const channels = (await db.prepare('SELECT id, provider, phone_number_id, display_number, is_active FROM wa_channels WHERE store_id = ?').bind(storeId).all()).results ?? [];
    return json({
      store: { id: auth.store.id, code: auth.store.code, name: auth.store.storeName },
      actor: auth.actor,
      isManagement: auth.isManagement,
      mode: await modeGerai(db, storeId),
      modes: MODES,
      machines: (await machinesForStore(db, storeId)).map(machine => ({
        id: machine.id, code: machine.code, name: machine.name, isActive: Boolean(machine.is_active),
        hasAgentKey: Boolean(machine.agent_key_hash), agentLastSeenAt: machine.agent_last_seen_at
      })),
      products: (await productsForStore(db, storeId, { activeOnly: false })).map(mapProduct),
      channels: channels.map(channel => ({ id: channel.id, provider: channel.provider, phoneNumberId: channel.phone_number_id, displayNumber: channel.display_number, isActive: Boolean(channel.is_active) })),
      aiReady: aiConfigured(env),
      storageReady: Boolean(r2Bucket(env))
    });
  }

  if (request.method === 'POST' && pathname === '/api/percetakan/machines') return onlyManagement(auth) || upsertMachine(db, storeId, input);

  if (request.method === 'POST' && pathname === '/api/percetakan/settings') {
    const denied = onlyManagement(auth);
    if (denied) return denied;
    const mode = text(input.mode, 20).toUpperCase();
    if (!await simpanMode(db, storeId, mode, auth.actor)) return json({ error: `Mode wajib salah satu: ${MODES.join(', ')}.` }, 400);
    return json({ ok: true, mode });
  }

  const keyMatch = pathname.match(/^\/api\/percetakan\/machines\/([^/]+)\/kunci$/);
  if (request.method === 'POST' && keyMatch) {
    const denied = onlyManagement(auth);
    if (denied) return denied;
    const key = await buatKunciMesin(db, storeId, keyMatch[1]);
    if (!key) return json({ error: 'Mesin tidak ditemukan di gerai ini.' }, 404);
    // Teks kunci hanya muncul sekali di sini; server cuma menyimpan sidiknya.
    return json({ ok: true, key }, 201);
  }
  if (request.method === 'POST' && pathname === '/api/percetakan/products') return onlyManagement(auth) || upsertProduct(db, storeId, input);

  if (request.method === 'POST' && pathname === '/api/percetakan/channels') {
    const denied = onlyManagement(auth);
    if (denied) return denied;
    const phoneNumberId = text(input.phoneNumberId, 60).replace(/\D/g, '');
    if (!phoneNumberId) return json({ error: 'Phone number ID dari Meta wajib diisi.' }, 400);
    const taken = await db.prepare("SELECT store_id FROM wa_channels WHERE provider = 'META_CLOUD' AND phone_number_id = ?").bind(phoneNumberId).first();
    if (taken && taken.store_id !== storeId) return json({ error: 'Nomor WA ini sudah dipakai gerai lain.' }, 409);
    if (!taken) {
      await db.prepare("INSERT INTO wa_channels (id, store_id, provider, phone_number_id, display_number) VALUES (?, ?, 'META_CLOUD', ?, ?)")
        .bind(`wach_${crypto.randomUUID()}`, storeId, phoneNumberId, text(input.displayNumber, 30)).run();
    }
    return json({ ok: true }, 201);
  }

  if (request.method === 'POST' && pathname === '/api/percetakan/wa/simulasi') {
    const denied = onlyManagement(auth);
    if (denied) return denied;
    const result = await simulasiPesan(env, storeId, input);
    return result.ok ? json(result, 201) : json({ error: result.error }, result.status);
  }

  if (request.method === 'GET' && pathname === '/api/percetakan/inbox') return json({ conversations: await inbox(db, storeId) });

  if (request.method === 'POST' && (pathname === '/api/percetakan/drafts/baca' || pathname === '/api/percetakan/drafts/manual')) {
    const fromNumber = normalizePhone(input.fromNumber);
    if (!fromNumber) return json({ error: 'Nomor pelanggan wajib diisi.' }, 400);
    const messages = await pendingMessages(db, storeId, fromNumber);
    if (!messages.length) return json({ error: 'Tidak ada pesan baru dari nomor ini yang belum diproses.' }, 409);
    let proposal = { customerName: messages.find(message => message.from_name)?.from_name || '', dueText: '', items: [], questions: [] };
    let model = '';
    let source = 'MANUAL';
    if (pathname.endsWith('/baca')) {
      const products = await productsForStore(db, storeId);
      const filesByMessageId = new Map(messages.filter(message => message.file_id).map(message => [message.id, message.file_id]));
      const read = await bacaChatOrder(env, { messages, products, filesByMessageId });
      if (!read.ok) return json({ error: read.error }, read.status);
      proposal = { ...read.proposal, customerName: read.proposal.customerName || proposal.customerName };
      model = read.model;
      source = 'AI';
    }
    const draftId = await simpanDraft(db, { storeId, fromNumber, messages, proposal, source, model });
    if (!draftId) return json({ error: 'Pesan ini baru saja diproses. Muat ulang.' }, 409);
    const row = await db.prepare('SELECT * FROM print_order_drafts WHERE id = ?').bind(draftId).first();
    return json({ draft: mapDraft(row) }, 201);
  }

  if (request.method === 'GET' && pathname === '/api/percetakan/drafts') {
    const rows = (await db.prepare("SELECT * FROM print_order_drafts WHERE store_id = ? AND status = 'MENUNGGU' ORDER BY created_at").bind(storeId).all()).results ?? [];
    return json({ drafts: rows.map(mapDraft) });
  }

  const draftAction = pathname.match(/^\/api\/percetakan\/drafts\/([^/]+)\/(konfirmasi|tolak)$/);
  if (request.method === 'POST' && draftAction) {
    const draft = await db.prepare("SELECT * FROM print_order_drafts WHERE id = ? AND store_id = ? AND status = 'MENUNGGU'").bind(draftAction[1], storeId).first();
    if (!draft) return json({ error: 'Draft tidak ditemukan atau sudah diputuskan.' }, 404);
    if (draftAction[2] === 'tolak') {
      await db.prepare(`
        UPDATE print_order_drafts SET status = 'DITOLAK', decided_by_role = ?, decided_by_id = ?, decided_at = ?
        WHERE id = ? AND store_id = ? AND status = 'MENUNGGU'
      `).bind(auth.actor.role, auth.actor.id, new Date().toISOString(), draft.id, storeId).run();
      return json({ ok: true });
    }
    const created = await buatOrder(db, {
      storeId, actor: auth.actor, source: 'WA', draftId: draft.id, customerPhone: draft.from_number,
      customerName: input.customerName, dueAt: input.dueAt, note: input.note, items: input.items
    });
    return created.ok ? json(created, 201) : json({ error: created.error }, created.status);
  }

  if (request.method === 'POST' && pathname === '/api/percetakan/orders') {
    const created = await buatOrder(db, {
      storeId, actor: auth.actor, source: 'WALKIN', customerPhone: input.customerPhone,
      customerName: input.customerName, dueAt: input.dueAt, note: input.note, items: input.items
    });
    return created.ok ? json(created, 201) : json({ error: created.error }, created.status);
  }

  if (request.method === 'GET' && pathname === '/api/percetakan/orders') return json({ orders: await listOrders(db, storeId, url) });

  const orderMatch = pathname.match(/^\/api\/percetakan\/orders\/([^/]+)(\/status)?$/);
  if (orderMatch && request.method === 'GET' && !orderMatch[2]) {
    const detail = await detailOrder(db, storeId, orderMatch[1]);
    if (!detail) return json({ error: 'Order tidak ditemukan.' }, 404);
    return json({
      order: mapOrder(detail.order),
      items: detail.items.map(mapItem),
      events: detail.events.map(event => ({
        seq: event.seq, eventType: event.event_type, fromStatus: event.from_status, toStatus: event.to_status,
        actorRole: event.actor_role, actorId: event.actor_id, note: event.note, createdAt: event.created_at
      })),
      verification: detail.verification
    });
  }
  if (orderMatch && request.method === 'POST' && orderMatch[2]) {
    const changed = await ubahStatus(db, { storeId, orderId: orderMatch[1], toStatus: input.toStatus, actor: auth.actor, note: input.note });
    return changed.ok ? json(changed) : json({ error: changed.error }, changed.status);
  }

  if (request.method === 'GET' && pathname === '/api/percetakan/antrian') {
    return json({ machines: await antrian(db, storeId, text(url.searchParams.get('machine'), 80)) });
  }

  const fileMatch = pathname.match(/^\/api\/percetakan\/files\/([^/]+)(\/ulang)?$/);
  if (fileMatch) {
    const file = await db.prepare(`
      SELECT f.*, m.media_id, m.media_file_name FROM print_files f JOIN wa_inbound_messages m ON m.id = f.message_id
      WHERE f.id = ? AND f.store_id = ?
    `).bind(fileMatch[1], storeId).first();
    if (!file) return json({ error: 'File tidak ditemukan.' }, 404);
    if (request.method === 'POST' && fileMatch[2]) {
      if (file.status !== 'GAGAL' || !file.media_id) return json({ error: 'File ini tidak perlu diambil ulang.' }, 409);
      await db.prepare("UPDATE print_files SET status = 'MENUNGGU', error = '' WHERE id = ? AND status = 'GAGAL'").bind(file.id).run();
      const result = await unduhMediaMeta(env, { storeId, fileId: file.id, mediaId: file.media_id, fileName: file.media_file_name });
      return json({ ok: result.ok });
    }
    if (request.method === 'GET' && !fileMatch[2]) {
      const object = file.r2_key && r2Bucket(env) ? await r2Bucket(env).get(file.r2_key) : null;
      if (!object) return json({ error: 'Isi file belum tersimpan.' }, 404);
      const name = String(file.file_name || 'file').replace(/["\r\n]/g, '');
      return new Response(object.body, {
        headers: {
          'content-type': file.mime || 'application/octet-stream',
          'content-disposition': `attachment; filename="${name}"`,
          'cache-control': 'private, no-store'
        }
      });
    }
  }

  return json({ error: 'Route percetakan tidak ditemukan.' }, 404);
}
