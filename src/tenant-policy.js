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
// Bos Cyo, 2026-10-01: pilihan skin per tenant -- "nanti ada tombol a b dan
// c dan 0. 0 itu yang skr." 0 = tampilan sekarang; A/B/C = calon desain
// jualan yang sedang diuji (HANDOFF-UIUX-SIAP-JUAL.md §8). Dibaca halaman
// lewat GET /api/ui-profile (src/ui-profile.js). Default 0 supaya tenant
// yang sudah jalan tidak berubah tampilan tanpa diminta.
export const UI_SKIN_KEY = 'ui_skin';
export const UI_SKIN_OPTIONS = Object.freeze([
  { value: '0', label: '0 · Sekarang' },
  { value: 'A', label: 'A · Tenang' },
  { value: 'B', label: 'B · Papan Siaga' },
  { value: 'C', label: 'C · Kabar Gerai' },
  // D bukan cuma tampilan: "Mode Warung" untuk kelontong/UMKM kecil --
  // kasir satu layar + layar Pemilik "Hari ini" (DESAIN-SKIN-D-WARUNG.md).
  { value: 'D', label: 'D · Mode Warung' },
  // Bos Cyo, 2026-10-02: "yang kusus ga ada karyawan dibuat skin e" -- E
  // adalah Mode Warung untuk pemilik yang jaga sendiri
  // (DESAIN-SKIN-E-JAGA-SENDIRI.md). Satu-satunya skin yang juga mengubah
  // aturan server, lihat isOwnerOperatedChoice di bawah.
  { value: 'E', label: 'E · Jaga Sendiri' },
  // Bos Cyo, 2026-10-06: customer parfum racikan -- "setiap penjualannya itu
  // resepnya selalu ga sama". F = layar Racik (Pesanan -> Racik -> Bayar ->
  // Nota) di atas produksi + penjualan yang sudah ada (DESAIN-SKIN-F-RACIK-PARFUM.md).
  // Satu-satunya aturan server yang ikut berubah: kasir boleh mengubah harga
  // jual per transaksi, dan perubahannya tercatat (isRacikChoice di bawah).
  { value: 'F', label: 'F · Racik Parfum' },
  // Bos Cyo, 2026-10-10: "upgrade fitur2 itu hanya berlaku pada tenant baru tersebut. jadi dijadikan
  // on/off skin. setiap tenant juga bisa pake skin itu kalo dipilih." G = Percetakan: chat WA jadi
  // order + antrian per mesin + agen cetak (ADR-055, HANDOFF-PERCETAKAN.md). Seluruh /api/percetakan/*
  // dan layar /s/<kode>/cetak HANYA hidup untuk tenant yang memilih G (isPercetakanChoice).
  { value: 'G', label: 'G · Percetakan' }
]);

// Tenant yang memilih skin E dijaga pemiliknya sendiri, tanpa karyawan:
// buka laci tanpa presensi (presensi ke diri sendiri), pengajuan langsung
// disetujui otomatis (izin ke diri sendiri, tetap tercatat AUTO_PERMIT), dan
// login kasir boleh melihat untung gerainya. Aturan uang/jurnal tidak
// berubah sama sekali. Sengaja satu pintu supaya kalau nanti dipisah jadi
// saklar sendiri, cukup ubah fungsi ini.
export const OWNER_OPERATED_SKIN_CHOICE = 'E';
// Skin F (racik parfum): harga jual boleh diubah kasir saat transaksi. Harga
// daftar tetap dari Master Barang; perubahannya dicatat di keterangan
// penjualan (src/cashier-sales-tracking.js validateDirectLines).
export const RACIK_SKIN_CHOICE = 'F';
export function isRacikChoice(choice) {
  return choice === RACIK_SKIN_CHOICE;
}
// Bos Cyo, 2026-10-06 (skin F): "admin/owner/kasir untuk saat ini samakan,
// boleh langsung jual dan buka laci" -- buka laci (dan ajukan tutup laci)
// tidak menunggu presensi. Skin E sudah begitu lewat isOwnerOperatedChoice;
// F hanya melepas syarat presensi, pengajuan tetap menunggu keputusan.
export function isAttendanceOptionalChoice(choice) {
  return choice === OWNER_OPERATED_SKIN_CHOICE || choice === RACIK_SKIN_CHOICE;
}
// Skin G (Percetakan): satu-satunya saklar modul percetakan. Tenant lain tidak bisa memanggil
// /api/percetakan/* sama sekali, webhook WA-nya diabaikan, dan agen cetaknya ditolak.
export const PERCETAKAN_SKIN_CHOICE = 'G';
export function isPercetakanChoice(choice) {
  return choice === PERCETAKAN_SKIN_CHOICE;
}
export function isOwnerOperatedChoice(choice) {
  return choice === OWNER_OPERATED_SKIN_CHOICE;
}

export const TENANT_POLICY_DEFINITIONS = Object.freeze([
  {
    key: ATTENDANCE_SCHEDULE_GATE_KEY,
    label: 'Batasi gaji & presensi sesuai jadwal shift',
    description: 'ON: presensi di luar jam shift/hari libur gajinya Rp0, dan sesi yang lupa ditutup 1 jam setelah jadwal pulang otomatis ditutup sistem. OFF: cocok untuk tenant yang kebijakannya tidak pakai akun khusus lembur -- di luar jam kerja tetap dihitung gaji, dan tidak di-force-close karena memang masih dianggap kerja.',
    defaultValue: true
  },
  {
    key: UI_SKIN_KEY,
    type: 'choice',
    options: UI_SKIN_OPTIONS,
    label: 'Tampilan (skin)',
    description: '0 = tampilan sekarang. G = Percetakan (chat WA pelanggan otomatis jadi order + antrian per mesin, layar Cetak untuk operator, agen cetak langsung ke printer; kasir diarahkan ke layar Cetak). F = Racik Parfum (untuk toko parfum racikan: layar Racik pesanan -> takaran bahan -> bayar -> nota, draft bisa dilanjutkan, racikan terakhir per pelanggan; kasir boleh mengubah harga jual dan perubahannya tercatat). E = Jaga Sendiri (untuk warung TANPA karyawan: buka warung tanpa absen, pengajuan langsung disetujui otomatis, login kasir bisa lihat untung; jangan dipilih kalau tenant punya karyawan). D = Mode Warung (cara pakai baru untuk kelontong/UMKM kecil: kasir satu layar dengan kembalian, layar Pemilik "Hari ini"). A, B, C = calon desain baru yang sedang diuji untuk dijual: kasir, portal staf, workspace gerai, panel pemilik, dan halaman pelanggan tenant ini ikut berubah. Berlaku setelah halaman dimuat ulang.',
    defaultValue: '0'
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

// Saklar bertipe 'choice' (mis. skin 0/A/B/C) menyimpan nilainya apa adanya,
// bukan '1'/'0'. Nilai di luar daftar opsi dianggap default.
export function normalizePolicyValue(key, value) {
  const def = DEFINITION_BY_KEY.get(key);
  if (def?.type === 'choice') {
    const raw = String(value ?? '');
    return def.options.some(option => option.value === raw) ? raw : def.defaultValue;
  }
  return value ? '1' : '0';
}

function decodePolicyValue(def, stored) {
  if (def?.type === 'choice') return normalizePolicyValue(def.key, stored);
  return stored === '1';
}

export async function getTenantPolicyChoice(db, tenantId, key) {
  const def = DEFINITION_BY_KEY.get(key);
  if (!tenantId) return def?.defaultValue ?? null;
  const row = await db.prepare(`
    SELECT setting_value FROM tenant_policy_settings WHERE tenant_id = ? AND setting_key = ?
  `).bind(tenantId, key).first();
  return row ? decodePolicyValue(def, row.setting_value) : (def?.defaultValue ?? null);
}

export async function setTenantPolicySetting(db, tenantId, key, value, { role = '', id = '' } = {}) {
  await db.prepare(`
    INSERT INTO tenant_policy_settings (tenant_id, setting_key, setting_value, updated_at, updated_by_role, updated_by_id)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
    ON CONFLICT (tenant_id, setting_key) DO UPDATE SET
      setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP,
      updated_by_role = excluded.updated_by_role, updated_by_id = excluded.updated_by_id
  `).bind(tenantId, key, normalizePolicyValue(key, value), role, id).run();
}

// Buat panel Owner -- semua saklar yang dikenal + nilainya SEKARANG untuk
// satu tenant, supaya UI-nya generik (tidak hardcode nama saklar).
export async function listTenantPolicySettings(db, tenantId) {
  const rows = tenantId
    ? (await db.prepare(`SELECT setting_key, setting_value FROM tenant_policy_settings WHERE tenant_id = ?`).bind(tenantId).all()).results ?? []
    : [];
  const savedByKey = new Map(rows.map(row => [row.setting_key, decodePolicyValue(DEFINITION_BY_KEY.get(row.setting_key), row.setting_value)]));
  return TENANT_POLICY_DEFINITIONS.map(def => ({
    key: def.key,
    type: def.type || 'boolean',
    options: def.options || null,
    label: def.label,
    description: def.description,
    value: savedByKey.has(def.key) ? savedByKey.get(def.key) : def.defaultValue
  }));
}
