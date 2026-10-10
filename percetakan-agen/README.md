# Agen cetak — kirim file order langsung ke mesin

Program kecil untuk PC yang tersambung ke mesin cetak. Program ini mengambil order berstatus
**Siap cetak** milik mesin itu, menaruh filenya di mesin, lalu melapor ke server. Begitu semua file
satu order masuk mesin, status order otomatis berubah jadi **Dicetak**, dan riwayatnya tercatat
atas nama mesin.

Rancangan dan alasannya: `adr/ADR-055-tenant-percetakan-order-wa.md` D8.

## Dua cara "langsung ke printer"

| Mesin | Cara | Isi pengaturan |
|---|---|---|
| Large format / outdoor / indoor (pakai software RIP: Maintop, Onyx, PhotoPrint, Caldera, dll) | **Hot folder**: RIP memantau satu folder, dan file yang masuk ke situ langsung diproses sesuai preset folder itu (bahan, mode cetak) | `AGEN_FOLDER` = hot folder RIP |
| Printer kantor / A3+ / dokumen (driver Windows biasa) | **SumatraPDF** mencetak file ke printer tanpa membuka jendela | `AGEN_FOLDER` (arsip) + `AGEN_SUMATRA` + `AGEN_PRINTER` |

Satu mesin = satu agen = satu kunci. Kalau ada 3 mesin, jalankan 3 agen, boleh di PC yang sama
dengan folder dan kunci masing-masing.

## Pasang

1. Pasang Node.js 22 di PC mesin.
2. Login Owner/Admin → `/s/<KODE>/cetak` → Pengaturan → di mesin yang dimaksud, tekan
   **Buat kunci agen**. Salin kuncinya. Kunci hanya tampil sekali. Menekan tombol lagi membuat
   kunci baru dan mematikan kunci lama.
3. Jalankan (PowerShell):
   ```powershell
   $env:AGEN_SERVER = "https://<alamat-web>"
   $env:AGEN_KUNCI  = "mesin_..."
   $env:AGEN_FOLDER = "D:\RIP\HotFolder\Outdoor"
   node percetakan-agen\agen-cetak.mjs
   ```
   Untuk printer biasa, tambah:
   ```powershell
   $env:AGEN_SUMATRA = "C:\Program Files\SumatraPDF\SumatraPDF.exe"
   $env:AGEN_PRINTER = "EPSON L1800"
   ```
4. Supaya jalan sendiri saat PC menyala: Task Scheduler → "At startup" → jalankan perintah di atas.

Uji sekali tanpa menunggu: `$env:AGEN_SEKALI = "1"`.

## Pagar

- Sidik file (SHA-256) dicek sebelum dicetak. Kalau tidak sama dengan catatan server, file tidak
  dicetak.
- File ditulis dengan nama sementara lalu di-rename, supaya RIP tidak mengambil file setengah jadi.
- Nama file di folder berisi nomor order, nomor antrian, dan jumlah, misalnya
  `CTK-261010-001_antrian-3_2x_banner.pdf`. Operator bisa mencocokkan dengan layar antrian.
- Jumlah lembar untuk hot folder diatur operator atau RIP. Agen tidak menggandakan file; nama
  file sudah menyebut jumlahnya. SumatraPDF mencetak sebanyak `qty`.
- Kunci mesin hanya bisa melihat dan mengambil tugas mesin itu sendiri.
