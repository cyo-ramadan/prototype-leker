-- ADR-054 (Bos Cyo, 2026-10-08): "output program wajib masuk akuntansi, data akuntansi itulah
-- yang ditampilkan di semua data tentang keuangan". Saldo per orang (Hutang Gaji, Piutang setoran
-- CS, hutang Bea ke pihak lain) dibaca dari buku lewat label "atas nama siapa"
-- (accounting_party_entries, migration 0138). Sejak ADR-054 jurnal otomatis menulis label itu
-- sendiri; migration ini menempelkan label yang sama ke jurnal otomatis yang lahir SEBELUMNYA.
--
-- Hanya MENAMBAH label. Jurnal posted tidak diubah (invariant #2), tidak ada baris jurnal baru,
-- tidak ada nominal yang dihitung ulang: side dan amount_scaled disalin apa adanya dari baris
-- jurnalnya. Nama diambil dari fakta operasional asal jurnal itu (sumber yang sama dengan yang
-- dipakai jurnal baru). INSERT OR IGNORE pada journal_line_id UNIQUE: aman dijalankan ulang dan
-- tidak menimpa label yang sudah ada (mis. jurnal manual akuntan).
--
-- Yang sengaja tidak dilabeli: jurnal Standardisasi Akun (pemindahan saldo antar akun, bukan
-- milik satu orang), jurnal kasir ke Piutang Pelanggan / Utang Usaha (celah yang diketahui,
-- ADR-054 tahap berikutnya), dan jurnal manual lama tanpa nama. Semuanya tetap tampil di
-- Cek Sinkron sebagai "belum bernama".

-- 1. Setoran CS: pengakuan Piutang Karyawan dari tutup laci (sumber = piutang setoran).
INSERT OR IGNORE INTO accounting_party_entries (
  id, store_id, entity_id, journal_id, journal_line_id, account_id, account_code,
  party_type, employee_id, supplier_id, party_name, side, amount_scaled,
  business_date, description, created_by_role, created_by_id, created_at
)
SELECT 'party_' || l.id, l.store_id, s.entity_id, h.id, l.id, l.account_id, c.code,
       'EMPLOYEE', r.counterparty_id, NULL, trim(r.counterparty_name_snapshot), l.side, l.amount_scaled,
       h.business_date, l.description, 'MIGRATION', '0143', CURRENT_TIMESTAMP
FROM accounting_journal_headers h
JOIN accounting_journal_lines l ON l.journal_id = h.id AND l.store_id = h.store_id
JOIN chart_of_accounts c ON c.id = l.account_id AND c.code = '1202'
JOIN stores s ON s.id = h.store_id
JOIN operational_receivables_payables r ON r.id = h.source_reference_id AND r.store_id = h.store_id
WHERE h.source_system = 'EMPLOYEE_DEPOSIT' AND h.journal_status = 'POSTED'
  AND r.source_type = 'EMPLOYEE_DEPOSIT' AND r.counterparty_id IS NOT NULL
  AND length(trim(r.counterparty_name_snapshot)) >= 2;

-- 2. Setoran CS: pelunasan (transfer setoran yang di-ACC; sumber = pembayaran piutang setoran).
INSERT OR IGNORE INTO accounting_party_entries (
  id, store_id, entity_id, journal_id, journal_line_id, account_id, account_code,
  party_type, employee_id, supplier_id, party_name, side, amount_scaled,
  business_date, description, created_by_role, created_by_id, created_at
)
SELECT 'party_' || l.id, l.store_id, s.entity_id, h.id, l.id, l.account_id, c.code,
       'EMPLOYEE', r.counterparty_id, NULL, trim(r.counterparty_name_snapshot), l.side, l.amount_scaled,
       h.business_date, l.description, 'MIGRATION', '0143', CURRENT_TIMESTAMP
FROM accounting_journal_headers h
JOIN accounting_journal_lines l ON l.journal_id = h.id AND l.store_id = h.store_id
JOIN chart_of_accounts c ON c.id = l.account_id AND c.code = '1202'
JOIN stores s ON s.id = h.store_id
JOIN operational_receivable_payable_payments p ON p.id = h.source_reference_id AND p.store_id = h.store_id
JOIN operational_receivables_payables r ON r.id = p.receivable_payable_id AND r.store_id = p.store_id
WHERE h.source_system = 'EMPLOYEE_DEPOSIT' AND h.journal_status = 'POSTED'
  AND r.source_type = 'EMPLOYEE_DEPOSIT' AND r.counterparty_id IS NOT NULL
  AND length(trim(r.counterparty_name_snapshot)) >= 2;

-- 3. Gaji presensi: Utang Gaji atas nama karyawan; akun kasir yang belum ditautkan atas nama
--    akunnya (`cashier:<id>`, konvensi yang sama dengan piutang setoran).
INSERT OR IGNORE INTO accounting_party_entries (
  id, store_id, entity_id, journal_id, journal_line_id, account_id, account_code,
  party_type, employee_id, supplier_id, party_name, side, amount_scaled,
  business_date, description, created_by_role, created_by_id, created_at
)
SELECT 'party_' || l.id, l.store_id, s.entity_id, h.id, l.id, l.account_id, c.code,
       'EMPLOYEE',
       COALESCE(p.employee_id, 'cashier:' || p.account_id),
       NULL,
       trim(COALESCE(e.full_name, k.employee_name, k.username)),
       l.side, l.amount_scaled,
       h.business_date, l.description, 'MIGRATION', '0143', CURRENT_TIMESTAMP
FROM accounting_journal_headers h
JOIN accounting_journal_lines l ON l.journal_id = h.id AND l.store_id = h.store_id
JOIN chart_of_accounts c ON c.id = l.account_id AND c.code = '2102'
JOIN stores s ON s.id = h.store_id
JOIN payroll_ledger_entries p ON h.source_reference_id = 'GAJI_PRESENSI:' || p.id
LEFT JOIN employees e ON e.id = p.employee_id
LEFT JOIN cashiers k ON k.id = p.account_id AND p.account_type = 'CASHIER'
WHERE h.source_system = 'LEKER_ADMIN' AND h.journal_status = 'POSTED'
  AND (p.employee_id IS NOT NULL OR p.account_type = 'CASHIER')
  AND length(trim(COALESCE(e.full_name, k.employee_name, k.username, ''))) >= 2;

-- 4a. Bea Gaji (dicatat sebagai Utang Gaji): atas nama karyawan yang dipilih Admin.
INSERT OR IGNORE INTO accounting_party_entries (
  id, store_id, entity_id, journal_id, journal_line_id, account_id, account_code,
  party_type, employee_id, supplier_id, party_name, side, amount_scaled,
  business_date, description, created_by_role, created_by_id, created_at
)
SELECT 'party_' || l.id, l.store_id, s.entity_id, h.id, l.id, l.account_id, c.code,
       'EMPLOYEE', x.employee_id, NULL, trim(e.full_name), l.side, l.amount_scaled,
       h.business_date, l.description, 'MIGRATION', '0143', CURRENT_TIMESTAMP
FROM accounting_journal_headers h
JOIN accounting_journal_lines l ON l.journal_id = h.id AND l.store_id = h.store_id
JOIN chart_of_accounts c ON c.id = l.account_id AND c.code = '2102'
JOIN stores s ON s.id = h.store_id
JOIN admin_operational_expenses x ON h.source_reference_id = 'BEA:' || x.id AND x.store_id = h.store_id
JOIN employees e ON e.id = x.employee_id
WHERE h.source_system = 'LEKER_ADMIN' AND h.journal_status = 'POSTED'
  AND x.category = 'BEA_GAJI' AND x.settlement = 'HUTANG'
  AND length(trim(e.full_name)) >= 2;

-- 4b. Bea Lapak / Bea Lainnya yang dicatat sebagai hutang: atas nama pihak yang dihutangi.
INSERT OR IGNORE INTO accounting_party_entries (
  id, store_id, entity_id, journal_id, journal_line_id, account_id, account_code,
  party_type, employee_id, supplier_id, party_name, side, amount_scaled,
  business_date, description, created_by_role, created_by_id, created_at
)
SELECT 'party_' || l.id, l.store_id, s.entity_id, h.id, l.id, l.account_id, c.code,
       CASE WHEN r.counterparty_type = 'EMPLOYEE' AND r.counterparty_id IS NOT NULL THEN 'EMPLOYEE'
            WHEN r.counterparty_type = 'SUPPLIER' AND r.counterparty_id IS NOT NULL THEN 'SUPPLIER'
            ELSE 'OTHER' END,
       CASE WHEN r.counterparty_type = 'EMPLOYEE' THEN r.counterparty_id END,
       CASE WHEN r.counterparty_type = 'SUPPLIER' THEN r.counterparty_id END,
       trim(r.counterparty_name_snapshot), l.side, l.amount_scaled,
       h.business_date, l.description, 'MIGRATION', '0143', CURRENT_TIMESTAMP
FROM accounting_journal_headers h
JOIN accounting_journal_lines l ON l.journal_id = h.id AND l.store_id = h.store_id
JOIN chart_of_accounts c ON c.id = l.account_id AND c.code IN ('2101', '2102', '2103')
JOIN stores s ON s.id = h.store_id
JOIN admin_operational_expenses x ON h.source_reference_id = 'BEA:' || x.id AND x.store_id = h.store_id
JOIN operational_receivables_payables r ON r.source_type = x.category AND r.source_id = x.id AND r.store_id = x.store_id
WHERE h.source_system = 'LEKER_ADMIN' AND h.journal_status = 'POSTED'
  AND x.category <> 'BEA_GAJI' AND x.settlement = 'HUTANG'
  AND length(trim(r.counterparty_name_snapshot)) >= 2;

-- 5a. Pelunasan hutang: baris Debit (utang yang berkurang) atas nama pihak yang dibayar.
INSERT OR IGNORE INTO accounting_party_entries (
  id, store_id, entity_id, journal_id, journal_line_id, account_id, account_code,
  party_type, employee_id, supplier_id, party_name, side, amount_scaled,
  business_date, description, created_by_role, created_by_id, created_at
)
SELECT 'party_' || l.id, l.store_id, s.entity_id, h.id, l.id, l.account_id, c.code,
       CASE WHEN a.counterparty_type = 'EMPLOYEE' AND a.counterparty_id IS NOT NULL THEN 'EMPLOYEE'
            WHEN a.counterparty_type = 'SUPPLIER' AND a.counterparty_id IS NOT NULL THEN 'SUPPLIER'
            ELSE 'OTHER' END,
       CASE WHEN a.counterparty_type = 'EMPLOYEE' THEN a.counterparty_id END,
       CASE WHEN a.counterparty_type = 'SUPPLIER' THEN a.counterparty_id END,
       trim(a.counterparty_name), l.side, l.amount_scaled,
       h.business_date, l.description, 'MIGRATION', '0143', CURRENT_TIMESTAMP
FROM accounting_journal_headers h
JOIN accounting_journal_lines l ON l.journal_id = h.id AND l.store_id = h.store_id AND l.side = 'DEBIT'
JOIN chart_of_accounts c ON c.id = l.account_id AND c.code IN ('2101', '2102', '2103')
JOIN stores s ON s.id = h.store_id
JOIN admin_payments a ON h.source_reference_id = 'BAYAR_HUTANG:' || a.id AND a.store_id = h.store_id
WHERE h.source_system = 'LEKER_ADMIN' AND h.journal_status = 'POSTED'
  AND length(trim(a.counterparty_name)) >= 2;

-- 5b. Pelunasan hutang yang dibayar dari setoran CS: baris Kredit Piutang Karyawan atas nama CS
--     pemegang setoran.
INSERT OR IGNORE INTO accounting_party_entries (
  id, store_id, entity_id, journal_id, journal_line_id, account_id, account_code,
  party_type, employee_id, supplier_id, party_name, side, amount_scaled,
  business_date, description, created_by_role, created_by_id, created_at
)
SELECT 'party_' || l.id, l.store_id, s.entity_id, h.id, l.id, l.account_id, c.code,
       'EMPLOYEE', d.counterparty_id, NULL, trim(d.counterparty_name_snapshot), l.side, l.amount_scaled,
       h.business_date, l.description, 'MIGRATION', '0143', CURRENT_TIMESTAMP
FROM accounting_journal_headers h
JOIN accounting_journal_lines l ON l.journal_id = h.id AND l.store_id = h.store_id AND l.side = 'CREDIT'
JOIN chart_of_accounts c ON c.id = l.account_id AND c.code = '1202'
JOIN stores s ON s.id = h.store_id
JOIN admin_payments a ON h.source_reference_id = 'BAYAR_HUTANG:' || a.id AND a.store_id = h.store_id
JOIN operational_receivables_payables d ON d.id = a.deposit_id AND d.store_id = a.store_id
WHERE h.source_system = 'LEKER_ADMIN' AND h.journal_status = 'POSTED'
  AND a.payment_method = 'DEPOSIT' AND d.source_type = 'EMPLOYEE_DEPOSIT' AND d.counterparty_id IS NOT NULL
  AND length(trim(d.counterparty_name_snapshot)) >= 2;

-- 6. Jurnal pembalik (pembatalan) mewarisi label baris aslinya: baris ke-n pembalik = baris ke-n
--    asli dengan sisi terbalik dan nominal sama. Dijalankan terakhir supaya label asli di atas
--    sudah ada.
INSERT OR IGNORE INTO accounting_party_entries (
  id, store_id, entity_id, journal_id, journal_line_id, account_id, account_code,
  party_type, employee_id, supplier_id, party_name, side, amount_scaled,
  business_date, description, created_by_role, created_by_id, created_at
)
SELECT 'party_' || rl.id, rl.store_id, s.entity_id, rh.id, rl.id, rl.account_id, src.account_code,
       src.party_type, src.employee_id, src.supplier_id, src.party_name, rl.side, rl.amount_scaled,
       rh.business_date, rl.description, 'MIGRATION', '0143', CURRENT_TIMESTAMP
FROM accounting_journal_headers rh
JOIN accounting_journal_lines rl ON rl.journal_id = rh.id AND rl.store_id = rh.store_id
JOIN stores s ON s.id = rh.store_id
JOIN accounting_journal_lines ol ON ol.journal_id = rh.reversal_of_journal_id AND ol.store_id = rh.store_id
  AND ol.line_number = rl.line_number AND ol.account_id = rl.account_id
  AND ol.amount_scaled = rl.amount_scaled AND ol.side <> rl.side
JOIN accounting_party_entries src ON src.journal_line_id = ol.id
WHERE rh.reversal_of_journal_id IS NOT NULL AND rh.journal_status = 'POSTED';
