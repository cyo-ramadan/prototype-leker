import { json, readJson } from './http.js';
import { hashCredential } from './owner-auth.js';
import { requireCashier } from './cashier-auth.js';

// Laporan halaman /diagnostik (Bos Cyo, 2026-10-19; migration 0173). Dulu CS memotret/menyalin
// hasil diagnosis; sekarang halaman mengirimnya sendiri dan CS cukup menyebut kodenya. Boleh tanpa
// login (HP yang tidak bisa login justru paling perlu); bila token kasir ada, nama & gerainya ikut.
// Jaringan (ISP/ASN, data center Cloudflare) diambil dari request.cf -- itu yang membedakan XL,
// Telkomsel, WiFi gerai -- bukan dari isian browser.

const ROOT = '/api/diagnostik/laporan';
const MAX_BYTES = 48 * 1024;
const MAX_ROWS = 120;
const PER_IP_PER_HOUR = 20;
const RETENTION_DAYS = 60;
const clip = (value, max) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);

function kodeLaporan() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `D-${Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('')}`;
}

export function rapikanHasil(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, MAX_ROWS).map(row => ({
    label: clip(row?.label, 120),
    status: clip(row?.status, 20),
    detail: clip(row?.detail, 600)
  })).filter(row => row.label);
}

async function kasirOpsional(request, db) {
  if (!/^Bearer\s+\S/i.test(request.headers.get('authorization') || '')) return null;
  try {
    const auth = await requireCashier(request, db);
    return auth.ok && !auth.readOnly ? auth.cashier : null;
  } catch { return null; }
}

export async function handleDiagnostikLaporanApi(request, env, pathname) {
  if (pathname !== ROOT) return null;
  if (request.method !== 'POST') return json({ error: 'Method tidak didukung.' }, 405);
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BYTES) return json({ error: 'Laporan terlalu besar.' }, 413);
  const body = await readJson(request);
  if (!body.ok || !body.value) return json({ error: 'Isi laporan tidak terbaca.' }, 400);
  const hasil = rapikanHasil(body.value.rows);
  if (!hasil.length) return json({ error: 'Hasil diagnosis kosong.' }, 400);

  const db = env.DB;
  const now = new Date();
  const createdAt = now.toISOString();
  const ipHash = (await hashCredential(`diag:${request.headers.get('cf-connecting-ip') || ''}`)).slice(0, 32);
  const hourAgo = new Date(now.getTime() - 3600 * 1000).toISOString();
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM diagnostik_laporan WHERE ip_hash=? AND created_at>?').bind(ipHash, hourAgo).first();
  if (Number(recent?.n || 0) >= PER_IP_PER_HOUR) return json({ error: 'Terlalu sering mengirim. Coba lagi satu jam lagi.' }, 429);

  const cf = request.cf || {};
  const cashier = await kasirOpsional(request, db);
  const kode = kodeLaporan();
  const record = {
    id: crypto.randomUUID(),
    kode,
    created_at: createdAt,
    cashier_id: cashier?.id || null,
    cashier_name: clip(cashier?.employee_name || cashier?.username || '', 80),
    store_code: clip(cashier?.store_code || body.value.storeCode || '', 20),
    isp: clip(cf.asOrganization || '', 120),
    asn: Number.isFinite(Number(cf.asn)) ? Number(cf.asn) : null,
    colo: clip(cf.colo || '', 10),
    kota: clip([cf.city, cf.region].filter(Boolean).join(', '), 120),
    user_agent: clip(request.headers.get('user-agent') || '', 400),
    gagal: hasil.filter(row => row.status === 'GAGAL').length,
    catatan: clip(body.value.catatan, 500)
  };
  await db.batch([
    db.prepare(`INSERT INTO diagnostik_laporan (id, kode, created_at, cashier_id, cashier_name, store_code, isp, asn, colo, kota, user_agent, ip_hash, gagal, catatan, hasil_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(record.id, kode, createdAt, record.cashier_id, record.cashier_name, record.store_code, record.isp, record.asn, record.colo, record.kota, record.user_agent, ipHash, record.gagal, record.catatan, JSON.stringify(hasil)),
    db.prepare('DELETE FROM diagnostik_laporan WHERE created_at<?').bind(new Date(now.getTime() - RETENTION_DAYS * 86400 * 1000).toISOString())
  ]);
  return json({ ok: true, kode, jaringan: { isp: record.isp, asn: record.asn, colo: record.colo }, kasir: record.cashier_name || null, gerai: record.store_code || null });
}
