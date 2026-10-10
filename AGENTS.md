# AGENTS.md — untuk Codex dan agen lain yang tidak membaca CLAUDE.md

Aturan kerja repo ini ada di **`CLAUDE.md`**. Baca file itu dulu; semua isinya berlaku juga untukmu
(bahasa, invariant uang/jurnal/isolasi gerai, `npm run check` + `npm test` sebelum commit, branch
fitur, peringatan "push branch = migration jalan ke D1 produksi").

Bedanya cuma satu: pakai namamu sendiri, bukan "Hana". Sebut diri "Codex" saat melapor ke Bos Cyo,
dan sebelum commit pertama set:

```sh
git config user.name "Codex"
git config user.email "codex@agent.maxi"
```

Sedang mengerjakan modul Percetakan (order WA → antrian cetak)? Mulai dari
`HANDOFF-PERCETAKAN.md`, lalu `adr/ADR-055-tenant-percetakan-order-wa.md`.

Laptop Bos Cyo menjalankan Windows. 13 tes lama gagal karena line ending (CRLF) dan path. Itu
baseline lingkungan, bukan kerusakan dari perubahanmu.
