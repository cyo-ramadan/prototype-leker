import { json, readJson } from './http.js';
import { entityAdminFromRequest } from './owner-auth.js';
import {
  listEntityAccounts, createEntityAccount, updateEntityAccount,
  postEntityJournal, listEntityJournals, getEntityJournal
} from './entity-ledger.js';

const text = (value, max = 300) => String(value ?? '').trim().slice(0, max);

async function requireEntityAdmin(request, db) {
  const entityAdmin = await entityAdminFromRequest(request, db);
  if (!entityAdmin) {
    return { ok: false, response: json({ error: 'Session Entity Admin tidak valid atau sudah habis.', code: 'ENTITY_ADMIN_SESSION_EXPIRED' }, 401) };
  }
  return { ok: true, entityAdmin };
}

function resultResponse(result, successStatus = 200) {
  if (!result.ok) return json(result, result.status || 400);
  const { status, ...rest } = result;
  return json(rest, successStatus);
}

export async function handleEntityAccountingApi(request, env, pathname) {
  if (!pathname.startsWith('/api/entity-admin/accounts') && !pathname.startsWith('/api/entity-admin/journals')) return null;
  const db = env.DB;
  const auth = await requireEntityAdmin(request, db);
  if (!auth.ok) return auth.response;
  const entityId = auth.entityAdmin.entityId;

  if (request.method === 'GET' && pathname === '/api/entity-admin/accounts') {
    return json({ accounts: await listEntityAccounts(db, entityId) });
  }

  if (request.method === 'POST' && pathname === '/api/entity-admin/accounts') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload akun tidak valid.' }, 400);
    return resultResponse(await createEntityAccount(db, entityId, body.value), 201);
  }

  const accountMatch = pathname.match(/^\/api\/entity-admin\/accounts\/([^/]+)$/);
  if (accountMatch && request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload akun tidak valid.' }, 400);
    return resultResponse(await updateEntityAccount(db, entityId, decodeURIComponent(accountMatch[1]), body.value));
  }

  if (request.method === 'GET' && pathname === '/api/entity-admin/journals') {
    const url = new URL(request.url);
    return json({
      journals: await listEntityJournals(db, entityId, {
        from: url.searchParams.get('from') || '',
        to: url.searchParams.get('to') || '',
        limit: Number(url.searchParams.get('limit')) || 200
      })
    });
  }

  if (request.method === 'POST' && pathname === '/api/entity-admin/journals') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload jurnal tidak valid.' }, 400);
    const sourceReferenceId = text(body.value?.sourceReferenceId, 180) || `manual_${crypto.randomUUID()}`;
    const result = await postEntityJournal(db, entityId, {
      businessDate: body.value?.businessDate,
      occurredAt: new Date().toISOString(),
      sourceSystem: 'MANUAL',
      sourceReferenceId,
      correlationId: text(body.value?.correlationId, 180) || sourceReferenceId,
      idempotencyKey: `MANUAL:${entityId}:${sourceReferenceId}`,
      description: body.value?.description,
      journalLines: body.value?.journalLines
    });
    return resultResponse(result, result?.duplicate ? 200 : 201);
  }

  const journalMatch = pathname.match(/^\/api\/entity-admin\/journals\/([^/]+)$/);
  if (journalMatch && request.method === 'GET') {
    const journal = await getEntityJournal(db, entityId, decodeURIComponent(journalMatch[1]));
    return journal ? json({ journal }) : json({ error: 'Jurnal Entity tidak ditemukan.' }, 404);
  }

  return json({ error: 'Route Akuntansi Entity tidak ditemukan.' }, 404);
}
