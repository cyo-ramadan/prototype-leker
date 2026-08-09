(() => {
  const el = id => document.getElementById(id);
  const statusCard = el('statusCard');
  if (!statusCard) return;

  const actions = document.createElement('div');
  actions.className = 'repeat-order-actions';
  actions.innerHTML = `
    <button id="backToMenuBtn" class="secondary-btn repeat-order-btn" type="button">← PILIH MENU LAGI</button>
    <div class="repeat-order-hint">Order ini tetap diproses kasir. Kamu bisa lanjut pilih menu dan membuat order baru.</div>`;

  const existingNewOrderButton = el('newOrderBtn');
  if (existingNewOrderButton) existingNewOrderButton.insertAdjacentElement('beforebegin', actions);
  else statusCard.appendChild(actions);

  el('backToMenuBtn').addEventListener('click', () => {
    const previousOrderNo = state.activeOrder?.orderNo || el('statusOrderNo')?.textContent || '';

    state.cart = [];
    state.activeOrder = null;
    localStorage.removeItem('lekerActiveOrderId');

    if (el('generalNote')) el('generalNote').value = '';
    el('statusView')?.classList.add('hidden');
    el('shopView')?.classList.remove('hidden');
    el('cartHandle')?.classList.remove('hidden');

    renderCart();
    renderMenu();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (previousOrderNo) {
      const notice = document.createElement('div');
      notice.className = 'repeat-order-toast';
      notice.textContent = `${previousOrderNo} tetap diproses · silakan buat order baru`;
      document.body.appendChild(notice);
      requestAnimationFrame(() => notice.classList.add('show'));
      setTimeout(() => {
        notice.classList.remove('show');
        setTimeout(() => notice.remove(), 220);
      }, 2400);
    }
  });
})();
