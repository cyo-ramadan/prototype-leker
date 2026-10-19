// Sumber makna ditinjau dari kode. ID fitur eksplisit, tidak mengikuti route baru otomatis.
export const SUMBER_KAMUS = Object.freeze({
  "una_lembar": {
    "sumber": ["src/una-surfaces.js", "public/una-lembar.js", "public/una-surfaces-client.js", "public/una-kanvas.js", "src/una-kanvas-patch.js", "src/una-kanvas-baca.js", "public/una-kanvas-baca.js"],
    "fitur": [
      "rute:src/caca-chat.js:/api/caca/kanvas/baca",
      "tulis:src/caca-chat.js:request.method === 'POST' && pathname === '/api/caca/kanvas/baca') return handleBacaKanvas(request, env);",
      "rute:src/caca-chat.js:/api/caca/surfaces", "rute:src/caca-chat.js:/api/caca/surfaces/", "rute:src/una-surfaces.js:/api/caca/surfaces",
      "tulis:src/una-surfaces.js:request.method!=='POST')return json(",
      "tulis:src/una-surfaces.js:request.method==='DELETE')",
      "tulis:src/una-surfaces.js:request.method==='PATCH'?await readBody(request):"
    ]
  },
  "una_laporan_chat": {
    "sumber": ["src/una-perintah-lembar.js", "public/una-dispatcher.js", "public/una-adapter-laporan.js"],
    "fitur": []
  },
  "kemampuan": {
    "sumber": [
      "src/caca-aksi.js",
      "src/caca-kesiapan.js"
    ],
    "fitur": []
  },
  "mulai": {
    "sumber": [
      "src/caca-aksi.js",
      "src/caca-kesiapan.js"
    ],
    "fitur": []
  },
  "hpp": {
    "sumber": [
      "src/cashier-purchase.js",
      "src/manufacture-costing.js",
      "src/hpp-recalculation.js"
    ],
    "fitur": []
  },
  "resep": {
    "sumber": [
      "src/manufacturing-master.js",
      "src/cashier-production.js",
      "public/racik-admin.js"
    ],
    "fitur": []
  },
  "jenis_tipe": {
    "sumber": [
      "src/admin-product-classification.js",
      "src/product-kinds.js"
    ],
    "fitur": []
  },
  "master_barang": {
    "sumber": [
      "src/product-master.js"
    ],
    "fitur": []
  },
  "satuan": {
    "sumber": [
      "src/manufacturing-master.js",
      "public/racik-admin.js"
    ],
    "fitur": []
  },
  "stok_minus": {
    "sumber": [
      "src/admin-stock.js",
      "public/admin-stock.js",
      "src/cashier-purchase.js"
    ],
    "fitur": []
  },
  "riwayat_stok": {
    "sumber": [
      "src/admin-stock.js",
      "public/admin-stock.js",
      "src/cashier-purchase.js"
    ],
    "fitur": []
  },
  "untung_rugi": {
    "sumber": [
      "src/net-profit-report.js"
    ],
    "fitur": []
  },
  "jurnal": {
    "sumber": [
      "src/accounting-ledger.js"
    ],
    "fitur": []
  },
  "akun": {
    "sumber": [
      "src/accounting-ledger.js"
    ],
    "fitur": []
  },
  "rekening_bersama": {
    "sumber": [
      "src/entity-shared-accounts.js"
    ],
    "fitur": []
  },
  "deposit": {
    "sumber": [
      "src/operational-deposits.js",
      "src/cashier-purchase.js"
    ],
    "fitur": []
  },
  "bea": {
    "sumber": [
      "src/admin-operational-expense.js"
    ],
    "fitur": []
  },
  "hutang": {
    "sumber": [
      "src/operational-receivables-payables.js"
    ],
    "fitur": []
  },
  "laci": {
    "sumber": [
      "src/cashier-drawer.js",
      "src/drawer-report.js",
      "src/cashier-drawer-close-permit.js",
      "public/cashier-live-photo.js",
      "src/tenant-policy.js"
    ],
    "fitur": []
  },
  "tutup_laci": {
    "sumber": [
      "src/cashier-drawer.js",
      "src/cashier-drawer-close-permit.js",
      "public/cashier-live-photo.js",
      "src/tenant-policy.js"
    ],
    "fitur": [
      "rute:src/cashier-drawer-close-permit.js:/api/admin/drawer/close-permits",
      "rute:src/cashier-drawer-close-permit.js:/api/cashier/drawer/close-permits",
      "rute:src/cashier-drawer.js:/api/cashier/drawer/close",
      "rute:src/cashier-drawer.js:/api/cashier/drawer/open",
      "tombol:public/cashier.html:closeDrawerBtn",
      "tombol:public/cashier.html:openDrawerBtn",
      "tulis:src/cashier-drawer-close-permit.js:request.method === 'PATCH' && decisionMatch)",
      "tulis:src/cashier-drawer-close-permit.js:request.method === 'POST' && pathname === '/api/cashier/drawer/close-permits')",
      "tulis:src/cashier-drawer.js:request.method === 'POST' && pathname === '/api/cashier/drawer/close')",
      "tulis:src/cashier-drawer.js:request.method === 'POST' && pathname === '/api/cashier/drawer/open')",
      "pola:src/cashier-drawer-close-permit.js:/^\\/api\\/admin\\/drawer\\/close-permits\\/([^/]+)$/"
    ]
  },
  "persetujuan": {
    "sumber": [
      "src/transaction-void-permits.js",
      "src/transaction-correction-executor.js",
      "public/cashier-data-explorer.js",
      "src/tenant-policy.js"
    ],
    "fitur": []
  },
  "batal_penjualan": {
    "sumber": [
      "src/transaction-void-permits.js",
      "src/transaction-correction-executor.js",
      "public/cashier-data-explorer.js",
      "src/tenant-policy.js"
    ],
    "fitur": [
      "rute:src/transaction-void-permits.js:/api/cashier/transaction-void",
      "rute:src/transaction-void-permits.js:/api/cashier/transaction-void/candidates",
      "rute:src/transaction-void-permits.js:/api/cashier/transaction-void/permits",
      "rute:src/transaction-void-permits.js:/api/management/transaction-void-permits",
      "tombol:public/cashier-data-explorer.js:data-cashier-tx-cancel-permit:Batal Hapus",
      "tombol:public/management-transaction-void-permits.js:data-void-permit-acc:ACC PERMIT",
      "tombol:public/management-transaction-void-permits.js:data-void-permit-reject:Reject",
      "tombol:public/management-transaction-void-permits.js:data-void-permit-retry:🔁 Retry Eksekusi",
      "tombol:public/management-transaction-void-permits.js:managementVoidPermitRefresh",
      "tulis:src/transaction-void-permits.js:request.method === 'DELETE' && cancelMatch)",
      "tulis:src/transaction-void-permits.js:request.method === 'PATCH' && match)",
      "tulis:src/transaction-void-permits.js:request.method === 'POST' && pathname === '/api/cashier/transaction-void/permits')",
      "pola:src/transaction-void-permits.js:/^\\/api\\/cashier\\/transaction-void\\/permits\\/([^/]+)$/",
      "pola:src/transaction-void-permits.js:/^\\/api\\/management\\/transaction-void-permits\\/([^/]+)$/"
    ]
  },
  "presensi": {
    "sumber": [
      "src/staff-portal.js",
      "src/staff-attendance.js",
      "src/attendance-correction-permit.js",
      "src/attendance-gps-permit.js",
      "src/tenant-policy.js"
    ],
    "fitur": []
  },
  "dana_apresiasi": {
    "sumber": [
      "src/dana-apresiasi.js",
      "src/dana-apresiasi-api.js",
      "public/entity-dana-apresiasi.js",
      "public/pengganti-presensi.js"
    ],
    "fitur": [
      "rute:src/dana-apresiasi-api.js:/api/entity-admin/dana-apresiasi",
      "rute:src/staff-portal.js:/api/staff/pengganti",
      "tombol:public/entity-dana-apresiasi.js:label:Rekap &amp; penyesuaian",
      "tombol:public/entity-dana-apresiasi.js:label:Simpan bawaan",
      "tombol:public/entity-dana-apresiasi.js:label:Simpan gerai {nilai}",
      "tombol:public/entity-dana-apresiasi.js:label:Tampilkan",
      "tulis:src/dana-apresiasi-api.js:request.method !== 'POST') return json(",
      "tulis:src/staff-portal.js:request.method === 'POST' && pathname === '/api/staff/pengganti')"
    ]
  },
  "presensi_gagal": {
    "sumber": [
      "src/staff-portal.js",
      "src/staff-attendance.js",
      "src/attendance-correction-permit.js",
      "src/attendance-gps-permit.js",
      "src/tenant-policy.js",
      "src/attendance-revision-permit.js",
      "public/entity-izin-cs.js"
    ],
    "fitur": [
      "pola:src/attendance-revision-permit.js:/^\\/api\\/admin\\/attendance-revisions\\/([^/]+)$/",
      "rute:src/attendance-revision-permit.js:/api/admin/attendance-revisions",
      "rute:src/attendance-revision-permit.js:/api/staff/attendance-revisions",
      "tombol:public/entity-izin-cs.js:data-in,data-izin-edit,data-kind,data-out,data-store:Edit lalu ACC",
      "tombol:public/staff.js:data-correct-attendance:Ajukan revisi jam",
      "tulis:src/attendance-revision-permit.js:request.method !== 'POST') return json(",
      "tulis:src/attendance-revision-permit.js:request.method === 'PATCH' && match)",
      "rute:src/attendance-correction-permit.js:/api/admin/attendance-correction-permits",
      "rute:src/attendance-correction-permit.js:/api/staff/attendance-correction-permits",
      "rute:src/attendance-gps-permit.js:/api/admin/attendance-gps-permits",
      "rute:src/attendance-gps-permit.js:/api/staff/attendance-gps-permits",
      "tulis:src/attendance-correction-permit.js:request.method === 'PATCH' && match)",
      "tulis:src/attendance-correction-permit.js:request.method === 'POST' && match)",
      "tulis:src/attendance-gps-permit.js:request.method === 'PATCH' && match)",
      "tulis:src/attendance-gps-permit.js:request.method === 'POST' && match)",
      "pola:src/attendance-correction-permit.js:/^\\/api\\/admin\\/attendance-correction-permits\\/([^/]+)$/",
      "pola:src/attendance-correction-permit.js:/^\\/api\\/staff\\/attendance\\/([^/]+)\\/correction-permits$/",
      "pola:src/attendance-correction-permit.js:/^\\/api\\/staff\\/attendance\\/[^/]+\\/correction-permits$/",
      "pola:src/attendance-gps-permit.js:/^\\/api\\/admin\\/attendance-gps-permits\\/([^/]+)$/",
      "pola:src/attendance-gps-permit.js:/^\\/api\\/staff\\/attendance\\/([^/]+)\\/gps-permits$/",
      "pola:src/attendance-gps-permit.js:/^\\/api\\/staff\\/attendance\\/[^/]+\\/gps-permits$/"
    ]
  },
  "akun_kasir": {
    "sumber": [
      "src/employee-master.js",
      "src/caca-aksi-karyawan.js",
      "public/admin-employees.js",
      "public/admin-cashiers.js"
    ],
    "fitur": []
  },
  "qris_mutasi": {
    "sumber": [
      "src/qris-mutasi.js",
      "public/bca-mutasi-baca.js",
      "migrations/0168_qris_mutasi.sql",
      "migrations/0171_qris_catatan_cs.sql",
      "src/staff-raport.js"
    ],
    "fitur": [
      "rute:src/qris-mutasi.js:/api/qris/mutasi",
      "rute:src/qris-mutasi.js:/api/qris/mutasi/peta",
      "rute:src/qris-mutasi.js:/api/qris/mutasi/proses",
      "rute:src/qris-otomatis.js:/api/qris/mutasi",
      "rute:src/qris-otomatis.js:/api/qris/mutasi/",
      "tombol:public/qris-otomatis.js:data-mt-peta-simpan:{nilai}",
      "tombol:public/qris-otomatis.js:data-mt-proses:Proses ulang tanggal ini",
      "tombol:public/qris-otomatis.js:label:Baca & proses",
      "tulis:src/qris-mutasi.js:request.method !== 'POST') return json(",
      "tulis:src/qris-otomatis.js:request.method === 'POST')"
    ]
  },
  "qris_sambung_hp": {
    "sumber": [
      "src/qris-otomatis.js",
      "public/qris-otomatis.js"
    ],
    "fitur": []
  },
  "qris_otomatis": {
    "sumber": [
      "src/qris-otomatis.js",
      "public/qris-otomatis.js",
      "public/qris-kasir.js",
      "public/cashier-data-explorer.js",
      "src/tenant-policy.js"
    ],
    "fitur": [
      "rute:src/qris-otomatis.js:/api/qris",
      "rute:src/qris-otomatis.js:/api/qris/",
      "rute:src/qris-otomatis.js:/api/qris/abaikan",
      "rute:src/qris-otomatis.js:/api/qris/lepas",
      "rute:src/qris-otomatis.js:/api/qris/manual",
      "rute:src/qris-otomatis.js:/api/qris/masuk",
      "rute:src/qris-otomatis.js:/api/qris/penerima",
      "rute:src/qris-otomatis.js:/api/qris/penerima/cabut",
      "rute:src/qris-otomatis.js:/api/qris/pindah-gerai",
      "rute:src/qris-otomatis.js:/api/qris/pulihkan",
      "rute:src/qris-otomatis.js:/api/qris/ringkasan",
      "rute:src/qris-otomatis.js:/api/qris/setelan",
      "rute:src/qris-otomatis.js:/api/qris/tautkan",
      "rute:src/qris-otomatis.js:/api/qris/batal-klaim",
      "rute:src/qris-otomatis.js:/api/qris/minta",
      "rute:src/qris-otomatis.js:/api/qris/permintaan/lepas",
      "rute:src/qris-otomatis.js:/api/qris/permintaan/tahan",
      "rute:src/qris-otomatis.js:/api/qris/klaim",
      "rute:src/qris-otomatis.js:/api/qris/kandidat",
      "rute:src/qris-otomatis.js:/api/qris/klaim-tautkan",
      "tombol:public/cashier-data-explorer.js:cashierDataQrisPool",
      "tombol:public/cashier-data-explorer.js:data-cashier-tx-qris:QRIS",
      "tombol:public/qris-otomatis.js:data-qp-pakai:Pakai",
      "tombol:public/qris-otomatis.js:label:Batal klaim & tautan",
      "rute:src/qris-otomatis.js:/api/qris/kolam",
      "tombol:public/qris-otomatis.js:data-qr-batal:Batal klaim",
      "tombol:public/qris-otomatis.js:data-qr-lepas-minta:Lepaskan untuk {nilai}",
      "tombol:public/qris-otomatis.js:data-qr-minta:🙋 Ini pembeliku",
      "tombol:public/qris-otomatis.js:data-qr-tahan:Pertahankan",
      "tombol:public/qris-otomatis.js:data-qr-klaim:✋ Klaim untuk {nilai}",
      "tombol:public/entity-admin.js:data-qris-gerai:📲 QRIS{nilai}",
      "tombol:public/qris-otomatis.js:${esc(item.id)}",
      "tombol:public/qris-otomatis.js:data-qr-cabut:Cabut",
      "tombol:public/qris-otomatis.js:data-qr-pakai,data-qr-sale:Pakai uang masuk {nilai} · {nilai}{nilai}",
      "tombol:public/qris-otomatis.js:data-qr-pindah:Masukkan ke {nilai}",
      "tombol:public/qris-otomatis.js:data-qr-tab:{nilai}",
      "tombol:public/qris-otomatis.js:data-qr-taut:{nilai}",
      "tombol:public/qris-otomatis.js:label:＋ Buat HP penerima",
      "tombol:public/qris-otomatis.js:label:＋ Tambah uang masuk manual (dari mutasi)",
      "tombol:public/qris-otomatis.js:label:Muat ulang",
      "tombol:public/qris-otomatis.js:label:Salin",
      "tombol:public/qris-otomatis.js:label:Simpan setelan",
      "tombol:public/qris-otomatis.js:label:Tutup",
      "tulis:src/qris-otomatis.js:request.method !== 'POST' && request.method !== 'PUT') return json(",
      "tulis:src/qris-otomatis.js:request.method !== 'POST') return json("
    ]
  },
  "info_gerai": {
    "sumber": [
      "src/info-gerai.js",
      "src/staff-raport.js",
      "public/info-gerai.js",
      "public/info-gerai-kasir.js",
      "src/tenant-policy.js"
    ],
    "fitur": [
      "pola:src/info-gerai.js:/^\\/api\\/info-gerai\\/([^/]+)(?:\\/(foto|status|aktivitas))?$/",
      "rute:src/info-gerai.js:/api/info-gerai",
      "rute:src/info-gerai.js:/api/info-gerai/",
      "rute:src/info-gerai.js:/api/info-gerai/ringkasan",
      "tombol:public/cashier.html:infoGeraiBtn",
      "tombol:public/entity-admin.js:data-info-gerai:ℹ️ Info Gerai{nilai}",
      "tombol:public/info-gerai.js:${esc(entry.id)}",
      "tombol:public/info-gerai.js:data-ig-baru:＋ Laporkan Masalah",
      "tombol:public/info-gerai.js:data-ig-baru:＋ Tambah kontak",
      "tombol:public/info-gerai.js:data-ig-baru:＋ Tulis panduan",
      "tombol:public/info-gerai.js:data-ig-edit:Ubah",
      "tombol:public/info-gerai.js:data-ig-filter:Belum beres ({nilai})",
      "tombol:public/info-gerai.js:data-ig-filter:Sudah beres ({nilai})",
      "tombol:public/info-gerai.js:data-ig-foto:🖼 Lihat foto",
      "tombol:public/info-gerai.js:data-ig-hapus:Hapus",
      "tombol:public/info-gerai.js:data-ig-kontak-salah:⚠️ Nomor salah / tutup",
      "tombol:public/info-gerai.js:data-ig-saya-juga:👀 Saya juga lihat{nilai})` : ''}",
      "tombol:public/info-gerai.js:data-ig-selesai:✅ Tandai selesai",
      "tombol:public/info-gerai.js:data-ig-tab:{nilai}",
      "tombol:public/info-gerai.js:label:← Kembali",
      "tombol:public/info-gerai.js:label:Kirim",
      "tombol:public/info-gerai.js:label:Kirim laporan",
      "tombol:public/info-gerai.js:label:Simpan kontak",
      "tombol:public/info-gerai.js:label:Simpan panduan",
      "tombol:public/info-gerai.js:label:Tandai selesai",
      "tombol:public/info-gerai.js:label:Tutup",
      "tulis:src/info-gerai.js:request.method === 'DELETE' && !action)",
      "tulis:src/info-gerai.js:request.method === 'PATCH' && !action)",
      "tulis:src/info-gerai.js:request.method === 'POST' && action === 'aktivitas')",
      "tulis:src/info-gerai.js:request.method === 'POST' && action === 'status')",
      "tulis:src/info-gerai.js:request.method === 'POST' && pathname === '/api/info-gerai')"
    ]
  },
  "karyawan_tambah": {
    "sumber": [
      "src/employee-master.js",
      "src/caca-aksi-karyawan.js",
      "public/admin-employees.js",
      "public/admin-cashiers.js",
      "public/entity-admin.js"
    ],
    "fitur": [
      "pola:src/employee-master.js:/^\\/api\\/admin\\/employees\\/([^/]+)\\/photo$/",
      "tombol:public/admin-employees.js:employeePhotoRemove",
      "tombol:public/entity-admin.js:data-employee-detail:Detail",
      "tombol:public/entity-admin.js:label:Simpan",
      "tombol:public/entity-admin.html:entityEmployeeAddBtn",
      "tombol:public/entity-admin.js:label:Tambah karyawan"
    ]
  },
  "cara_bayar": {
    "sumber": [
      "src/pos-payment-methods.js",
      "src/sale-payments.js",
      "public/cashier-bayar-campuran.js",
      "migrations/0165_cara_bayar_qris.sql",
      "migrations/0169_cara_bayar_untuk_penjualan.sql"
    ],
    "fitur": []
  },
  "jualan_pertama": {
    "sumber": [
      "src/cashier-drawer.js",
      "src/cashier-sales-tracking.js"
    ],
    "fitur": []
  },
  "gerai_entity": {
    "sumber": [
      "src/stores.js",
      "src/owner-entity-context.js"
    ],
    "fitur": []
  },
  "barang_tambah": {
    "sumber": [
      "public/branch-admin.html",
      "src/product-master.js",
      "public/racik-admin.js"
    ],
    "fitur": []
  },
  "harga_barang": {
    "sumber": [
      "public/branch-admin.html",
      "src/product-master.js",
      "public/racik-admin.js"
    ],
    "fitur": []
  },
  "barang_nonaktif": {
    "sumber": [
      "public/branch-admin.html",
      "src/product-master.js",
      "public/racik-admin.js"
    ],
    "fitur": []
  },
  "kategori_barang": {
    "sumber": [
      "public/branch-admin.html",
      "src/admin.js",
      "src/admin-multistore.js"
    ],
    "fitur": []
  },
  "supplier_tambah": {
    "sumber": [
      "public/branch-admin.html",
      "src/suppliers.js"
    ],
    "fitur": []
  },
  "pembelian": {
    "sumber": [
      "src/cashier-purchase.js",
      "public/cashier-procurement-ui.js"
    ],
    "fitur": []
  },
  "nota_beda": {
    "sumber": [
      "src/cashier-purchase.js",
      "public/cashier-procurement-ui.js"
    ],
    "fitur": []
  },
  "barang_rusak": {
    "sumber": [
      "public/cashier-approval-actions.js",
      "src/stock-adjustment-correction.js",
      "src/operational-posting.js"
    ],
    "fitur": []
  },
  "barang_keluar": {
    "sumber": [
      "public/cashier-approval-actions.js",
      "src/stock-adjustment-correction.js",
      "src/operational-posting.js"
    ],
    "fitur": []
  },
  "penyesuaian_stok": {
    "sumber": [
      "public/cashier-approval-actions.js",
      "src/stock-adjustment-correction.js",
      "src/operational-posting.js"
    ],
    "fitur": []
  },
  "retur_barang": {
    "sumber": [
      "public/cashier-approval-actions.js",
      "src/stock-adjustment-correction.js",
      "src/operational-posting.js"
    ],
    "fitur": []
  },
  "akun_cs": {
    "sumber": [
      "public/admin-cashiers.js",
      "src/staff-attendance.js",
      "src/tenant-policy.js"
    ],
    "fitur": []
  },
  "jadwal_beda": {
    "sumber": [
      "public/admin-cashiers.js",
      "src/staff-attendance.js",
      "src/tenant-policy.js"
    ],
    "fitur": []
  },
  "gaji_harian": {
    "sumber": [
      "public/admin-cashiers.js",
      "src/staff-attendance.js",
      "src/tenant-policy.js"
    ],
    "fitur": []
  },
  "telat_gaji": {
    "sumber": [
      "public/admin-cashiers.js",
      "src/staff-attendance.js",
      "src/tenant-policy.js"
    ],
    "fitur": []
  },
  "setoran_cs": {
    "sumber": [
      "src/employee-deposit-settlement.js",
      "public/admin-employee-deposits.js",
      "public/staff.html"
    ],
    "fitur": [
      "rute:src/employee-deposit-settlement.js:/api/admin/employee-deposits/",
      "rute:src/employee-deposit-settlement.js:/api/admin/employee-deposits/overview",
      "rute:src/employee-deposit-settlement.js:/api/admin/employee-deposits/pending",
      "rute:src/employee-deposit-settlement.js:/api/cashier/employee-deposits",
      "rute:src/employee-deposit-settlement.js:/api/cashier/employee-deposits/",
      "rute:src/employee-deposit-settlement.js:/api/cashier/employee-deposits/read-proof",
      "rute:src/employee-deposit-settlement.js:/api/entity-admin/employee-deposits/pending",
      "tombol:public/admin-employee-deposits.js:data-approve-payment,data-nama,data-nominal,data-waktu:ACC",
      "tombol:public/admin-employee-deposits.js:data-reject-payment:Tolak",
      "tombol:public/admin-employee-deposits.js:data-tab:setoran-cs",
      "tombol:public/admin-employee-deposits.js:setoranRefresh",
      "tulis:src/employee-deposit-settlement.js:request.method === 'PATCH')",
      "tulis:src/employee-deposit-settlement.js:request.method === 'POST' && pathname === '/api/cashier/employee-deposits/read-proof')",
      "tulis:src/employee-deposit-settlement.js:request.method === 'POST' && submitMatch)",
      "pola:src/employee-deposit-settlement.js:/^\\/api\\/admin\\/employee-deposits\\/payments\\/([^/]+)\\/photo$/",
      "pola:src/employee-deposit-settlement.js:/^\\/api\\/admin\\/employee-deposits\\/payments\\/([^/]+)$/",
      "pola:src/employee-deposit-settlement.js:/^\\/api\\/cashier\\/employee-deposits\\/([^/]+)\\/payments$/",
      "pola:src/employee-deposit-settlement.js:/^\\/api\\/cashier\\/employee-deposits\\/payments\\/([^/]+)\\/photo$/"
    ]
  },
  "potongan_gaji": {
    "sumber": [
      "src/payroll-adjustments.js",
      "public/admin-cashiers.js",
      "src/accounting-admin-bridge.js"
    ],
    "fitur": [
      "pola:src/accounting-admin-bridge.js:/^\\/api\\/admin\\/cashiers\\/[^/]+\\/payroll-adjustments\\/([^/]+)\\/void$/",
      "pola:src/accounting-admin-bridge.js:/^\\/api\\/admin\\/cashiers\\/[^/]+\\/payroll$/"
    ]
  },
  "backup_salah_gerai": {
    "sumber": [
      "src/entity-backup-cashiers.js",
      "public/admin-cashiers.js"
    ],
    "fitur": []
  },
  "suara_una": {
    "sumber": [
      "public/kerangka-suara.js",
      "public/kerangka-suara-pemilik.js",
      "public/kerangka-suara-model-worker.js",
      "public/kerangka-suara-audio.js",
      "public/caca-chat.js",
      "public/caca-pengaturan.js"
    ],
    "fitur": [
      "tombol:public/caca-chat.js:cacaMulutStop",
      "tombol:public/caca-chat.js:cacaMulutToggle",
      "tombol:public/caca-chat.js:label:▶ dengarkan",
      "tombol:public/caca-pengaturan.js:cacaSuaraDaftar",
      "tombol:public/caca-pengaturan.js:cacaSuaraHapus",
      "tombol:public/caca-pengaturan.js:cacaSuaraModel",
      "tombol:public/caca-chat.js:cacaLiveToggle"
    ]
  },
  "nama_una": {
    "sumber": [
      "src/caca-pengaturan.js",
      "public/caca-pengaturan.js"
    ],
    "fitur": [
      "rute:src/caca-chat.js:/api/caca/pengaturan",
      "tombol:public/caca-pengaturan.js:cacaNamaSimpan",
      "tombol:public/branch-admin.html:cacaPengaturanTab",
      "tulis:src/caca-pengaturan.js:request.method !== 'PATCH') return json("
    ]
  },
  "jurnal_split": {
    "sumber": [
      "src/accounting-workspace.js",
      "src/accounting-journal-schedules.js",
      "public/admin-accounting-workspace.js"
    ],
    "fitur": [
      "rute:src/accounting-workspace.js:/api/admin/accounting/journal-splits",
      "tombol:public/admin-accounting-workspace.js:label:Buat Jurnal Split",
      "tulis:src/accounting-workspace.js:request.method === 'POST' && pathname === '/api/admin/accounting/journal-splits')",
      "pola:src/accounting-workspace.js:/^\\/api\\/admin\\/accounting\\/journal-splits\\/([^/]+)\\/(post-now|cancel)$/",
      "tombol:public/admin-accounting-workspace.js:data-split-cancel:Hapus split",
      "tombol:public/admin-accounting-workspace.js:data-split-cancel:Lanjutkan hapus",
      "tombol:public/admin-accounting-workspace.js:data-split-post:Posting sekarang",
      "tulis:src/accounting-workspace.js:request.method === 'POST' && splitActionMatch)"
    ]
  }
});
