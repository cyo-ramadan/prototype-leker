import { json } from './http.js';
import { requireOwner } from './owner-auth.js';
import petaKode from '../generated/peta-kode-data.js';

// Peta Kode 3D (Bos Cyo, 2026-10-04): data titik/hubungan hasil scripts/build-peta-kode.mjs.
// Nama file dan tabel aplikasi tidak untuk umum, jadi tidak ditaruh di public/ -- hanya
// dilayani setelah login Owner. Halaman penggambarnya: public/peta-kode.html.
export async function handlePetaKodeApi(request, env, pathname) {
  if (pathname !== '/api/owner/peta-kode') return null;
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const auth = await requireOwner(request, env.DB);
  if (!auth.ok) return auth.response;
  return json(petaKode);
}
