import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migration = readFileSync(new URL('../migrations/0046_tenancy_ledger_entity_column.sql', import.meta.url), 'utf8');

function ledgerFixture({ missingEntity = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE entities (id TEXT PRIMARY KEY);
    CREATE TABLE stores (
      id TEXT PRIMARY KEY,
      entity_id TEXT REFERENCES entities(id)
    );
    CREATE TABLE chart_of_accounts (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id)
    );

    INSERT INTO entities (id) VALUES ('entity_a'), ('entity_b');
    INSERT INTO stores (id, entity_id) VALUES
      ('store_a', 'entity_a'),
      ('store_b', ${missingEntity ? 'NULL' : "'entity_b'"});
    INSERT INTO chart_of_accounts (id, store_id) VALUES
      ('account_a', 'store_a'),
      ('account_b', 'store_b');

    CREATE TABLE accounting_journal_headers (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      journal_number TEXT NOT NULL,
      business_date TEXT NOT NULL CHECK (business_date GLOB '????-??-??'),
      occurred_at TEXT NOT NULL,
      currency_code TEXT NOT NULL DEFAULT 'IDR' CHECK (currency_code = 'IDR'),
      source_system TEXT NOT NULL,
      source_reference_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      description TEXT NOT NULL,
      journal_status TEXT NOT NULL DEFAULT 'POSTED' CHECK (journal_status = 'POSTED'),
      posted_at TEXT NOT NULL,
      reversal_of_journal_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (store_id) REFERENCES stores(id),
      FOREIGN KEY (reversal_of_journal_id) REFERENCES accounting_journal_headers(id) ON DELETE RESTRICT,
      UNIQUE (store_id, journal_number),
      UNIQUE (store_id, idempotency_key)
    );

    CREATE INDEX idx_accounting_journal_headers_store_date
      ON accounting_journal_headers(store_id, business_date DESC, journal_number DESC);
    CREATE INDEX idx_accounting_journal_headers_source
      ON accounting_journal_headers(store_id, source_system, source_reference_id);

    CREATE TRIGGER trg_accounting_posted_header_immutable_update
    BEFORE UPDATE ON accounting_journal_headers
    BEGIN
      SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
    END;

    CREATE TRIGGER trg_accounting_posted_header_immutable_delete
    BEFORE DELETE ON accounting_journal_headers
    BEGIN
      SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
    END;

    CREATE TABLE accounting_journal_lines (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      journal_id TEXT NOT NULL,
      line_number INTEGER NOT NULL CHECK (line_number > 0),
      account_id TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('DEBIT', 'CREDIT')),
      amount_scaled INTEGER NOT NULL CHECK (amount_scaled > 0),
      is_system_generated INTEGER NOT NULL DEFAULT 0 CHECK (is_system_generated IN (0, 1)),
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      choice_group_code TEXT NOT NULL DEFAULT '',
      choice_option_code TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (store_id) REFERENCES stores(id),
      FOREIGN KEY (journal_id) REFERENCES accounting_journal_headers(id) ON DELETE RESTRICT,
      FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
      UNIQUE (store_id, journal_id, line_number)
    );

    CREATE INDEX idx_accounting_journal_lines_account
      ON accounting_journal_lines(store_id, account_id, journal_id);

    CREATE TRIGGER trg_accounting_journal_line_scope_insert
    BEFORE INSERT ON accounting_journal_lines
    WHEN NOT EXISTS (
           SELECT 1 FROM accounting_journal_headers h
           WHERE h.id = NEW.journal_id AND h.store_id = NEW.store_id
         )
       OR NOT EXISTS (
           SELECT 1 FROM chart_of_accounts a
           WHERE a.id = NEW.account_id AND a.store_id = NEW.store_id
         )
    BEGIN
      SELECT RAISE(ABORT, 'ACCOUNTING_JOURNAL_SCOPE_MISMATCH');
    END;

    CREATE TRIGGER trg_accounting_posted_line_immutable_update
    BEFORE UPDATE ON accounting_journal_lines
    BEGIN
      SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
    END;

    CREATE TRIGGER trg_accounting_posted_line_immutable_delete
    BEFORE DELETE ON accounting_journal_lines
    BEGIN
      SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
    END;

    CREATE TABLE accounting_bridge_deliveries (
      id TEXT PRIMARY KEY,
      journal_id TEXT REFERENCES accounting_journal_headers(id) ON DELETE RESTRICT
    );
    CREATE TABLE approval_permits (
      id TEXT PRIMARY KEY,
      original_journal_id TEXT REFERENCES accounting_journal_headers(id) ON DELETE RESTRICT,
      reversal_journal_id TEXT REFERENCES accounting_journal_headers(id) ON DELETE RESTRICT
    );

    CREATE TABLE inventory_stock_balances (
      store_id TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (store_id, product_id),
      FOREIGN KEY (store_id) REFERENCES stores(id)
    );
    CREATE TABLE inventory_ledger_entries (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (store_id) REFERENCES stores(id)
    );
    CREATE TABLE stock_movements (
      id TEXT PRIMARY KEY,
      source_key TEXT NOT NULL UNIQUE,
      store_id TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (store_id) REFERENCES stores(id)
    );
  `);

  sqlite.exec(`
    INSERT INTO accounting_journal_headers (
      id, store_id, journal_number, business_date, occurred_at, source_system,
      source_reference_id, correlation_id, idempotency_key, description, posted_at,
      reversal_of_journal_id
    ) VALUES
      ('journal_a', 'store_a', 'J-1', '2026-08-22', '2026-08-22T10:00:00Z', 'POS',
       'sale_a', 'correlation_a', 'idempotency_a', 'Sale A', '2026-08-22T10:00:00Z', NULL),
      ('journal_a_reversal', 'store_a', 'J-2', '2026-08-22', '2026-08-22T10:05:00Z', 'POS',
       'void_a', 'correlation_a_reversal', 'idempotency_a_reversal', 'Reverse Sale A', '2026-08-22T10:05:00Z', 'journal_a'),
      ('journal_b', 'store_b', 'J-3', '2026-08-22', '2026-08-22T11:00:00Z', 'POS',
       'sale_b', 'correlation_b', 'idempotency_b', 'Sale B', '2026-08-22T11:00:00Z', NULL);

    INSERT INTO accounting_journal_lines (
      id, store_id, journal_id, line_number, account_id, side, amount_scaled,
      is_system_generated, description, choice_group_code, choice_option_code
    ) VALUES
      ('line_a', 'store_a', 'journal_a', 1, 'account_a', 'DEBIT', 1000000, 0, 'Line A', 'PAYMENT', 'CASH'),
      ('line_a_reversal', 'store_a', 'journal_a_reversal', 1, 'account_a', 'CREDIT', 1000000, 1, 'Reverse Line A', '', ''),
      ('line_b', 'store_b', 'journal_b', 1, 'account_b', 'DEBIT', 2000000, 0, 'Line B', '', '');

    INSERT INTO accounting_bridge_deliveries (id, journal_id) VALUES ('delivery_a', 'journal_a');
    INSERT INTO approval_permits (id, original_journal_id, reversal_journal_id)
    VALUES ('permit_a', 'journal_a', 'journal_a_reversal');

    INSERT INTO inventory_stock_balances (store_id, product_id, quantity, updated_at) VALUES
      ('store_a', 1, 7, '2026-08-22T10:00:00Z'),
      ('store_b', 2, 9, '2026-08-22T11:00:00Z');
    INSERT INTO inventory_ledger_entries (id, store_id, note) VALUES
      ('inventory_a', 'store_a', 'A'),
      ('inventory_b', 'store_b', 'B');
    INSERT INTO stock_movements (id, source_key, store_id, note) VALUES
      ('movement_a', 'source_a', 'store_a', 'A'),
      ('movement_b', 'source_b', 'store_b', 'B');
  `);

  return sqlite;
}

function columnsOf(sqlite, table) {
  return sqlite.prepare(`PRAGMA table_info("${table}")`).all().map(row => row.name);
}

function schemaNames(sqlite, type, table) {
  return sqlite
    .prepare(`SELECT name FROM sqlite_schema WHERE type = ? AND tbl_name = ? AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name`)
    .all(type, table)
    .map(row => row.name);
}

test('0046 backfills Entity on all five ledgers without rewriting posted journal facts', () => {
  const sqlite = ledgerFixture();
  const headerColumnsBefore = columnsOf(sqlite, 'accounting_journal_headers');
  const lineColumnsBefore = columnsOf(sqlite, 'accounting_journal_lines');
  const headersBefore = sqlite.prepare(`SELECT * FROM accounting_journal_headers ORDER BY id`).all();
  const linesBefore = sqlite.prepare(`SELECT * FROM accounting_journal_lines ORDER BY id`).all();

  sqlite.exec(migration);

  assert.equal(sqlite.prepare(`PRAGMA foreign_keys`).get().foreign_keys, 1);
  assert.deepEqual(sqlite.prepare(`PRAGMA foreign_key_check`).all(), []);

  for (const table of [
    'accounting_journal_headers',
    'accounting_journal_lines',
    'inventory_stock_balances',
    'inventory_ledger_entries',
    'stock_movements'
  ]) {
    assert.equal(columnsOf(sqlite, table).at(-1), 'entity_id');
    assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE entity_id IS NULL`).get().n, 0);
    assert.equal(
      sqlite
        .prepare(`SELECT COUNT(*) AS n FROM ${table} t JOIN stores s ON s.id = t.store_id WHERE t.entity_id <> s.entity_id`)
        .get().n,
      0
    );
  }

  assert.deepEqual(columnsOf(sqlite, 'accounting_journal_headers'), [...headerColumnsBefore, 'entity_id']);
  assert.deepEqual(columnsOf(sqlite, 'accounting_journal_lines'), [...lineColumnsBefore, 'entity_id']);

  assert.deepEqual(
    sqlite.prepare(`
      SELECT id, store_id, journal_number, business_date, occurred_at, currency_code,
             source_system, source_reference_id, correlation_id, idempotency_key,
             description, journal_status, posted_at, reversal_of_journal_id, created_at
      FROM accounting_journal_headers ORDER BY id
    `).all(),
    headersBefore
  );
  assert.deepEqual(
    sqlite.prepare(`
      SELECT id, store_id, journal_id, line_number, account_id, side, amount_scaled,
             is_system_generated, description, created_at, choice_group_code, choice_option_code
      FROM accounting_journal_lines ORDER BY id
    `).all(),
    linesBefore
  );

  assert.deepEqual(schemaNames(sqlite, 'index', 'accounting_journal_headers'), [
    'idx_accounting_journal_headers_source',
    'idx_accounting_journal_headers_store_date'
  ]);
  assert.deepEqual(schemaNames(sqlite, 'index', 'accounting_journal_lines'), [
    'idx_accounting_journal_lines_account'
  ]);
  assert.deepEqual(schemaNames(sqlite, 'trigger', 'accounting_journal_headers'), [
    'trg_accounting_posted_header_immutable_delete',
    'trg_accounting_posted_header_immutable_update'
  ]);
  assert.deepEqual(schemaNames(sqlite, 'trigger', 'accounting_journal_lines'), [
    'trg_accounting_journal_line_scope_insert',
    'trg_accounting_posted_line_immutable_delete',
    'trg_accounting_posted_line_immutable_update'
  ]);

  assert.deepEqual(
    sqlite.prepare(`SELECT id, journal_id FROM accounting_bridge_deliveries`).all().map(row => [row.id, row.journal_id]),
    [['delivery_a', 'journal_a']]
  );
  assert.deepEqual(
    sqlite
      .prepare(`SELECT id, original_journal_id, reversal_journal_id FROM approval_permits`)
      .all()
      .map(row => [row.id, row.original_journal_id, row.reversal_journal_id]),
    [['permit_a', 'journal_a', 'journal_a_reversal']]
  );

  assert.throws(
    () => sqlite.prepare(`UPDATE accounting_journal_headers SET description = 'changed' WHERE id = 'journal_a'`).run(),
    /POSTED_JOURNAL_IMMUTABLE/
  );
  assert.throws(
    () => sqlite.prepare(`UPDATE accounting_journal_lines SET description = 'changed' WHERE id = 'line_a'`).run(),
    /POSTED_JOURNAL_IMMUTABLE/
  );
});

test('0046 fails closed when a ledger row has no books-owner entity', () => {
  const sqlite = ledgerFixture({ missingEntity: true });
  assert.throws(() => sqlite.exec(migration), /CHECK constraint failed|constraint/i);
});
