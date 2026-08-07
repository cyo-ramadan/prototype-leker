export function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { 'cache-control': 'no-store' }
  });
}

export async function readJson(request) {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, value: null };
  }
}

export function sanitizeText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}
