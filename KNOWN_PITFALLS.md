# Known Pitfalls — Prototype Leker

## Periodic cashier polling

**Pitfall:** Jangan menjalankan polling periodik untuk queue order dan status laci pada prototype ini.

Polling beberapa detik sekali dari setiap tab kasir membuat request Worker/D1 bertambah terus walaupun tidak ada perubahan. Membuka lebih dari satu tab menggandakan traffic tersebut dan dapat memperburuk error quota/network tanpa memberi nilai operasional yang sebanding.

**Current strategy:**

- Dashboard kasir memuat menu, order, dan status laci saat dibuka.
- Tidak ada periodic `setInterval` refresh yang aktif.
- Kasir mempunyai tombol **Refresh Pesanan** untuk refresh manual.
- Order dan status laci direfresh ketika tab kembali visible atau window kembali focus.
- Action kasir yang mengubah state tetap memperbarui state terkait setelah request selesai.
- Error network/quota tidak boleh dianggap sebagai session expiry. Session hanya dilepas pada response auth yang benar-benar menyatakan session tidak valid.

Jika realtime otomatis dibutuhkan nanti, gunakan mekanisme push yang disetujui dan diuji, misalnya WebSocket/SSE, bukan mengembalikan polling rapat tanpa impact assessment.

## DOC-IMPACT

**REQUIRED** — refresh behavior kasir berubah dari periodic polling menjadi manual/event-driven refresh untuk mengurangi request yang tidak perlu dan menjaga session behavior tetap jelas.
