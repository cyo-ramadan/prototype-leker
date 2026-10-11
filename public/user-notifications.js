/* Authenticated per-user inbox. Event driven, never polls. */
(() => {
  'use strict';
  let active = null;
  const PUSH_BINDING_KEY = 'maxiNotificationPushBinding';
  function readPushBinding() { try { const value = JSON.parse(localStorage.getItem(PUSH_BINDING_KEY) || 'null'); return value?.actorKey && value?.endpoint && value?.id ? value : null; } catch { return null; } }
  function sameBinding(a, b) { return !!a && !!b && a.actorKey === b.actorKey && a.endpoint === b.endpoint && a.id === b.id; }
  async function revokeBinding(binding, token) {
    if (!pushSupported() || !binding || !sameBinding(binding, readPushBinding())) return;
    const registration = await navigator.serviceWorker.getRegistration('/');
    const sub = await registration?.pushManager?.getSubscription();
    if (!sub || sub.endpoint !== binding.endpoint || !sameBinding(binding, readPushBinding())) return;
    try {
      if (token) await fetch('/api/notifications/subscriptions', { method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
    } finally {
      // A new account may have rebound this endpoint while the server request was pending.
      if (sameBinding(binding, readPushBinding())) {
        await sub.unsubscribe();
        if (sameBinding(binding, readPushBinding())) localStorage.removeItem(PUSH_BINDING_KEY);
      }
    }
  }
  const node = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  const safePath = value => {
    try {
      const url = new URL(value, location.origin);
      if (url.origin !== location.origin || url.username || url.password) return null;
      if (!/^\/(?:entity-admin|admin|owner|cashier|staff|login|s\/[^/]+\/admin)(?:\/|$)/.test(url.pathname)) return null;
      for (const key of url.searchParams.keys()) if (/token|ticket|password|authorization/i.test(key)) return null;
      return url.pathname + url.search + url.hash;
    } catch { return null; }
  };
  async function request(state, path, options = {}) {
    if (active !== state || !state.token || state.getToken() !== state.token) { if (active === state) void destroy({ revokePush: true }); throw new Error('Sesi notifikasi berakhir.'); }
    const response = await fetch('/api/notifications' + path, { ...options, signal: state.abort.signal,
      headers: { Authorization: `Bearer ${state.token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Notifikasi gagal dimuat (${response.status}).`);
    if (active !== state || state.getToken() !== state.token) { if (active === state) void destroy({ revokePush: true }); throw new Error('Sesi notifikasi berubah.'); }
    return result;
  }
  function report(state, message) { if (active === state) state.status.textContent = message; }
  function beep(state) {
    if (!state.audio || !state.snapshot?.preferences?.soundEnabled || document.hidden) return;
    try { const osc = state.audio.createOscillator(); const gain = state.audio.createGain(); osc.connect(gain); gain.connect(state.audio.destination); osc.frequency.value = 660; gain.gain.value = 0.08; osc.start(); gain.gain.exponentialRampToValueAtTime(0.001, state.audio.currentTime + 0.18); osc.stop(state.audio.currentTime + 0.2); } catch {}
  }
  function render(state, payload) {
    state.bell.textContent = `Notifikasi${payload.unreadCount ? ` (${payload.unreadCount})` : ''}`;
    state.list.replaceChildren();
    if (!payload.items?.length) state.list.append(node('p', 'Belum ada notifikasi.', 'muted'));
    for (const item of payload.items || []) {
      const row = node('article', null, 'notification-item' + (item.readAt ? '' : ' is-unread'));
      row.append(node('strong', item.title), node('p', item.body));
      const date = new Date(item.createdAt);
      if (!Number.isNaN(date.getTime())) row.append(node('small', new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(date) + ' WIB', 'muted'));
      const actions = node('div', null, 'management-actions');
      const url = safePath(item.url);
      if (url) { const link = node('a', 'Buka', 'mini-btn'); link.href = url; actions.append(link); }
      if (!item.readAt) { const read = node('button', 'Tandai dibaca', 'mini-btn'); read.type = 'button'; read.onclick = async () => { read.disabled = true; try { await request(state, '/read', { method: 'POST', body: JSON.stringify({ id: item.id }) }); await refresh(); } catch (e) { report(state, e.message); read.disabled = false; } }; actions.append(read); }
      row.append(actions); state.list.append(row);
    }
    state.sound.textContent = payload.preferences?.soundEnabled && state.audio?.state === 'running' ? 'Matikan bunyi' : 'Aktifkan bunyi pada perangkat ini';
    state.push.textContent = payload.preferences?.pushEnabled ? 'Kelola notifikasi HP' : 'Aktifkan notifikasi HP (Rekomendasi Codex: tetap terima saat aplikasi ditutup)';
    state.off.hidden = !payload.preferences?.pushEnabled;
  }
  async function refresh() {
    const state = active; if (!state) return null;
    if (state.loading) { state.again = true; return state.loading; }
    state.loading = (async () => {
      try {
        const payload = await request(state, '');
        if (state.snapshot) { const old = new Set((state.snapshot.items || []).map(i => i.id)); if ((payload.items || []).some(i => !i.readAt && !old.has(i.id))) beep(state); }
        state.snapshot = payload;
        if (!state.bindingInitialized && payload.actor?.key) { state.bindingInitialized = true; const binding = readPushBinding(); if (binding?.actorKey === payload.actor.key) state.pushBinding = binding; }
        render(state, payload); report(state, '');
        state.onChange?.(payload); document.dispatchEvent(new CustomEvent('maxi-notifications-changed', { detail: payload })); return payload;
      } catch (error) { if (error.name !== 'AbortError') report(state, error.message); return null; }
    })();
    try { return await state.loading; } finally { state.loading = null; if (state.again && active === state) { state.again = false; void refresh(); } }
  }
  async function setPreferences(patch) {
    if (!active) throw new Error('Login dahulu.');
    const state = active; const result = await request(state, '/preferences', { method: 'PATCH', body: JSON.stringify(patch) }); await refresh(); return result;
  }
  function retry(state) {
    if (active !== state || document.hidden || state.retryCount >= 8 || state.timer) return;
    state.timer = setTimeout(() => { state.timer = null; void connect(state); }, Math.min(60000, 1000 * 2 ** state.retryCount++));
  }
  async function connect(state) {
    if (active !== state || document.hidden || state.connecting || state.socket || !window.WebSocket) return;
    state.connecting = true;
    try {
      const { ticket } = await request(state, '/live-ticket'); if (!ticket || active !== state || document.hidden) return;
      const url = new URL('/api/notifications/live', location.origin); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('ticket', ticket);
      const socket = new WebSocket(url); state.socket = socket;
      socket.onopen = () => { state.retryCount = 0; };
      socket.onmessage = event => { try { if (JSON.parse(event.data).type === 'notifications-changed') void refresh(); } catch {} };
      socket.onclose = () => { if (state.socket === socket) state.socket = null; retry(state); }; socket.onerror = () => socket.close();
    } catch { retry(state); } finally { state.connecting = false; }
  }
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  async function enablePush() {
    const state = active; if (!state) return;
    if (!pushSupported()) { report(state, 'Browser belum mendukung notifikasi HP. Di iPhone/iPad: tambahkan aplikasi ke Layar Utama melalui Safari, lalu buka dari ikonnya.'); return; }
    const permissionPromise = Notification.permission === 'default' ? Notification.requestPermission() : Promise.resolve(Notification.permission);
    try {
      if (await permissionPromise !== 'granted') throw new Error('Izin notifikasi belum diberikan. Buka pengaturan browser untuk mengizinkannya.');
      const key = await request(state, '/push-key');
      if (!key.configured || !key.publicKey) throw new Error('Notifikasi HP belum dikonfigurasi oleh pengelola. Notifikasi di aplikasi tetap dapat dipakai.');
      const registration = await navigator.serviceWorker.register('/notifications-sw.js', { scope: '/' }); await navigator.serviceWorker.ready;
      const raw = atob(key.publicKey.replace(/-/g, '+').replace(/_/g, '/')); const applicationServerKey = Uint8Array.from(raw, char => char.charCodeAt(0));
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      if (!state.snapshot?.actor?.key) throw new Error('Identitas akun belum tersedia. Muat ulang notifikasi.');
      await request(state, '/subscriptions', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) });
      const binding = { actorKey: state.snapshot.actor.key, endpoint: subscription.endpoint, id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}` };
      localStorage.setItem(PUSH_BINDING_KEY, JSON.stringify(binding)); state.pushBinding = binding;
      await setPreferences({ pushEnabled: true }); report(state, 'Notifikasi HP aktif untuk akun ini pada perangkat ini. Bunyi saat aplikasi ditutup mengikuti pengaturan HP.');
    } catch (e) { report(state, e.message); }
  }
  async function disablePush() {
    const state = active; if (!state) return;
    try {
      await revokeBinding(state.pushBinding, state.token);
      await setPreferences({ pushEnabled: false }); report(state, 'Notifikasi HP dimatikan untuk akun ini.');
    } catch (e) { report(state, e.message); }
  }
  async function destroy(options = {}) {
    const state = active; if (!state) return;
    active = null; state.abort.abort(); clearTimeout(state.timer); state.socket?.close(); state.audio?.close().catch(() => {});
    document.removeEventListener('visibilitychange', state.wake); window.removeEventListener('focus', state.wake); navigator.serviceWorker?.removeEventListener('message', state.message);
    window.removeEventListener('storage', state.storage); state.root.remove();
    if (options.revokePush) { try { await revokeBinding(state.pushBinding, state.token); } catch { /* Local unsubscribe is attempted even when the server is offline. */ } }
  }
  async function init({ getToken, token, mount, onChange } = {}) {
    await destroy(); const getter = getToken || (() => token || ''); if (!getter()) return null;
    const state = { getToken: getter, token: getter(), abort: new AbortController(), onChange, retryCount: 0 }; active = state;
    state.root = node('div', null, 'notifications-widget'); state.bell = node('button', 'Notifikasi', 'secondary-btn'); state.bell.type = 'button'; state.bell.setAttribute('aria-expanded', 'false');
    const panel = node('section', null, 'notifications-panel'); panel.hidden = true; panel.setAttribute('aria-label', 'Notifikasi akun');
    const heading = node('div', null, 'management-actions'); heading.append(node('h2', 'Notifikasi'));
    const close = node('button', 'Tutup', 'mini-btn'); close.type = 'button'; close.onclick = () => { panel.hidden = true; state.bell.setAttribute('aria-expanded', 'false'); state.bell.focus(); }; heading.append(close);
    const actions = node('div', null, 'management-actions');
    const all = node('button', 'Tandai semua dibaca', 'mini-btn'); all.type = 'button'; all.onclick = async () => { try { await request(state, '/read', { method: 'POST', body: '{"all":true}' }); await refresh(); } catch (e) { report(state, e.message); } };
    const reload = node('button', 'Muat ulang', 'mini-btn'); reload.type = 'button'; reload.onclick = () => void refresh();
    state.sound = node('button', 'Aktifkan bunyi', 'mini-btn'); state.sound.type = 'button'; state.sound.onclick = async () => { try { const enabled = !(state.snapshot?.preferences?.soundEnabled && state.audio?.state === 'running'); if (enabled) { const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) throw new Error('Bunyi tidak didukung browser ini.'); state.audio ||= new Audio(); await state.audio.resume(); } await setPreferences({ soundEnabled: enabled }); if (enabled) beep(state); } catch (e) { report(state, e.message); } };
    state.push = node('button', 'Aktifkan notifikasi HP (Rekomendasi Codex: tetap terima saat aplikasi ditutup)', 'mini-btn'); state.push.type = 'button'; state.push.onclick = enablePush;
    state.off = node('button', 'Matikan notifikasi HP', 'mini-btn'); state.off.type = 'button'; state.off.onclick = disablePush; state.off.hidden = true;
    actions.append(all, reload, state.sound, state.push, state.off); state.status = node('p', '', 'management-status'); state.status.setAttribute('role', 'status'); state.list = node('div', null, 'notifications-list');
    panel.append(heading, node('p', 'Bunyi dalam aplikasi aktif setelah tombol bunyi ditekan pada perangkat ini. Bunyi notifikasi HP mengikuti pengaturan perangkat.', 'muted'), actions, state.status, state.list);
    state.root.append(state.bell, panel); (mount || document.querySelector('.admin-top-actions') || document.querySelector('.cashier-user-chip') || document.querySelector('.w-top') || document.querySelector('.r-top') || document.querySelector('.cetak-header') || document.querySelector('.topbar') || document.body).append(state.root);
    state.bell.onclick = () => { panel.hidden = !panel.hidden; state.bell.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) void refresh(); };
    const initialToken = getter();
    state.wake = () => { if (getter() !== initialToken) { void destroy({ revokePush: true }); return; } if (document.hidden) { clearTimeout(state.timer); state.timer = null; state.socket?.close(); state.socket = null; } else { state.retryCount = 0; void refresh(); void connect(state); } };
    state.message = event => { if (event.data?.type === 'notifications-changed') void refresh(); }; state.storage = () => { if (getter() !== initialToken) void destroy({ revokePush: true }); };
    document.addEventListener('visibilitychange', state.wake); window.addEventListener('focus', state.wake); navigator.serviceWorker?.addEventListener('message', state.message); window.addEventListener('storage', state.storage);
    const payload = await refresh(); void connect(state); return payload;
  }
  function storedSessionGetter() {
    const path = location.pathname.replace(/\/$/, '').replace(/\.html$/, '');
    if (window.LEKER_PAGE_CONTEXT === 'admin' || /^\/s\/[^/]+\/admin(?:\/|$)/.test(path)) return () => localStorage.getItem('lekerOwnerToken') || localStorage.getItem('lekerEntityAdminToken') || localStorage.getItem('lekerAdminToken') || '';
    if (path === '/admin' || path === '/owner') return () => localStorage.getItem('lekerOwnerToken') || '';
    if (path === '/entity-admin') return () => localStorage.getItem('lekerEntityAdminToken') || '';
    if (/^\/(?:s\/[^/]+\/)?(?:cashier|staff|warung|racik)(?:\/|$)/.test(path)) return () => localStorage.getItem('lekerCashierToken') || '';
    if (/^\/(?:s\/[^/]+\/cetak|percetakan)$/.test(path)) return () => localStorage.getItem('lekerCashierToken') || localStorage.getItem('lekerOwnerToken') || localStorage.getItem('lekerEntityAdminToken') || localStorage.getItem('lekerAdminToken') || '';
    return () => localStorage.getItem('lekerOwnerToken') || localStorage.getItem('lekerEntityAdminToken') || localStorage.getItem('lekerAdminToken') || localStorage.getItem('lekerCashierToken') || '';
  }
  async function revokeStoredPush() {
    const state = active;
    // Without an active widget this is an explicit pre-login cleanup of the current device binding.
    const binding = state ? state.pushBinding : readPushBinding();
    await revokeBinding(binding, state?.token || storedSessionGetter()());
  }
  function startForStoredSession() {
    const path = location.pathname.replace(/\/$/, '').replace(/\.html$/, '');
    if (path === '/entity-admin' || path === '/login') return;
    if (!/^\/(?:owner|admin|branch-admin|staff|cashier|warung|racik|percetakan|s\/[^/]+\/(?:admin|cashier|warung|racik|cetak))(?:\/|$)/.test(path)) return;
    const getToken = storedSessionGetter(); if (getToken()) return init({ getToken });
  }
  window.MaxiNotifications = { init, destroy, refresh, setPreferences, enablePush, disablePush, safePath, startForStoredSession, revokeStoredPush, get snapshot() { return active?.snapshot || null; } };
})();
