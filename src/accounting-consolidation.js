function rowsOf(result) {
  if (Array.isArray(result)) return result;
  return result?.results || [];
}

function normalizeAsOf(value) {
  const text = String(value || '').trim();
  return text || new Date().toISOString();
}

function mapResolvedRow(row) {
  if (!row) return null;
  return {
    consolidationGroupId: row.consolidation_group_id,
    entityId: row.entity_id,
    storeId: row.store_id,
    accountId: row.account_id,
    accountCode: row.account_code,
    accountName: row.account_name,
    groupAccountId: row.group_account_id,
    groupAccountCode: row.group_account_code,
    groupAccountName: row.group_account_name,
    groupAccountType: row.group_account_type,
    mappingEffectiveFrom: row.mapping_effective_from,
    mappingEffectiveTo: row.mapping_effective_to,
    groupAccountEffectiveFrom: row.group_account_effective_from,
    groupAccountEffectiveTo: row.group_account_effective_to
  };
}

export async function resolveGroupAccountMapping(db, {
  consolidationGroupId,
  storeId,
  accountId,
  asOf
}) {
  const groupId = String(consolidationGroupId || '').trim();
  const sourceStoreId = String(storeId || '').trim();
  const sourceAccountId = String(accountId || '').trim();
  if (!groupId || !sourceStoreId || !sourceAccountId) return null;
  const at = normalizeAsOf(asOf);

  const row = await db.prepare(`
    SELECT
      m.consolidation_group_id,
      s.entity_id,
      m.store_id,
      m.account_id,
      a.code AS account_code,
      a.name AS account_name,
      ga.id AS group_account_id,
      ga.code AS group_account_code,
      ga.name AS group_account_name,
      ga.type AS group_account_type,
      m.effective_from AS mapping_effective_from,
      m.effective_to AS mapping_effective_to,
      ga.effective_from AS group_account_effective_from,
      ga.effective_to AS group_account_effective_to
    FROM consolidation_account_mapping m
    JOIN stores s
      ON s.id = m.store_id
    JOIN chart_of_accounts a
      ON a.id = m.account_id
     AND a.store_id = m.store_id
    JOIN consolidation_group_accounts ga
      ON ga.id = m.consolidation_group_account_id
     AND ga.consolidation_group_id = m.consolidation_group_id
    JOIN consolidation_membership cm
      ON cm.entity_id = s.entity_id
     AND cm.consolidation_group_id = m.consolidation_group_id
     AND cm.effective_from <= ?
     AND (cm.effective_to IS NULL OR cm.effective_to > ?)
    WHERE m.consolidation_group_id = ?
      AND m.store_id = ?
      AND m.account_id = ?
      AND m.effective_from <= ?
      AND (m.effective_to IS NULL OR m.effective_to > ?)
      AND ga.effective_from <= ?
      AND (ga.effective_to IS NULL OR ga.effective_to > ?)
    LIMIT 1
  `).bind(
    at, at,
    groupId, sourceStoreId, sourceAccountId,
    at, at,
    at, at
  ).first();

  return mapResolvedRow(row);
}

export async function listMappedAccountsForGroup(db, {
  consolidationGroupId,
  asOf
}) {
  const groupId = String(consolidationGroupId || '').trim();
  if (!groupId) return [];
  const at = normalizeAsOf(asOf);

  const result = await db.prepare(`
    SELECT
      m.consolidation_group_id,
      s.entity_id,
      m.store_id,
      m.account_id,
      a.code AS account_code,
      a.name AS account_name,
      ga.id AS group_account_id,
      ga.code AS group_account_code,
      ga.name AS group_account_name,
      ga.type AS group_account_type,
      m.effective_from AS mapping_effective_from,
      m.effective_to AS mapping_effective_to,
      ga.effective_from AS group_account_effective_from,
      ga.effective_to AS group_account_effective_to
    FROM consolidation_account_mapping m
    JOIN stores s
      ON s.id = m.store_id
    JOIN chart_of_accounts a
      ON a.id = m.account_id
     AND a.store_id = m.store_id
    JOIN consolidation_group_accounts ga
      ON ga.id = m.consolidation_group_account_id
     AND ga.consolidation_group_id = m.consolidation_group_id
    JOIN consolidation_membership cm
      ON cm.entity_id = s.entity_id
     AND cm.consolidation_group_id = m.consolidation_group_id
     AND cm.effective_from <= ?
     AND (cm.effective_to IS NULL OR cm.effective_to > ?)
    WHERE m.consolidation_group_id = ?
      AND m.effective_from <= ?
      AND (m.effective_to IS NULL OR m.effective_to > ?)
      AND ga.effective_from <= ?
      AND (ga.effective_to IS NULL OR ga.effective_to > ?)
    ORDER BY s.entity_id, m.store_id, a.code, ga.code
  `).bind(at, at, groupId, at, at, at, at).all();

  return rowsOf(result).map(mapResolvedRow);
}
