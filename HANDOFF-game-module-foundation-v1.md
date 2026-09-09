# Handoff — Game Module Foundation V1

Tanggal: 2026-09-09
Implementer: Karen
Status target: foundation only, legacy Roda Puter belum dimigrasikan

## Keputusan Bos Cyo yang diterapkan

1. Game menjadi modul horizontal opsional per Tenant.
2. Tenant tanpa Game dapat memutus entitlement Game tanpa menghapus histori.
3. Game dipisahkan dari Voucher. Outcome memakai provider-neutral `reward_key`.
4. Artwork menjadi properti outcome melalui opaque `artwork_ref`.
5. Storage provider artwork tidak diputuskan di task ini; tidak ada dependency R2.
6. Client Game nantinya lazy-load hanya setelah manifest menyatakan module aktif.
7. Roda Puter menjadi game type pertama setelah legacy migration, bukan nama modul.

## Yang sudah dibuat

- ADR-042 dan `contracts/game-module-v1.md`.
- `platform_modules` + versioned `tenant_module_installations`.
- definisi platform module `GAME`, tanpa auto-enroll Tenant.
- `game_campaigns`, `game_outcomes`, `game_plays` provider-neutral.
- `src/platform-module-registry.js` read helpers.
- `src/game.js` single Game entry point + manifest contract.
- test entitlement history, schema boundary, no provider import, dan tenancy holder.
- package syntax check memasukkan source baru.

## Yang sengaja belum dilakukan

- menghubungkan `handleGameApi()` ke `src/index.js`;
- membuat Owner UI/API install/uninstall module per Tenant;
- memigrasikan `roda_puter_*` ke `game_*`;
- memindahkan Setting Roda Puter dari Voucher ke Game;
- membuat fulfillment adapter Voucher/Point/Product;
- memilih storage fisik untuk `artwork_ref`;
- membuat lazy-loaded browser bundle per game;
- menetapkan final owner module `game`.

Alasan route belum dihubungkan: foundation ini additive dan tidak boleh mengubah
Roda Puter production sampai data compatibility + fulfillment boundary siap.

## Batas kompatibilitas

`src/roda-puter.js`, `roda_puter_*`, probability existing, official spin, dan
Voucher issuance tetap untouched. Migration 0080 hanya menambah schema baru.

## Next safe slice

1. tetapkan owner module `game`;
2. buat Owner entitlement management per Tenant;
3. hubungkan `/api/game/manifest` ke router;
4. buat Game settings surface;
5. migrasi Roda Puter campaign/outcome ke Game dengan compatibility tests;
6. baru pindahkan customer wheel ke lazy-loaded Game client.

## Agent Bus

Sesi ini tidak memiliki connector D1/maxi-agent-bus. GitHub work dapat dilakukan,
tetapi claim/report board belum bisa ditulis dari sesi ini. Jangan mengarang row
board. Gunakan relay canonical jika perlu.

## DOC-IMPACT

**REQUIRED** — pondasi ini menambah module, contract, migration, dan ownership
registry entry; semuanya berada dalam perubahan yang sama.
