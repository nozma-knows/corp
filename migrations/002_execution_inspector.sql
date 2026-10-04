CREATE TABLE workers (
    id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);
CREATE TABLE workflow_runs (
    id TEXT PRIMARY KEY,
    workflow TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('completed', 'blocked')),
    order_id TEXT REFERENCES orders(id),
    product_id TEXT REFERENCES products(id),
    engine TEXT NOT NULL CHECK (engine = 'scripted'),
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_workflow_runs_created ON workflow_runs(created_at);
CREATE TABLE execution_spans (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES workflow_runs(id),
    parent_id TEXT REFERENCES execution_spans(id),
    worker_id TEXT NOT NULL REFERENCES workers(id),
    worker_name TEXT NOT NULL,
    position TEXT NOT NULL,
    function_id TEXT NOT NULL,
    function_title TEXT NOT NULL,
    engine TEXT NOT NULL CHECK (engine IN ('scripted', 'control')),
    provider TEXT NOT NULL CHECK (provider = 'local'),
    destination TEXT NOT NULL,
    model TEXT,
    status TEXT NOT NULL CHECK (status IN ('completed', 'blocked')),
    input_json TEXT NOT NULL,
    output_json TEXT NOT NULL,
    duration_ms REAL NOT NULL CHECK (duration_ms >= 0),
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_micro_usd INTEGER NOT NULL CHECK (cost_micro_usd = 0),
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_execution_spans_run ON execution_spans(run_id);
CREATE INDEX idx_execution_spans_worker ON execution_spans(worker_id);
CREATE TRIGGER spans_no_update BEFORE UPDATE ON execution_spans BEGIN SELECT RAISE(ABORT, 'execution history is append-only'); END;
CREATE TRIGGER spans_no_delete BEFORE DELETE ON execution_spans BEGIN SELECT RAISE(ABORT, 'execution history is append-only'); END;
