export function stockAdjustmentRowKey(row) {
  return String(row?.productId ?? '');
}

export function selectStockAdjustmentProduct(rows, product) {
  const currentRows = Array.isArray(rows) ? rows : [];
  const productId = Number(product?.productId);
  if (!Number.isInteger(productId)) throw new Error('Barang Penyesuaian Stok tidak valid.');

  const key = String(productId);
  const existing = currentRows.find(row => stockAdjustmentRowKey(row) === key);
  if (existing) {
    return [existing, ...currentRows.filter(row => stockAdjustmentRowKey(row) !== key)];
  }

  const currentQuantity = Number(product?.currentQuantity ?? 0);
  if (!Number.isInteger(currentQuantity) || currentQuantity < 0) {
    throw new Error('Qty tercatat barang tidak valid.');
  }

  return [{
    productId,
    productName: String(product?.productName ?? ''),
    currentQuantity,
    unitSymbol: String(product?.unitSymbol ?? ''),
    actualQuantity: '',
    accountingHppDisplay: product?.accountingHppDisplay == null ? '—' : String(product.accountingHppDisplay)
  }, ...currentRows];
}

export function selectStockAdjustmentForm(rows, products) {
  return (Array.isArray(products) ? products : []).reduce(
    (selected, product) => selectStockAdjustmentProduct(selected, product),
    Array.isArray(rows) ? rows : []
  );
}

export function updateStockAdjustmentActualQuantity(rows, productId, value) {
  const key = String(Number(productId));
  return (Array.isArray(rows) ? rows : []).map(row =>
    stockAdjustmentRowKey(row) === key ? { ...row, actualQuantity: String(value ?? '') } : row
  );
}

export function removeStockAdjustmentRow(rows, productId) {
  const key = String(Number(productId));
  return (Array.isArray(rows) ? rows : []).filter(row => stockAdjustmentRowKey(row) !== key);
}

export function stockAdjustmentDifference(row) {
  const raw = String(row?.actualQuantity ?? '').trim();
  if (!raw) return null;
  const actual = Number(raw);
  if (!Number.isInteger(actual) || actual < 0) return null;
  return actual - Number(row?.currentQuantity ?? 0);
}

export function prepareStockAdjustmentRows(rows) {
  const currentRows = Array.isArray(rows) ? rows : [];
  if (!currentRows.length) throw new Error('Pilih minimal satu barang untuk Penyesuaian Stok.');

  return currentRows.map(row => {
    const actualRaw = String(row.actualQuantity ?? '').trim();
    const targetQuantity = Number(actualRaw);
    if (!actualRaw || !Number.isInteger(targetQuantity) || targetQuantity < 0) {
      throw new Error(`Qty Sebenarnya ${row.productName || ''} wajib bilangan bulat minimal 0.`.trim());
    }
    return {
      productId: Number(row.productId),
      productName: row.productName,
      currentQuantity: Number(row.currentQuantity),
      targetQuantity,
      difference: targetQuantity - Number(row.currentQuantity),
      unitSymbol: row.unitSymbol || ''
    };
  });
}
