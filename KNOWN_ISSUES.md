# Known Issues — Prototype Leker

## Duplicate cashier tabs can share an initial session token

A browser tab duplicated from an already logged-in cashier tab can begin with a copied `sessionStorage` token. If one of those tabs logs out, the server deletes that token and another tab still using the same token can receive `401 CASHIER_SESSION_EXPIRED` and require login again.

This issue is separate from periodic polling. Removing polling reduces unnecessary requests but does not change server-side logout semantics.

**Current recovery:** close stale duplicate tabs and login again on the tab that will be used.

**Future fix candidate:** use a multi-tab-safe cashier session strategy that preserves explicit logout semantics without one copied tab unexpectedly invalidating another active tab. This requires its own focused change and tests.

## DOC-IMPACT

**REQUIRED** — unresolved multi-tab session behavior is explicitly tracked and must not be reported as fixed by the polling-removal change.
