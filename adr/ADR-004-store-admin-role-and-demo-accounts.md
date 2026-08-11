# ADR-004 — Store Admin Role and Prototype Demo Accounts

Status: ACCEPTED for Prototype Leker

## Context

ADR-003 intentionally left a separate Admin account role undefined. Bos Cyo has now explicitly requested two Admin accounts in each prototype branch together with two customer login accounts and two cashier login accounts per branch for testing.

The existing branch workspace already defines the functional surface expected for branch management: store identity, products, categories, suppliers, customers, cashier master, Accounting placeholder, Reports placeholder, and Drawer Detail. Owner remains above branches and controls branch creation plus cross-branch Customer Sharing.

## Decision

1. Introduce `store_admins` and `store_admin_sessions` as internal staff identity tables separate from `customers` and `cashiers`.
2. Each Store Admin belongs to exactly one `store_id`.
3. Store Admin may access the branch-management workspace for its own store and use existing branch-management APIs for store identity, products, categories, suppliers, customers, cashier master, and Drawer Detail.
4. Store Admin may not create, rename, activate/deactivate, or otherwise manage branches through Owner-level branch-management routes.
5. Store Admin may not configure Customer Sharing Groups. Customer Sharing remains Owner-only.
6. Store Admin authorization is checked server-side. A valid Admin token for G001 must be rejected when an admin-management request declares G002 as its branch context.
7. Unified login recognizes `ADMIN` in addition to `OWNER`, `CASHIER`, and `CUSTOMER`. Successful Admin login redirects to `/s/<ADMIN_STORE_CODE>/admin`.
8. Browser storage keeps Admin bearer sessions separate from Owner, Cashier, and Customer sessions.
9. The old prototype Admin PIN remains only as backward-compatible fallback while legacy UI is retired; it is not the identity model for the new Store Admin role.
10. Prototype demo credentials may be seeded through migration with password hashes. These credentials are test fixtures and must not be treated as production security policy.
11. Existing Wowo (G001) and Wiwi (G002) cashier fixtures remain. One additional cashier account is seeded per branch, producing two seeded cashier logins per branch without deleting unrelated/user-created cashier records.
12. Two login-enabled demo customer records and two Store Admin records are seeded per branch. Existing customer records are preserved.

## Permission Boundary

Store Admin can operate only inside its own branch workspace. Owner retains platform-level authority over branch creation and cross-branch sharing configuration. Cashier retains transaction/drawer operational authority. Customer remains customer identity only.

Customer Sharing remains the only explicit branch-data widening rule. A Store Admin may see shared customer scope when its own branch belongs to a Customer Sharing Group, but this does not grant access to another branch's products, staff, drawer, or transactions.

## Compatibility

- Existing Owner login remains unchanged.
- Existing Cashier login remains unchanged.
- Existing Customer login and guest checkout remain unchanged.
- Existing branch-management APIs keep their paths; authorization is widened to the new Store Admin role only when the requested store matches the Admin's assigned store.
- Existing Owner access to all branch workspaces remains valid.
- Existing user-created customers and cashiers are not deleted to force an exact database row count.

## Recovery

Migration `0009_branch_admin_and_demo_accounts.sql` adds Store Admin identity/session tables and deterministic prototype seed accounts. If migration/deploy fails, stop promotion and restore the prototype D1 through the established Cloudflare D1 recovery procedure before retrying a corrected migration.

Application rollback must not assume removing the migration tables is safe once Store Admin sessions have been issued. Roll back code first, invalidate/remove Store Admin sessions if needed, and use D1 recovery for schema rollback rather than ad-hoc destructive SQL.

## Supersession

ADR-004 resolves the ADR-003 follow-up item concerning a separate Admin account role and its permission matrix. All other ADR-003 decisions remain active.
