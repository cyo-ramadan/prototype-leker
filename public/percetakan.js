// Layar Percetakan (ADR-055). Satu file, tanpa framework, seperti layar lain di repo ini.
// Isi chat pelanggan adalah data asing: SELALU lewat esc() sebelum masuk HTML.
(() => {
  const storeCode = (location.pathname.match(/^\/s\/([^/]+)\/cetak/) || [])[1] || new URLSearchParams(location.search).get('store') || '';
  const token = () => {
    try {
      return localStorage.getItem('lekerCashierToken') || localStorage.getItem('lekerOwnerToken')
        || localStorage.getItem('lekerEntityAdminToken') || localStorage.getItem('lekerAdminToken') || '';
    } catch { return ''; }
  };
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const STATUS_LABEL = { BARU: 'Baru', DESAIN: 'Desain', SIAP_CETAK: 'Siap cetak', DICETAK: 'Dicetak', FINISHING: 'Finishing', SIAP_AMBIL: 'Siap diambil', DIAMBIL: 'Diambil', BATAL: 'Batal', DIREVISI: 'Direvisi' };
  const ROLE_LABEL = { CASHIER: 'Karyawan', ADMIN: 'Admin', ENTITY_ADMIN: 'Admin', OWNER: 'Pemilik', SYSTEM: 'Sistem otomatis', MESIN: 'Mesin' };
  let setup = null;
  // ?mesin=OUTDOOR -> layar khusus satu mesin (tablet di samping mesin).
  let mesinDipilih = new URLSearchParams(location.search).get('mesin') || '';
  const MODE_LABEL = {
    MANUAL: 'ACC pelanggan (disarankan): draft Una → kirim rincian ke pelanggan → pelanggan balas OK → order',
    OTOMATIS: 'Otomatis tanpa ACC: chat yang jelas langsung jadi order + antrian',
    LANGSUNG_CETAK: 'Langsung cetak: seperti Otomatis, file langsung dikirim ke mesin oleh agen cetak'
  };

  async function api(path, { method = 'GET', body } = {}) {
    const url = new URL(path, location.origin);
    if (storeCode) url.searchParams.set('store', storeCode);
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || `Gagal (${response.status})`), { status: response.status, code: data.code });
    return data;
  }

  function tampilPesan(text, bad = false) {
    const box = $('pesan');
    box.textContent = text;
    box.className = bad ? 'notice bad' : 'notice';
    box.hidden = !text;
  }

  async function jalankan(fn) {
    try { tampilPesan(''); await fn(); } catch (error) { tampilPesan(error.message, true); }
  }

  const ukuran = item => (item.widthCm && item.heightCm ? ` ${item.widthCm}×${item.heightCm} cm` : '');

  async function unduhFile(fileId, name) {
    const url = new URL(`/api/percetakan/files/${encodeURIComponent(fileId)}`, location.origin);
    if (storeCode) url.searchParams.set('store', storeCode);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
    if (!response.ok) return tampilPesan('File belum bisa dibuka.', true);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await response.blob());
    link.download = name || 'file';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  }

  // --- Chat masuk -------------------------------------------------------------------------
  async function renderMasuk() {
    const { conversations } = await api('/api/percetakan/inbox');
    const sim = setup.isManagement && !setup.channels.some(c => c.provider === 'META_CLOUD' && c.isActive) ? `
      <div class="admin-card">
        <strong>Simulator WA</strong> <span class="status-chip warn">uji coba</span>
        <p class="muted">Pesan di sini ditandai SIMULASI selamanya, dan simulator mati sendiri begitu WA sungguhan tersambung.</p>
        <div class="grid">
          <input class="text-input" id="sim-from" placeholder="Nomor pelanggan, mis. 0812…" />
          <input class="text-input" id="sim-name" placeholder="Nama (opsional)" />
        </div>
        <textarea class="text-input" id="sim-text" rows="2" placeholder="Isi chat, mis. mas cetak banner 3x1 2 lembar"></textarea>
        <input type="file" id="sim-file" />
        <div class="actions"><button class="primary-btn" id="sim-kirim" type="button">Kirim sebagai pelanggan</button></div>
      </div>` : '';
    $('tab-masuk').innerHTML = sim + (conversations.length ? conversations.map(conv => `
      <div class="admin-card">
        <div class="master-row">
          <div class="master-main">
            <strong>${esc(conv.fromName || conv.fromNumber)}</strong> <span class="muted">${esc(conv.fromNumber)}</span>
            ${conv.unprocessed ? `<span class="status-chip warn">${conv.unprocessed} belum diproses</span>` : '<span class="status-chip">sudah diproses</span>'}
            ${conv.looksComplete ? '<span class="status-chip">kelihatannya lengkap, siap dibuat draft</span>' : ''}
          </div>
          <div class="actions">
            <button class="primary-btn" data-baca="${esc(conv.fromNumber)}" ${conv.unprocessed && setup.aiReady ? '' : 'disabled'} type="button">Baca dengan Una</button>
            <button class="secondary-btn" data-manual="${esc(conv.fromNumber)}" ${conv.unprocessed ? '' : 'disabled'} type="button">Isi manual</button>
          </div>
        </div>
        <ul class="chat">${conv.messages.map(m => m.direction === 'OUT' ? `
          <li class="out${m.failed ? ' failed' : ''}">
            <span class="muted">${esc(new Date(m.sentAt).toLocaleString('id-ID'))} · dibalas ${esc(m.senderName || ROLE_LABEL[m.senderRole] || '')}</span>
            <div>${esc(m.text)}</div>
            ${m.failed ? `<span class="status-chip bad">Gagal terkirim: ${esc(m.error)}</span>` : ''}
          </li>` : `
          <li class="${m.processed ? 'done' : ''}">
            <span class="muted">${esc(new Date(m.sentAt).toLocaleString('id-ID'))}</span>
            ${m.simulated ? '<span class="status-chip warn">SIMULASI</span>' : ''}
            <div>${esc(m.text)}</div>
            ${m.file ? `<div>📎 ${esc(m.file.fileName || 'file')}
              ${m.file.status === 'TERSIMPAN' ? `<button class="mini-btn" data-file="${esc(m.file.id)}" data-name="${esc(m.file.fileName)}" type="button">Unduh</button>` : ''}
              ${m.file.status === 'GAGAL' ? `<span class="status-chip bad">${esc(m.file.error)}</span> <button class="mini-btn" data-ulang="${esc(m.file.id)}" type="button">Ambil ulang file</button>` : ''}
              ${m.file.status === 'MENUNGGU' ? '<span class="status-chip warn">sedang diunduh</span>' : ''}
            </div>` : ''}
          </li>`).join('')}
        </ul>
        <div class="balas">
          <textarea class="text-input" rows="2" id="balas-${esc(conv.fromNumber)}" placeholder="Balas ke ${esc(conv.fromName || conv.fromNumber)}…"></textarea>
          <button class="primary-btn" data-balas="${esc(conv.fromNumber)}" type="button">Kirim</button>
        </div>
      </div>`).join('') : '<p class="muted">Belum ada chat masuk 7 hari terakhir.</p>');
    if (!setup.aiReady) tampilPesan('Una belum tersambung ke mesin AI, pakai "Isi manual" dulu.');

    $('sim-kirim')?.addEventListener('click', () => jalankan(async () => {
      const file = $('sim-file').files[0];
      let fileBase64 = '';
      if (file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        fileBase64 = btoa(binary);
      }
      const hasil = await api('/api/percetakan/wa/simulasi', { method: 'POST', body: {
        from: $('sim-from').value, name: $('sim-name').value, text: $('sim-text').value,
        fileName: file?.name, mime: file?.type, fileBase64
      } });
      await renderMasuk();
      const auto = hasil.otomatis || {};
      if (auto.reason === 'ACC_PELANGGAN') tampilPesan(`Pelanggan ACC. Order ${auto.created.orderNo} masuk antrian mesin.`);
      else if (auto.created) tampilPesan(`Order otomatis ${auto.created.orderNo} dibuat dan masuk antrian mesin.`);
      else if (auto.reason === 'BELUM_LENGKAP') tampilPesan(`Belum jadi order otomatis: ${(auto.questions || []).join(' ')}`);
    }));
    $('tab-masuk').querySelectorAll('[data-baca],[data-manual]').forEach(button => button.addEventListener('click', () => jalankan(async () => {
      button.disabled = true;
      const ai = button.hasAttribute('data-baca');
      if (ai) button.textContent = 'Una sedang membaca…';
      await api(`/api/percetakan/drafts/${ai ? 'baca' : 'manual'}`, { method: 'POST', body: { fromNumber: button.dataset.baca || button.dataset.manual } });
      pindahTab('draft');
    })));
    $('tab-masuk').querySelectorAll('[data-file]').forEach(b => b.addEventListener('click', () => unduhFile(b.dataset.file, b.dataset.name)));
    // Balasan dikirim lewat WhatsApp dari layar ini dan tercatat atas nama karyawan yang login.
    $('tab-masuk').querySelectorAll('[data-balas]').forEach(b => b.addEventListener('click', () => jalankan(async () => {
      const box = document.getElementById(`balas-${b.dataset.balas}`);
      if (!box.value.trim()) return;
      b.disabled = true;
      try {
        await api('/api/percetakan/wa/balas', { method: 'POST', body: { toNumber: b.dataset.balas, text: box.value } });
        await renderMasuk();
      } finally { b.disabled = false; }
    })));
    $('tab-masuk').querySelectorAll('[data-ulang]').forEach(b => b.addEventListener('click', () => jalankan(async () => {
      await api(`/api/percetakan/files/${encodeURIComponent(b.dataset.ulang)}/ulang`, { method: 'POST' });
      await renderMasuk();
    })));
  }

  // --- Draft --------------------------------------------------------------------------------
  function barisItem(item = {}) {
    const options = setup.products.filter(p => p.isActive).map(p => `<option value="${esc(p.id)}" ${p.id === item.productId ? 'selected' : ''}>${esc(p.name)} (${esc(p.unitPriceText)}/${esc(p.unit)})</option>`).join('');
    return `<div class="item-row">
      <select class="text-input" data-k="productId"><option value="">— pilih produk —</option>${options}</select>
      <input class="text-input" data-k="qty" type="number" min="1" placeholder="Jumlah" value="${esc(item.qty ?? '')}" />
      <input class="text-input" data-k="widthCm" type="number" min="1" placeholder="Lebar cm" value="${esc(item.widthCm ?? '')}" />
      <input class="text-input" data-k="heightCm" type="number" min="1" placeholder="Tinggi cm" value="${esc(item.heightCm ?? '')}" />
      <input class="text-input" data-k="note" placeholder="Catatan" value="${esc(item.note ?? '')}" />
      <input type="hidden" data-k="fileId" value="${esc(item.fileId ?? '')}" />
      <button class="mini-btn" data-hapus type="button">Hapus</button>
    </div>`;
  }

  async function renderDraft() {
    const { drafts } = await api('/api/percetakan/drafts');
    // Alur ACC (ADR-055 D14): draft -> "Kirim ke pelanggan" -> pelanggan balas OK -> order otomatis.
    $('tab-draft').innerHTML = drafts.length ? drafts.map(d => {
      const isi = d.accPayload || { customerName: d.proposal.customerName, dueAt: d.proposal.dueText, items: d.proposal.items };
      const menunggu = d.accStatus === 'MENUNGGU_ACC';
      return `
      <div class="admin-card" data-draft="${esc(d.id)}">
        <strong>${esc(isi.customerName || d.fromNumber)}</strong> <span class="muted">${esc(d.fromNumber)}</span>
        <span class="status-chip ${d.source === 'AI' ? '' : 'warn'}">${d.source === 'AI' ? 'dibaca Una' : d.source === 'ATURAN' ? 'pembaca otomatis' : 'manual'}</span>
        ${menunggu ? `<span class="status-chip warn">menunggu ACC pelanggan · ${esc(d.accTotalText || '')}</span>` : ''}
        ${menunggu ? `<div class="notice">Dikirim ${esc(new Date(d.accSentAt).toLocaleString('id-ID'))}. Begitu pelanggan membalas <b>OK</b>, order otomatis masuk antrian.<pre class="acc-pesan">${esc(d.accMessage)}</pre>Kalau pelanggan minta perubahan, ubah rincian di bawah lalu kirim ulang.</div>` : ''}
        ${(d.proposal.questions || []).length && !menunggu ? `<div class="notice">Perlu ditanyakan ke pelanggan:<ul>${d.proposal.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ul></div>` : ''}
        <div class="grid">
          <input class="text-input" data-f="customerName" placeholder="Nama pelanggan" value="${esc(isi.customerName || '')}" />
          <input class="text-input" data-f="dueAt" placeholder="Perkiraan jadi, mis. besok 16.00" value="${esc(isi.dueAt || '')}" />
        </div>
        <h2>Rincian</h2>
        <div data-items>${(isi.items?.length ? isi.items : [{}]).map(barisItem).join('')}</div>
        <div class="actions">
          <button class="secondary-btn" data-tambah type="button">+ Item</button>
          <button class="primary-btn" data-kirim-acc type="button">${menunggu ? 'Kirim ulang ke pelanggan' : 'Kirim ke pelanggan untuk ACC'}</button>
          <button class="secondary-btn" data-tolak type="button">Bukan order</button>
        </div>
        <details class="manual">
          <summary>Pelanggan sudah setuju di luar WA (telepon / datang langsung)?</summary>
          <div class="balas">
            <input class="text-input" data-f="alasan" placeholder="Alasan, mis. pelanggan setuju lewat telepon jam 14.10" />
            <button class="secondary-btn" data-konfirmasi type="button">Setujui manual</button>
          </div>
          <p class="muted">Persetujuan manual tercatat atas nama Anda dan ditandai di riwayat order.</p>
        </details>
        <p class="muted">Harga dihitung server dari daftar harga gerai, bukan dari layar ini.</p>
      </div>`;
    }).join('') : '<p class="muted">Tidak ada draft yang menunggu.</p>';

    $('tab-draft').querySelectorAll('[data-draft]').forEach(card => {
      const id = card.dataset.draft;
      card.addEventListener('click', event => { if (event.target.matches('[data-hapus]')) event.target.closest('.item-row').remove(); });
      card.querySelector('[data-tambah]').addEventListener('click', () => card.querySelector('[data-items]').insertAdjacentHTML('beforeend', barisItem()));
      card.querySelector('[data-tolak]').addEventListener('click', () => jalankan(async () => {
        await api(`/api/percetakan/drafts/${encodeURIComponent(id)}/tolak`, { method: 'POST', body: {} });
        await renderDraft();
      }));
      const isian = () => ({
        customerName: card.querySelector('[data-f="customerName"]').value,
        dueAt: card.querySelector('[data-f="dueAt"]').value,
        items: [...card.querySelectorAll('.item-row')].map(row => {
          const item = {};
          row.querySelectorAll('[data-k]').forEach(input => { item[input.dataset.k] = input.value; });
          return { productId: item.productId, qty: Number(item.qty), widthCm: Number(item.widthCm) || null, heightCm: Number(item.heightCm) || null, note: item.note, fileId: item.fileId || null };
        })
      });
      card.querySelector('[data-kirim-acc]').addEventListener('click', () => jalankan(async () => {
        const hasil = await api(`/api/percetakan/drafts/${encodeURIComponent(id)}/kirim-acc`, { method: 'POST', body: isian() });
        tampilPesan(`Rincian (${hasil.totalText}) terkirim ke pelanggan${hasil.simulated ? ' (simulasi)' : ''}. Menunggu balasan OK.`);
        await renderDraft();
      }));
      card.querySelector('[data-konfirmasi]').addEventListener('click', () => jalankan(async () => {
        const result = await api(`/api/percetakan/drafts/${encodeURIComponent(id)}/konfirmasi`, { method: 'POST', body: {
          ...isian(), alasan: card.querySelector('[data-f="alasan"]').value
        } });
        tampilPesan(`Order ${result.orderNo} dibuat (persetujuan manual) dan masuk antrian.`);
        await bukaOrder(result.orderId);
        await renderDraft();
      }));
    });
  }

  // --- Antrian & order ------------------------------------------------------------------------
  async function renderAntrian() {
    const pilih = setup.machines.find(m => m.code === mesinDipilih || m.id === mesinDipilih);
    const { machines } = await api(`/api/percetakan/antrian${pilih ? `?machine=${encodeURIComponent(pilih.id)}` : ''}`);
    const filter = `<select class="text-input" id="pilih-mesin">
        <option value="">Semua mesin</option>
        ${setup.machines.map(m => `<option value="${esc(m.code)}" ${pilih?.id === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
      </select>`;
    $('tab-antrian').innerHTML = filter + (machines.length ? machines.map(machine => `
      <h2>${esc(machine.machineName)}</h2>
      ${machine.tickets.map(t => `
        <div class="admin-card master-row">
          <div class="queue-no">#${esc(t.queueNo)}</div>
          <div class="master-main">
            <strong>${esc(t.productName)}</strong> ${esc(t.qty)}×${esc(ukuran(t))}
            <span class="status-chip">${esc(STATUS_LABEL[t.status] || t.status)}</span>
            ${t.automatic ? '<span class="status-chip warn">otomatis</span>' : ''}
            ${t.dispatchedAt ? '<span class="status-chip">sudah di mesin</span>' : ''}
            ${t.revised ? '<span class="status-chip">hasil revisi</span>' : ''}
            ${t.hasNewChat ? '<span class="status-chip bad">ada chat baru, cek dulu</span>' : ''}
            <div class="muted">${esc(t.orderNo)} · ${esc(t.customerName || t.customerPhone)} · ${esc(t.businessDate)}${t.dueAt ? ` · tenggat ${esc(t.dueAt)}` : ''}</div>
            ${t.note ? `<div class="muted">${esc(t.note)}</div>` : ''}
          </div>
          <div class="actions">
            ${t.fileId ? `<button class="mini-btn" data-file="${esc(t.fileId)}" type="button">File</button>` : ''}
            <button class="mini-btn" data-order="${esc(t.orderId)}" type="button">Buka</button>
          </div>
        </div>`).join('')}`).join('') : '<p class="muted">Antrian kosong.</p>');
    $('pilih-mesin').addEventListener('change', event => { mesinDipilih = event.target.value; renderTab('antrian'); });
    pasangTombolOrder($('tab-antrian'));
  }

  async function renderOrder() {
    $('tab-order').innerHTML = `
      <div class="grid">
        <select class="text-input" id="filter-status">
          <option value="AKTIF">Yang masih jalan</option>
          ${Object.entries(STATUS_LABEL).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}
        </select>
        <input class="text-input" id="filter-hp" placeholder="Cari riwayat nomor WA pelanggan" />
        <button class="secondary-btn" id="filter-cari" type="button">Cari</button>
      </div>
      <div id="daftar-order"></div>`;
    const load = () => jalankan(async () => {
      const params = new URLSearchParams();
      const phone = $('filter-hp').value.trim();
      if (phone) params.set('phone', phone); else params.set('status', $('filter-status').value);
      const { orders } = await api(`/api/percetakan/orders?${params}`);
      $('daftar-order').innerHTML = orders.length ? orders.map(o => `
        <div class="admin-card master-row">
          <div class="master-main">
            <strong>${esc(o.orderNo)}</strong> <span class="status-chip ${o.status === 'BATAL' ? 'bad' : ''}">${esc(STATUS_LABEL[o.status] || o.status)}</span>
            ${o.source === 'WALKIN' ? '<span class="status-chip warn">datang langsung</span>' : ''}
            ${o.automatic ? '<span class="status-chip">otomatis dari WA</span>' : ''}
            <div class="muted">${esc(o.customerName || o.customerPhone)} · ${esc(o.totalText)} · ${esc(new Date(o.createdAt).toLocaleString('id-ID'))}</div>
          </div>
          <button class="mini-btn" data-order="${esc(o.id)}" type="button">Buka</button>
        </div>`).join('') : '<p class="muted">Tidak ada order.</p>';
      pasangTombolOrder($('daftar-order'));
    });
    $('filter-cari').addEventListener('click', load);
    $('filter-status').addEventListener('change', load);
    load();
  }

  function pasangTombolOrder(root) {
    root.querySelectorAll('[data-order]').forEach(b => b.addEventListener('click', () => jalankan(() => bukaOrder(b.dataset.order))));
    root.querySelectorAll('[data-file]').forEach(b => b.addEventListener('click', () => unduhFile(b.dataset.file, b.dataset.name)));
  }

  async function bukaOrder(orderId) {
    const d = await api(`/api/percetakan/orders/${encodeURIComponent(orderId)}`);
    const o = d.order;
    $('dialog-isi').innerHTML = `
      <div class="master-row"><h1>${esc(o.orderNo)}</h1><button class="mini-btn" data-tutup type="button">Tutup</button></div>
      <p>${esc(o.customerName || '')} · ${esc(o.customerPhone)} · <strong>${esc(o.totalText)}</strong>
        <span class="status-chip">${esc(STATUS_LABEL[o.status] || o.status)}</span></p>
      ${d.revisedFrom ? `<p class="muted">Revisi dari <button class="mini-btn" data-buka="${esc(d.revisedFrom.id)}" type="button">${esc(d.revisedFrom.order_no)}</button></p>` : ''}
      ${d.revisedTo ? `<p class="notice">Order ini sudah direvisi menjadi <button class="mini-btn" data-buka="${esc(d.revisedTo.id)}" type="button">${esc(d.revisedTo.order_no)}</button></p>` : ''}
      ${d.verification.ok ? '<p class="status-chip">Riwayat utuh, tidak ada yang diubah</p>'
        : `<div class="notice bad"><strong>Riwayat order ini tidak cocok:</strong><ul>${d.verification.problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>`}
      <table><tr><th>Item</th><th>Mesin</th><th>Antrian</th><th>Subtotal</th></tr>
        ${d.items.map(i => `<tr><td>${esc(i.productName)} ${esc(i.qty)}×${esc(ukuran(i))}${i.note ? `<div class="muted">${esc(i.note)}</div>` : ''}</td>
          <td>${esc(i.machineName)}</td><td>#${esc(i.queueNo)}</td><td>${esc(i.subtotalText)}</td></tr>`).join('')}
      </table>
      ${o.nextStatuses.length ? `<div class="actions">${o.nextStatuses.map(s => `<button class="${s === 'BATAL' ? 'secondary-btn' : 'primary-btn'}" data-status="${s}" type="button">${s === 'BATAL' ? 'Batalkan' : `Jadikan: ${STATUS_LABEL[s]}`}</button>`).join('')}</div>
        <input class="text-input" id="catatan-status" placeholder="Catatan (wajib untuk pembatalan)" />` : ''}
      ${d.canRevise ? `<div class="actions"><button class="secondary-btn" data-revisi type="button">Revisi order</button></div>
        <div id="form-revisi" hidden>
          <h2>Revisi order</h2>
          <p class="muted">Order ini ditutup sebagai "Direvisi" dan order baru langsung masuk antrian. Keduanya tercatat atas nama Anda.</p>
          <div data-items>${(d.rawItems.length ? d.rawItems : [{}]).map(barisItem).join('')}</div>
          <div class="actions"><button class="secondary-btn" data-tambah type="button">+ Item</button></div>
          <input class="text-input" id="alasan-revisi" placeholder="Alasan revisi, mis. pelanggan minta laminating" />
          <div class="actions"><button class="primary-btn" data-simpan-revisi type="button">Simpan revisi</button></div>
        </div>` : ''}
      <h2>Riwayat</h2>
      <table>${d.events.map(e => `<tr><td>${esc(new Date(e.createdAt).toLocaleString('id-ID'))}</td><td>${esc(e.eventType === 'DIKIRIM_KE_MESIN' ? 'Masuk mesin' : STATUS_LABEL[e.toStatus] || e.toStatus)}</td><td>${esc(ROLE_LABEL[e.actorRole] || e.actorRole)} ${esc(e.actorRole === 'SYSTEM' ? '' : e.actorId)}</td><td>${esc(e.note)}</td></tr>`).join('')}</table>`;
    const dialog = $('dialog-order');
    dialog.querySelector('[data-tutup]').addEventListener('click', () => dialog.close());
    dialog.querySelectorAll('[data-buka]').forEach(b => b.addEventListener('click', () => jalankan(() => bukaOrder(b.dataset.buka))));
    dialog.querySelector('[data-revisi]')?.addEventListener('click', () => { $('form-revisi').hidden = false; });
    dialog.querySelector('[data-tambah]')?.addEventListener('click', () => dialog.querySelector('[data-items]').insertAdjacentHTML('beforeend', barisItem()));
    $('form-revisi')?.addEventListener('click', event => { if (event.target.matches('[data-hapus]')) event.target.closest('.item-row').remove(); });
    dialog.querySelector('[data-simpan-revisi]')?.addEventListener('click', () => jalankan(async () => {
      const items = [...dialog.querySelectorAll('#form-revisi .item-row')].map(row => {
        const item = {};
        row.querySelectorAll('[data-k]').forEach(input => { item[input.dataset.k] = input.value; });
        return { productId: item.productId, qty: Number(item.qty), widthCm: Number(item.widthCm) || null, heightCm: Number(item.heightCm) || null, note: item.note, fileId: item.fileId || null };
      });
      const hasil = await api(`/api/percetakan/orders/${encodeURIComponent(orderId)}/revisi`, { method: 'POST', body: { items, note: $('alasan-revisi').value } });
      tampilPesan(`${o.orderNo} direvisi menjadi ${hasil.orderNo} dan langsung masuk antrian.`);
      await bukaOrder(hasil.orderId);
      await renderTab(tabAktif);
    }));
    dialog.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => jalankan(async () => {
      await api(`/api/percetakan/orders/${encodeURIComponent(orderId)}/status`, { method: 'POST', body: { toStatus: b.dataset.status, note: $('catatan-status')?.value || '' } });
      await bukaOrder(orderId);
      await renderTab(tabAktif);
    })));
    if (!dialog.open) dialog.showModal();
  }

  // --- Pengaturan (Owner/Admin) ----------------------------------------------------------------
  async function renderAtur() {
    setup = await api('/api/percetakan/setup');
    $('tab-atur').innerHTML = `
      <h2>Otomatisasi chat WA</h2>
      <div class="admin-card">
        <select class="text-input" id="mode-gerai">
          ${setup.modes.map(m => `<option value="${m}" ${m === setup.mode ? 'selected' : ''}>${esc(MODE_LABEL[m] || m)}</option>`).join('')}
        </select>
        <p class="muted">Chat yang belum jelas (ukuran kosong, produk tidak dikenal, ada koreksi, file kurang) selalu masuk Draft untuk dicek orang.</p>
      </div>
      <h2>Mesin cetak</h2>
      ${setup.machines.map(m => `<div class="admin-card master-row">
        <div class="master-main">${esc(m.name)} <span class="muted">${esc(m.code)}</span>
          ${m.hasAgentKey ? `<span class="status-chip">agen ${m.agentLastSeenAt ? `terlihat ${esc(new Date(m.agentLastSeenAt).toLocaleString('id-ID'))}` : 'belum pernah tersambung'}</span>` : ''}
        </div>
        <div class="actions">
          <a class="mini-btn" href="?mesin=${encodeURIComponent(m.code)}${storeCode && !location.pathname.startsWith('/s/') ? `&store=${encodeURIComponent(storeCode)}` : ''}">Layar mesin</a>
          <button class="mini-btn" data-kunci="${esc(m.id)}" type="button">${m.hasAgentKey ? 'Ganti kunci agen' : 'Buat kunci agen'}</button>
        </div>
        <div class="master-main" data-kunci-hasil="${esc(m.id)}"></div>
      </div>`).join('') || '<p class="muted">Belum ada mesin.</p>'}
      <div class="admin-card grid">
        <input class="text-input" id="mesin-kode" placeholder="Kode, mis. OUTDOOR" />
        <input class="text-input" id="mesin-nama" placeholder="Nama, mis. Outdoor Banner" />
        <button class="primary-btn" id="mesin-simpan" type="button">Simpan mesin</button>
      </div>
      <h2>Produk & harga</h2>
      ${setup.products.map(p => `<div class="admin-card">${esc(p.name)} <span class="muted">${esc(p.code)} · ${esc(p.unitPriceText)}/${esc(p.unit)} · ${esc(p.machineName)}</span></div>`).join('') || '<p class="muted">Belum ada produk.</p>'}
      <div class="admin-card grid">
        <input class="text-input" id="produk-kode" placeholder="Kode, mis. FLX280" />
        <input class="text-input" id="produk-nama" placeholder="Nama, mis. Banner Flexi 280gr" />
        <select class="text-input" id="produk-satuan"><option value="M2">per m²</option><option value="LEMBAR">per lembar</option><option value="PCS">per pcs</option></select>
        <input class="text-input" id="produk-harga" placeholder="Harga (rupiah)" inputmode="numeric" />
        <select class="text-input" id="produk-mesin">${setup.machines.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select>
        <input class="text-input" id="produk-kata" placeholder="Kata kunci untuk Una, mis. spanduk, baliho" />
        <button class="primary-btn" id="produk-simpan" type="button">Simpan produk</button>
      </div>
      <h2>WhatsApp</h2>
      ${setup.channels.map(c => `<div class="admin-card">${esc(({ SIMULATOR: 'Simulator', TWILIO: 'WhatsApp lewat Twilio', META_CLOUD: 'WhatsApp lewat Meta' })[c.provider] || c.provider)} ${esc(c.displayNumber || '')} <span class="muted">${esc(c.phoneNumberId)}</span></div>`).join('')}
      <div class="admin-card grid">
        <select class="text-input" id="wa-penyedia">
          <option value="TWILIO">Twilio (sandbox / nomor Twilio)</option>
          <option value="META_CLOUD">Meta WhatsApp Cloud API</option>
        </select>
        <input class="text-input" id="wa-id" placeholder="Twilio: nomor WhatsApp-nya, mis. +1 415 523 8886 · Meta: Phone number ID" />
        <input class="text-input" id="wa-nomor" placeholder="Nomor tampil, mis. 0812…" />
        <button class="primary-btn" id="wa-simpan" type="button">Sambungkan nomor</button>
      </div>
      <p class="muted">Cara mendapatkan Phone number ID: HANDOFF-PERCETAKAN.md bagian "Menyambungkan WhatsApp".</p>`;
    $('mode-gerai').addEventListener('change', event => jalankan(async () => {
      await api('/api/percetakan/settings', { method: 'POST', body: { mode: event.target.value } });
      tampilPesan('Mode otomatisasi disimpan.');
      await renderAtur();
    }));
    $('tab-atur').querySelectorAll('[data-kunci]').forEach(b => b.addEventListener('click', () => jalankan(async () => {
      if (!confirm('Buat kunci agen baru? Kunci lama (kalau ada) langsung tidak berlaku.')) return;
      const { key } = await api(`/api/percetakan/machines/${encodeURIComponent(b.dataset.kunci)}/kunci`, { method: 'POST' });
      const box = $('tab-atur').querySelector(`[data-kunci-hasil="${b.dataset.kunci}"]`);
      box.innerHTML = `<div class="notice">Salin sekarang, kunci ini hanya tampil sekali:<br><code>${esc(key)}</code><br>Cara pasang: percetakan-agen/README.md</div>`;
    })));
    $('mesin-simpan').addEventListener('click', () => jalankan(async () => {
      await api('/api/percetakan/machines', { method: 'POST', body: { code: $('mesin-kode').value, name: $('mesin-nama').value } });
      await renderAtur();
    }));
    $('produk-simpan').addEventListener('click', () => jalankan(async () => {
      await api('/api/percetakan/products', { method: 'POST', body: {
        code: $('produk-kode').value, name: $('produk-nama').value, unit: $('produk-satuan').value,
        unitPriceRupiah: $('produk-harga').value, machineId: $('produk-mesin').value, keywords: $('produk-kata').value
      } });
      await renderAtur();
    }));
    $('wa-simpan').addEventListener('click', () => jalankan(async () => {
      await api('/api/percetakan/channels', { method: 'POST', body: { provider: $('wa-penyedia').value, phoneNumberId: $('wa-id').value, displayNumber: $('wa-nomor').value } });
      await renderAtur();
    }));
  }

  // --- Navigasi ---------------------------------------------------------------------------------
  // --- Log Mesin: semua file yang masuk mesin (Bos Cyo 2026-10-12) ---------------------------------
  async function renderLog() {
    const { jobs } = await api('/api/percetakan/log-mesin');
    $('tab-log').innerHTML = `<p class="muted">Setiap file yang masuk mesin tercatat di sini. File di luar antrian boleh, tapi wajib diberi catatan.</p>`
      + (jobs.length ? jobs.map(j => `
        <div class="admin-card${j.source === 'LUAR_ANTRIAN' && !j.notes.length ? ' flag' : ''}">
          <div class="master-row">
            <div class="master-main">
              <strong>${esc(j.fileName || 'file')}</strong>
              ${j.source === 'ANTRIAN' ? '<span class="status-chip">dari antrian</span>' : '<span class="status-chip bad">di luar antrian</span>'}
              <div class="muted">${esc(j.machineName)} · ${esc(new Date(j.detectedAt).toLocaleString('id-ID'))}${j.orderNo ? ` · ${esc(j.orderNo)}${j.queueNo ? ` antrian #${esc(j.queueNo)}` : ''}` : ''}${j.sha256 ? ` · sidik ${esc(j.sha256.slice(0, 10))}` : ''}</div>
              ${j.source === 'LUAR_ANTRIAN' && j.orderNo ? `<div class="muted">Isinya sama persis dengan file order ${esc(j.orderNo)}.</div>` : ''}
              ${j.notes.map(n => `<div class="notice">${esc(n.note)} <span class="muted">— ${esc(ROLE_LABEL[n.actorRole] || n.actorRole)}, ${esc(new Date(n.createdAt).toLocaleString('id-ID'))}</span></div>`).join('')}
            </div>
            ${j.orderId ? `<button class="mini-btn" data-order="${esc(j.orderId)}" type="button">Buka order</button>` : ''}
          </div>
          ${j.source === 'LUAR_ANTRIAN' ? `<div class="balas"><input class="text-input" id="catat-${esc(j.id)}" placeholder="Kenapa dicetak di luar antrian? mis. cetak ulang karena salah warna" /><button class="secondary-btn" data-catat="${esc(j.id)}" type="button">Simpan catatan</button></div>` : ''}
        </div>`).join('') : '<p class="muted">Belum ada file yang masuk mesin lewat agen cetak.</p>');
    pasangTombolOrder($('tab-log'));
    $('tab-log').querySelectorAll('[data-catat]').forEach(b => b.addEventListener('click', () => jalankan(async () => {
      await api(`/api/percetakan/log-mesin/${encodeURIComponent(b.dataset.catat)}/catatan`, { method: 'POST', body: { note: document.getElementById(`catat-${b.dataset.catat}`).value } });
      await renderLog();
    })));
  }

  const RENDER = { masuk: renderMasuk, draft: renderDraft, antrian: renderAntrian, order: renderOrder, log: renderLog, atur: renderAtur };
  let tabAktif = 'masuk';
  const renderTab = name => jalankan(() => RENDER[name]());
  function pindahTab(name) {
    tabAktif = name;
    document.querySelectorAll('#tabs [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(panel => { panel.hidden = panel.id !== `tab-${name}`; });
    renderTab(name);
  }

  document.querySelectorAll('#tabs [data-tab]').forEach(b => b.addEventListener('click', () => pindahTab(b.dataset.tab)));
  $('muat-ulang').addEventListener('click', () => renderTab(tabAktif));
  // Tanpa polling (invariant #6): muat ulang saat tab kembali dilihat.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && setup) renderTab(tabAktif); });

  // Belum login / sesi habis / skin G mati: tampilkan alasannya sekali dan berhenti. Tidak ada
  // percobaan ulang otomatis (invariant tanpa polling) -- layar hanya meminta data saat dibuka,
  // tab diklik, tombol Muat ulang, atau tab browser kembali dilihat.
  function berhenti(judul, pesan, tombol) {
    $('subjudul').textContent = judul;
    document.querySelectorAll('#tabs [data-tab]').forEach(b => { b.disabled = true; });
    document.querySelectorAll('.tab-panel').forEach(panel => { panel.hidden = true; });
    tampilPesan(pesan, true);
    if (tombol) $('pesan').insertAdjacentHTML('beforeend', ` <a class="primary-btn" href="${tombol.href}">${tombol.text}</a>`);
  }

  jalankan(async () => {
    if (!token()) {
      berhenti('Belum masuk', 'Masuk dulu sebagai Owner, Admin, atau karyawan gerai ini, lalu buka lagi alamat ini.', { href: '/login', text: 'Masuk' });
      return;
    }
    try {
      setup = await api('/api/percetakan/setup');
    } catch (error) {
      if (error.status === 401) {
        berhenti('Sesi sudah habis', 'Sesi login di browser ini sudah habis. Masuk lagi, lalu buka alamat ini.', { href: '/login', text: 'Masuk' });
      } else if (error.code === 'SKIN_PERCETAKAN_OFF' || error.status === 403) {
        berhenti('Tidak bisa dibuka', error.message);
      } else {
        berhenti('Gagal memuat', `${error.message} Tekan "Muat ulang" untuk mencoba lagi.`);
      }
      return;
    }
    $('judul').textContent = setup.store.name;
    $('subjudul').textContent = `${setup.actor.name} · ${setup.isManagement ? 'Owner/Admin' : 'Karyawan'}`;
    document.querySelector('[data-tab="atur"]').hidden = !setup.isManagement;
    // Skin G mengarahkan kasir ke sini (public/warung-entry.js); jalan pulang ke layar lain tetap ada.
    const code = encodeURIComponent(setup.store.code);
    const pindah = $('pindah-layar');
    pindah.href = setup.isManagement ? `/s/${code}/admin` : `/s/${code}/cashier?lengkap=1`;
    pindah.textContent = setup.isManagement ? 'Workspace Gerai' : 'Kasir lengkap';
    pindah.hidden = false;
    if (!setup.storageReady) tampilPesan('Penyimpanan file belum terpasang di server; file dari WA belum bisa disimpan.', true);
    pindahTab(mesinDipilih ? 'antrian' : setup.isManagement && !setup.products.length ? 'atur' : 'masuk');
  });
})();
