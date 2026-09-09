# Store Onboarding from Existing Store Template

Status: ACTIVE
Canonical detailed procedure for Prototype Leker store cloning. `RUNBOOK.md` is the canonical operational index and points here for the full allowlist/denylist.

## Purpose

Use this runbook when Bos Cyo asks for a new operational Store to start from an existing Store's current master/configuration, for example: "buat gerai baru, samakan dengan Pendem".

The template is evaluated from the database **when the onboarding migration runs**. Do not re-copy old seed migrations by hand and do not assume that Git history still matches the template Store's current master state.

For the 2026-09-08 batch, the template is `store_pendem` and the new Stores are `SUGIONO`, `GENENGAN`, `NGIJO`, `BEJI`, `TLEKUNG`, `DERMO`, and `KALIURANG` (`migrations/0081_kpm_stores_from_pendem_template.sql`). Ordinal `0080` is already owned by `0080_game_module_foundation.sql` on current `main`.

## Entity and onboarding actor

A Store is operational scope. Entity is the books/stock owner (ADR-030).

When Bos Cyo says a new Store is in the **same Entity as the template**, resolve `entity_id` from the template Store at migration execution time and assign that exact value to the new Store. Do not:

- invent a new Entity id;
- rename the template Entity;
- change the template Store's `entity_id`;
- create or rewrite `entity_tenancy` merely to add another Store under an existing Entity.

If the template Store is missing or has no `entity_id`, fail closed before creating the new Store.

If Bos Cyo explicitly requests a **new Entity**, stop and follow the identity-tenancy ownership/governance path instead of this same-Entity procedure.

For the 2026-09-08 KPM batch, Bos Cyo explicitly designates Entity Admin Rika as the onboarding actor:

- role: `ENTITY_ADMIN`;
- id: `entity_admin_rika_pilot`;
- display: Rika (Akuntan).

The migration must fail closed unless that Entity Admin is active and belongs to the exact current Entity of `store_pendem`. The `stores` table currently has no creator column, so creator provenance cannot be stored on the Store row itself. New configuration/master rows created by the onboarding that expose `created_by_*`/`enabled_by_*` provenance fields use Rika's Entity Admin identity rather than inventing a system user.

## What is cloned

Clone current store-scoped **master/configuration** needed for the new Store to behave like the template:

1. Store operating settings: edition, warehouse-enabled flag, and reusable branding/logo. Store id, code, name, and physical address remain the new Store's own identity.
2. Master Barang commercial and operational fields: name, category, display/order state, active state, image/emoji, master purchase price, master sale price, points policy, production mode, recipe-link policy, and stock-tracking policy.
3. Item Types / operational item classification and custom Units.
4. Categories.
5. Suppliers and legacy Contacts master.
6. Product Kinds / Jenis Barang.
7. Current **ACTIVE** manufacturing Recipe/BOM and components. Archived recipe revisions stay with the source as historical master provenance.
8. Product Groups and their product membership.
9. Current Accounting configuration: Chart of Accounts, Payment Methods, Transaction Categories, Product-Kind/Account mapping, Accounting Choice Groups/Options, and Journal Rules. References are remapped by code/natural key to target-local ids. Provisioned system Chart-of-Accounts rows keep their canonical ids, for example `coa_<store>_1201`, because active provisioning triggers still resolve those identities. Existing rows are aligned to the template by account `code`; only template-only custom accounts receive new clone-local ids.
10. Current Warehouse master and Stock Opname settings. Principal-specific Warehouse Access is not inherited.
11. Cost Types and Cost Masters. Deprecated `accounting_component_rule_id` compatibility evidence is reset to `NULL`; it is not current Accounting authority.
12. Customer Sharing Group membership only, so the new Store participates in the same sharing policy. Customer rows and points are not copied.
13. Store approval policy (`auto_permit_enabled`). When the cloned policy is enabled, the onboarding actor is recorded as the enabler instead of copying the template admin's historical identity.
14. Active Voucher Master configuration and eligible products. Usage counters reset for the new Store.
15. Active Roda Puter campaign/reward configuration. Official spins are not copied.
16. A dedicated Admin Gerai account when Bos Cyo requests one. Store Admin credentials are new identities, never a copied template session/account.

The Game module foundation introduced by migration `0080_game_module_foundation.sql` is provider-neutral and does not auto-enroll existing Tenants or create Pendem Game campaign config. This KPM onboarding therefore does not invent Game configuration. `game_plays` is treated as runtime history and must start empty. If a future active Store template has canonical Game configuration that Bos Cyo wants cloned, add that table family explicitly to this allowlist before reuse.

### Identifier remapping

Never copy store-local foreign-key ids directly.

Resolve/remap by a stable natural key wherever available:

- Unit → `code`
- Item Type → `code`
- Product Kind → `code`
- Chart of Accounts → `code`, while preserving an already provisioned canonical target id
- Payment Method → `code`
- Transaction Category → `code`
- Choice Group → `code`
- Warehouse → `code`
- Cost Type → `code`

Products use globally scoped INTEGER ids in the prototype. Allocate new ids above the current maximum and keep a temporary source→target product map inside the migration. Use that map for Recipe/BOM, Product Group, Voucher, and Roda Puter references.

Temporary mapping/helper tables must be dropped before migration completion.

### Why provisioned COA ids must be preserved

Active repository triggers still contain canonical account identity references such as `coa_<store>_1201`, `coa_<store>_1301`, `coa_<store>_4101`, and `coa_<store>_5101`. A clone migration must not delete those provisioned rows and recreate the same account codes under unrelated ids. Doing so can make a later CASH or Product Kind insert fail with a foreign-key/scope guard even when the account code exists.

For template cloning:

1. let normal Store provisioning create current system accounts;
2. keep those target ids;
3. update their business configuration from the template by `code`;
4. insert only template account codes that are absent from the target;
5. run `PRAGMA foreign_key_check` and a post-clone trigger smoke test before PASS.

Changing the global Accounting trigger/id architecture is a separate governed task, not a shortcut inside Store onboarding.

## What must start fresh

Do **not** clone business facts, history, security sessions, or balances from the template:

- customers and registration requests;
- cashiers and employees;
- Store Admin sessions, cashier sessions, Owner sessions;
- cash drawer sessions and drawer reports;
- orders and order status history;
- sales and sale items;
- purchases and purchase items;
- expenses and other income;
- approval requests, permits, and approval history;
- Accounting journals, journal lines, posting/backlog/reconciliation facts;
- stock balances/opening balances;
- inventory ledger entries and stock movements;
- production runs and production run components;
- average-cost/HPP snapshots and historical valuation;
- voucher instances/distributions/redemptions;
- official Roda Puter spins;
- Game plays and other append-only Game runtime facts;
- point ledger/activity;
- Warehouse Access tied to specific admins/cashiers;
- audit/debug logs and any other append-only/runtime fact.

## Costing and stock reset rule

A new Store starts with no physical opening quantity and no historical valuation unless Bos Cyo explicitly supplies an approved opening-stock migration.

For cloned Product Master rows:

- `purchase_price` follows the template Master Barang;
- `price` follows the template Master Barang;
- `average_cost = 0`;
- `last_purchase_price = 0`;
- `cost_updated_at = NULL`;
- `last_purchase_at = NULL`;
- no stock movement/balance is created.

This prevents a new Store with zero stock history from inheriting a fake historical HPP or stock value.

## Promotion reset rule

Voucher/Roda Puter configuration can be cloned, while consumption facts reset:

- Voucher Master dates, quota, active flag, and eligible products follow the template configuration;
- `redeemed_count` starts at `0` for the new Store;
- no Voucher Instance or redemption is copied;
- only active Roda Puter campaign/rewards are cloned;
- no official spin is copied.

If a future promotion schema changes these semantics, update this runbook and its migration test in the same changeset before reusing the procedure.

## Credentials

For a new Store Admin:

1. create a unique username for that Store;
2. hash the plaintext password using the repository's canonical SHA-256 credential convention;
3. commit only the hash;
4. never place plaintext credentials in a migration, code comment, test, README, runbook, PR body, or GitHub Issue;
5. deliver plaintext credentials directly to Bos Cyo after deployment is verified live.

## Required migration guards

A template-clone migration must fail closed unless all applicable checks hold:

- template Store exists and has an Entity;
- designated onboarding actor exists, is active, and belongs to that same Entity when an actor is required;
- every requested Store exists exactly once;
- every new Store has the requested template Entity relation;
- edition/warehouse mode matches the intended template policy;
- every template Chart-of-Accounts code resolves in every target without destroying canonical provisioned system ids;
- Product Master count matches the template;
- active Recipe/BOM count matches the template;
- requested Admin Gerai accounts exist;
- new product historical costing fields are reset;
- customers/cashiers/drawers/orders/sales/purchases/expenses remain empty;
- stock balances/movements remain empty;
- production runs remain empty;
- journals remain empty;
- approval history remains empty;
- Voucher runtime facts, official Roda Puter spins, and Game play facts remain empty.

Add a full-migration-chain regression test. Static SQL inspection alone is not sufficient. The regression must include `PRAGMA foreign_key_check = zero rows` and at least one post-onboarding trigger smoke test that creates a new Product Kind and proves its Accounting mapping still resolves the target Store's canonical account ids.

## Deployment procedure

1. Read `CLAUDE.md`, `MODULE_OWNERSHIP.md`, ADR-030, current state/pitfalls, this runbook, and relevant schema migrations.
2. Confirm Bos Cyo's requested Store ids/codes/names, template Store, Entity relationship, onboarding actor if applicable, and opening-stock decision.
3. For reuse, start from this allowlist/denylist and inspect only migrations added after the last reviewed migration in this procedure for new/changed store-scoped tables. Do not redo the entire historical schema research unless the canonical model itself changed.
4. Run baseline tests/checks or verify the exact baseline commit's required CI checks are green.
5. Prepare the complete migration, regression test, and DOC-IMPACT documentation before publishing a feature branch.
6. Because feature-branch pushes can hit production D1, publish the complete change atomically in one Git ref update. Never push a half-written migration.
7. Require repository `Check & Test` success.
8. Require canonical Cloudflare Workers build/deploy success. The production road remains `npm run deploy`, never direct `npx wrangler deploy`.
9. Validate the created Store rows and representative live application routes/logins.
10. Only then report `PASS` and send requested plaintext credentials directly to Bos Cyo.

## Rollback / recovery

This onboarding is additive for new Stores, but it can still write substantial master/config data. Use the canonical D1 Time Travel checkpoint captured by the deploy road as the rollback anchor if migration/deployment validation fails.

Do not manually delete a partial Store/config graph in production as an ad-hoc rollback. Correct the migration or restore the checkpoint through the governed deployment/recovery procedure.

## DOC-IMPACT

**REQUIRED.** Store-template onboarding is a repeatable operational procedure. Any future schema change that adds/removes a store-scoped master/config table, changes canonical provisioned ids, or changes what counts as a business fact must update this runbook and the clone regression test in the same changeset.