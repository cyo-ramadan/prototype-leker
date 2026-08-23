// Generator ID kecil -- dipakai semua modul supaya konsisten.

export function newId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

// Nomor invoice/nota yang enak dibaca manusia: tanggal + 4 digit acak.
// Bukan primary key -- primary key tetap newId(). Ini cuma label tampilan/unique.
export function newDocumentNumber(prefix, date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const suffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${prefix}-${y}${m}${d}-${suffix}`;
}
