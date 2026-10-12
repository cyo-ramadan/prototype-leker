// Agen cetak: jalur "langsung ke printer" (ADR-055 D8).
//
// Server tidak bisa menyentuh printer di toko. Yang menyentuh adalah program kecil di PC mesin
// (percetakan-agen/agen-cetak.mjs) yang memegang KUNCI MESIN. Program itu menanyakan tugas mesinnya,
// mengunduh file, menaruhnya di hot folder software RIP (atau mencetak ke printer Windows), lalu
// melapor "terkirim". Begitu semua item satu order terkirim, order otomatis jadi DICETAK.
//
// Kunci mesin hanya bisa: melihat tugas mesin itu, mengunduh file tugas itu, dan melapor terkirim.
// Tidak bisa membaca order lain, mengubah harga, atau membatalkan.
import { json, readJson } from './http.js';
import { STATUS, catatEvent, percetakanAktif, sha256Hex, ubahStatus } from './percetakan.js';
import { r2Bucket } from './percetakan-wa.js';

const KEY_PREFIX = 'mesin_';

export async function buatKunciMesin(db, storeId, machineId) {
  const machine = await db.prepare('SELECT id FROM print_machines WHERE id = ? AND store_id = ?').bind(machineId, storeId).first();
  if (!machine) return null;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const key = KEY_PREFIX + [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  // Kunci lama otomatis tidak berlaku lagi (hash diganti).
  await db.prepare("UPDATE print_machines SET agent_key_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .bind(await sha256Hex(key), machine.id).run();
  return key;
}

async function mesinDariRequest(request, db) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token.startsWith(KEY_PREFIX)) return null;
  const machine = await db.prepare(`
    SELECT m.*, et.tenant_id
    FROM print_machines m
    JOIN stores s ON s.id = m.store_id
    LEFT JOIN entity_tenancy et ON et.entity_id = s.entity_id AND et.effective_to IS NULL
    WHERE m.agent_key_hash = ? AND m.is_active = 1 AND s.is_active = 1
  `).bind(await sha256Hex(token)).first();
  if (!machine || !await percetakanAktif(db, machine.tenant_id)) return null;
  return machine;
}

async function tugasMesin(db, machine) {
  const rows = (await db.prepare(`
    SELECT t.id AS ticket_id, t.queue_no, t.business_date, o.id AS order_id, o.order_no, o.customer_name,
           i.product_name, i.qty, i.width_cm, i.height_cm, i.note, f.file_name, f.size_bytes, f.sha256
    FROM print_queue_tickets t
    JOIN print_order_items i ON i.id = t.order_item_id
    JOIN print_orders o ON o.id = i.order_id
    JOIN print_files f ON f.id = i.file_id
    WHERE t.machine_id = ? AND t.dispatched_at IS NULL AND o.status = 'SIAP_CETAK' AND f.status = 'TERSIMPAN'
    ORDER BY t.business_date, t.queue_no
    LIMIT 10
  `).bind(machine.id).all()).results ?? [];
  return rows.map(row => ({
    ticketId: row.ticket_id,
    queueNo: row.queue_no,
    businessDate: row.business_date,
    orderId: row.order_id,
    orderNo: row.order_no,
    customerName: row.customer_name,
    productName: row.product_name,
    qty: row.qty,
    widthCm: row.width_cm,
    heightCm: row.height_cm,
    note: row.note,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    sha256: row.sha256
  }));
}

async function ticketMesin(db, machine, ticketId) {
  return db.prepare(`
    SELECT t.*, i.order_id, f.r2_key, f.mime, f.file_name, f.sha256, f.size_bytes, o.status AS order_status
    FROM print_queue_tickets t
    JOIN print_order_items i ON i.id = t.order_item_id
    JOIN print_orders o ON o.id = i.order_id
    LEFT JOIN print_files f ON f.id = i.file_id
    WHERE t.id = ? AND t.machine_id = ?
  `).bind(ticketId, machine.id).first();
}

async function tandaiTerkirim(db, machine, ticket, now = new Date()) {
  if (ticket.dispatched_at) return json({ ok: true, already: true });
  if (ticket.order_status !== STATUS.SIAP_CETAK) return json({ error: 'Order ini tidak lagi berstatus Siap cetak.' }, 409);
  const actor = { role: 'MESIN', id: machine.code };
  const sentAt = now.toISOString();
  const logged = await catatEvent(db, {
    storeId: machine.store_id, orderId: ticket.order_id, eventType: 'DIKIRIM_KE_MESIN', actor,
    note: `Antrian #${ticket.queue_no} dikirim ke ${machine.name}.`
  }, {
    now,
    extraStatements: [
      db.prepare('UPDATE print_queue_tickets SET dispatched_at = ? WHERE id = ? AND machine_id = ? AND dispatched_at IS NULL').bind(sentAt, ticket.id, machine.id),
      // Log Mesin: file dari antrian yang masuk mesin (Bos Cyo 2026-10-12).
      db.prepare(`
        INSERT INTO print_machine_jobs (id, store_id, machine_id, source, ticket_id, order_id, file_name, sha256, size_bytes, detected_at)
        VALUES (?, ?, ?, 'ANTRIAN', ?, ?, ?, ?, ?, ?)
      `).bind(`pmj_${crypto.randomUUID()}`, machine.store_id, machine.id, ticket.id, ticket.order_id, ticket.file_name || '',
        ticket.sha256 || null, ticket.size_bytes ?? null, sentAt)
    ]
  });
  if (!logged.ok) return json({ error: logged.error }, logged.status);

  const left = await db.prepare(`
    SELECT COUNT(*) AS n FROM print_queue_tickets t JOIN print_order_items i ON i.id = t.order_item_id
    WHERE i.order_id = ? AND t.dispatched_at IS NULL
  `).bind(ticket.order_id).first();
  if (!Number(left?.n)) {
    await ubahStatus(db, { storeId: machine.store_id, orderId: ticket.order_id, toStatus: STATUS.DICETAK, actor, note: 'Semua file order sudah masuk mesin.' }, { now });
  }
  return json({ ok: true, orderDone: !Number(left?.n) });
}

/** Route /api/percetakan/agen/* -- login pakai kunci mesin, bukan akun orang. */
export async function handleAgenApi(request, env, pathname) {
  const db = env.DB;
  const machine = await mesinDariRequest(request, db);
  if (!machine) return json({ error: 'Kunci mesin tidak valid.' }, 401);

  // Catat "terakhir terlihat" paling sering tiap 5 menit, supaya cek tugas tidak jadi tulis D1.
  const seen = Date.parse(machine.agent_last_seen_at || 0);
  if (!seen || Date.now() - seen > 5 * 60 * 1000) {
    await db.prepare('UPDATE print_machines SET agent_last_seen_at = ? WHERE id = ?').bind(new Date().toISOString(), machine.id).run();
  }

  if (request.method === 'GET' && pathname === '/api/percetakan/agen/tugas') {
    return json({ machine: { code: machine.code, name: machine.name }, tasks: await tugasMesin(db, machine) });
  }

  // File yang muncul di mesin TANPA lewat antrian (mis. ditaruh operator sendiri di hot folder).
  // Boleh, tapi tercatat sebagai LUAR_ANTRIAN dan menunggu catatan alasan dari operator.
  if (request.method === 'POST' && pathname === '/api/percetakan/agen/luar-antrian') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);
    const fileName = String(body.value?.fileName ?? '').trim().slice(0, 200);
    const sha256 = /^[0-9a-f]{64}$/.test(String(body.value?.sha256 || '')) ? body.value.sha256 : null;
    const sizeBytes = Number.isSafeInteger(Number(body.value?.sizeBytes)) ? Number(body.value.sizeBytes) : null;
    const detectedAt = Number.isFinite(Date.parse(body.value?.detectedAt)) ? new Date(body.value.detectedAt).toISOString() : new Date().toISOString();
    if (!fileName) return json({ error: 'Nama file wajib ada.' }, 400);
    // Kalau isinya sama persis dengan file salah satu order, catat order itu supaya mudah dicocokkan.
    const sama = sha256 ? await db.prepare(`
      SELECT i.order_id FROM print_files f JOIN print_order_items i ON i.file_id = f.id
      WHERE f.store_id = ? AND f.sha256 = ? ORDER BY f.created_at DESC LIMIT 1
    `).bind(machine.store_id, sha256).first() : null;
    const id = `pmj_${crypto.randomUUID()}`;
    await db.prepare(`
      INSERT INTO print_machine_jobs (id, store_id, machine_id, source, order_id, file_name, sha256, size_bytes, detected_at)
      VALUES (?, ?, ?, 'LUAR_ANTRIAN', ?, ?, ?, ?, ?)
    `).bind(id, machine.store_id, machine.id, sama?.order_id ?? null, fileName, sha256, sizeBytes, detectedAt).run();
    return json({ ok: true, id, matchedOrder: Boolean(sama) }, 201);
  }

  const match = pathname.match(/^\/api\/percetakan\/agen\/tugas\/([^/]+)\/(file|terkirim)$/);
  if (match) {
    const ticket = await ticketMesin(db, machine, match[1]);
    if (!ticket) return json({ error: 'Tugas tidak ditemukan untuk mesin ini.' }, 404);
    if (request.method === 'GET' && match[2] === 'file') {
      const object = ticket.r2_key && r2Bucket(env) ? await r2Bucket(env).get(ticket.r2_key) : null;
      if (!object) return json({ error: 'File belum tersimpan.' }, 404);
      return new Response(object.body, { headers: { 'content-type': ticket.mime || 'application/octet-stream', 'cache-control': 'no-store' } });
    }
    if (request.method === 'POST' && match[2] === 'terkirim') return tandaiTerkirim(db, machine, ticket);
  }
  return json({ error: 'Route agen tidak ditemukan.' }, 404);
}
