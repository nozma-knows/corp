CREATE TABLE company (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mode TEXT NOT NULL CHECK (mode = 'simulation'),
    paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
    auto_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_enabled IN (0, 1)),
    next_tick INTEGER NOT NULL DEFAULT 0,
    reserve_minor INTEGER NOT NULL CHECK (reserve_minor >= 40000),
    action_limit_minor INTEGER NOT NULL CHECK (action_limit_minor > 0),
    daily_limit_minor INTEGER NOT NULL CHECK (daily_limit_minor > 0),
    policy_version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);
CREATE TABLE envelopes (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    budget_minor INTEGER NOT NULL CHECK (budget_minor >= 0)
);
CREATE TABLE commands (
    idempotency_key TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    description TEXT NOT NULL,
    reference TEXT,
    envelope_id TEXT REFERENCES envelopes(id),
    created_at INTEGER NOT NULL
);
CREATE TABLE journal_lines (
    id INTEGER PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES transactions(id),
    account TEXT NOT NULL CHECK (account IN ('cash', 'equity', 'revenue', 'expense')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor != 0)
);
CREATE INDEX idx_journal_lines_transaction ON journal_lines(transaction_id);
CREATE INDEX idx_transactions_created ON transactions(created_at);
CREATE TABLE actions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    envelope_id TEXT NOT NULL REFERENCES envelopes(id),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    status TEXT NOT NULL CHECK (status IN ('reserved', 'completed', 'cancelled')),
    created_at INTEGER NOT NULL,
    completed_at INTEGER
);
CREATE INDEX idx_actions_status ON actions(status);
CREATE TABLE products (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    audience TEXT NOT NULL,
    price_minor INTEGER NOT NULL CHECK (price_minor > 0),
    delivery_cost_minor INTEGER NOT NULL CHECK (delivery_cost_minor > 0),
    color TEXT NOT NULL
);
CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    gross_minor INTEGER NOT NULL CHECK (gross_minor > 0),
    cost_minor INTEGER NOT NULL CHECK (cost_minor > 0),
    status TEXT NOT NULL CHECK (status IN ('delivered', 'refunded')),
    refund_until INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_orders_refund_status ON orders(status, refund_until);
CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    actor TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT NOT NULL,
    reference TEXT,
    created_at INTEGER NOT NULL
);
CREATE TRIGGER transactions_no_update BEFORE UPDATE ON transactions BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER transactions_no_delete BEFORE DELETE ON transactions BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER journal_no_update BEFORE UPDATE ON journal_lines BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER journal_no_delete BEFORE DELETE ON journal_lines BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
