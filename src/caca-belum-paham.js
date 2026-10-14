// Server-only diagnostic observations. Cannot execute tasks or approve drafts.
import { json } from './http.js';
import { ownerFromRequest, entityAdminFromRequest, hashCredential } from './owner-auth.js';
import { bersihkan } from './caca-baca-aman.js';
import { bersihkanRiwayat } from './caca-riwayat.js';

const ROOT = '/api/caca/belum-paham';
const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
const STATUSES = new Set(['baru', 'dikerjakan', 'selesai', 'bukan_masalah']);
const REASONS = new Set(['ngambek', 'belum_lengkap_berulang', 'topik_tidak_ditemukan', 'menu_tidak_ditemukan', 'model_gagal', 'format_model', 'angka_tanpa_bukti', 'koreksi_pengguna']);
const SECRET = /password|passwd|passphrase|kata\s*sandi|\bsandi\b|\bpin\b|\botp\b|token|secret|credential|authorization|api[_ -]?key|\bBearer\s+|\bsk-(?:proj-)?[\w-]+|BEGIN.*PRIVATE KEY|data:[^\s]+;base64,|\b(?:foto|photo|gambar|image)\s*[:=]/i;
const CORRECTION = /\b(?:bukan\s+(?:itu|gitu|begitu)|salah(?!\s+satu\b)(?:\s+(?:itu|ya|jawabannya))?|(?:ga|gak|nggak|tidak)\s+(?:gitu|begitu)|maksud(?:ku|nya)?\s+bukan)\b/i;
const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const error = (message, status = 400) => Object.assign(new Error(message), { status });

/** Conservative free-text companion to bersihkan(): discard secret-bearing turns. */
export function samarkanTeksBelumPaham(value, customerNames = []) {
  const text = normalize(value);
  if (SECRET.test(text) || /[A-Za-z0-9+/]{120,}={0,2}/.test(text)) return '[pesan sensitif tidak disimpan]';
  let clean = text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[kontak disamarkan]')
    .replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, match => match.replace(/\D/g, '').length >= 8 ? '[nomor disamarkan]' : match)
    .replace(/\b(?:pelanggan|customer|atas nama|a\.n\.)\s*[:=-]?\s*[\p{L}][\p{L}\s'.-]{0,100}/giu, '[pelanggan disamarkan]');
  // Names come from scoped DB records, never client-provided dictionaries.
  for (const name of customerNames) {
    const known = normalize(name);
    if (!known) continue;
    const escaped = known.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'), '[pelanggan disamarkan]');
  }
  return clean.slice(0, 600);
}

async function scopeFor(request, env) {
  const owner = await ownerFromRequest(request, env.DB);
  const admin = owner ? null : await entityAdminFromRequest(request, env.DB);
  if (!owner && !admin) throw error('Login Owner atau Entity Admin diperlukan.', 401);
  const actor = owner ? { key: `OWNER:${owner.id}`, role: 'OWNER' } : { key: `ENTITY_ADMIN:${admin.id}`, role: 'ENTITY_ADMIN', entityId: admin.entityId };
  const params = new URL(request.url).searchParams;
  const entityScope = params.get('lingkup') === 'entity';
  if (entityScope && !admin) throw error('Mode entity hanya untuk Entity Admin.', 403);
  const identifier = params.get('store');
  // Missing scope must never select all tenants or a default tenant.
  if (!entityScope && !identifier) throw error('Pilih gerai untuk antrean Una.', 400);
  const select = `SELECT e.id AS entity_id, et.id AS tenancy_id, et.tenant_id${entityScope ? '' : ', s.id AS store_id'}
    FROM entities e JOIN entity_tenancy et ON et.entity_id=e.id AND et.effective_to IS NULL
    JOIN tenants t ON t.id=et.tenant_id ${entityScope ? '' : 'JOIN stores s ON s.entity_id=e.id'}
    WHERE e.status='ACTIVE' AND t.status='ACTIVE' AND ${entityScope ? 'e.id=?' : 's.is_active=1 AND (s.id=? OR s.code=?)'} LIMIT 1`;
  const row = await env.DB.prepare(select).bind(...(entityScope ? [admin.entityId] : [identifier, identifier.toUpperCase()])).first();
  if (!row || (admin && row.entity_id !== admin.entityId)) throw error('Lingkup antrean Una tidak tersedia untuk akun ini.', 403);
  return { ...actor, tenantId: row.tenant_id, tenancyId: row.tenancy_id, entityId: row.entity_id, storeId: row.store_id ?? null, kind: entityScope ? 'entity' : 'gerai' };
}

async function cleanup(db, now) {
  await db.batch([
    db.prepare('DELETE FROM una_belum_paham WHERE expires_at<=?').bind(now),
    db.prepare('DELETE FROM una_belum_paham_observations WHERE expires_at<=?').bind(now)
  ]);
}

/** Call with the current server response only; request flags are never accepted. */
export async function catatBelumPaham(request, env, { pertanyaan, riwayat = [], hasil, kegagalan = null, versi = '', conversationId = null } = {}) {
  if (!normalize(pertanyaan)) return { tercatat: 0 };
  hasil = hasil && typeof hasil === 'object' ? hasil : {};
  const reasons = new Set();
  for (const reason of Array.isArray(kegagalan) ? kegagalan : [kegagalan]) if (REASONS.has(reason)) reasons.add(reason);
  const reply = String(hasil.jawaban ?? '');
  if (hasil.ngambek || /Una kurang ngerti|Una[^.!?]{0,60}ngambek/i.test(reply)) reasons.add('ngambek');
  if (hasil.alat === 'jelaskan' && hasil.dikenal === false) reasons.add('topik_tidak_ditemukan');
  if (hasil.alat === 'buka_layar' && hasil.dikenal === false) reasons.add('menu_tidak_ditemukan');
  if (hasil.ok === false) reasons.add(/format|json|schema|struktur/i.test(String(hasil.error ?? '')) ? 'format_model' : 'model_gagal');
  if (/angka[^.]{0,100}(?:belum ketemu|tidak ada|tanpa bukti)/i.test(String(hasil.peringatan ?? ''))) reasons.add('angka_tanpa_bukti');
  if (!SECRET.test(normalize(pertanyaan)) && CORRECTION.test(normalize(pertanyaan)) && (reply || hasil.ok === false)) reasons.add('koreksi_pengguna');
  const incomplete = Boolean(hasil.belumLengkap && !hasil.penjelasan);
  // Healthy replies do no diagnostic I/O, including retention writes.
  if (!reasons.size && !incomplete) return { tercatat: 0 };
  const scope = await scopeFor(request, env);
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + RETENTION_MS).toISOString();
  const history = bersihkanRiwayat(riwayat);
  // A UUID is a grouping hint only, never evidence of a prior failure or authority.
  const validId = typeof conversationId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(conversationId);
  const first = history.find(turn => turn.dari === 'saya')?.teks || pertanyaan;
  const group = validId ? ['id', conversationId.toLowerCase()] : ['first', samarkanTeksBelumPaham(first).toLowerCase()];
  const conversation = await hashCredential(JSON.stringify([scope.tenantId, scope.tenancyId, scope.entityId, scope.storeId, scope.key, group]));
  const question = await hashCredential(samarkanTeksBelumPaham(pertanyaan).toLowerCase());
  if (incomplete) {
    const observed = await env.DB.prepare(`INSERT INTO una_belum_paham_observations(conversation_key,question_key,incomplete_count,expires_at)
      VALUES(?,?,1,?) ON CONFLICT(conversation_key,question_key) DO UPDATE SET
      incomplete_count=CASE WHEN una_belum_paham_observations.expires_at<=? THEN 1 ELSE incomplete_count+1 END,
      expires_at=excluded.expires_at RETURNING incomplete_count`).bind(conversation, question, expires, now).first();
    if (observed?.incomplete_count >= 2) reasons.add('belum_lengkap_berulang');
  }
  if (!reasons.size) return { tercatat: 0 };
  // Retention cleanup belongs to real case ingestion or queue access, never a first clarification.
  await cleanup(env.DB, now);
  // No draft payloads, tool arguments, photos, tokens or raw error strings in this queue.
  // SQLite lower() only folds ASCII. Filter ownership in SQL, then match names
  // with Unicode-aware JS so ÉLISE/élise and normalized forms cannot escape masking.
  const customers = await env.DB.prepare(`SELECT CASE WHEN length(c.customer_name)<=128 THEN c.customer_name ELSE NULL END AS customer_name
    FROM customers c JOIN stores s ON s.id=c.store_id WHERE s.entity_id=? AND c.customer_name<>'' LIMIT 501`).bind(scope.entityId).all();
  const rows = customers.results ?? [];
  let overLimit = rows.length > 500;
  let total = 0;
  const names = [];
  for (const row of rows) {
    const name = row.customer_name;
    if (typeof name !== 'string' || !normalize(name) || name.length > 128 || /[\p{Cc}\p{Cf}]/u.test(name)) { overLimit = true; break; }
    total += name.length;
    if (total > 32768) { overLimit = true; break; }
    names.push(name);
  }
  // Sampling could expose an omitted customer's name. If coverage cannot be
  // guaranteed within fixed limits, redact every free-text turn and trigger.
  const mask = overLimit ? () => '[teks disamarkan: daftar pelanggan melebihi batas pemeriksaan]' : value => samarkanTeksBelumPaham(value, names);
  const turns = [...history, { dari: 'saya', teks: pertanyaan }, ...(reply ? [{ dari: 'una', teks: reply }] : [])].slice(-6).map(turn => ({ dari: turn.dari, teks: mask(turn.teks) }));
  const sanitized = bersihkan({ pesan: mask(pertanyaan), giliran: turns }).data;
  const tool = /^[a-z][a-z0-9_]{0,70}$/.test(String(hasil.alat ?? '')) ? hasil.alat : null;
  const version = /^[a-zA-Z0-9._-]{1,100}$/.test(String(versi)) ? String(versi) : 'tidak-tersedia';
  const statements = [...reasons].map(reason => env.DB.prepare(`INSERT OR IGNORE INTO una_belum_paham
    (id,entity_tenancy_id,entity_id,store_id,scope_kind,principal_key,sender_role,conversation_key,reason,trigger_message,turns_json,tool_name,asset_version,status,created_at,updated_at,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'baru',?,?,?)`).bind(crypto.randomUUID(), scope.tenancyId, scope.entityId, scope.storeId, scope.kind, scope.key, scope.role, conversation, reason, sanitized.pesan, JSON.stringify(sanitized.giliran), tool, version, now, now, expires));
  const written = await env.DB.batch(statements);
  return { tercatat: written.reduce((count, result) => count + Number(result.meta?.changes ?? 0), 0) };
}

// Ownership membership snapshot preserves historic isolation without stamping tenant_id on facts (ADR-030).
const scopedWhere = 'entity_tenancy_id=? AND entity_id=? AND store_id IS ? AND scope_kind=?';
const scopedParams = scope => [scope.tenancyId, scope.entityId, scope.storeId, scope.kind];
function mapRow(row, scope) {
  return { id: row.id, tenantId: scope.tenantId, entityId: row.entity_id, storeId: row.store_id, peran: row.sender_role, alasan: row.reason, pesan: row.trigger_message, giliran: JSON.parse(row.turns_json), alat: row.tool_name, versi: row.asset_version, status: row.status, dibuat: row.created_at, diperbarui: row.updated_at };
}

async function readStatusBody(request) {
  const max = 300;
  if (Number(request.headers.get('content-length')) > max) throw error('Isian status terlalu panjang.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw error('Isian status tidak valid.');
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw error('Isian status terlalu panjang.', 413);
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw error('Isian status tidak valid.'); }
}
/** No ingestion route: only the server recorder can create a case. */
export async function handleCacaBelumPahamApi(request, env, pathname) {
  try {
    const scope = await scopeFor(request, env);
    await cleanup(env.DB, new Date().toISOString());
    if (pathname === ROOT && request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      const status = params.get('status') || 'baru';
      if (!STATUSES.has(status)) throw error('Status antrean tidak valid.');
      const limit = Math.max(1, Math.min(100, Number.parseInt(params.get('limit'), 10) || 50));
      const after = params.get('after') || '';
      if (after && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\|[a-zA-Z0-9-]{1,80}$/.test(after)) throw error('Cursor antrean tidak valid.');
      const [time = '', id = ''] = after.split('|');
      const rows = await env.DB.prepare(`SELECT * FROM una_belum_paham WHERE ${scopedWhere} AND status=?
        AND (created_at>? OR (created_at=? AND id>?)) ORDER BY created_at,id LIMIT ?`).bind(...scopedParams(scope), status, time, time, id, limit + 1).all();
      const all = rows.results ?? [];
      const page = all.slice(0, limit);
      const last = page.at(-1);
      return json({ items: page.map(row => mapRow(row, scope)), next: all.length > limit && last ? `${last.created_at}|${last.id}` : null });
    }
    const match = pathname.match(/^\/api\/caca\/belum-paham\/([a-zA-Z0-9-]{1,80})$/);
    if (match && request.method === 'PATCH') {
      const body = await readStatusBody(request);
      if (!body || !STATUSES.has(body.status)) throw error('Status antrean tidak valid.');
      const result = await env.DB.prepare(`UPDATE una_belum_paham SET status=?,updated_at=? WHERE id=? AND ${scopedWhere}`).bind(body.status, new Date().toISOString(), match[1], ...scopedParams(scope)).run();
      if (!result.meta?.changes) throw error('Kejadian tidak tersedia.', 404);
      return json({ id: match[1], status: body.status });
    }
    return json({ error: 'Route antrean Una tidak ditemukan.' }, 404);
  } catch (caught) {
    // Never expose raw DB errors.
    return json({ error: caught.status ? caught.message : 'Antrean Una belum tersedia.' }, caught.status || 503);
  }
}