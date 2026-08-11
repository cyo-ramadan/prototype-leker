(() => {
  const metaRaw = sessionStorage.getItem('lekerStaffSessionMeta');
  if (!metaRaw) return;

  let meta;
  try { meta = JSON.parse(metaRaw); } catch { return; }
  if (!meta?.id || !meta?.role) return;

  const leaseKey = 'lekerStaffBrowserLease';
  const ttlMs = 15000;
  const heartbeatMs = 5000;
  const pageId = crypto.randomUUID();
  const handoffId = sessionStorage.getItem('lekerStaffHandoffId') || '';
  let blocked = false;

  const tokenKey = meta.role === 'OWNER'
    ? 'lekerOwnerToken'
    : meta.role === 'ADMIN'
      ? 'lekerAdminToken'
      : 'lekerCashierToken';

  function readLease() {
    try { return JSON.parse(localStorage.getItem(leaseKey) || 'null'); }
    catch { return null; }
  }

  function writeLease() {
    localStorage.setItem(leaseKey, JSON.stringify({
      owner: pageId,
      stage: 'active',
      staffId: meta.id,
      role: meta.role,
      updatedAt: Date.now()
    }));
  }

  function clearOwnLease() {
    const lease = readLease();
    if (lease?.owner === pageId) localStorage.removeItem(leaseKey);
  }

  function block() {
    if (blocked) return;
    blocked = true;
    sessionStorage.removeItem(tokenKey);
    sessionStorage.removeItem('lekerStaffSessionMeta');
    sessionStorage.removeItem('lekerStaffHandoffId');
    location.replace('/?login=staff&staffBlocked=1');
  }

  const existing = readLease();
  const existingActive = existing?.owner && Date.now() - Number(existing.updatedAt || 0) <= ttlMs;
  const isHandoff = handoffId && existing?.owner === handoffId;
  if (existingActive && !isHandoff) {
    block();
    return;
  }

  writeLease();
  sessionStorage.removeItem('lekerStaffHandoffId');

  const heartbeat = setInterval(() => {
    if (blocked) return;
    const lease = readLease();
    if (lease?.owner && lease.owner !== pageId && Date.now() - Number(lease.updatedAt || 0) <= ttlMs) {
      clearInterval(heartbeat);
      block();
      return;
    }
    writeLease();
  }, heartbeatMs);

  window.addEventListener('storage', event => {
    if (event.key !== leaseKey || blocked) return;
    const lease = readLease();
    if (lease?.owner && lease.owner !== pageId && Date.now() - Number(lease.updatedAt || 0) <= ttlMs) {
      clearInterval(heartbeat);
      block();
    }
  });

  window.addEventListener('beforeunload', clearOwnLease);
})();
