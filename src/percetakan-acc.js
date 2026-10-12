// ACC pelanggan sebelum produksi (ADR-055 D14).
//
// Bos Cyo, 2026-10-12: draft dibuat Una saat karyawan menekan tombol, "setelah draft jadi, draft
// tersebut dikirim ke customer untuk makesure, kalo ok baru di post sebagai pesanan yang akan di
// proses ke bagian produksi". Pola ini standar di software percetakan: penawaran -> ACC pelanggan
// yang tercatat -> job ticket -> produksi.
//
//   1. kirimAcc      : rincian draft (harga dihitung server dari master) dikirim ke WA pelanggan,
//                      dan rincian PERSIS yang dikirim disimpan di draft (acc_items_json).
//   2. cekBalasanAcc : balasan pelanggan "OK / ya / acc / lanjut ..." -> order diposting dari rincian
//                      yang dikirim, bukan dari isian layar. Balasan itu disimpan sebagai bukti.
//   3. setujuiDraft  : juga dipakai untuk persetujuan MANUAL (pelanggan setuju lewat telepon) --
//                      wajib alasan dan tercatat sebagai persetujuan manual.
import { buatOrder, normalizePhone, productsForStore, scaledToRupiahText, siapkanItem } from './percetakan.js';
import { kirimBalasan } from './percetakan-wa.js';
import { pendingMessages } from './percetakan-otomatis.js';

const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
export const SYSTEM_ACC_ACTOR = Object.freeze({ role: 'SYSTEM', id: 'acc-pelanggan' });

// Kata setuju di awal pesan pendek, tanpa kata yang menandakan perubahan.
const RE_SETUJU = /^\s*(ok(e|ey|ay)?|oke+|okk+|ya+|iya+|yes|y|setuju|acc|lanjut(kan)?|siap|gas|sip+|sudah sesuai|sesuai|benar|betul|mantap|deal)(?![a-z])/i;
const RE_UBAH = /(?<![a-z])(ganti|ubah|tapi|kecuali|salah|revisi|tambah|kurang|eh|tidak|nggak|ngga|gak|enggak|jangan|batal|bukan)(?![a-z])/i;

export function adalahSetuju(pesan) {
  const isi = String(pesan || '').trim();
  return isi.length > 0 && isi.length <= 60 && RE_SETUJU.test(isi) && !RE_UBAH.test(isi);
}

/** Validasi rincian terhadap master gerai. Hasil: { ok, items (untuk buatOrder), lines, total } */
export async function siapkanRincian(db, storeId, rawItems) {
  const list = Array.isArray(rawItems) ? rawItems.slice(0, 50) : [];
  if (!list.length) return { ok: false, status: 400, error: 'Draft belum punya item.' };
  const products = new Map((await productsForStore(db, storeId)).map(product => [product.id, product]));
  const items = [];
  const lines = [];
  let total = 0n;
  for (const [index, raw] of list.entries()) {
    const prepared = siapkanItem(raw, products.get(text(raw?.productId, 80)), index + 1);
    if (!prepared.ok) return { ok: false, status: 400, error: prepared.error };
    const item = prepared.item;
    items.push({ productId: item.productId, qty: item.qty, widthCm: item.widthCm, heightCm: item.heightCm, fileId: item.fileId, note: item.note });
    lines.push(item);
    total += item.subtotalScaled;
  }
  return { ok: true, items, lines, total };
}

export function susunPesanAcc({ customerName, dueText, lines, total, fileNames = new Map() }) {
  const sapa = customerName ? `Halo Kak ${customerName}, ` : 'Halo Kak, ';
  const baris = lines.map((line, index) => {
    const ukuran = line.widthCm && line.heightCm ? ` ${line.widthCm}×${line.heightCm} cm` : '';
    const file = line.fileId && fileNames.get(line.fileId) ? `\n   File: ${fileNames.get(line.fileId)}` : '';
    const catatan = line.note ? `\n   Catatan: ${line.note}` : '';
    return `${index + 1}. ${line.productName}${ukuran} × ${line.qty} = ${scaledToRupiahText(line.subtotalScaled)}${file}${catatan}`;
  });
  return [
    `${sapa}ini rincian pesanannya:`,
    ...baris,
    `Total: ${scaledToRupiahText(total)}`,
    ...(dueText ? [`Perkiraan jadi: ${dueText}`] : []),
    '',
    'Balas *OK* kalau sudah sesuai, atau tulis bagian yang perlu diubah ya.'
  ].join('\n');
}

async function namaFile(db, storeId, fileIds) {
  const map = new Map();
  for (const id of fileIds) {
    const row = await db.prepare('SELECT file_name FROM print_files WHERE id = ? AND store_id = ?').bind(id, storeId).first();
    if (row) map.set(id, row.file_name || 'file');
  }
  return map;
}

/** Kirim rincian draft ke pelanggan. body: { customerName, dueAt, items } dari layar. */
export async function kirimAcc(env, { storeId, draftId, actor, body }, { now = new Date() } = {}) {
  const db = env.DB;
  const draft = await db.prepare("SELECT * FROM print_order_drafts WHERE id = ? AND store_id = ? AND status = 'MENUNGGU'").bind(draftId, storeId).first();
  if (!draft) return { ok: false, status: 404, error: 'Draft tidak ditemukan atau sudah diputuskan.' };
  const rincian = await siapkanRincian(db, storeId, body?.items);
  if (!rincian.ok) return rincian;
  const customerName = text(body?.customerName, 120);
  const dueAt = text(body?.dueAt, 60);
  const pesan = susunPesanAcc({
    customerName, dueText: dueAt, lines: rincian.lines, total: rincian.total,
    fileNames: await namaFile(db, storeId, rincian.items.map(item => item.fileId).filter(Boolean))
  });
  const sent = await kirimBalasan(env, { storeId, toNumber: draft.from_number, body: pesan, actor });
  if (!sent.ok) return sent;

  // Pesan pelanggan yang masuk setelah draft dibuat (mis. koreksi) ikut dianggap sudah diproses
  // oleh draft ini, supaya tidak muncul lagi sebagai "belum diproses".
  let ids = [];
  try { ids = JSON.parse(draft.message_ids_json); } catch { ids = []; }
  for (const message of await pendingMessages(db, storeId, draft.from_number)) if (!ids.includes(message.id)) ids.push(message.id);

  await db.prepare(`
    UPDATE print_order_drafts SET acc_status = 'MENUNGGU_ACC', acc_items_json = ?, acc_total_scaled = ?, acc_message_text = ?,
      acc_sent_at = ?, acc_sent_by_role = ?, acc_sent_by_id = ?, message_ids_json = ?
    WHERE id = ? AND store_id = ? AND status = 'MENUNGGU'
  `).bind(JSON.stringify({ customerName, dueAt, items: rincian.items }), Number(rincian.total), pesan, now.toISOString(),
    actor.role, actor.id, JSON.stringify(ids), draft.id, storeId).run();
  return { ok: true, simulated: Boolean(sent.simulated), message: pesan, totalText: scaledToRupiahText(rincian.total) };
}

/**
 * Posting draft jadi order. method PELANGGAN_WA (dari balasan OK) memakai rincian yang DIKIRIM;
 * MANUAL wajib alasan dan memakai rincian dari layar (atau yang dikirim, kalau ada).
 */
export async function setujuiDraft(db, { storeId, draftId, actor, method, replyMessageId = null, replyText = '', note = '', body = null }, { now = new Date() } = {}) {
  const draft = await db.prepare("SELECT * FROM print_order_drafts WHERE id = ? AND store_id = ? AND status = 'MENUNGGU'").bind(draftId, storeId).first();
  if (!draft) return { ok: false, status: 404, error: 'Draft tidak ditemukan atau sudah diputuskan.' };
  let sentPayload = null;
  try { sentPayload = draft.acc_items_json ? JSON.parse(draft.acc_items_json) : null; } catch { sentPayload = null; }

  let payload;
  let eventNote;
  if (method === 'PELANGGAN_WA') {
    if (draft.acc_status !== 'MENUNGGU_ACC' || !sentPayload) return { ok: false, status: 409, error: 'Draft ini belum dikirim ke pelanggan.' };
    payload = sentPayload;
    eventNote = `ACC pelanggan lewat WA: "${text(replyText, 80)}"`;
  } else {
    const alasan = text(note, 300);
    if (!alasan) return { ok: false, status: 400, error: 'Tulis alasan persetujuan manual (mis. pelanggan setuju lewat telepon).' };
    payload = body?.items ? { customerName: text(body.customerName, 120), dueAt: text(body.dueAt, 60), items: body.items } : sentPayload;
    if (!payload) return { ok: false, status: 400, error: 'Draft belum punya rincian.' };
    eventNote = `Disetujui MANUAL oleh karyawan: ${alasan}`;
  }

  let ids = [];
  try { ids = JSON.parse(draft.message_ids_json); } catch { ids = []; }
  if (replyMessageId && !ids.includes(replyMessageId)) ids.push(replyMessageId);

  const created = await buatOrder(db, {
    storeId, actor, source: 'WA', draftId: draft.id, customerPhone: normalizePhone(draft.from_number),
    customerName: payload.customerName, dueAt: payload.dueAt, note: eventNote, eventNote, items: payload.items
  }, {
    now,
    extraStatements: async () => [db.prepare(`
      UPDATE print_order_drafts SET acc_status = 'DISETUJUI', acc_method = ?, acc_approved_at = ?, acc_reply_message_id = ?,
        acc_note = ?, message_ids_json = ?
      WHERE id = ? AND store_id = ?
    `).bind(method, now.toISOString(), replyMessageId, method === 'MANUAL' ? text(note, 300) : '', JSON.stringify(ids), draft.id, storeId)]
  });
  return created.ok ? { ...created, method } : created;
}

/** Dipanggil untuk setiap pesan masuk: kalau pelanggan sedang ditunggu ACC dan membalas OK, posting order. */
export async function cekBalasanAcc(db, storeId, fromNumber, messageId, { now = new Date() } = {}) {
  if (!messageId) return null;
  const draft = await db.prepare(`
    SELECT id FROM print_order_drafts
    WHERE store_id = ? AND from_number = ? AND status = 'MENUNGGU' AND acc_status = 'MENUNGGU_ACC'
    ORDER BY acc_sent_at DESC LIMIT 1
  `).bind(storeId, fromNumber).first();
  if (!draft) return null;
  const message = await db.prepare('SELECT id, body_text FROM wa_inbound_messages WHERE id = ? AND store_id = ?').bind(messageId, storeId).first();
  if (!message || !adalahSetuju(message.body_text)) return { waiting: true };
  const posted = await setujuiDraft(db, {
    storeId, draftId: draft.id, actor: SYSTEM_ACC_ACTOR, method: 'PELANGGAN_WA', replyMessageId: message.id, replyText: message.body_text
  }, { now });
  return posted.ok ? { approved: { orderId: posted.orderId, orderNo: posted.orderNo } } : { error: posted.error };
}
