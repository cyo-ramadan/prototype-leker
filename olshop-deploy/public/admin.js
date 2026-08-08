const app = document.querySelector('#app');
const tabs = document.querySelector('#tabs');
const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const state = { products: [], orders: [], receivables: [], customers: [], posCart: [], financialReport: null, editingProductId: null };
let activeView = 'dashboard';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

function showToast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2200);
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'REQUEST_FAILED');
  return payload;
}

async function refreshState() {
  const [products, orders, receivables, customers, financialReport] = await Promise.all([
    api('/api/products'), api('/api/orders'), api('/api/receivables'), api('/api/customers'), api('/api/reports/financial')
  ]);
  state.products = products.products;
  state.orders = orders.orders;
  state.receivables = receivables.receivables;
  state.customers = customers.customers;
  state.financialReport = financialReport;
  render();
}

function table(headers, rows) {
  return `<div class="table-wrap"><table class="table"><thead><tr>${headers.map(header => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function orderTable(orders) {
  return table(['Order', 'Channel', 'Customer', 'Status', 'Payment', 'Total', 'Action'], orders.map(order => `
    <tr>
      <td><b>${escapeHtml(order.orderNumber)}</b><br><small>${escapeHtml(order.marketplaceOrderReference || '')}</small></td>
      <td>${escapeHtml(order.orderChannel)}</td>
      <td>${escapeHtml(order.customerNameSnapshot)}</td>
      <td><span class="badge">${escapeHtml(order.orderStatus)}</span></td>
      <td>${escapeHtml(order.paymentStatus)}</td>
      <td>${rupiah.format(order.totalAmount)}</td>
      <td>
        ${!['SHIPPED', 'COMPLETED', 'CANCELLED'].includes(order.orderStatus) ? `<button class="button tiny" data-ship="${escapeHtml(order.orderId)}">Ship</button>` : ''}
        ${order.orderStatus === 'SHIPPED' ? `<button class="button tiny" data-complete="${escapeHtml(order.orderId)}">Complete</button>` : ''}
      </td>
    </tr>`));
}

function dashboardView() {
  const openReceivables = state.receivables.filter(item => item.receivableStatus === 'OPEN');
  const pendingReceivableAmount = openReceivables.reduce((sum, item) => sum + Number(item.grossAmount), 0);
  const grossOrderAmount = state.orders.reduce((sum, order) => sum + Number(order.totalAmount), 0);
  return `
    <div class="metric-grid">
      <article class="metric"><span>Master barang</span><strong>${state.products.length}</strong></article>
      <article class="metric"><span>Orders</span><strong>${state.orders.length}</strong></article>
      <article class="metric"><span>Gross order</span><strong>${rupiah.format(grossOrderAmount)}</strong></article>
      <article class="metric"><span>Piutang marketplace</span><strong>${rupiah.format(pendingReceivableAmount)}</strong></article>
    </div>
    <section class="panel"><div class="section-head"><div><span class="eyebrow">Operational pulse</span><h2>Recent Orders</h2></div></div>${orderTable(state.orders.slice(0, 10))}</section>`;
}

function posView() {
  const subtotal = state.posCart.reduce((sum, line) => sum + Number(line.salePriceAmount) * line.quantity, 0);
  const cartLines = state.posCart.length
    ? state.posCart.map(line => `<div class="cart-line"><div><b>${escapeHtml(line.productName)}</b><br><small>${rupiah.format(line.salePriceAmount)}</small></div><span>x${line.quantity}</span><button data-pos-remove="${escapeHtml(line.productId)}">−</button></div>`).join('')
    : '<div class="empty">Belum ada item.</div>';
  return `
    <section class="split">
      <div class="panel">
        <span class="eyebrow">Cashier</span><h2>POS multi-item</h2>
        <p class="muted">Add item, customer, discount, payment lalu checkout. Stock resmi tetap milik Warehouse.</p>
        <div class="product-grid">${state.products.slice(0, 12).map(product => `
          <article class="product-card"><div class="visual">👶</div><h3>${escapeHtml(product.productName)}</h3><div class="price">${rupiah.format(product.salePriceAmount)}</div><button class="button" data-pos-add="${escapeHtml(product.productId)}">Add</button></article>`).join('')}</div>
      </div>
      <aside class="panel">
        <span class="eyebrow">Current sale</span><h2>Cart</h2>${cartLines}
        <div class="cart-total"><span>Subtotal</span><span>${rupiah.format(subtotal)}</span></div>
        <div class="form-grid">
          <input id="posCustomerName" placeholder="Customer / walk-in">
          <input id="posCustomerPhone" placeholder="No. HP untuk loyalty">
          <input id="posDiscount" type="number" min="0" value="0" placeholder="Discount">
          <select id="posPayment"><option value="PAID">Paid</option><option value="PENDING">Pending</option></select>
        </div>
        <button class="button full" data-pos-checkout>Checkout POS</button>
        <div class="notice" style="margin-top:12px">Accounting dan Warehouse tetap canonical. OLShop tidak membuat account mapping atau official stock valuation.</div>
      </aside>
    </section>`;
}

function productsView() {
  const editing = state.editingProductId ? state.products.find(product => product.productId === state.editingProductId) : null;
  const form = `
    <section class="panel">
      <span class="eyebrow">${editing ? 'Edit SKU' : 'New SKU'}</span><h2>${editing ? 'Edit Master Barang' : 'Tambah Barang'}</h2>
      <div class="form-grid">
        <input id="productSku" value="${escapeHtml(editing?.sku || '')}" placeholder="SKU">
        <input id="productName" value="${escapeHtml(editing?.productName || '')}" placeholder="Nama barang">
        <input id="productCategory" value="${escapeHtml(editing?.categoryName || 'Gendongan Bayi')}" placeholder="Kategori">
        <input id="productBarcode" value="${escapeHtml(editing?.barcodeValue || '')}" placeholder="Barcode">
        <input id="productPurchasePrice" type="number" min="0" value="${editing?.purchasePriceAmount ?? ''}" placeholder="Harga beli">
        <input id="productSalePrice" type="number" min="0" value="${editing?.salePriceAmount ?? ''}" placeholder="Harga jual">
      </div>
      <div class="form-row" style="margin-top:12px"><button class="button" data-save-product>${editing ? 'Save changes' : 'Tambah barang'}</button>${editing ? '<button class="button danger" data-cancel-product-edit>Cancel</button>' : ''}</div>
    </section>`;
  const master = `<section class="panel"><div class="section-head"><div><span class="eyebrow">20 seeded SKU + CRUD</span><h2>Master Barang</h2></div></div>${table(
    ['SKU', 'Produk', 'Kategori', 'Harga beli', 'Harga jual', 'Margin kotor', 'Action'],
    state.products.map(product => `<tr><td>${escapeHtml(product.sku)}</td><td><b>${escapeHtml(product.productName)}</b><br><small>${escapeHtml(product.barcodeValue)}</small></td><td>${escapeHtml(product.categoryName)}</td><td>${rupiah.format(product.purchasePriceAmount)}</td><td>${rupiah.format(product.salePriceAmount)}</td><td>${rupiah.format(Number(product.salePriceAmount) - Number(product.purchasePriceAmount))}</td><td><button class="button tiny" data-edit-product="${escapeHtml(product.productId)}">Edit</button></td></tr>`)
  )}</section>`;
  return `<div class="split">${master}${form}</div>`;
}

function customersView() {
  return `<section class="panel"><h2>Customers</h2>${table(
    ['Customer', 'Phone', 'Email', 'Cashback balance'],
    state.customers.map(customer => `<tr><td>${escapeHtml(customer.customerName)}</td><td>${escapeHtml(customer.phoneNumber || '-')}</td><td>${escapeHtml(customer.emailAddress || '-')}</td><td><b>${rupiah.format(customer.loyaltyBalance)}</b></td></tr>`)
  )}</section>`;
}

function marketplaceView() {
  const open = state.receivables.filter(item => item.receivableStatus === 'OPEN');
  return `<section class="panel"><div class="section-head"><div><span class="eyebrow">Shopee + TikTok</span><h2>Marketplace Receivables</h2></div><span class="badge open">${open.length} open</span></div>${table(
    ['Marketplace', 'Order', 'Gross piutang', 'Status', 'Settlement'],
    state.receivables.map(receivable => `<tr><td>${escapeHtml(receivable.marketplaceName)}</td><td>${escapeHtml(receivable.orderId)}</td><td>${rupiah.format(receivable.grossAmount)}</td><td><span class="badge ${String(receivable.receivableStatus).toLowerCase()}">${escapeHtml(receivable.receivableStatus)}</span></td><td>${receivable.receivableStatus === 'OPEN' ? `<div class="form-row"><input data-net="${escapeHtml(receivable.receivableId)}" type="number" placeholder="Dana cair"><input data-fee="${escapeHtml(receivable.receivableId)}" type="number" placeholder="Fee"><input data-deduction="${escapeHtml(receivable.receivableId)}" type="number" placeholder="Potongan lain"><button class="button tiny" data-settle="${escapeHtml(receivable.receivableId)}">Settle</button></div>` : `${rupiah.format(receivable.settledAmount)} · fee ${rupiah.format(receivable.feeAmount)}`}</td></tr>`)
  )}</section>`;
}

function loyaltyView() {
  const totalBalance = state.customers.reduce((sum, customer) => sum + Number(customer.loyaltyBalance), 0);
  return `<div class="metric-grid"><article class="metric"><span>Total loyalty balance</span><strong>${rupiah.format(totalBalance)}</strong></article><article class="metric"><span>Cashback/order completed</span><strong>${rupiah.format(50000)}</strong></article></div>${customersView()}`;
}

function reportsView() {
  const report = state.financialReport || {};
  const channelRows = report.channelRows || [];
  return `
    <div class="metric-grid">
      <article class="metric"><span>Gross order</span><strong>${rupiah.format(Number(report.grossOrderAmount || 0))}</strong></article>
      <article class="metric"><span>Discount</span><strong>${rupiah.format(Number(report.discountAmount || 0))}</strong></article>
      <article class="metric"><span>Open receivable</span><strong>${rupiah.format(Number(report.openReceivableAmount || 0))}</strong></article>
      <article class="metric"><span>Marketplace payout</span><strong>${rupiah.format(Number(report.marketplacePayoutAmount || 0))}</strong></article>
    </div>
    <div class="metric-grid">
      <article class="metric"><span>Marketplace fee</span><strong>${rupiah.format(Number(report.marketplaceFeeAmount || 0))}</strong></article>
      <article class="metric"><span>Other deductions</span><strong>${rupiah.format(Number(report.marketplaceOtherDeductionAmount || 0))}</strong></article>
      <article class="metric"><span>Loyalty redeemed</span><strong>${rupiah.format(Number(report.loyaltyRedeemedAmount || 0))}</strong></article>
      <article class="metric"><span>Shipping charged</span><strong>${rupiah.format(Number(report.shippingAmount || 0))}</strong></article>
    </div>
    <section class="panel"><h2>Sales by Channel</h2>${table(['Channel','Orders','Gross order'], channelRows.map(row => `<tr><td>${escapeHtml(row.orderChannel)}</td><td>${row.orderCount}</td><td>${rupiah.format(row.grossOrderAmount)}</td></tr>`))}<p class="muted">Financial operations detail di OLShop menjaga gross, discount, shipping, loyalty, fee, deductions, payout dan open receivable tetap terpisah. Final journals, HPP, account mapping dan valuation tetap canonical di Accounting/Inventory.</p></section>`;
}

function render() {
  tabs.querySelectorAll('button').forEach(button => button.classList.toggle('active', button.dataset.view === activeView));
  const views = {
    dashboard: dashboardView,
    pos: posView,
    orders: () => `<section class="panel"><h2>Orders</h2>${orderTable(state.orders)}</section>`,
    products: productsView,
    customers: customersView,
    marketplace: marketplaceView,
    loyalty: loyaltyView,
    reports: reportsView
  };
  app.innerHTML = (views[activeView] || dashboardView)();
}

tabs.addEventListener('click', event => {
  const button = event.target.closest('[data-view]');
  if (!button) return;
  activeView = button.dataset.view;
  render();
});

app.addEventListener('click', async event => {
  try {
    const editProduct = event.target.closest('[data-edit-product]');
    if (editProduct) {
      state.editingProductId = editProduct.dataset.editProduct;
      render();
      return;
    }
    const cancelProductEdit = event.target.closest('[data-cancel-product-edit]');
    if (cancelProductEdit) {
      state.editingProductId = null;
      render();
      return;
    }
    const saveProduct = event.target.closest('[data-save-product]');
    if (saveProduct) {
      const body = {
        sku: document.querySelector('#productSku').value,
        productName: document.querySelector('#productName').value,
        categoryName: document.querySelector('#productCategory').value,
        barcodeValue: document.querySelector('#productBarcode').value,
        purchasePriceAmount: Number(document.querySelector('#productPurchasePrice').value),
        salePriceAmount: Number(document.querySelector('#productSalePrice').value),
        isActive: true
      };
      const path = state.editingProductId ? `/api/products/${encodeURIComponent(state.editingProductId)}` : '/api/products';
      await api(path, { method: state.editingProductId ? 'PUT' : 'POST', body: JSON.stringify(body) });
      state.editingProductId = null;
      showToast('Master barang saved.');
      await refreshState();
      return;
    }
    const add = event.target.closest('[data-pos-add]');
    if (add) {
      const product = state.products.find(item => item.productId === add.dataset.posAdd);
      const existing = state.posCart.find(item => item.productId === product.productId);
      if (existing) existing.quantity += 1;
      else state.posCart.push({ ...product, quantity: 1 });
      render();
      return;
    }
    const remove = event.target.closest('[data-pos-remove]');
    if (remove) {
      const line = state.posCart.find(item => item.productId === remove.dataset.posRemove);
      if (line) {
        line.quantity -= 1;
        if (line.quantity <= 0) state.posCart.splice(state.posCart.indexOf(line), 1);
      }
      render();
      return;
    }
    const checkout = event.target.closest('[data-pos-checkout]');
    if (checkout) {
      if (!state.posCart.length) throw new Error('POS_CART_EMPTY');
      await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          orderChannel: 'POS',
          paymentStatus: document.querySelector('#posPayment').value,
          customerName: document.querySelector('#posCustomerName').value || 'Walk-in POS',
          customerPhone: document.querySelector('#posCustomerPhone').value,
          discountAmount: Number(document.querySelector('#posDiscount').value || 0),
          lines: state.posCart.map(line => ({ productId: line.productId, quantity: line.quantity }))
        })
      });
      state.posCart.length = 0;
      showToast('POS order created.');
      await refreshState();
      return;
    }
    const ship = event.target.closest('[data-ship]');
    if (ship) {
      await api(`/api/orders/${encodeURIComponent(ship.dataset.ship)}/ship`, { method: 'POST' });
      showToast('Order shipped. Piutang marketplace dibuat bila channel marketplace.');
      await refreshState();
      return;
    }
    const complete = event.target.closest('[data-complete]');
    if (complete) {
      await api(`/api/orders/${encodeURIComponent(complete.dataset.complete)}/complete`, { method: 'POST' });
      showToast('Order completed + cashback Rp50.000 jika customer terhubung.');
      await refreshState();
      return;
    }
    const settle = event.target.closest('[data-settle]');
    if (settle) {
      const receivableId = settle.dataset.settle;
      const settledAmount = Number(document.querySelector(`[data-net="${CSS.escape(receivableId)}"]`).value || 0);
      const feeAmount = Number(document.querySelector(`[data-fee="${CSS.escape(receivableId)}"]`).value || 0);
      const otherDeductionAmount = Number(document.querySelector(`[data-deduction="${CSS.escape(receivableId)}"]`).value || 0);
      await api(`/api/receivables/${encodeURIComponent(receivableId)}/settle`, {
        method: 'POST',
        body: JSON.stringify({ settledAmount, feeAmount, otherDeductionAmount, payoutReference: `MANUAL-${Date.now()}` })
      });
      showToast('Marketplace settlement reconciled.');
      await refreshState();
    }
  } catch (error) {
    showToast(error.message);
  }
});

refreshState().catch(error => {
  app.innerHTML = `<section class="panel"><h2>Database belum terhubung</h2><p>${escapeHtml(error.message)}</p><p class="muted">Apply D1 migrations dan bind DB sebelum runtime.</p></section>`;
});
