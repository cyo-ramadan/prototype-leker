# ADR-003 — Branch Admin, Drawer Reporting, and Owner-Controlled Customer Sharing

Status: ACCEPTED for Prototype Leker

## Context

Prototype Leker already separates operational data by `store_id`, has Owner above branches, cashier accounts bound to one branch, one open cash drawer per branch, and optional customer identity. The next prototype stage requires a clearer branch-admin workspace, a detailed cash-drawer shift report visible to branch management and cashiers, and an Owner-controlled exception that allows selected branches to share customer identity for a future loyalty point system.

The detailed drawer example supplied by Bos Cyo includes cash/non-cash sales, purchases, operating expenses, promotions, cooking, stock, stock adjustment, cash-in, shift metadata, opening/closing amounts, incentive, and the cashier responsible for opening the drawer. Some of those facts do not yet have canonical operational modules in this prototype.

## Decision

1. `/s/<KODE>/admin` remains the branch-management workspace. It is currently authorized by the existing Owner management session. This ADR does not invent or introduce a separate Admin account role.
2. Branch Admin navigation exposes operational areas including Data Barang, Pelanggan, Create Kasir/Kasir, Akuntansi, Laporan, and Detail Laci, while existing Toko, Kategori, and Supplier capabilities remain available.
3. Akuntansi and Laporan are visible placeholders only. No journal mapping, chart of accounts, posting rule, or financial interpretation is invented. Accounting remains a separate domain concern.
4. Detail Laci is readable by branch management and authenticated cashiers only for their own branch context. Server-side `store_id` filtering is mandatory for drawer list and drawer detail endpoints.
5. A drawer report includes drawer ID, shift label, opening/closing timestamp, opening/closing amount, responsible cashier, incentive amount, closing note, cash sales, non-cash sales, cash purchases, non-cash purchases, cash operating expenses, non-cash operating expenses, other cash income, and drawer cash calculation.
6. Existing transactions created before payment-channel support are classified as `CASH` for backward compatibility. New sale, purchase, and expense records accept the explicit channel `CASH` or `NON_CASH`.
7. Promotion, cooking, stock remaining, and stock adjustment sections are rendered in the drawer report but remain empty until their canonical promotion/inventory/production facts exist. The prototype must not infer official stock movement or valuation from drawer transactions.
8. The existing one-open-drawer-per-branch rule remains unchanged. Multiple cashiers may view branch data, but only the cashier who opened the active drawer receives drawer write authority.
9. Owner may create a **Customer Sharing Group** and select member branches. A branch may belong to at most one sharing group at a time.
10. Customer sharing changes only the authorized customer identity scope. Products, categories, suppliers, cashier accounts, orders, sales, purchases, expenses, drawer sessions, and other operational data remain branch-isolated.
11. A customer retains a home `store_id`. When branches share customers, an authenticated customer from any member branch may be resolved and used at another member branch. Customer creation and credential updates prevent duplicate usernames inside one active sharing scope.
12. Customer sharing is enforced server-side. Client-selected branch identity alone never authorizes cross-branch customer access.
13. A `customer_point_ledger` is added as a future loyalty foundation with signed point movement, activity type, source branch, optional sharing group, and references. No earning ratio, redemption conversion, expiry, promotion multiplier, or adjustment authorization is activated until Bos Cyo defines those business rules.
14. Owner/Staff access identities and Customer identities remain separate domains. Owner, future Admin accounts, and Cashier accounts are never stored in Master Pelanggan.

## Compatibility

- Existing branch operational rows keep their `store_id` and remain isolated.
- Existing drawer records gain empty shift/closing-note values and zero incentive.
- Existing sale, purchase, and expense rows default to `CASH` so historical rows remain reportable.
- Existing customers remain owned by their original home branch. No customer row is physically copied or merged when sharing is enabled.
- Existing guest checkout remains supported.

## Security and Data Integrity

- Owner authorization is required to configure customer-sharing membership.
- Branch management drawer APIs resolve a selected branch and filter all drawer reads by that branch.
- Cashier drawer APIs derive the branch from the cashier session and never accept another branch as an authority source.
- Customer session resolution is limited to the selected branch or its explicit active sharing group.
- A branch cannot simultaneously belong to multiple customer-sharing groups.
- Sharing-group activation rejects existing duplicate customer usernames across selected branches to avoid ambiguous customer login.

## Recovery

Migration `0008_branch_admin_drawer_customer_sharing.sql` is additive. If remote migration or deploy fails, stop promotion. Restore the prototype D1 database through the established Cloudflare D1 backup/Time Travel procedure before retrying a corrected migration. Do not manually apply partial schema fragments to guess migration state.

Disabling a customer-sharing group removes its memberships and returns its branches to branch-only customer scope. It does not delete customers, operational transactions, or point-ledger history.

## Follow-up Decisions Still Required

The following business rules remain intentionally undefined:

- loyalty point earning rate;
- point redemption value and minimum redemption;
- expiry policy;
- promotion effects on points;
- point reversal/correction authority;
- canonical promotion, cooking/production, official stock, and stock-adjustment modules;
- a separate Admin account role and its permission matrix, if required.
