// Otomatisasi task Percetakan (ADR-055 D7): pesan WA masuk -> order + task antrian tanpa ditekan
// karyawan, kalau chatnya terbaca lengkap oleh pembaca aturan (src/percetakan-tebak.js).
//
// Dipanggil setiap kali satu pesan tercatat (webhook Meta atau simulator). Membaca ulang semua
// pesan pelanggan itu yang belum masuk draft, jadi urutan kirim tidak penting: teks dulu lalu
// file, atau file dulu lalu teks, order terbentuk di pesan yang membuatnya lengkap.
//
// Yang dibuat otomatis tetap lewat jalur yang sama dengan order manual (buatOrder), jadi harga dari
// master, antrian per mesin, dan rantai hash berlaku sama. Pelakunya tercatat SYSTEM.
import { STATUS, buatOrder, productsForStore, sha256Hex, ubahStatus } from './percetakan.js';
import { tebakOrder } from './percetakan-tebak.js';

export const MODES = Object.freeze(['MANUAL', 'OTOMATIS', 'LANGSUNG_CETAK']);
export const SYSTEM_ACTOR = Object.freeze({ role: 'SYSTEM', id: 'otomatis' });

export async function modeGerai(db, storeId) {
  const row = await db.prepare('SELECT mode FROM print_settings WHERE store_id = ?').bind(storeId).first();
  return MODES.includes(row?.mode) ? row.mode : 'MANUAL';
}

export async function simpanMode(db, storeId, mode, actor) {
  if (!MODES.includes(mode)) return false;
  await db.prepare(`
    INSERT INTO print_settings (store_id, mode, updated_by_role, updated_by_id, updated_at)
    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT (store_id) DO UPDATE SET mode = excluded.mode, updated_by_role = excluded.updated_by_role,
      updated_by_id = excluded.updated_by_id, updated_at = excluded.updated_at
  `).bind(storeId, mode, actor.role, actor.id).run();
  return true;
}

export async function draftedMessageIds(db, storeId, fromNumber) {
  const rows = (await db.prepare(`
    SELECT message_ids_json FROM print_order_drafts
    WHERE store_id = ? AND from_number = ? AND status IN ('MENUNGGU', 'DIKONFIRMASI')
  `).bind(storeId, fromNumber).all()).results ?? [];
  const ids = new Set();
  for (const row of rows) {
    try { for (const id of JSON.parse(row.message_ids_json)) ids.add(id); } catch { /* baris rusak dilewati */ }
  }
  return ids;
}

/** Pesan 3 hari terakhir dari nomor ini yang belum masuk draft mana pun, urut waktu. */
export async function pendingMessages(db, storeId, fromNumber) {
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const drafted = await draftedMessageIds(db, storeId, fromNumber);
  const rows = (await db.prepare(`
    SELECT m.*, f.id AS file_id FROM wa_inbound_messages m LEFT JOIN print_files f ON f.message_id = m.id
    WHERE m.store_id = ? AND m.from_number = ? AND m.sent_at >= ? ORDER BY m.sent_at, m.received_at
  `).bind(storeId, fromNumber, since).all()).results ?? [];
  return rows.filter(row => !drafted.has(row.id));
}

/** Menyimpan draft. null kalau set pesan yang sama sudah punya draft hidup (balapan webhook). */
export async function simpanDraft(db, { storeId, fromNumber, messages, proposal, source, model = '' }) {
  const id = `pdrf_${crypto.randomUUID()}`;
  const ids = messages.map(message => message.id);
  const messageKey = await sha256Hex(JSON.stringify([...ids].sort()));
  try {
    await db.prepare(`
      INSERT INTO print_order_drafts (id, store_id, from_number, message_ids_json, message_key, proposal_json, source, ai_model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, storeId, fromNumber, JSON.stringify(ids), messageKey, JSON.stringify(proposal), source, model).run();
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error?.message || error))) return null;
    throw error;
  }
  return id;
}

/**
 * Coba jadikan chat pelanggan ini order otomatis. Tidak pernah melempar error ke pemanggil:
 * kegagalan di sini tidak boleh membuat pesan WA ikut gagal tercatat.
 * Hasil: { mode, created?: {orderId, orderNo}, reason? }
 */
export async function prosesOtomatis(db, storeId, fromNumber, { now = new Date() } = {}) {
  try {
    const mode = await modeGerai(db, storeId);
    if (mode === 'MANUAL') return { mode, reason: 'MODE_MANUAL' };
    const messages = await pendingMessages(db, storeId, fromNumber);
    if (!messages.length) return { mode, reason: 'TIDAK_ADA_PESAN' };
    const proposal = tebakOrder(messages, await productsForStore(db, storeId));
    if (!proposal.complete) return { mode, reason: 'BELUM_LENGKAP', questions: proposal.questions };

    const draftId = await simpanDraft(db, { storeId, fromNumber, messages, proposal, source: 'ATURAN' });
    if (!draftId) return { mode, reason: 'SUDAH_DIPROSES' };
    const created = await buatOrder(db, {
      storeId,
      actor: SYSTEM_ACTOR,
      source: 'WA',
      draftId,
      customerPhone: fromNumber,
      customerName: proposal.customerName,
      dueAt: proposal.dueText,
      note: 'Dibuat otomatis dari chat WA.',
      items: proposal.items
    }, { now });
    if (!created.ok) return { mode, reason: 'GAGAL_BUAT_ORDER', error: created.error };
    if (mode === 'LANGSUNG_CETAK') {
      await ubahStatus(db, {
        storeId, orderId: created.orderId, toStatus: STATUS.SIAP_CETAK, actor: SYSTEM_ACTOR,
        note: 'Mode Langsung Cetak: file dikirim ke mesin oleh agen cetak.'
      }, { now });
    }
    return { mode, created: { orderId: created.orderId, orderNo: created.orderNo } };
  } catch (error) {
    console.error('percetakan: otomatisasi gagal', { storeId, error: String(error) });
    return { mode: 'ERROR', reason: 'ERROR' };
  }
}
