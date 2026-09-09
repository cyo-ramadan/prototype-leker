const moduleCode = value => String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 48);
const tenantId = value => String(value ?? '').trim().slice(0, 180);

export async function isTenantModuleEnabled(db, rawTenantId, rawModuleCode) {
  const tenant = tenantId(rawTenantId);
  const code = moduleCode(rawModuleCode);
  if (!tenant || !code) return false;

  const row = await db.prepare(`
    SELECT 1 AS enabled
    FROM tenant_module_installations
    WHERE tenant_id = ?
      AND module_code = ?
      AND effective_to IS NULL
    LIMIT 1
  `).bind(tenant, code).first();
  return Boolean(row?.enabled);
}

export async function listActiveTenantModules(db, rawTenantId) {
  const tenant = tenantId(rawTenantId);
  if (!tenant) return [];

  const rows = await db.prepare(`
    SELECT definition.code, definition.display_name, definition.module_kind,
           installation.effective_from
    FROM tenant_module_installations installation
    JOIN platform_modules definition ON definition.code = installation.module_code
    WHERE installation.tenant_id = ?
      AND installation.effective_to IS NULL
    ORDER BY definition.code
  `).bind(tenant).all();

  return (rows.results ?? []).map(row => ({
    code: row.code,
    displayName: row.display_name,
    moduleKind: row.module_kind,
    effectiveFrom: row.effective_from
  }));
}

export async function moduleInstallationHistory(db, rawTenantId, rawModuleCode) {
  const tenant = tenantId(rawTenantId);
  const code = moduleCode(rawModuleCode);
  if (!tenant || !code) return [];

  const rows = await db.prepare(`
    SELECT id, tenant_id, module_code, effective_from, effective_to,
           reason, created_by_role, created_by_id, created_at
    FROM tenant_module_installations
    WHERE tenant_id = ? AND module_code = ?
    ORDER BY effective_from, id
  `).bind(tenant, code).all();

  return (rows.results ?? []).map(row => ({
    id: row.id,
    tenantId: row.tenant_id,
    moduleCode: row.module_code,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    reason: row.reason,
    createdByRole: row.created_by_role,
    createdById: row.created_by_id,
    createdAt: row.created_at
  }));
}
