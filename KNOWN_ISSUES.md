# Known Issues — Prototype Leker

## Approval posting contract

Approval queue migration `0013_approval_queue.sql` sudah menyediakan staging terpisah untuk `CASH_FLOW`, `GOODS_FLOW`, dan `ASSET`.

Current behavior:

- input Kasir selalu masuk sebagai `approval_status = pending_approval` dan `posting_status = unposted`;
- Admin Gerai dapat ACC/Reject hanya pada gerainya;
- Owner dapat ACC/Reject lintas gerai;
- ACC saat ini mencatat approval tetapi mengubah `posting_status` menjadi `blocked` dengan alasan `POSTING_CONTRACT_REQUIRED`;
- belum ada saldo kas, stok, atau aset yang dimutasi oleh approval queue.

**Blocker:** canonical posting contract untuk financial ledger/account mapping, inventory movement/valuation, dan asset lifecycle belum tersedia di Prototype Leker. Jangan menghubungkan row approval langsung ke `expenses`, `other_income`, `products`, atau entity aset buatan baru sebagai workaround.

Saat domain contract sudah disetujui, implementasikan posting adapter yang idempotent dan atomic: baca approval snapshot, tulis ke canonical ledger/domain owner, lalu set `posting_status = posted` dan `posted_at` hanya bila seluruh posting berhasil.

## Staff session dan duplicate tab

Issue sebelumnya tentang duplicate cashier tab ditutup oleh kombinasi:

- canonical login dipisah menjadi Pelanggan dan Karyawan;
- satu staff account hanya mempunyai satu active server session;
- satu browser hanya mempunyai satu active staff tab melalui local browser lease;
- takeover session harus explicit;
- customer session tetap terpisah dan boleh coexist dengan satu staff tab.

Jika browser-tab lease atau takeover menghasilkan failure baru pada testing live, catat sebagai issue baru dengan langkah reproduksi dan jangan menghidupkan kembali periodic network polling sebagai workaround.

## DOC-IMPACT

**REQUIRED** — approval queue kini memiliki unresolved posting-contract gate yang harus tetap visible sampai canonical ledger/inventory/asset behavior ditetapkan. Session/tab mitigation 0011 tetap dianggap implemented.
