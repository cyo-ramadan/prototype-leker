# Known Issues — Prototype Leker

Tidak ada known issue aktif yang ditambahkan oleh perubahan login/session 0011.

Issue sebelumnya tentang duplicate cashier tab ditutup oleh kombinasi:

- canonical login dipisah menjadi Pelanggan dan Karyawan;
- satu staff account hanya mempunyai satu active server session;
- satu browser hanya mempunyai satu active staff tab melalui local browser lease;
- takeover session harus explicit;
- customer session tetap terpisah dan boleh coexist dengan satu staff tab.

Jika browser-tab lease atau takeover menghasilkan failure baru pada testing live, catat sebagai issue baru dengan langkah reproduksi dan jangan menghidupkan kembali periodic network polling sebagai workaround.

## DOC-IMPACT

**REQUIRED** — duplicate staff-tab problem yang sebelumnya unresolved sekarang memiliki implemented mitigation dan regression coverage pada changeset auth 0011.
