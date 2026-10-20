import { json } from './http.js';
import { requireOwner } from './owner-auth.js';
import petaAgen from '../generated/peta-agen-data.js';

// Peta Agen (Bos Cyo, 2026-10-20): rancangan Una, Rika (akuntan), dan Fina (HR) beserta status
// tiap bagian yang dihitung dari kode (scripts/build-peta-agen.mjs). Seperti Peta Kode, nama file
// tidak untuk umum, jadi hanya dilayani setelah login Owner. Halaman penggambarnya: public/peta-agen.html.
export async function handlePetaAgenApi(request, env, pathname) {
  if (pathname !== '/api/owner/peta-agen') return null;
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const auth = await requireOwner(request, env.DB);
  if (!auth.ok) return auth.response;
  return json(petaAgen);
}
