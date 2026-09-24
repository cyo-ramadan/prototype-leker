// Bos Cyo, 2026-09-24 (koreksi atas migration 0118): "setting2 jangan
// ditaruh disitu. jadi model setting2 sebenernya aku siapkan untuk beda
// tenant apabila mereka memiliki kebijakan kusus ... hal ini berlaku juga
// nanti untuk setting2 lainnya. intinya opsi on/off nya itu adalah
// kebijakan suatu tenant."
//
// Saklar on/off apa pun yang mewakili KEBIJAKAN sebuah pelanggan MAXI
// (Tenant, ADR-030 -- bukan Entity/Badan Usaha, bukan Store/Gerai) hidup di
// sini: satu tabel generik (migration 0119), bukan kolom baru di `stores`
// tiap kali ada saklar baru -- persis arah yang sudah dikunci ADR-040 D3
// ("Modul aktif dicatat per tenant, di tabel, bukan di kolom").
//
// TENANT_POLICY_DEFINITIONS adalah satu-satunya tempat yang perlu disentuh
// waktu menambah saklar baru -- src/owner-auth.js merender daftar ini
// generik, tidak perlu endpoint/kolom baru per saklar.
export const ATTENDANCE_SCHEDULE_GATE_KEY = 'attendance_schedule_gate';

export const TENANT_POLICY_DEFINITIONS = Object.freeze([
  {
    key: ATTENDANCE_SCHEDULE_GATE_KEY,
    label: 'Batasi gaji & presensi sesuai jadwal shift',
    description: 'ON: presensi di luar jam shift/hari libur gajinya Rp0, dan sesi yang lupa ditutup 1 jam setelah jadwal pulang otomatis ditutup sistem. OFF: cocok untuk tenant yang kebijakannya tidak pakai akun khusus lembur -- di luar jam kerja tetap dihitung gaji, dan tidak di-force-close karena memang masih dianggap kerja.',
    defaultValue: true
  }
]);

const DEFINITION_BY_KEY = new Map(TENANT_POLICY_DEFINITIONS.map(def => [def.key, def]));

// Tenant SAAT INI milik sebuah entity, per ADR-030 -- entities sengaja tidak
// punya kolom tenant_id (link itu pindah waktu merger dua pelanggan), jadi
// selalu diresolusi dari baris entity_tenancy yang masih terbuka
// (effective_to IS NULL), bukan dibaca dari kolom statis.
export async function resolveTenantId(db, entityId) {
  if (!entityId) return null;
  const row = await db.prepare(`
    SELECT tenant_id FROM entity_tenancy WHERE entity_id = ? AND effective_to IS NULL LIMIT 1
  `).bind(entityId).first();
  return row?.tenant_id ?? null;
}

// Tidak ada baris tersimpan = belum pernah diubah Owner -- pakai default
// definisinya (atau defaultValue yang dioper eksplisit), BUKAN dianggap off.
export async function getTenantPolicySetting(db, tenantId, key, defaultValue) {
  const fallback = defaultValue !== undefined ? defaultValue : (DEFINITION_BY_KEY.get(key)?.defaultValue ?? false);
  if (!tenantId) return fallback;
  const row = await db.prepare(`
    SELECT setting_value FROM tenant_policy_settings WHERE tenant_id = ? AND setting_key = ?
  `).bind(tenantId, key).first();
  if (!row) return fallback;
  return row.setting_value === '1';
}

export async function setTenantPolicySetting(db, tenantId, key, value, { role = '', id = '' } = {}) {
  await db.prepare(`
    INSERT INTO tenant_policy_settings (tenant_id, setting_key, setting_value, updated_at, updated_by_role, updated_by_id)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
    ON CONFLICT (tenant_id, setting_key) DO UPDATE SET
      setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP,
      updated_by_role = excluded.updated_by_role, updated_by_id = excluded.updated_by_id
  `).bind(tenantId, key, value ? '1' : '0', role, id).run();
}

// Buat panel Owner -- semua saklar yang dikenal + nilainya SEKARANG untuk
// satu tenant, supaya UI-nya generik (tidak hardcode nama saklar).
export async function listTenantPolicySettings(db, tenantId) {
  const rows = tenantId
    ? (await db.prepare(`SELECT setting_key, setting_value FROM tenant_policy_settings WHERE tenant_id = ?`).bind(tenantId).all()).results ?? []
    : [];
  const savedByKey = new Map(rows.map(row => [row.setting_key, row.setting_value === '1']));
  return TENANT_POLICY_DEFINITIONS.map(def => ({
    key: def.key,
    label: def.label,
    description: def.description,
    value: savedByKey.has(def.key) ? savedByKey.get(def.key) : def.defaultValue
  }));
}
