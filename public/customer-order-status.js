(() => {
  const byId = id => document.getElementById(id);

  function ensureProgress() {
    const progress = document.querySelector('#statusCard .progress');
    if (!progress) return;
    if (byId('stepNew')) byId('stepNew').textContent = '1. Dipesan';
    if (byId('stepPrep')) byId('stepPrep').textContent = '2. Diterima';
    if (byId('stepReady')) byId('stepReady').textContent = '3. Dibuat';
    if (!byId('stepDone')) {
      const step = document.createElement('div');
      step.id = 'stepDone';
      step.className = 'progress-step';
      step.textContent = '4. Sudah Jadi';
      progress.appendChild(step);
    }
    if (!byId('customerOrderLifecycleStyle')) {
      const style = document.createElement('style');
      style.id = 'customerOrderLifecycleStyle';
      style.textContent = '#statusCard .progress{grid-template-columns:repeat(4,minmax(0,1fr))}@media(max-width:680px){#statusCard .progress{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}}';
      document.head.appendChild(style);
    }
  }

  showStatus = function showRequestedOrderStatus(order) {
    ensureProgress();
    closeCart();
    byId('cartHandle')?.classList.add('hidden');
    byId('shopView')?.classList.add('hidden');
    byId('statusView')?.classList.remove('hidden');
    if (byId('statusOrderNo')) byId('statusOrderNo').textContent = order.orderNo;

    ['stepNew', 'stepPrep', 'stepReady', 'stepDone'].forEach(id => byId(id)?.classList.remove('active'));
    byId('statusCard')?.classList.remove('ready');
    byId('readyButton')?.classList.add('hidden');
    byId('newOrderBtn')?.classList.add('hidden');

    const activate = ids => ids.forEach(id => byId(id)?.classList.add('active'));
    if (order.status === 'NEW') {
      activate(['stepNew']);
      byId('statusIcon').textContent = '🧾';
      byId('statusTitle').textContent = 'Pesanan sudah dikirim';
      byId('statusText').textContent = 'Status: Dipesan. Menunggu kasir menerima pesanan.';
      return;
    }
    if (order.status === 'PREPARING') {
      activate(['stepNew', 'stepPrep']);
      byId('statusIcon').textContent = '🤝';
      byId('statusTitle').textContent = 'Pesanan diterima';
      byId('statusText').textContent = 'Kasir sudah menerima pesanan. Berikutnya pesanan akan masuk proses dibuat.';
      return;
    }
    if (order.status === 'READY') {
      activate(['stepNew', 'stepPrep', 'stepReady']);
      byId('statusIcon').textContent = '🥞';
      byId('statusTitle').textContent = 'Pesanan sedang dibuat';
      byId('statusText').textContent = 'Tim sedang membuat pesanan. Nomor pesanan tetap tersimpan meskipun browser direfresh.';
      return;
    }
    if (order.status === 'COMPLETED') {
      activate(['stepNew', 'stepPrep', 'stepReady', 'stepDone']);
      byId('statusCard')?.classList.add('ready');
      byId('statusIcon').textContent = '✅';
      byId('statusTitle').textContent = 'Pesanan sudah jadi!';
      byId('statusText').textContent = 'Silakan menuju kasir dan tunjukkan nomor pesanan ini.';
      if (byId('readyButton')) {
        byId('readyButton').textContent = '✅ PESANAN SUDAH JADI · AMBIL DI KASIR';
        byId('readyButton').classList.remove('hidden');
      }
      return;
    }
    if (order.status === 'CANCELLED') {
      activate(['stepNew']);
      byId('statusIcon').textContent = '✕';
      byId('statusTitle').textContent = 'Pesanan ditolak';
      byId('statusText').textContent = 'Pesanan tidak dilanjutkan oleh kasir. Silakan buat pesanan baru atau hubungi kasir bila perlu.';
      byId('newOrderBtn')?.classList.remove('hidden');
    }
  };

  const legacyLabels = new Map([
    ['Diterima', 'Dipesan'],
    ['Sedang dibuat', 'Diterima'],
    ['Siap diambil', 'Dibuat'],
    ['Selesai', 'Sudah Jadi'],
    ['Dibatalkan', 'Ditolak']
  ]);

  function normalizeOrderListLabels() {
    document.querySelectorAll('.entry-order-row span:not([data-order-flow-normalized])').forEach(node => {
      node.dataset.orderFlowNormalized = '1';
      const parts = String(node.textContent || '').split(' · ');
      const current = parts.at(-1);
      const replacement = legacyLabels.get(current);
      if (!replacement) return;
      parts[parts.length - 1] = replacement;
      node.textContent = parts.join(' · ');
    });
  }

  ensureProgress();
  normalizeOrderListLabels();
  new MutationObserver(normalizeOrderListLabels).observe(document.body, { childList: true, subtree: true });
})();
