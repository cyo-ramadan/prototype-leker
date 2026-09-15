# Anjungan Tap Kartu v1

Status: DESIGN — belum ada implementasi, belum ada tabel
Contract: `MAXI_ANJUNGAN_TAP_V1`
Owner: `hana` (arsitektur) sampai Bos Cyo menetapkan owner modul
Depends on: ADR-043, ADR-029, ADR-030, `HANDOFF-anjungan-tap-kartu-v1.md`

## Tujuan

Menerima dan menyimpan satu jenis fakta: **kartu X ditempel di alat Y pada jam Z**.
Tidak lebih. Arti tap ditentukan modul konsumen, bukan di sini.

Modul ini **harus bisa dijual berdiri sendiri** ke pelanggan yang tidak memakai
POS Leker sama sekali (ADR-043 keputusan 7). Itu bukan fitur tambahan — itu yang
menentukan bentuk tabelnya, dan alasan kenapa tidak ada foreign key ke `cashiers`
maupun `stores` yang wajib.

## Modul platform

`ANJUNGAN_TAP` didaftarkan di `platform_modules` sebagai `HORIZONTAL`, dipasang
per tenant lewat `tenant_module_installations` (pola ADR-040/ADR-042):

- terpasang = ada baris terbuka untuk `(tenant_id, module_code='ANJUNGAN_TAP')`;
- migration **tidak boleh** memasang tenant mana pun secara otomatis —
  pemasangan itu tindakan provisioning, bukan schema migration;
- mencabut pemasangan tidak menghapus riwayat `tap_events`.

## Boundary

### Anjungan owns

- `tap_devices`, `tap_cards`, `tap_events`
- entry point `handleAnjunganTapApi(request, env)`
- autentikasi alat lewat token dan resolusi pemilik (`tenant_id`, `store_id`)
  dari token itu
- dedupe pengiriman susulan dari buffer offline alat

### Anjungan explicitly does not own

- `staff_attendance` dan penentuan hadir/telat/pulang
- skor CS (`src/staff-raport.js`)
- jam masuk standar per gerai
- posting jurnal apa pun
- pembuatan file audio
- firmware alat
- data pemegang kartu milik sistem pelanggan (murid, karyawan mereka)

Tidak ada foreign key dari `tap_events` ke `staff_attendance` maupun sebaliknya.
Modul konsumen membaca `tap_events` dan menafsirkannya sendiri.

## Aturan keras

1. **`tenant_id` dan `store_id` diambil dari baris `tap_devices` yang cocok
   dengan token alat.** Kalau payload alat memuat tenant/store/gerai, field itu
   diabaikan — bukan divalidasi, diabaikan. (Invariant #5 `CLAUDE.md`)
2. **`tapped_at` dari alat, `received_at` dari server.** Dua kolom terpisah.
   `tapped_at` tidak pernah ditimpa nilai server, termasuk saat kiriman susulan
   datang jauh belakangan.
3. **`tap_events` append-only.** Koreksi lewat baris/flag baru, bukan UPDATE.
4. **Idempoten.** `UNIQUE (device_id, client_event_id)`. Alat yang mengirim ulang
   buffer-nya karena tidak yakin balasan sampai tidak boleh menggandakan fakta.
5. **Kartu tidak dikenal tetap dicatat** dengan outcome `UNKNOWN_CARD`. Tap yang
   didiamkan menghilangkan jejak justru di kasus yang paling perlu ditelusuri.
6. **Token alat disimpan sebagai hash** (pola `hashCredential()` di
   `src/owner-auth.js`, sama seperti `*_sessions.token_hash`). Plaintext hanya
   ada sekali saat provisioning dan tidak pernah masuk log maupun repo.
7. **Alat mendorong, server tidak ditanyai berkala.** (Invariant #6)
8. **Balasan server tidak boleh menyebut telat/tepat waktu** selama jam masuk
   standar per gerai belum ada di sistem.

## Tabel

### `tap_devices` — identitas alat

| Kolom | Isi |
|---|---|
| `id` | TEXT PK |
| `tenant_id` | TEXT NOT NULL → `tenants(id)` — **pemilik alat, sumber kebenaran** |
| `store_id` | TEXT NULL → `stores(id)` — diisi hanya kalau tenant ini memakai POS Leker |
| `device_name` | TEXT NOT NULL, label manusia ("Anjungan Depan Pendem") |
| `token_hash` | TEXT NOT NULL UNIQUE |
| `purpose_code` | TEXT NOT NULL — arti tap di alat ini, v1 hanya `STAFF_ATTENDANCE` |
| `delivery_mode` | TEXT NOT NULL DEFAULT `INTERNAL`, CHECK IN (`INTERNAL`, `WEBHOOK`) |
| `is_active` | INTEGER NOT NULL DEFAULT 1 |
| `created_at`, `last_seen_at` | TEXT |

`store_id` sengaja nullable: pelanggan yang membeli modul ini tanpa POS Leker
(mis. sekolah) tidak punya baris `stores`. Kalau diisi, `stores.id` itu wajib
milik tenant yang sama — dijaga trigger, mengikuti pola
`migrations/0080_game_module_foundation.sql`.

`delivery_mode = 'WEBHOOK'` **belum diimplementasikan** (ADR-043 keputusan 9).
Kolomnya ada supaya pilihan itu tidak tertutup; nilai `WEBHOOK` ditolak di lapisan
aplikasi sampai pengiriman keluar benar-benar dibangun.

### `tap_cards` — kartu milik siapa

| Kolom | Isi |
|---|---|
| `id` | TEXT PK |
| `tenant_id` | TEXT NOT NULL → `tenants(id)` |
| `card_uid` | TEXT NOT NULL, unik di antara kartu aktif **dalam satu tenant** |
| `holder_type` | TEXT NOT NULL — v1: `CASHIER` (internal) atau `EXTERNAL` |
| `holder_ref` | TEXT NOT NULL — acuan pemegang kartu |
| `holder_display_name` | TEXT NOT NULL — nama yang disebut saat kartu ditempel |
| `store_id` | TEXT NULL → `stores(id)` |
| `is_active` | INTEGER NOT NULL DEFAULT 1 |
| `registered_at`, `revoked_at` | TEXT |

**Tidak ada foreign key dari `holder_ref` ke `cashiers`.** Saat
`holder_type='CASHIER'` isinya memang `cashiers(id)` dan divalidasi di lapisan
aplikasi, tapi saat `holder_type='EXTERNAL'` isinya milik sistem pelanggan (nomor
induk siswa, id karyawan mereka) yang datanya tidak tinggal di sini. Foreign key
ke `cashiers` akan membuat modul ini mustahil dijual berdiri sendiri.

`card_uid` unik **per tenant**, bukan global: dua pelanggan berbeda bisa saja
memakai kartu dengan nomor yang sama dan itu bukan tabrakan.

Kartu hilang di-revoke, tidak dihapus — `tap_events` lama harus tetap bisa
ditelusuri ke pemilik saat itu.

### `tap_events` — log fakta

| Kolom | Isi |
|---|---|
| `id` | TEXT PK |
| `device_id` | TEXT NOT NULL → `tap_devices(id)` |
| `client_event_id` | TEXT NOT NULL, dibuat alat; `UNIQUE (device_id, client_event_id)` |
| `card_uid` | TEXT NOT NULL, disimpan apa adanya walau tak dikenal |
| `resolved_card_id` | TEXT NULL → `tap_cards(id)` |
| `resolved_holder_ref` | TEXT NULL — disalin dari kartu saat tap, bukan JOIN saat dibaca |
| `tenant_id` | TEXT NOT NULL — hasil resolusi token, bukan kiriman alat |
| `store_id` | TEXT NULL — hasil resolusi token, bukan kiriman alat |
| `tapped_at` | TEXT NOT NULL, jam alat |
| `received_at` | TEXT NOT NULL, jam server |
| `clock_skew_seconds` | INTEGER NOT NULL, `received_at - tapped_at`, boleh negatif |
| `outcome_code` | TEXT NOT NULL: `ACCEPTED` \| `UNKNOWN_CARD` \| `CARD_REVOKED` \| `CARD_OTHER_TENANT` |
| `created_at` | TEXT NOT NULL |

`clock_skew_seconds` disimpan mentah dan boleh besar — kiriman susulan setelah
wifi mati semalam memang begitu. Jangan di-`abs()`, jangan di-clamp (semangat
invariant #8).

## API v1

```
POST /api/anjungan/tap
Authorization: Bearer <token alat>
{ "card_uid": "...", "tapped_at": "2026-09-15T01:22:33.000Z", "client_event_id": "..." }
```

Balasan 200:

```json
{
  "status": "ACCEPTED",
  "holder_display_name": "Budi",
  "speech_text": "Selamat datang Budi",
  "lamp": "GREEN"
}
```

- Token tidak dikenal / alat non-aktif → 401, tidak ada baris ditulis.
- Tenant pemilik alat tidak punya pemasangan `ANJUNGAN_TAP` yang terbuka → 403,
  tidak ada baris ditulis.
- Kartu tidak dikenal → 200 dengan `status: "UNKNOWN_CARD"`, `holder_display_name: null`,
  `lamp: "RED"`; barisnya **tetap** ditulis.
- Kartu milik tenant lain → 200 dengan `status: "CARD_OTHER_TENANT"`, barisnya
  tetap ditulis, dan nama pemegangnya **tidak** dibocorkan ke alat.
- Pengiriman ulang `client_event_id` yang sama → 200 dengan balasan yang sama,
  tanpa baris baru.

Bentuk balasan ini sengaja tidak menyebut gerai, kasir, atau apa pun yang khas
Leker — supaya firmware yang sama tetap sah dipakai pelanggan yang sistemnya
bukan Leker.

`speech_text` v1 hanya menyapa nama. Tidak ada kalimat telat/tepat waktu sampai
jam masuk standar ada. Format audio final (server kirim teks lalu alat yang
bicara, atau server kirim berkas suara) sengaja belum dikunci.

## Yang sengaja belum diputuskan

1. **Jam masuk standar per gerai.** Belum ada di sistem. Milik area Presensi,
   ditetapkan Admin, dan kebijakannya milik Bos Cyo.
2. **Skor CS.** `src/staff-raport.js` sengaja mengembalikan `score: null` dengan
   `scoreStatus: 'NEEDS_KPI_POLICY'`. Anjungan hanya akan membacanya nanti.
3. **Pemakaian selain absen** (mis. check-in member). `purpose_code` sudah
   menyediakan tempatnya, tapi belum ada perilaku yang dirancang.
4. **Tempat kode firmware.** Rekomendasi Hana: subfolder repo ini mengikuti
   preseden `agent-bridge/`. Belum dikonfirmasi Bos Cyo.
5. **Pengiriman keluar (`delivery_mode='WEBHOOK'`).** Kolomnya disediakan,
   perilakunya belum dibangun (ADR-043 keputusan 9). Yang harus diputuskan dulu:
   cara menandatangani kiriman supaya sistem penerima yakin itu benar dari kita,
   apa yang terjadi kalau sistem penerima sedang mati, dan di mana rahasia milik
   pelanggan disimpan. Belum ada preseden pengiriman keluar di repo ini, jadi
   jangan dikarang saat implementasi tabel.
6. **Cara menagih pelanggan modul ini.** Per alat, per tenant, atau sekali beli —
   belum ditetapkan Bos Cyo, dan `tenant_module_installations` sudah cukup untuk
   menahannya sampai diputuskan.

## DOC-IMPACT

ADR-043 memegang alasannya. `HANDOFF-anjungan-tap-kartu-v1.md` menunjuk ke sini.
Saat tabel dan endpoint benar-benar dibuat, status dokumen ini naik dari DESIGN
dan bagian "belum diputuskan" wajib dipangkas sesuai keputusan Bos Cyo.
