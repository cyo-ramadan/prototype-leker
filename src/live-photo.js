const MAX_LIVE_PHOTO_BYTES = 800 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/webp', 'image/png']);

export function isMultipartRequest(request) {
  return String(request.headers.get('content-type') || '').toLowerCase().includes('multipart/form-data');
}

export async function readLivePhoto(formData, fieldName = 'photo') {
  const photo = formData.get(fieldName);
  if (!photo || typeof photo.arrayBuffer !== 'function') {
    return { ok: false, status: 400, error: 'Foto live wajib disertakan.' };
  }
  const type = String(photo.type || '').toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(type)) {
    return { ok: false, status: 415, error: 'Format foto wajib JPEG, WebP, atau PNG.' };
  }
  const bytes = await photo.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_LIVE_PHOTO_BYTES) {
    return { ok: false, status: 413, error: 'Ukuran foto terlalu besar. Maksimal 800 KB.' };
  }
  return { ok: true, type, bytes, size: bytes.byteLength };
}
