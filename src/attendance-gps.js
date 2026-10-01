// Penilaian GPS presensi (Bos Cyo, 2026-10-01): "presensi absen bisa dilakukan
// jika gps nya match dengan radius 75 meter dari gps acuan (jangan ada info
// ... batas radius adalah 75, tapi infokan saja melebihi batas radius 10
// meter). absen tanpa gps atau gps salah tetap bisa tapi ada tanda warning
// merah di kartu absennya."
//
// Presensi TIDAK PERNAH ditolak karena GPS. Batas radius sengaja hanya ada di
// sini: ke karyawan cuma dikirim selisihnya (overRadiusMeters), bukan batas
// maupun jarak totalnya, karena dari dua angka itu batasnya bisa ditebak.

export const ATTENDANCE_RADIUS_METERS = 75;
const EARTH_RADIUS_METERS = 6_371_000;

const toRadians = degrees => (degrees * Math.PI) / 180;

export function haversineMeters(a, b) {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

const isCoordinate = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

export function storeReference(row) {
  if (!row || !isCoordinate(row.attendance_ref_latitude) || !isCoordinate(row.attendance_ref_longitude)) return null;
  return { latitude: Number(row.attendance_ref_latitude), longitude: Number(row.attendance_ref_longitude) };
}

// status: NO_GPS | OK | OUT_OF_RADIUS | null (ada GPS tapi titik acuan gerai
// belum diatur, jadi tidak bisa dinilai).
export function evaluateGps({ latitude, longitude, reference }) {
  if (!isCoordinate(latitude) || !isCoordinate(longitude)) return { status: 'NO_GPS', distanceM: null };
  if (!reference) return { status: null, distanceM: null };
  const distance = haversineMeters({ latitude: Number(latitude), longitude: Number(longitude) }, reference);
  return { status: distance > ATTENDANCE_RADIUS_METERS ? 'OUT_OF_RADIUS' : 'OK', distanceM: Math.round(distance) };
}

// Selisih di atas batas, dibulatkan ke atas supaya tidak pernah "0 meter".
export function overRadiusMeters(distanceM) {
  if (!Number.isFinite(Number(distanceM))) return null;
  return Math.max(1, Math.ceil(Number(distanceM) - ATTENDANCE_RADIUS_METERS));
}

// Pesan untuk karyawan tepat setelah presensi tersimpan. Tidak menyebut batas.
export function gpsNotice({ status, distanceM }) {
  if (status === 'OUT_OF_RADIUS') {
    return `Presensi tersimpan, tetapi posisi kamu melebihi batas radius ${overRadiusMeters(distanceM)} meter dari lokasi gerai dan ditandai merah. Kalau GPS-nya salah, ajukan perbaikan dari kartu presensi.`;
  }
  if (status === 'NO_GPS') {
    return 'Presensi tersimpan tanpa GPS dan ditandai merah. Aktifkan GPS lalu ajukan perbaikan dari kartu presensi bila perlu.';
  }
  return '';
}

// Bentuk yang dikirim ke sisi karyawan (includeDistance=false) atau Admin.
// needsAttention = tanda merah masih menyala: bermasalah dan belum di-ACC.
export function gpsFact(status, distanceM, resolvedPermitId, resolutionNote, { includeDistance = false } = {}) {
  if (!status) return null;
  const resolved = resolvedPermitId ? { permitId: resolvedPermitId, note: resolutionNote || '' } : null;
  return {
    status,
    overRadiusMeters: status === 'OUT_OF_RADIUS' ? overRadiusMeters(distanceM) : null,
    ...(includeDistance ? { distanceMeters: distanceM == null ? null : Number(distanceM) } : {}),
    resolved,
    needsAttention: (status === 'NO_GPS' || status === 'OUT_OF_RADIUS') && !resolved
  };
}
