// "Baca dengan Una" membaca SELURUH percakapan (Bos Cyo 2026-10-12, ADR-055 D15).
//
// Karyawan menekan tombol kapan saja -- juga setelah draft lama ada -- dan Una membaca ulang:
//   - semua pesan pelanggan 7 hari terakhir (sama dengan jendela Chat masuk),
//   - balasan CS yang terkirim (kesepakatan/koreksi lewat CS ikut terbaca),
//   - foto kiriman pelanggan yang belum jadi order (paling banyak 4, masing-masing <= 4 MB).
// Pesan yang sudah jadi order hanya konteks; draft baru hanya mengikat pesan yang belum jadi order.
// Draft MENUNGGU lama untuk nomor ini diganti (DITOLAK + catatan) dalam satu batch, termasuk
// draft yang sedang menunggu ACC -- rincian lama yang terkirim tidak berlaku lagi.
import { productsForStore, sha256Hex } from './percetakan.js';
import { bacaChatOrder } from './percetakan-una.js';
import { r2Bucket } from './percetakan-wa.js';

const JENDELA_MS = 7 * 24 * 60 * 60 * 1000;
const MAKS_GAMBAR = 4;
const MAKS_BYTE_GAMBAR = 4 * 1024 * 1024;

function keBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Status pesan satu nomor: id yang sudah jadi order, dan draft MENUNGGU yang masih hidup. */
export async function statusDraftNomor(db, storeId, fromNumber) {
  const rows = (await db.prepare(`
    SELECT id, status, message_ids_json FROM print_order_drafts
    WHERE store_id = ? AND from_number = ? AND status IN ('MENUNGGU', 'DIKONFIRMASI')
  `).bind(storeId, fromNumber).all()).results ?? [];
  const ordered = new Set();
  const liveDraftIds = [];
  for (const row of rows) {
    if (row.status === 'MENUNGGU') { liveDraftIds.push(row.id); continue; }
    try { for (const id of JSON.parse(row.message_ids_json)) ordered.add(id); } catch { /* baris rusak dilewati */ }
  }
  return { ordered, liveDraftIds };
}

/** Linimasa untuk Una: pesan masuk (ditandai ordered) + balasan CS terkirim, urut waktu. */
export async function percakapanUntukUna(db, storeId, fromNumber, { now = Date.now() } = {}) {
  const since = new Date(now - JENDELA_MS).toISOString();
  const { ordered, liveDraftIds } = await statusDraftNomor(db, storeId, fromNumber);
  const masuk = (await db.prepare(`
    SELECT m.id, m.from_name, m.body_text, m.media_file_name, m.media_mime, m.sent_at, m.received_at,
           f.id AS file_id, f.status AS file_status, f.mime AS file_mime, f.size_bytes, f.r2_key
    FROM wa_inbound_messages m LEFT JOIN print_files f ON f.message_id = m.id
    WHERE m.store_id = ? AND m.from_number = ? AND m.sent_at >= ?
    ORDER BY m.sent_at, m.received_at
  `).bind(storeId, fromNumber, since).all()).results ?? [];
  const keluar = (await db.prepare(`
    SELECT id, body_text, created_at AS sent_at FROM wa_outbound_messages
    WHERE store_id = ? AND to_number = ? AND created_at >= ? AND status = 'TERKIRIM'
  `).bind(storeId, fromNumber, since).all()).results ?? [];
  const pesanMasuk = masuk.map(row => ({ ...row, direction: 'IN', ordered: ordered.has(row.id) }));
  const timeline = [...pesanMasuk, ...keluar.map(row => ({ ...row, direction: 'OUT' }))]
    .sort((a, b) => (a.sent_at < b.sent_at ? -1 : a.sent_at > b.sent_at ? 1 : 0));
  return { timeline, baru: pesanMasuk.filter(row => !row.ordered), liveDraftIds };
}

async function ambilGambar(env, pesanBaru) {
  const bucket = r2Bucket(env);
  if (!bucket) return [];
  const calon = pesanBaru.filter(row => row.file_status === 'TERSIMPAN' && row.r2_key
    && String(row.file_mime || row.media_mime || '').startsWith('image/')
    && Number(row.size_bytes || 0) <= MAKS_BYTE_GAMBAR).slice(-MAKS_GAMBAR);
  const images = [];
  for (const row of calon) {
    try {
      const object = await bucket.get(row.r2_key);
      if (!object) continue;
      images.push({ messageId: row.id, mediaType: row.file_mime || row.media_mime, data: keBase64(new Uint8Array(await object.arrayBuffer())) });
    } catch { /* foto gagal dibaca: Una tetap membaca teksnya */ }
  }
  return images;
}

/**
 * Una membaca ulang percakapan dan menyimpan draft baru (menggantikan draft MENUNGGU lama).
 * Hasil: { ok, draftId, replaced } atau { ok:false, status, error }.
 */
export async function bacaUlangDenganUna(env, { storeId, fromNumber, actor, call }) {
  const db = env.DB;
  const { timeline, baru, liveDraftIds } = await percakapanUntukUna(db, storeId, fromNumber);
  if (!baru.length) return { ok: false, status: 409, error: 'Belum ada chat baru dari nomor ini sejak order terakhir.' };
  const products = await productsForStore(db, storeId);
  const filesByMessageId = new Map(baru.filter(row => row.file_id).map(row => [row.id, row.file_id]));
  const images = await ambilGambar(env, baru);
  const read = await bacaChatOrder(env, { messages: timeline, products, filesByMessageId, images }, call ? { call } : {});
  if (!read.ok) return read;
  const proposal = { ...read.proposal, customerName: read.proposal.customerName || baru.find(row => row.from_name)?.from_name || '' };

  const ids = baru.map(row => row.id);
  // Kunci menyertakan draft yang digantikan: dua klik bersamaan atas keadaan yang sama -> satu menang.
  const messageKey = await sha256Hex(`${JSON.stringify([...ids].sort())}|${[...liveDraftIds].sort().join(',')}`);
  const draftId = `pdrf_${crypto.randomUUID()}`;
  const nowIso = new Date().toISOString();
  const statements = liveDraftIds.map(id => db.prepare(`
    UPDATE print_order_drafts SET status = 'DITOLAK', decided_by_role = ?, decided_by_id = ?, decided_at = ?,
      acc_note = 'Diganti draft baru (Una membaca ulang percakapan)'
    WHERE id = ? AND store_id = ? AND status = 'MENUNGGU'
  `).bind(actor.role, actor.id, nowIso, id, storeId));
  statements.push(db.prepare(`
    INSERT INTO print_order_drafts (id, store_id, from_number, message_ids_json, message_key, proposal_json, source, ai_model)
    VALUES (?, ?, ?, ?, ?, ?, 'AI', ?)
  `).bind(draftId, storeId, fromNumber, JSON.stringify(ids), messageKey, JSON.stringify(proposal), read.model || ''));
  try {
    await db.batch(statements);
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error?.message || error))) return { ok: false, status: 409, error: 'Una baru saja membaca chat ini. Muat ulang.' };
    throw error;
  }
  return { ok: true, draftId, replaced: liveDraftIds.length, images: images.length };
}
