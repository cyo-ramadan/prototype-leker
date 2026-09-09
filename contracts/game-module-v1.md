# Game Module v1

Status: ACTIVE FOUNDATION
Contract: `MAXI_GAME_MODULE_V1`
Owner: pending assignment
Depends on: ADR-042, `MAXI_MODULE_CONTRACT_V1`

## Tujuan

Game adalah modul horizontal opsional yang mengelola game type, campaign,
outcome, dan play history. Game tidak memiliki Voucher, Product, Customer Point,
atau storage provider artwork.

## Boundary

### Game owns

- `game_campaigns`
- `game_outcomes`
- `game_plays`
- entry point `handleGameApi(request, ctx)`
- pemilihan outcome sesuai rule game type
- snapshot visual/reward identity yang diperlukan untuk histori

### Platform owns

- `platform_modules`
- `tenant_module_installations`
- resolusi Tenant/Entity/Store
- keputusan apakah Tenant boleh memanggil module `GAME`

### Game explicitly does not own

- Voucher Master / Voucher Instance / redemption
- Product Master / inventory movement
- Customer Point ledger
- file/object storage
- Accounting interpretation

Tidak ada foreign key `game_*` ke tabel provider hadiah. Tidak ada import langsung
Game ke `voucher.js`, Product, Customer Point, Accounting, atau provider sibling.

## Tenant entitlement

`GAME` hanya dianggap installed bila ada row terbuka di
`tenant_module_installations` untuk `(tenant_id, module_code='GAME')`.

- enable: buka periode baru;
- disable: tutup periode aktif;
- re-enable: buat periode baru;
- periode yang sudah ditutup immutable;
- disable tidak menghapus `game_*` history.

Migration tidak boleh otomatis mendaftarkan Tenant ke `GAME`. Enrollment adalah
provisioning/configuration action, bukan schema migration.

## Campaign

Satu campaign V1 memiliki minimal:

- `store_id` dan `entity_id` sebagai operational/data anchor;
- `game_type_code`;
- `display_name`;
- version positif;
- `client_entry` sebagai optional lazy-loaded browser entry;
- `config_json` untuk konfigurasi spesifik game type;
- status aktif/arsip melalui `is_active`.

Campaign lama tidak ditulis ulang saat campaign baru dibuat. Deactivation tidak
boleh diikuti reactivation atas snapshot lama.

## Outcome

Outcome V1 memiliki:

- `label_snapshot` — label hadiah saat campaign dibuat;
- `reward_key` — business identifier stabil dan provider-neutral;
- `weight_basis_points` — nullable karena tidak semua game harus memakai RNG
  berbobot;
- `artwork_ref` — opaque reference, nullable/empty diperbolehkan sampai asset
  storage dipilih;
- `sort_order`;
- `config_json` untuk data game-type-specific.

`reward_key` tidak boleh berisi ID Voucher/Product yang kemudian dibaca langsung
oleh Game sebagai foreign key terselubung. Mapping ke provider adalah kontrak
integrasi terpisah.

## Reward fulfillment fact

Saat fulfillment integration dibuat, Game menghasilkan business fact konseptual:

`GAME_OUTCOME_AWARDED_V1`

Minimal payload:

```json
{
  "playId": "...",
  "campaignId": "...",
  "outcomeId": "...",
  "gameTypeCode": "RODA_PUTER",
  "storeId": "...",
  "entityId": "...",
  "playerRef": "...",
  "rewardKey": "FREE_MATCHA",
  "awardedAt": "..."
}
```

Provider adapter boleh mengubah fact tersebut menjadi Voucher, Point, Product,
atau bentuk hadiah lain. Receipt/provider result tidak mengubah outcome yang
sudah tercatat.

## Play history

`game_plays` adalah append-only fact. V1 menyimpan mode, campaign/outcome,
optional `player_ref`, optional RNG evidence, dan waktu play.

Game tidak membuat foreign key ke Customer. `player_ref` adalah opaque identity
reference supaya Game tetap bisa dipasang tanpa module Customer dan histori tidak
rusak bila identity provider berubah.

## Client manifest dan lazy loading

`handleGameApi()` menyediakan contract `GET /api/game/manifest` saat route sudah
dihubungkan ke platform router.

Manifest saat module tidak installed:

```json
{
  "module": "GAME",
  "enabled": false,
  "games": []
}
```

Manifest adalah satu-satunya request bootstrap yang boleh terjadi sebelum Game
diketahui aktif. Bundle per game, CSS, artwork, audio, dan asset lain tidak boleh
dipanggil saat `enabled=false`.

Semua route Game selain manifest harus fail closed dengan
`MODULE_NOT_INSTALLED` jika Tenant tidak memasang `GAME`.

## Legacy Roda Puter

`src/roda-puter.js` dan tabel `roda_puter_*` adalah compatibility surface sampai
migration/adaptor terpisah selesai. Pondasi V1 tidak mengubah probability,
official spin, Voucher issuance, atau redemption existing.

Roda Puter baru boleh disebut migrated setelah:

1. campaign/outcome existing punya mapping lossless ke `game_*`;
2. Voucher direct dependency diganti provider adapter;
3. UI setting pindah dari Voucher ke Game;
4. customer code lazy-load dari Game manifest;
5. tests membuktikan Tenant tanpa Game tetap berfungsi.

## Test requirements

- migration chain clean;
- satu Tenant tidak dapat dua periode GAME terbuka sekaligus;
- closed entitlement history tidak dapat diedit/dihapus;
- tidak ada Tenant yang otomatis di-enroll oleh migration;
- `game_*` schema tidak memiliki FK/column Voucher Master atau Product;
- Game source tidak mengimpor provider hadiah sibling;
- module disabled path tidak query campaign Game.

## DOC-IMPACT

**REQUIRED** bila entitlement semantics, Game/provider boundary, outcome schema,
atau lazy-load rule berubah.
