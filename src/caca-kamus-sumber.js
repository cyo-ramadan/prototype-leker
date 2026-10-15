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
  "presensi_gagal": {
    "sumber": [
      "src/staff-portal.js",
      "src/staff-attendance.js",
      "src/attendance-correction-permit.js",
      "src/attendance-gps-permit.js",
      "src/tenant-policy.js"
    ],
    "fitur": [
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
  "karyawan_tambah": {
    "sumber": [
      "src/employee-master.js",
      "src/caca-aksi-karyawan.js",
      "public/admin-employees.js",
      "public/admin-cashiers.js"
    ],
    "fitur": []
  },
  "cara_bayar": {
    "sumber": [
      "src/pos-payment-methods.js"
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
      "public/admin-cashiers.js"
    ],
    "fitur": []
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
