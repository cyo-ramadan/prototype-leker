(() => {
  let saleEditor;
  function mountSale() {
    const host = document.getElementById('salePimasatu');
    if (!host || host.dataset.pimasatuMounted === '1' || !window.MAXIPimasatu) return;
    host.dataset.pimasatuMounted = '1';
    saleEditor = window.MAXIPimasatu.create({
      host, items: () => state.products || [],
      getId: product => product.id, getLabel: product => product.name,
      getMeta: product => [product.category, rupiah(product.price)].filter(Boolean).join(' · '),
      getDefaultAmount: product => product.price,
      openLabel: 'Tambah Barang', itemLabel: 'Barang / produk', priceLabel: 'Harga jual / unit',
      priceEditable: false, renderDetails: false, onError: toast,
      onAdd: line => {
        const id = Number(line.id), current = state.draft.get(id);
        state.draft.delete(id);
        state.draft.set(id, { product: line.item, quantity: Math.min(50, (current?.quantity || 0) + line.quantity) });
        renderDraft();
      }
    });
  }
  document.addEventListener('cashier:sale-dialog-opened', mountSale);
  document.addEventListener('cashier:workspace-applied', mountSale);
  document.addEventListener('DOMContentLoaded', mountSale);
  mountSale();
})();
