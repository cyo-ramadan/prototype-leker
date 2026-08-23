// Ikan dijual per kilogram, sering pecahan (1.5 kg, 0.75 kg) -- bukan cuma satuan
// bulat kayak "ekor"/"pcs". Kolom `quantity` di migration 0001 sudah INTEGER polos
// TANPA asumsi satuannya harus utuh -- jadi dipakai sebagai milli-unit (3 desimal)
// di sini, bukan lewat migration baru. 1 kg tampil ke user = 1000 tersimpan di DB.

export const QTY_SCALE = 1000;

export function qtyToScaled(qty) {
  if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) {
    throw new RangeError('Quantity harus angka > 0');
  }
  const scaled = Math.round(qty * QTY_SCALE);
  if (Math.abs(scaled / QTY_SCALE - qty) > 1e-9) {
    throw new RangeError('Quantity maksimal 3 desimal');
  }
  return scaled;
}

export function scaledToQty(scaled) {
  if (!Number.isInteger(scaled) || scaled <= 0) {
    throw new RangeError('Quantity berskala tidak valid');
  }
  return scaled / QTY_SCALE;
}

// lineAmount = qtyScaled * priceScaled / QTY_SCALE. Selalu bulat karena priceScaled
// selalu kelipatan 1_000_000 (lihat money.js) dan QTY_SCALE=1000 -- tidak pernah sisa.
export function computeLineAmount(qtyScaled, priceScaledPerUnit) {
  const product = qtyScaled * priceScaledPerUnit;
  if (product % QTY_SCALE !== 0) {
    throw new RangeError('LINE_AMOUNT_NOT_EXACT');
  }
  return product / QTY_SCALE;
}
