import { newId } from './ikan-ids.js';
import { IKAN_STORE_ID } from './ikan-config.js';

function mapContactRow(row) {
  return {
    contactId: row.contact_id,
    contactName: row.contact_name,
    whatsappNumber: row.whatsapp_number,
    isCustomer: Boolean(row.is_customer),
    isPetani: Boolean(row.is_petani),
    isKurir: Boolean(row.is_kurir),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listContacts(db, { role, activeOnly = true } = {}) {
  const conditions = ['store_id = ?'];
  const args = [IKAN_STORE_ID];
  if (activeOnly) conditions.push('is_active = 1');
  if (role === 'customer') conditions.push('is_customer = 1');
  if (role === 'petani') conditions.push('is_petani = 1');
  if (role === 'kurir') conditions.push('is_kurir = 1');
  const result = await db
    .prepare(`SELECT * FROM ikan_contacts WHERE ${conditions.join(' AND ')} ORDER BY contact_name ASC`)
    .bind(...args)
    .all();
  return (result.results ?? []).map(mapContactRow);
}

export async function getContact(db, contactId) {
  const row = await db.prepare('SELECT * FROM ikan_contacts WHERE contact_id = ? AND store_id = ?').bind(contactId, IKAN_STORE_ID).first();
  return row ? mapContactRow(row) : null;
}

function validateContactInput(input) {
  if (!input || typeof input.contactName !== 'string' || input.contactName.trim() === '') {
    throw new RangeError('contactName wajib diisi');
  }
  if (!input.isCustomer && !input.isPetani && !input.isKurir) {
    throw new RangeError('Kontak wajib punya minimal satu peran (customer/petani/kurir)');
  }
}

export async function createContact(db, input) {
  validateContactInput(input);
  const contactId = newId('CN');
  await db
    .prepare(
      `INSERT INTO ikan_contacts (contact_id, store_id, contact_name, whatsapp_number, is_customer, is_petani, is_kurir)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      contactId,
      IKAN_STORE_ID,
      input.contactName.trim(),
      input.whatsappNumber ?? null,
      input.isCustomer ? 1 : 0,
      input.isPetani ? 1 : 0,
      input.isKurir ? 1 : 0
    )
    .run();
  return getContact(db, contactId);
}

export async function updateContact(db, contactId, patch) {
  const existing = await getContact(db, contactId);
  if (!existing) throw new RangeError('CONTACT_NOT_FOUND');

  const merged = {
    contactName: patch.contactName ?? existing.contactName,
    whatsappNumber: patch.whatsappNumber !== undefined ? patch.whatsappNumber : existing.whatsappNumber,
    isCustomer: patch.isCustomer ?? existing.isCustomer,
    isPetani: patch.isPetani ?? existing.isPetani,
    isKurir: patch.isKurir ?? existing.isKurir,
    isActive: patch.isActive ?? existing.isActive,
  };
  validateContactInput(merged);

  await db
    .prepare(
      `UPDATE ikan_contacts SET contact_name = ?, whatsapp_number = ?, is_customer = ?, is_petani = ?, is_kurir = ?,
        is_active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE contact_id = ? AND store_id = ?`
    )
    .bind(
      merged.contactName.trim(),
      merged.whatsappNumber ?? null,
      merged.isCustomer ? 1 : 0,
      merged.isPetani ? 1 : 0,
      merged.isKurir ? 1 : 0,
      merged.isActive ? 1 : 0,
      contactId,
      IKAN_STORE_ID
    )
    .run();
  return getContact(db, contactId);
}

async function isContactReferenced(db, contactId) {
  const referencingQueries = [
    'SELECT 1 FROM ikan_sales WHERE contact_id = ? LIMIT 1',
    'SELECT 1 FROM ikan_purchases WHERE petani_contact_id = ? LIMIT 1',
    'SELECT 1 FROM ikan_cost_payables WHERE payee_contact_id = ? LIMIT 1',
  ];
  for (const sql of referencingQueries) {
    const row = await db.prepare(sql).bind(contactId).first();
    if (row) return true;
  }
  return false;
}

// Kontak yang masih direferensikan transaksi TIDAK dihapus diam-diam (cascade) --
// dinonaktifkan (soft delete) supaya histori transaksi lama tetap utuh.
export async function deleteContact(db, contactId) {
  const existing = await getContact(db, contactId);
  if (!existing) throw new RangeError('CONTACT_NOT_FOUND');
  if (await isContactReferenced(db, contactId)) {
    await db
      .prepare(`UPDATE ikan_contacts SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE contact_id = ? AND store_id = ?`)
      .bind(contactId, IKAN_STORE_ID)
      .run();
    return { deleted: false, deactivated: true };
  }
  await db.prepare('DELETE FROM ikan_contacts WHERE contact_id = ? AND store_id = ?').bind(contactId, IKAN_STORE_ID).run();
  return { deleted: true, deactivated: false };
}

export async function handleMasterContactsApi(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'ikan', 'contacts', maybe id]
  const contactId = parts[3];

  try {
    if (request.method === 'GET' && !contactId) {
      const role = url.searchParams.get('role') ?? undefined;
      const activeOnly = url.searchParams.get('all') !== '1';
      return Response.json(await listContacts(env.DB, { role, activeOnly }));
    }
    if (request.method === 'GET' && contactId) {
      const contact = await getContact(env.DB, contactId);
      if (!contact) return Response.json({ error: 'CONTACT_NOT_FOUND' }, { status: 404 });
      return Response.json(contact);
    }
    if (request.method === 'POST' && !contactId) {
      const body = await request.json();
      const created = await createContact(env.DB, body);
      return Response.json(created, { status: 201 });
    }
    if (request.method === 'PATCH' && contactId) {
      const body = await request.json();
      const updated = await updateContact(env.DB, contactId, body);
      return Response.json(updated);
    }
    if (request.method === 'DELETE' && contactId) {
      const result = await deleteContact(env.DB, contactId);
      return Response.json(result);
    }
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  } catch (err) {
    if (err.message === 'CONTACT_NOT_FOUND') return Response.json({ error: err.message }, { status: 404 });
    if (err instanceof RangeError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
