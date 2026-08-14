PRAGMA foreign_keys = ON;

-- Reserved migration number. Live D1 rejects direct Product Master inserts even
-- though the same schema passes fresh-database validation. Raw materials are
-- therefore created through the authenticated Product Master API/UI so all
-- live validation, defaults, Accounting mapping, and Warehouse hooks run.
SELECT 1;
