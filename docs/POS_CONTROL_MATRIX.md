# POS Control Matrix

Snapshot audit: `main@0f6f57720bd3c2fceef8348999673d1a408c35c6` (2026-08-12).

| UI/control | Business intent | Related state/control | Transition | Permission | Persistence | Empty/loading/error | Evidence/status |
|---|---|---|---|---|---|---|---|
| Customer menu `+/-`, cart, checkout | Guest/customer order capture | store menu, customer identity | draft → `NEW` | public; identity server-derived | orders + order items | empty cart disables checkout; request error retained | Existing, tested |
| Pesanan Saya | Track customer order | order lifecycle | `NEW→PREPARING→READY→COMPLETED`; early reject | customer session or device-local guest IDs | orders | empty and auth errors rendered | Existing, tested |
| Kasir Penjualan/Menu search | One canonical sale draft | product master + drawer owner | draft → sale | cashier owning open drawer | sales + sale_items | empty draft/readonly disabled | Existing, tested |
| Payment method | Classify tender | sale/purchase/expense | `CASH` or `NON_CASH` | drawer owner | transaction payment_method | defaults to CASH for legacy | Existing, tested |
| Split tender | Multiple tenders for one sale | payment configuration | not enabled | cashier | none | `NEEDS_CONFIGURATION` | Deferred: tender allocation contract absent |
| Buka/Tutup Laci | Shift cash accountability | terminal + cashier | OPEN → CLOSED | cashier; one writer/store | cash_drawer_sessions | stable drawer ownership errors | Existing; terminal identity added |
| Beli Bahan/Pengeluaran/Pendapatan Lain | Drawer movements | supplier/payment/mapping | create movement | drawer owner | domain table + outbox atomically | validation and mapping status | Connected to Accounting outbox |
| Order Terima/Buat/Jadi/Tolak | Fulfil customer queue | status controls | exact ADR-007 transitions | drawer owner | orders | terminal states cannot mutate | Existing, tested |
| Refund/Void/Reversal | Reverse completed financial/stock facts | original sale, approvals, warehouse/accounting | not enabled | undefined | none | `NEEDS_CONFIGURATION` | Deferred: policy/authorization absent; mapping slots provided |
| Struk Terakhir | Proof of sale | canonical sale response | sale → printable receipt | cashier | sale is source; last receipt held in active session | disabled before first sale; popup-block warning | Implemented; printer profile still configurable |
| Detail Laci | Shift reconciliation | sales/movements | read-only report | admin/cashier same store | query facts | explicit empty canonical sections | Existing, tested |
| Akuntansi: tambah akun | COA group/subaccount | parent/type/postable | create account | Owner/Admin same store | accounting_accounts | invalid parent/type rejected | Implemented |
| Akuntansi: mapping transaksi | Map type + payment to debit/credit | postable active accounts | NEEDS_CONFIGURATION → ACTIVE | Owner/Admin same store | accounting_transaction_mappings | fails closed | Implemented |
| Bridge settings | Preserve tenant/outlet/terminal/shift/warehouse identity | MAXI module pins | config update | Owner/Admin same store | pos_integration_settings | missing terminal rejected | Implemented |
| Warehouse item mapping | Map POS product to warehouse item | product + warehouse | NEEDS_MAPPING → ACTIVE | Owner/Admin same store | warehouse_item_mappings | missing mapping visible | Implemented |
| Laporan integrasi | Operational readiness | outbox status | pending/mapping/dispatched/failed | Owner/Admin same store | integration_outbox | honest empty state | Implemented |
| Attendance/presensi | Staff attendance | none | none | none | none | explicit out of scope | Out of scope |

## Audit conclusion

No dead `href="#"` control was found. Disabled cashier actions are intentional state guards, not dead buttons. The Accounting and Reports placeholders were the material empty controls and are now replaced with configuration/readiness panels. Pricing, tax, discount, BOM/recipe, costing, split tender and reversal rules remain fail-closed because no canonical business contract exists.
