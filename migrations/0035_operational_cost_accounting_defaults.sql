PRAGMA foreign_keys = ON;

-- Canonical operational composition: selected cost type supplies the Debit
-- component while settlement follows the configured payment method.
INSERT OR IGNORE INTO journal_rules (
  id, store_id, transaction_category_id, label, side,
  source_type, fixed_account_id, is_default, sort_order
)
SELECT 'jrule_' || s.id || '_operational_expense', s.id, tc.id,
       'Beban Operasional', 'DEBIT', 'fixed_account',
       'coa_' || s.id || '_6101', 1, 10
FROM stores s
JOIN transaction_categories tc
  ON tc.store_id = s.id AND tc.code = 'operational';

INSERT OR IGNORE INTO journal_rules (
  id, store_id, transaction_category_id, label, side,
  source_type, is_default, sort_order
)
SELECT 'jrule_' || s.id || '_operational_payment', s.id, tc.id,
       'Pembayaran Operasional', 'CREDIT', 'payment_method', 1, 20
FROM stores s
JOIN transaction_categories tc
  ON tc.store_id = s.id AND tc.code = 'operational';

UPDATE cost_types
SET accounting_component_rule_id = 'jrule_' || store_id || '_operational_expense',
    updated_at = CURRENT_TIMESTAMP
WHERE accounting_component_rule_id IS NULL
  AND EXISTS (
    SELECT 1 FROM journal_rules jr
    WHERE jr.id = 'jrule_' || cost_types.store_id || '_operational_expense'
      AND jr.store_id = cost_types.store_id
      AND jr.side = 'DEBIT'
      AND jr.is_active = 1
  );
