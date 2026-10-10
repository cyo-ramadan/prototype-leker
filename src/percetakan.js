// Modul Percetakan -- inti order cetak (ADR-055).
//
// Bos Cyo, 2026-10-10: "customer pesan2 dari wa dan kirim filenya, terus waktu eksekusi pesan itu
// tadi langsung berubah jadi task dengan detil rinciannya, dan sudah terotomatisasi harus print
// dimana, antrian nomor berapa dsb. ini juga diperlukan untuk tracking agar orderan itu tidak
// dipalsukan oleh karyawan."
//
// File ini memegang aturan yang tidak boleh ditawar:
//   - Harga selalu dari master produk gerai (print_products), dibekukan di item saat order dibuat.
//     AI dan karyawan tidak pernah mengetik harga.
//   - Mesin tujuan mengikuti produk; nomor antrian dibagikan server per mesin per tanggal bisnis.
//   - Setiap perubahan status = satu event di rantai hash (print_order_events). Event DIBUAT
//     menyimpan sidik isi order, jadi mengubah total/item langsung di database ikut ketahuan.
//   - Uang scaled INTEGER: 1 rupiah = 1.000.000 unit (invariant #1). Tanpa float.
import { getJakartaBusinessDate } from './time.js';

export const MONEY_SCALE = 1_000_000n;
export const UNITS = Object.freeze(['M2', 'LEMBAR', 'PCS']);
export const STATUS = Object.freeze({
  BARU: 'BARU',
  DESAIN: 'DESAIN',
  SIAP_CETAK: 'SIAP_CETAK',
  DICETAK: 'DICETAK',
  FINISHING: 'FINISHING',
  SIAP_AMBIL: 'SIAP_AMBIL',
  DIAMBIL: 'DIAMBIL',
  BATAL: 'BATAL'
});

// Langkah maju yang boleh. BATAL hanya boleh sebelum barang selesai dicetak, dan hanya oleh
// manajemen (lihat bolehUbahStatus). Tidak ada jalan mundur: salah langkah dicatat sebagai
// catatan di event berikutnya, bukan dihapus.
const TRANSITIONS = Object.freeze({
  BARU: ['DESAIN', 'SIAP_CETAK', 'BATAL'],
  DESAIN: ['SIAP_CETAK', 'BATAL'],
  SIAP_CETAK: ['DICETAK', 'BATAL'],
  DICETAK: ['FINISHING', 'SIAP_AMBIL'],
  FINISHING: ['SIAP_AMBIL'],
  SIAP_AMBIL: ['DIAMBIL'],
  DIAMBIL: [],
  BATAL: []
});

export const MANAGEMENT_ROLES = Object.freeze(['OWNER', 'ADMIN', 'ENTITY_ADMIN']);
export const GENESIS_HASH = '0'.repeat(64);

const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);

export function normalizePhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  return /^\d{8,15}$/.test(digits) ? digits : '';
}

/** Rupiah bulat (angka atau string "15.000") -> scaled BigInt; null kalau tidak valid. */
export function rupiahToScaled(value) {
  const digits = String(value ?? '').replace(/[.\s]/g, '');
  if (!/^\d{1,13}$/.test(digits)) return null;
  return BigInt(digits) * MONEY_SCALE;
}

export function scaledToRupiahText(scaled) {
  const value = BigInt(scaled);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = (abs / MONEY_SCALE).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}Rp${whole}`;
}

function positiveInt(value, max) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= max ? number : null;
}

/**
 * Subtotal satu item, scaled BigInt. M2: harga/m2 x lebar x tinggi x jumlah, ukuran dalam cm
 * (1 m2 = 10.000 cm2), dibulatkan half-up ke unit terkecil. LEMBAR/PCS: harga x jumlah.
 */
export function hitungSubtotal({ unit, unitPriceScaled, qty, widthCm, heightCm }) {
  const price = BigInt(unitPriceScaled);
  const count = BigInt(qty);
  if (unit !== 'M2') return price * count;
  const numerator = price * BigInt(widthCm) * BigInt(heightCm) * count;
  return (numerator + 5_000n) / 10_000n;
}

/** Validasi + hitung satu baris order terhadap master produk. Mengembalikan { ok, item | error }. */
export function siapkanItem(raw, product, lineNo) {
  if (!product) return { ok: false, error: `Baris ${lineNo}: produk tidak ditemukan di gerai ini.` };
  const qty = positiveInt(raw?.qty, 100_000);
  if (!qty) return { ok: false, error: `Baris ${lineNo}: jumlah wajib angka bulat positif.` };
  let widthCm = null;
  let heightCm = null;
  if (product.unit === 'M2') {
    widthCm = positiveInt(raw?.widthCm, 100_000);
    heightCm = positiveInt(raw?.heightCm, 100_000);
    if (!widthCm || !heightCm) return { ok: false, error: `Baris ${lineNo}: ${product.name} dihitung per meter, ukuran lebar dan tinggi (cm) wajib diisi.` };
  }
  const unitPriceScaled = BigInt(product.unit_price_scaled);
  const subtotalScaled = hitungSubtotal({ unit: product.unit, unitPriceScaled, qty, widthCm, heightCm });
  return {
    ok: true,
    item: {
      lineNo,
      productId: product.id,
      productName: product.name,
      machineId: product.machine_id,
      unit: product.unit,
      qty,
      widthCm,
      heightCm,
      unitPriceScaled,
      subtotalScaled,
      fileId: text(raw?.fileId, 80) || null,
      note: text(raw?.note, 300)
    }
  };
}

export function bolehUbahStatus(fromStatus, toStatus, role) {
  if (!(TRANSITIONS[fromStatus] || []).includes(toStatus)) {
    return { ok: false, error: `Status ${fromStatus} tidak bisa langsung jadi ${toStatus}.` };
  }
  if (toStatus === STATUS.BATAL && !MANAGEMENT_ROLES.includes(role)) {
    return { ok: false, error: 'Membatalkan order hanya boleh Admin atau Owner.' };
  }
  return { ok: true };
}

export function nextStatuses(status) {
  return [...(TRANSITIONS[status] || [])];
}

export function orderNumber(businessDate, seq) {
  return `CTK-${businessDate.slice(2).replace(/-/g, '')}-${String(seq).padStart(3, '0')}`;
}

export async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Sidik isi order: semua yang menentukan uang dan pekerjaan. */
export async function orderSnapshotHash(order, items) {
  const canonical = JSON.stringify([
    order.id, order.store_id, order.order_no, order.customer_phone, order.source, String(order.total_scaled),
    [...items].sort((a, b) => a.line_no - b.line_no).map(item => [
      item.line_no, item.product_id, item.machine_id, item.unit, item.qty, item.width_cm ?? null, item.height_cm ?? null,
      String(item.unit_price_scaled), String(item.subtotal_scaled), item.file_id ?? null
    ])
  ]);
  return sha256Hex(canonical);
}

export async function eventHash(event) {
  return sha256Hex(JSON.stringify([
    event.prev_hash, event.order_id, event.store_id, event.seq, event.event_type, event.from_status ?? null,
    event.to_status, event.actor_role, event.actor_id, event.note ?? '', event.photo_key ?? null,
    event.payload_json ?? '{}', event.created_at
  ]));
}

/** Memeriksa rantai riwayat satu order. Mengembalikan { ok, problems[] }. */
export async function verifikasiRiwayat(order, items, events) {
  const problems = [];
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  let prev = GENESIS_HASH;
  for (const [index, event] of sorted.entries()) {
    if (event.seq !== index + 1) problems.push(`Urutan riwayat bolong di langkah ${index + 1}.`);
    if (event.prev_hash !== prev) problems.push(`Riwayat langkah ${event.seq} tidak menyambung ke langkah sebelumnya.`);
    if (await eventHash(event) !== event.hash) problems.push(`Isi riwayat langkah ${event.seq} sudah diubah.`);
    prev = event.hash;
  }
  const created = sorted[0];
  if (!created || created.event_type !== 'DIBUAT') {
    problems.push('Riwayat pembuatan order tidak ada.');
  } else {
    let snapshot = null;
    try { snapshot = JSON.parse(created.payload_json || '{}').snapshot; } catch { snapshot = null; }
    if (snapshot !== await orderSnapshotHash(order, items)) problems.push('Isi order (harga/jumlah/item) berbeda dari saat order dibuat.');
  }
  const last = sorted[sorted.length - 1];
  if (last && last.to_status !== order.status) problems.push(`Status order (${order.status}) tidak sama dengan riwayat terakhir (${last.to_status}).`);
  return { ok: problems.length === 0, problems };
}

// --- Database ---------------------------------------------------------------------------------

export async function productsForStore(db, storeId, { activeOnly = true } = {}) {
  const rows = await db.prepare(`
    SELECT p.*, m.code AS machine_code, m.name AS machine_name
    FROM print_products p JOIN print_machines m ON m.id = p.machine_id
    WHERE p.store_id = ? ${activeOnly ? 'AND p.is_active = 1' : ''}
    ORDER BY p.name COLLATE NOCASE
  `).bind(storeId).all();
  return rows.results ?? [];
}

export async function machinesForStore(db, storeId) {
  const rows = await db.prepare('SELECT * FROM print_machines WHERE store_id = ? ORDER BY sort_order, name COLLATE NOCASE').bind(storeId).all();
  return rows.results ?? [];
}

async function nextOrderSeq(db, storeId, businessDate) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM print_orders WHERE store_id = ? AND business_date = ?').bind(storeId, businessDate).first();
  return Number(row?.n || 0) + 1;
}

async function nextQueueNos(db, storeId, businessDate, machineIds) {
  const result = new Map();
  for (const machineId of new Set(machineIds)) {
    const row = await db.prepare('SELECT MAX(queue_no) AS n FROM print_queue_tickets WHERE store_id = ? AND machine_id = ? AND business_date = ?')
      .bind(storeId, machineId, businessDate).first();
    result.set(machineId, Number(row?.n || 0));
  }
  return result;
}

// D1 menerima angka JS biasa; nilai scaled dihitung BigInt lalu dikirim sebagai Number yang
// dijamin aman (<= 2^53, setara Rp9 miliar per order) -- pola yang sama dengan accounting-ledger.
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const toDb = value => Number(value);

const isUniqueConflict = error => /UNIQUE constraint failed/i.test(String(error?.message || error));

/**
 * Membuat order + item + tiket antrian + event DIBUAT dalam satu batch. Nomor order dan antrian
 * dialokasikan dari isi tabel; bentrok UNIQUE (dua order di detik yang sama) diulang.
 * input: { storeId, actor:{role,id}, source:'WA'|'WALKIN', draftId?, customerPhone, customerName,
 *          dueAt?, note?, items:[{productId, qty, widthCm?, heightCm?, fileId?, note?}] }
 */
export async function buatOrder(db, input, { now = new Date() } = {}) {
  const customerPhone = normalizePhone(input.customerPhone);
  if (!customerPhone) return { ok: false, status: 400, error: 'Nomor WA pelanggan tidak valid.' };
  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (!rawItems.length || rawItems.length > 50) return { ok: false, status: 400, error: 'Order wajib berisi 1 sampai 50 item.' };

  const products = new Map((await productsForStore(db, input.storeId)).map(product => [product.id, product]));
  const items = [];
  for (const [index, raw] of rawItems.entries()) {
    const prepared = siapkanItem(raw, products.get(text(raw?.productId, 80)), index + 1);
    if (!prepared.ok) return { ok: false, status: 400, error: prepared.error };
    items.push(prepared.item);
  }
  const fileIds = items.map(item => item.fileId).filter(Boolean);
  for (const fileId of fileIds) {
    const file = await db.prepare('SELECT id FROM print_files WHERE id = ? AND store_id = ?').bind(fileId, input.storeId).first();
    if (!file) return { ok: false, status: 400, error: 'File order tidak ditemukan di gerai ini.' };
  }

  const businessDate = getJakartaBusinessDate(now);
  const createdAt = now.toISOString();
  const total = items.reduce((sum, item) => sum + item.subtotalScaled, 0n);
  if (total > MAX_SAFE) return { ok: false, status: 400, error: 'Total order terlalu besar.' };

  // Bentrok UNIQUE berarti order lain baru saja mengambil nomor yang sama; baca ulang lalu coba lagi.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const orderId = `pord_${crypto.randomUUID()}`;
    const order = {
      id: orderId,
      store_id: input.storeId,
      order_no: orderNumber(businessDate, await nextOrderSeq(db, input.storeId, businessDate)),
      business_date: businessDate,
      customer_phone: customerPhone,
      customer_name: text(input.customerName, 120),
      source: input.source === 'WALKIN' ? 'WALKIN' : 'WA',
      draft_id: input.draftId || null,
      status: STATUS.BARU,
      total_scaled: total,
      due_at: text(input.dueAt, 40) || null,
      note: text(input.note, 500)
    };
    const itemRows = items.map(item => ({
      id: `pitm_${crypto.randomUUID()}`,
      line_no: item.lineNo,
      product_id: item.productId,
      product_name: item.productName,
      machine_id: item.machineId,
      unit: item.unit,
      qty: item.qty,
      width_cm: item.widthCm,
      height_cm: item.heightCm,
      unit_price_scaled: item.unitPriceScaled,
      subtotal_scaled: item.subtotalScaled,
      file_id: item.fileId,
      note: item.note
    }));
    const queueBase = await nextQueueNos(db, input.storeId, businessDate, itemRows.map(item => item.machine_id));
    const tickets = itemRows.map(item => {
      const queueNo = queueBase.get(item.machine_id) + 1;
      queueBase.set(item.machine_id, queueNo);
      return { id: `ptkt_${crypto.randomUUID()}`, machine_id: item.machine_id, queue_no: queueNo, order_item_id: item.id };
    });
    const created = {
      id: `pevt_${crypto.randomUUID()}`,
      order_id: orderId,
      store_id: input.storeId,
      seq: 1,
      event_type: 'DIBUAT',
      from_status: null,
      to_status: STATUS.BARU,
      actor_role: input.actor.role,
      actor_id: input.actor.id,
      note: order.source === 'WALKIN' ? 'Order datang langsung (bukan dari WA).' : '',
      photo_key: null,
      payload_json: JSON.stringify({ snapshot: await orderSnapshotHash(order, itemRows) }),
      created_at: createdAt,
      prev_hash: GENESIS_HASH
    };
    created.hash = await eventHash(created);

    const statements = [
      db.prepare(`
        INSERT INTO print_orders (id, store_id, order_no, business_date, customer_phone, customer_name, source, draft_id,
          status, total_scaled, due_at, note, created_by_role, created_by_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(order.id, order.store_id, order.order_no, order.business_date, order.customer_phone, order.customer_name,
        order.source, order.draft_id, order.status, toDb(order.total_scaled), order.due_at, order.note, input.actor.role, input.actor.id, createdAt),
      ...itemRows.map(item => db.prepare(`
        INSERT INTO print_order_items (id, order_id, store_id, line_no, product_id, product_name, machine_id, unit, qty,
          width_cm, height_cm, unit_price_scaled, subtotal_scaled, file_id, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(item.id, orderId, input.storeId, item.line_no, item.product_id, item.product_name, item.machine_id, item.unit,
        item.qty, item.width_cm, item.height_cm, toDb(item.unit_price_scaled), toDb(item.subtotal_scaled), item.file_id, item.note)),
      ...tickets.map(ticket => db.prepare(`
        INSERT INTO print_queue_tickets (id, store_id, machine_id, business_date, queue_no, order_item_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(ticket.id, input.storeId, ticket.machine_id, businessDate, ticket.queue_no, ticket.order_item_id)),
      insertEventStatement(db, created)
    ];
    if (order.draft_id) {
      statements.push(db.prepare(`
        UPDATE print_order_drafts SET status = 'DIKONFIRMASI', decided_by_role = ?, decided_by_id = ?, decided_at = ?, order_id = ?
        WHERE id = ? AND store_id = ? AND status = 'MENUNGGU'
      `).bind(input.actor.role, input.actor.id, createdAt, orderId, order.draft_id, input.storeId));
    }
    try {
      await db.batch(statements);
    } catch (error) {
      if (isUniqueConflict(error)) continue;
      throw error;
    }
    return { ok: true, orderId, orderNo: order.order_no };
  }
  return { ok: false, status: 409, error: 'Sedang ramai, nomor order bentrok. Coba simpan lagi.' };
}

function insertEventStatement(db, event) {
  return db.prepare(`
    INSERT INTO print_order_events (id, order_id, store_id, seq, event_type, from_status, to_status, actor_role, actor_id,
      note, photo_key, payload_json, created_at, prev_hash, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(event.id, event.order_id, event.store_id, event.seq, event.event_type, event.from_status, event.to_status,
    event.actor_role, event.actor_id, event.note, event.photo_key, event.payload_json, event.created_at, event.prev_hash, event.hash);
}

export async function ubahStatus(db, { storeId, orderId, toStatus, actor, note = '', photoKey = null }, { now = new Date() } = {}) {
  const order = await db.prepare('SELECT * FROM print_orders WHERE id = ? AND store_id = ?').bind(orderId, storeId).first();
  if (!order) return { ok: false, status: 404, error: 'Order tidak ditemukan di gerai ini.' };
  const target = text(toStatus, 20).toUpperCase();
  const allowed = bolehUbahStatus(order.status, target, actor.role);
  if (!allowed.ok) return { ok: false, status: 409, error: allowed.error };
  const cleanNote = text(note, 500);
  if (target === STATUS.BATAL && !cleanNote) return { ok: false, status: 400, error: 'Alasan pembatalan wajib diisi.' };

  const last = await db.prepare('SELECT seq, hash FROM print_order_events WHERE order_id = ? ORDER BY seq DESC LIMIT 1').bind(orderId).first();
  const event = {
    id: `pevt_${crypto.randomUUID()}`,
    order_id: orderId,
    store_id: storeId,
    seq: Number(last?.seq || 0) + 1,
    event_type: 'STATUS',
    from_status: order.status,
    to_status: target,
    actor_role: actor.role,
    actor_id: actor.id,
    note: cleanNote,
    photo_key: photoKey,
    payload_json: '{}',
    created_at: now.toISOString(),
    prev_hash: last?.hash || GENESIS_HASH
  };
  event.hash = await eventHash(event);
  try {
    // UNIQUE(order_id, seq) membuat dua klik bersamaan tidak bisa sama-sama menang; UPDATE
    // bersyarat status lama menjaga cache status tetap sama dengan event terakhir.
    await db.batch([
      insertEventStatement(db, event),
      db.prepare('UPDATE print_orders SET status = ? WHERE id = ? AND store_id = ? AND status = ?').bind(target, orderId, storeId, order.status)
    ]);
  } catch (error) {
    if (isUniqueConflict(error)) return { ok: false, status: 409, error: 'Order ini barusan diubah orang lain. Muat ulang dulu.' };
    throw error;
  }
  return { ok: true, status: target };
}

/**
 * Event tanpa perubahan status (mis. DIKIRIM_KE_MESIN), tetap masuk rantai hash. extraStatements
 * ikut dalam batch yang sama supaya event dan perubahan datanya tidak pernah setengah jalan.
 */
export async function catatEvent(db, { storeId, orderId, eventType, actor, note = '' }, { now = new Date(), extraStatements = [] } = {}) {
  const order = await db.prepare('SELECT status FROM print_orders WHERE id = ? AND store_id = ?').bind(orderId, storeId).first();
  if (!order) return { ok: false, status: 404, error: 'Order tidak ditemukan di gerai ini.' };
  const last = await db.prepare('SELECT seq, hash FROM print_order_events WHERE order_id = ? ORDER BY seq DESC LIMIT 1').bind(orderId).first();
  const event = {
    id: `pevt_${crypto.randomUUID()}`,
    order_id: orderId,
    store_id: storeId,
    seq: Number(last?.seq || 0) + 1,
    event_type: text(eventType, 40),
    from_status: order.status,
    to_status: order.status,
    actor_role: actor.role,
    actor_id: actor.id,
    note: text(note, 500),
    photo_key: null,
    payload_json: '{}',
    created_at: now.toISOString(),
    prev_hash: last?.hash || GENESIS_HASH
  };
  event.hash = await eventHash(event);
  try {
    await db.batch([insertEventStatement(db, event), ...extraStatements]);
  } catch (error) {
    if (isUniqueConflict(error)) return { ok: false, status: 409, error: 'Order ini barusan diubah. Coba lagi.' };
    throw error;
  }
  return { ok: true };
}

export async function detailOrder(db, storeId, orderId) {
  const order = await db.prepare('SELECT * FROM print_orders WHERE id = ? AND store_id = ?').bind(orderId, storeId).first();
  if (!order) return null;
  const items = (await db.prepare(`
    SELECT i.*, m.name AS machine_name, t.queue_no, t.business_date AS queue_date
    FROM print_order_items i
    JOIN print_machines m ON m.id = i.machine_id
    LEFT JOIN print_queue_tickets t ON t.order_item_id = i.id
    WHERE i.order_id = ? ORDER BY i.line_no
  `).bind(orderId).all()).results ?? [];
  const events = (await db.prepare('SELECT * FROM print_order_events WHERE order_id = ? ORDER BY seq').bind(orderId).all()).results ?? [];
  const verification = await verifikasiRiwayat(order, items, events);
  return { order, items, events, verification };
}

export function mapOrder(order) {
  return {
    id: order.id,
    orderNo: order.order_no,
    businessDate: order.business_date,
    customerPhone: order.customer_phone,
    customerName: order.customer_name,
    source: order.source,
    status: order.status,
    nextStatuses: nextStatuses(order.status),
    totalText: scaledToRupiahText(order.total_scaled),
    totalScaled: String(order.total_scaled),
    dueAt: order.due_at,
    note: order.note,
    createdByRole: order.created_by_role,
    automatic: order.created_by_role === 'SYSTEM',
    createdAt: order.created_at
  };
}

export function mapItem(item) {
  return {
    lineNo: item.line_no,
    productName: item.product_name,
    machineId: item.machine_id,
    machineName: item.machine_name,
    queueNo: item.queue_no ?? null,
    unit: item.unit,
    qty: item.qty,
    widthCm: item.width_cm,
    heightCm: item.height_cm,
    unitPriceText: scaledToRupiahText(item.unit_price_scaled),
    subtotalText: scaledToRupiahText(item.subtotal_scaled),
    fileId: item.file_id,
    note: item.note
  };
}
