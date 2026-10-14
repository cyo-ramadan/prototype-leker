(() => {
  // Master nama fleksibel (Bos Cyo, 2026-10-14): satu orang tidak boleh terpecah dua nama di Hutang
  // Piutang. Dipanggil form yang meminta "atas nama" bebas (Buat Jurnal, Jurnal Split, Bea Operasional)
  // tepat sebelum menyimpan. Server: src/nama-pihak.js (GET /api/admin/accounting/party-names/check).
  //   - nama sama persis (abaikan huruf besar/spasi)  -> langsung pakai nama yang sudah ada;
  //   - nama mirip   -> "Maksudnya '<X>'?" -> ya: pakai X, tulisan aslinya dikembalikan sebagai `note`
  //                     supaya masuk keterangan;
  //   - nama baru    -> "Tambahkan '<nama>' sebagai pemasok/nama baru?" -> pemasok masuk Master Supplier.
  // Hasil: { name, supplierId?, note } atau null kalau admin membatalkan.
  async function konfirmasiNamaPihak({ name, asSupplier = false, api }) {
    const typed = String(name || '').trim();
    if (typed.length < 2) return { name: typed, note: '' };
    const check = await api(`/api/admin/accounting/party-names/check?name=${encodeURIComponent(typed)}`);
    const use = (item, note = '') => (item.kind === 'SUPPLIER' ? { name: item.name, supplierId: item.id, note } : { name: item.name, note });
    if (check.exact) return use(check.exact);
    for (const item of check.similar || []) {
      const label = item.kind === 'SUPPLIER' ? 'pemasok' : 'nama';
      if (window.confirm(`Maksudnya '${item.name}' (${label} yang sudah ada)?\n\nOK = pakai '${item.name}'; tulisan "${typed}" disimpan di keterangan.\nBatal = bukan, ini pihak lain.`)) {
        return use(item, `tertulis: ${typed}`);
      }
    }
    if (!window.confirm(`Tambahkan '${typed}' sebagai ${asSupplier ? 'pemasok' : 'nama'} baru?`)) return null;
    if (!asSupplier) return { name: typed, note: '' };
    const created = await api('/api/admin/suppliers', { method: 'POST', body: JSON.stringify({ name: typed, notes: 'Ditambahkan dari isian atas nama' }) });
    return { name: typed, supplierId: created.id, note: '', createdSupplier: true };
  }

  window.konfirmasiNamaPihak = konfirmasiNamaPihak;
})();
