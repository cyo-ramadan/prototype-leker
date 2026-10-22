const $ = id => document.getElementById(id);
let events, before = null, loading = false, refreshAgain = false;
async function api(path, method = 'GET', data = {}) {
  const response = await fetch(path, { method, ...(method !== 'GET' ? { headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Permintaan gagal');
  return result;
}
function showError(error) { $('error').textContent = error.message; }
function renderMessages(messages) {
  const list = $('messages'); list.replaceChildren();
  if (!messages.length) list.textContent = 'Belum ada pesan pada halaman ini.';
  for (const item of messages) {
    const article = document.createElement('article'); article.className = 'message';
    const title = document.createElement('strong'); title.textContent = item.name || item.jid;
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = `${item.jid} · Diterima ${new Date(item.received_at).toLocaleString('id-ID')}`;
    const body = document.createElement('p'); body.textContent = item.body;
    article.append(title, meta, body);
    if (item.media_type) {
      const file = document.createElement('div'); file.className = 'file';
      const name = document.createElement('span'); name.textContent = `${item.filename} · ${item.media_status}`; file.append(name);
      if (item.media_status === 'SAVED') {
        const link = document.createElement('a'); link.href = `/api/media/${item.seq}`; link.textContent = 'Unduh lampiran'; file.append(link);
      }
      if (item.media_status === 'FAILED') {
        const button = document.createElement('button'); button.className = 'secondary'; button.textContent = 'Coba unduh ulang';
        button.onclick = () => action(button, () => api(`/api/retry/${item.seq}`, 'POST')); file.append(button);
      }
      article.append(file);
    }
    list.append(article);
  }
  $('older').hidden = messages.length < 100;
  $('older').dataset.before = messages.at(-1)?.seq || '';
}
async function refresh() {
  if (loading) { refreshAgain = true; return; } loading = true;
  try {
    const [status, inbox] = await Promise.all([api('/api/status'), api(`/api/messages${before ? `?before=${before}` : ''}`)]);
    $('tenant').textContent = status.tenant;
    const names = {STOPPED:'Dihentikan',CONNECTING:'Menghubungkan',SCAN_QR:'Menunggu scan QR',CONNECTED:'Terhubung',RECONNECTING:'Menyambung kembali',NEEDS_ATTENTION:'Perlu diperiksa'};
    $('status').textContent = names[status.state] || status.state; $('connection-error').textContent = status.error || '';
    $('qr').hidden = !status.qr; $('qr-help').hidden = !status.qr;
    if (status.qr) $('qr').src = status.qr; else $('qr').removeAttribute('src');
    renderMessages(inbox.messages);
  } catch (error) { showError(error); }
  finally { loading = false; if (refreshAgain) { refreshAgain = false; void refresh(); } }
}
async function action(button, fn) {
  button.disabled = true; $('error').textContent = '';
  try { await fn(); await refresh(); } catch (error) { showError(error); } finally { button.disabled = false; }
}
function entered() {
  $('login').hidden = true; $('workspace').hidden = false; $('token').value = '';
  events?.close(); events = new EventSource('/api/events'); events.addEventListener('refresh', refresh);
  events.onerror = () => { $('error').textContent = 'Sambungan panel terputus. Panel mencoba tersambung kembali; muat ulang jika gateway baru dimulai ulang.'; };
  events.onopen = () => { $('error').textContent = ''; };
  void refresh();
}
$('login').onsubmit = async event => {
  event.preventDefault(); $('error').textContent = '';
  try { await api('/api/login', 'POST', { token: $('token').value.trim() }); entered(); } catch (error) { showError(error); }
};
$('connect').onclick = () => action($('connect'), () => api('/api/connect', 'POST'));
$('stop').onclick = () => action($('stop'), () => api('/api/stop', 'POST'));
$('reset').onclick = () => {
  if (confirm('Hapus sesi lokal dan scan QR baru? Arsip pesan tetap tersimpan. Lepaskan juga perangkat lama dari WhatsApp di HP bila masih tercantum.'))
    void action($('reset'), () => api('/api/reset-session', 'POST'));
};
$('refresh').onclick = () => { before = null; void refresh(); };
$('older').onclick = () => { before = Number($('older').dataset.before); void refresh(); };
window.addEventListener('focus', () => { if (!$('workspace').hidden) void refresh(); });
api('/api/status').then(entered).catch(() => {});
