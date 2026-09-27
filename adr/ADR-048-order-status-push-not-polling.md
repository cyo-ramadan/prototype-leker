# ADR-048 — Status pesanan pelanggan: push, bukan polling

Status: PROPOSED — desain, menunggu keputusan Bos Cyo di bagian "Keputusan yang Hana minta"
Tanggal: 2026-09-27
Diminta oleh: Bos Cyo (lewat pertanyaan "apakah sistem kita tergolong boros ... atau jangan2 ada
kasus looping req read"), ditulis oleh Hana

## Context

2026-09-27: D1 produksi kena `exceeded D1's free tier daily row read limit` sampai login
kasir dan Entity Admin ikut gagal ("terjadi kesalahan server"). Hana menelusuri kode (bukan
menebak) dan menemukan satu pelanggaran nyata atas invariant CLAUDE.md #6 ("Tanpa polling
periodik"):

- **Sisi Kasir sudah aman.** `startPolling()` bawaan `public/cashier.js` (pakai `setInterval`
  5 detik) sengaja di-*override* jadi versi tanpa interval oleh `public/cashier-workspace.js`
  lalu `public/cashier-refresh.js` — dua-duanya di-load belakangan di `cashier.html`, jadi
  override-nya sudah menang sebelum kasir manapun sempat login. Definisi asli yang punya
  `setInterval` adalah dead code yang dibiarkan supaya pemanggil lama tidak error.
- **Sisi Customer (layar status pesanan pelanggan) TIDAK ikut dibetulkan.** `public/customer.js`
  (`startOrderPolling()`, dipanggil dari `init()`, **tanpa override apa pun** di file lain) betul-
  betul menjalankan `setInterval(refreshActiveOrder, 5000)` — tiap 5 detik memanggil
  `GET /api/orders/:id` — selama pelanggan membuka layar status pesanannya, dan sebelum hari ini
  **tidak berhenti walau pesanan sudah `COMPLETED`/`CANCELLED`**, selama tab masih terbuka.

Perhitungan kasar: satu pesanan yang butuh ±10 menit sampai selesai = ±120 kali polling. Dengan
banyak gerai dan beberapa pelanggan menunggu bersamaan jam ramai, angka ini masuk akal jadi
penyumbang besar ke limit baca harian — walau Hana tidak punya akses dashboard analytics
Cloudflare dari sesi ini untuk memastikan angka pasti hari ini, jadi ini kesimpulan dari bukti
kode + perhitungan, bukan angka terukur langsung.

**Mitigasi sementara sudah live** (commit hari yang sama): interval dinaikkan 5 detik → 20 detik,
dan polling dihentikan begitu status pesanan final. Ini **mengurangi**, bukan **menghilangkan**
pelanggaran invariant #6 — tetap network polling periodik, cuma jauh lebih jarang.

Bos Cyo bertanya: aplikasi POS yang sudah mapan pada umumnya pakai pendekatan push (server yang
memberi tahu begitu ada perubahan), bukan pelanggan yang terus bertanya berkala — dan meminta
perbaikan yang seharusnya, bukan sekadar mitigasi interval.

## Decision (diusulkan)

**Ganti mekanisme status pesanan pelanggan dari polling jadi push, pakai WebSocket lewat
Cloudflare Durable Objects.** Ini pertama kalinya Worker ini memakai Durable Objects — belum ada
binding apa pun di `wrangler.jsonc` sekarang, cuma `ASSETS` dan `DB` (D1).

### Bentuknya

1. **Satu Durable Object per pesanan** (atau per gerai — lihat "Keputusan yang Hana minta" #2),
   misal kelas `OrderStatusHub`. Endpoint baru `GET /api/orders/:id/live` melakukan WebSocket
   upgrade ke instance Durable Object pesanan itu.
2. **Pelanggan connect sekali** setelah pesanan dibuat, bukan bertanya berkala. Server yang
   mengirim pesan begitu ada perubahan.
3. **Titik pemicu push**: `updateOrderStatus()` (`src/db-multistore.js`, dipanggil dari
   `src/orders-multistore.js`) adalah satu-satunya jalur resmi status pesanan berubah (diterima
   kasir, siap, selesai, dibatalkan). Sesudah write ke D1 berhasil, kirim pesan ke Durable Object
   pesanan itu, yang meneruskannya ke WebSocket yang terhubung.
4. **Fallback wajib ada** — koneksi WebSocket bisa putus (layar HP terkunci, jaringan goyah).
   Waktu reconnect atau tab kembali visible: **satu kali** fetch biasa ke `GET /api/orders/:id`
   (endpoint yang sudah ada, sudah murah — 1 baris order + beberapa baris item) untuk menyamakan
   status, persis pola yang sudah disetujui untuk Kasir ("refresh saat visible/focus", bukan
   periodic). Ini BUKAN polling karena cuma jalan sekali per event reconnect/visibility, bukan
   berulang dengan sendirinya.
5. **Kasir/gerai TIDAK terdampak.** Ini murni sisi pelanggan menonton status pesanannya sendiri.

### Kenapa Durable Objects, bukan yang lain

- **SSE (Server-Sent Events) tanpa Durable Objects tidak bisa** di Workers: satu invocation
  Worker itu pendek dan tidak bisa menyimpan koneksi terbuka sambil menunggu event dari request
  lain (kasir menerima pesanan) yang datang di invocation terpisah. Durable Objects adalah
  primitif Cloudflare yang justru dibuat untuk kasus ini — satu instance stateful yang bisa
  memegang koneksi terbuka dan menerima pesan dari Worker lain.
- **Biaya**: Durable Objects ditagih per request + durasi aktif + penyimpanan. Untuk skala
  Prototype Leker sekarang (13 gerai, volume pesanan harian yang tercatat sejauh ini kecil),
  perkiraan biayanya kecil — tapi tetap **item baru di tagihan Cloudflare** yang belum pernah ada,
  jadi tetap keputusan yang perlu Bos Cyo tahu di muka, bukan diam-diam ditambahkan.

## Consequences

- Menghilangkan (bukan cuma mengurangi) sumber baca berkala terbesar yang sudah terbukti ada.
- **Infrastruktur baru untuk seluruh proyek** (Durable Objects belum pernah dipakai) — perlu
  binding baru di `wrangler.jsonc`, migration Durable Object (mekanisme terpisah dari migration
  SQL `migrations/00xx_*.sql` yang sudah ada — jangan tertukar), dan test baru untuk pola koneksi/
  reconnect yang belum ada presedennya di test suite sekarang.
- Karen (pemegang modul `operasional`, termasuk `src/orders*.js`) yang mengerjakan implementasinya
  lewat papan agent-bus, dengan brief dari ADR ini.
- Mitigasi sementara (interval 20 detik + stop-on-terminal) tetap di tempat sampai ini selesai —
  jangan dicabut duluan.

## Keputusan yang Hana minta dari Bos Cyo

1. **Setuju memakai Durable Objects** (primitif baru, ada baris biaya baru walau kecil)? Kalau
   tidak, alternatif yang tersisa realistis cuma mempertahankan polling dengan interval yang jauh
   lebih longgar (mis. 30-60 detik) — bukan push sungguhan, tapi tanpa infrastruktur baru.
2. **Satu Durable Object per pesanan, atau per gerai?** Per pesanan lebih sederhana dan terisolasi
   (pesanan selesai = instance-nya beres, tidak ada shared state antar pesanan); per gerai lebih
   hemat instance tapi butuh logic routing pesan ke pelanggan yang benar di dalam satu instance.
   Hana menyarankan **per pesanan** untuk implementasi pertama — lebih sederhana dan lebih kecil
   risikonya untuk primitif yang belum pernah dipakai di proyek ini.
3. **Prioritas dan waktu pengerjaan** — ini menggantikan mitigasi yang sudah cukup meredakan
   masalah hari ini, jadi tidak darurat jam ini juga. Boleh dikerjakan berbarengan agenda lain?

## Related

`CLAUDE.md` invariant #6, `KNOWN_PITFALLS.md` "Periodic cashier polling" (koreksi 2026-09-27).

## DOC-IMPACT

Begitu diimplementasikan: `KNOWN_PITFALLS.md` bagian "Periodic cashier polling" diperbarui
(mitigasi interval dicabut, digantikan penjelasan mekanisme push), `MODULE_OWNERSHIP.md` mencatat
Durable Objects sebagai bagian modul `operasional`/`platform` (tergantung siapa yang pegang
binding-nya), dan status ADR ini naik ke ACCEPTED lalu IMPLEMENTED.
