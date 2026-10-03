// Setoran saat tutup laci (Bos Cyo, 2026-10-03): kasir TIDAK mengisi setoran.
// Yang diisi kasir adalah "Titip laci" -- uang yang sengaja ditinggal di laci
// untuk modal shift berikutnya. Setoran = saldo kas fisik - titip laci, jadi
// uang di laci selalu terhitung (kalau kasir mengisi setoran sendiri, sisa uang
// di laci tidak ikut dicek). Kasir lama / klien lama yang masih mengirim
// depositAmount langsung tetap dilayani.
//
// leftInDrawer: undefined = tidak dikirim; null = dikirim tapi bukan angka valid;
// angka = titip laci. depositFallback dipakai hanya bila titip laci tidak dikirim.
export function resolveDrawerDeposit({ closingAmount, leftInDrawer, depositFallback }) {
  if (leftInDrawer !== undefined) {
    if (leftInDrawer === null) return { ok: false, error: 'Titip laci wajib berupa angka valid.' };
    if (leftInDrawer > closingAmount) return { ok: false, error: 'Titip laci tidak boleh lebih besar dari saldo kas fisik laci.' };
    return { ok: true, depositAmount: closingAmount - leftInDrawer, leftInDrawer };
  }
  if (depositFallback === null) return { ok: false, error: 'Setoran wajib berupa angka valid.' };
  if (depositFallback > closingAmount) return { ok: false, error: 'Setoran tidak boleh lebih besar dari saldo akhir laci.' };
  return { ok: true, depositAmount: depositFallback, leftInDrawer: closingAmount - depositFallback };
}

// Nilai kolom form/JSON -> undefined bila tidak dikirim / kosong.
export function optionalMoney(raw, parse) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
  return parse(raw);
}
