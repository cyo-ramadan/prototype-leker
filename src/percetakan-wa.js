// Pintu WhatsApp modul Percetakan (ADR-055, mengikuti ADR-044 D2/D3).
//
// Dua penyedia, satu tabel pesan:
//   META_CLOUD -- WhatsApp Cloud API resmi. Pesan masuk dari pelanggan dan balasan dalam jendela
//                 24 jam tidak ditagih Meta; nomor uji (test number) dari Meta juga gratis. Jadi
//                 jalur resmi dipakai sejak uji coba: pindah ke "berbayar" nanti cuma soal
//                 penagihan akun Meta, bukan ganti kode.
//   SIMULATOR  -- pesan buatan dari layar Percetakan untuk mencoba alur tanpa WA sama sekali.
//                 Hanya Owner/Admin, ditandai SIMULATOR selamanya, dan mati otomatis begitu gerai
//                 punya saluran META_CLOUD aktif -- supaya simulator tidak bisa jadi jalan karyawan
//                 "mengarang" pesan pelanggan.
//
// Webhook hanya MENCATAT pesan dan file. Tidak ada AI yang jalan di webhook: nomor asing bisa
// mengirim apa saja, dan biaya AI baru keluar saat karyawan menekan "Baca dengan Una".
import { normalizePhone, sha256Hex } from './percetakan.js';

export const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';
// Batas ukuran file yang disimpan. Meta sendiri membatasi dokumen 100 MB.
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);

/** GET verifikasi webhook dari Meta (hub.challenge). */
export function verifikasiLangganan(url, env) {
  const expected = String(env?.WA_VERIFY_TOKEN || '');
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge') || '';
  if (!expected || mode !== 'subscribe' || token !== expected) return new Response('forbidden', { status: 403 });
  return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
}

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Cek header X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, badan mentah). */
export async function tandaTanganSah(rawBody, signatureHeader, appSecret) {
  if (!appSecret || !signatureHeader?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(mac)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return timingSafeEqualHex(hex, signatureHeader.slice('sha256='.length).toLowerCase());
}

/**
 * Mengurai badan webhook Meta jadi daftar pesan netral. Status pengiriman (sent/read) diabaikan.
 * Bentuk: { phoneNumberId, providerMessageId, from, fromName, kind, bodyText, mediaId, mime, fileName, sentAt }
 */
export function uraiWebhookMeta(payload) {
  const result = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};
      const phoneNumberId = text(value?.metadata?.phone_number_id, 60);
      const names = new Map((value.contacts ?? []).map(contact => [contact?.wa_id, text(contact?.profile?.name, 120)]));
      for (const message of value.messages ?? []) {
        const kind = text(message?.type, 20).toUpperCase() || 'UNKNOWN';
        const media = message?.[message?.type] ?? {};
        const isMedia = ['IMAGE', 'DOCUMENT', 'VIDEO', 'AUDIO'].includes(kind);
        const seconds = Number(message?.timestamp);
        result.push({
          phoneNumberId,
          providerMessageId: text(message?.id, 200),
          from: normalizePhone(message?.from),
          fromName: names.get(message?.from) || '',
          kind,
          bodyText: text(kind === 'TEXT' ? message?.text?.body : media?.caption, 4000),
          mediaId: isMedia ? text(media?.id, 200) || null : null,
          mime: isMedia ? text(media?.mime_type, 120) || null : null,
          fileName: isMedia ? text(media?.filename, 200) || null : null,
          sentAt: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : new Date().toISOString()
        });
      }
    }
  }
  return result.filter(message => message.providerMessageId && message.from);
}

export async function channelByPhoneNumberId(db, provider, phoneNumberId) {
  return db.prepare('SELECT * FROM wa_channels WHERE provider = ? AND phone_number_id = ? AND is_active = 1')
    .bind(provider, phoneNumberId).first();
}

/**
 * Menyimpan satu pesan (idempoten per providerMessageId -- Meta bisa mengirim ulang webhook).
 * Mengembalikan { inserted, messageId, fileId }.
 */
export async function catatPesan(db, channel, message, rawForHash) {
  const id = `wam_${crypto.randomUUID()}`;
  const rawSha = await sha256Hex(JSON.stringify(rawForHash ?? message));
  const insert = await db.prepare(`
    INSERT OR IGNORE INTO wa_inbound_messages (id, store_id, channel_id, provider, provider_message_id, from_number, from_name,
      kind, body_text, media_id, media_mime, media_file_name, sent_at, raw_sha256)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, channel.store_id, channel.id, channel.provider, message.providerMessageId, message.from, message.fromName,
    message.kind, message.bodyText, message.mediaId, message.mime, message.fileName, message.sentAt, rawSha).run();
  if (!insert?.meta?.changes) return { inserted: false };
  let fileId = null;
  if (message.mediaId || message.kind === 'DOCUMENT' || message.kind === 'IMAGE') {
    fileId = `pfil_${crypto.randomUUID()}`;
    await db.prepare(`
      INSERT INTO print_files (id, store_id, message_id, status, mime, file_name) VALUES (?, ?, ?, 'MENUNGGU', ?, ?)
    `).bind(fileId, channel.store_id, id, message.mime || '', message.fileName || '').run();
  }
  return { inserted: true, messageId: id, fileId };
}

export function r2Bucket(env) {
  const bucket = env?.R2_BUCKET;
  return bucket && typeof bucket.put === 'function' && typeof bucket.get === 'function' ? bucket : null;
}

function fileKey(storeId, fileId, fileName) {
  const safe = String(fileName || 'file').replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);
  return `percetakan/${storeId}/${new Date().toISOString().slice(0, 10)}/${fileId}-${safe}`;
}

async function tandaiFile(db, fileId, fields) {
  await db.prepare(`
    UPDATE print_files SET status = ?, r2_key = ?, sha256 = ?, size_bytes = ?, mime = COALESCE(NULLIF(?, ''), mime),
      error = ?, stored_at = ?
    WHERE id = ? AND status = 'MENUNGGU'
  `).bind(fields.status, fields.key ?? null, fields.sha256 ?? null, fields.size ?? null, fields.mime ?? '',
    fields.error ?? '', fields.status === 'TERSIMPAN' ? new Date().toISOString() : null, fileId).run();
}

/** Simpan bytes ke R2 + catat sidiknya. Dipakai simulator dan unduhan Meta. */
export async function simpanBytes(env, { storeId, fileId, fileName, mime, bytes }) {
  const bucket = r2Bucket(env);
  if (!bucket) {
    await tandaiFile(env.DB, fileId, { status: 'GAGAL', error: 'Penyimpanan file (R2) belum terpasang.' });
    return { ok: false };
  }
  const key = fileKey(storeId, fileId, fileName);
  await bucket.put(key, bytes, { httpMetadata: { contentType: mime || 'application/octet-stream' } });
  await tandaiFile(env.DB, fileId, { status: 'TERSIMPAN', key, sha256: await sha256Hex(bytes), size: bytes.byteLength, mime });
  return { ok: true, key };
}

/**
 * Mengunduh media dari Meta lalu menyimpan ke R2. Dua langkah sesuai dokumentasi Cloud API:
 * GET /{media-id} -> { url, mime_type, file_size }, lalu GET url dengan token yang sama.
 * ID media dari Meta kedaluwarsa 7 hari -- file yang GAGAL sesudah itu harus diminta ulang ke pelanggan.
 */
export async function unduhMediaMeta(env, { storeId, fileId, mediaId, fileName }, { fetchImpl = fetch } = {}) {
  const db = env.DB;
  const token = env?.WA_ACCESS_TOKEN;
  if (!token) {
    await tandaiFile(db, fileId, { status: 'GAGAL', error: 'Token WhatsApp (WA_ACCESS_TOKEN) belum dipasang.' });
    return { ok: false };
  }
  try {
    const metaResponse = await fetchImpl(`${GRAPH_API_BASE}/${encodeURIComponent(mediaId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!metaResponse.ok) throw new Error(`media info ${metaResponse.status}`);
    const info = await metaResponse.json();
    const size = Number(info?.file_size || 0);
    if (size > MAX_FILE_BYTES) {
      await tandaiFile(db, fileId, { status: 'GAGAL', error: 'File lebih dari 100 MB. Minta pelanggan kirim lewat link (Drive dsb).' });
      return { ok: false };
    }
    const fileResponse = await fetchImpl(info.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!fileResponse.ok) throw new Error(`media download ${fileResponse.status}`);
    const bytes = await fileResponse.arrayBuffer();
    return await simpanBytes(env, { storeId, fileId, fileName, mime: info?.mime_type || '', bytes });
  } catch (error) {
    console.error('percetakan: unduh media WA gagal', { fileId, error: String(error) });
    await tandaiFile(db, fileId, { status: 'GAGAL', error: 'File dari WA gagal diunduh. Coba "Ambil ulang file".' });
    return { ok: false };
  }
}

/**
 * POST webhook Meta. Selalu membalas 200 setelah tanda tangan sah (supaya Meta tidak mengirim
 * ulang terus), termasuk untuk nomor bisnis yang belum terdaftar -- pesannya tidak disimpan.
 */
export async function terimaWebhookMeta(request, env, { waitUntil } = {}) {
  const raw = await request.text();
  if (!env?.WA_APP_SECRET) return new Response('webhook belum dikonfigurasi', { status: 503 });
  if (!await tandaTanganSah(raw, request.headers.get('x-hub-signature-256'), env.WA_APP_SECRET)) {
    return new Response('signature tidak sah', { status: 401 });
  }
  let payload;
  try { payload = JSON.parse(raw); } catch { return new Response('ok', { status: 200 }); }

  const downloads = [];
  for (const message of uraiWebhookMeta(payload)) {
    const channel = await channelByPhoneNumberId(env.DB, 'META_CLOUD', message.phoneNumberId);
    if (!channel) continue;
    const saved = await catatPesan(env.DB, channel, message, message);
    if (saved.inserted && saved.fileId && message.mediaId) {
      downloads.push(unduhMediaMeta(env, { storeId: channel.store_id, fileId: saved.fileId, mediaId: message.mediaId, fileName: message.fileName }));
    }
  }
  if (downloads.length) {
    const all = Promise.allSettled(downloads);
    if (typeof waitUntil === 'function') waitUntil(all); else await all;
  }
  return new Response('ok', { status: 200 });
}

/** Simulator: pesan buatan untuk uji alur. Pemanggil sudah dicek Owner/Admin oleh API. */
export async function simulasiPesan(env, storeId, body) {
  const db = env.DB;
  const real = await db.prepare("SELECT 1 FROM wa_channels WHERE store_id = ? AND provider = 'META_CLOUD' AND is_active = 1 LIMIT 1").bind(storeId).first();
  if (real) return { ok: false, status: 409, error: 'Gerai ini sudah tersambung WhatsApp sungguhan; simulator dimatikan.' };
  const from = normalizePhone(body?.from);
  if (!from) return { ok: false, status: 400, error: 'Nomor pengirim simulasi tidak valid.' };
  const bodyText = text(body?.text, 4000);
  const fileBase64 = String(body?.fileBase64 || '');
  if (!bodyText && !fileBase64) return { ok: false, status: 400, error: 'Isi pesan atau file wajib ada.' };
  let bytes = null;
  if (fileBase64) {
    try {
      bytes = Uint8Array.from(atob(fileBase64), char => char.charCodeAt(0));
    } catch {
      return { ok: false, status: 400, error: 'File simulasi tidak terbaca.' };
    }
    if (bytes.byteLength > 20 * 1024 * 1024) return { ok: false, status: 413, error: 'File simulasi maksimal 20 MB.' };
  }

  let channel = await db.prepare("SELECT * FROM wa_channels WHERE store_id = ? AND provider = 'SIMULATOR'").bind(storeId).first();
  if (!channel) {
    const id = `wach_${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO wa_channels (id, store_id, provider, phone_number_id, display_number) VALUES (?, ?, 'SIMULATOR', ?, 'Simulator')`)
      .bind(id, storeId, `sim-${storeId}`).run();
    channel = await db.prepare('SELECT * FROM wa_channels WHERE id = ?').bind(id).first();
  }
  const fileName = text(body?.fileName, 200) || (fileBase64 ? 'file' : null);
  const mime = text(body?.mime, 120) || (fileBase64 ? 'application/octet-stream' : null);
  const message = {
    providerMessageId: `sim_${crypto.randomUUID()}`,
    from,
    fromName: text(body?.name, 120),
    kind: bytes ? 'DOCUMENT' : 'TEXT',
    bodyText,
    mediaId: null,
    mime,
    fileName,
    sentAt: new Date().toISOString()
  };
  const saved = await catatPesan(db, channel, message, message);
  if (saved.fileId && bytes) {
    await simpanBytes(env, { storeId, fileId: saved.fileId, fileName, mime, bytes });
  }
  return { ok: true, messageId: saved.messageId, fileId: saved.fileId };
}
