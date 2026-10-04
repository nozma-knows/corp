"""Durable execution spans and truthful routing/usage summaries."""

import json
import time
import uuid

from .registry import FUNCTIONS, FUNCTION_BY_ID, WORKERS, WORKER_BY_ID
from .treasury import DomainError


def initialize_workers(connection):
    connection.executemany("INSERT OR IGNORE INTO workers(id) VALUES (?)", [(worker["id"],) for worker in WORKERS])


class RunTrace:
    def __init__(self, connection, product_id: str, now: int, *, blocked: bool = False):
        self.connection, self.now = connection, now
        self.id = str(uuid.uuid4())
        self.stack, self.records = [], []
        connection.execute("INSERT INTO workflow_runs VALUES (?, 'digital_sale', ?, NULL, ?, 'scripted', ?)", (self.id, "blocked" if blocked else "completed", product_id, now))

    def _insert(self, span_id, parent, function, inputs, output, duration, status="completed"):
        worker = WORKER_BY_ID[function["worker_id"]]
        self.connection.execute("INSERT INTO execution_spans VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', 'local-process', NULL, ?, ?, ?, ?, NULL, NULL, 0, ?)",
                                (span_id, self.id, parent, worker["id"], worker["name"], worker["position"], function["id"], function["title"], function["engine"], status, json.dumps(inputs), json.dumps(output), duration, self.now))

    def stage(self, function_id, inputs, operation):
        function = FUNCTION_BY_ID[function_id]
        worker = WORKER_BY_ID[function["worker_id"]]
        enabled = self.connection.execute("SELECT enabled FROM workers WHERE id = ?", (worker["id"],)).fetchone()[0]
        record = {"id": str(uuid.uuid4()), "parent": self.stack[-1] if self.stack else None, "function": function,
                  "inputs": inputs, "output": {}, "duration": 0, "status": "completed"}
        self.records.append(record)
        self.stack.append(record["id"])
        start = time.perf_counter_ns()
        try:
            if not enabled:
                raise DomainError(f"{worker['name']} is disabled. Enable this worker before running dependent work.", worker_id=worker["id"], function_id=function_id)
            result = operation()
        except DomainError as exc:
            exc.worker_id = exc.worker_id or worker["id"]
            exc.function_id = exc.function_id or function_id
            exc.trace = self
            record["status"], record["output"] = "blocked", {"reason": str(exc)}
            raise
        finally:
            record["duration"] = (time.perf_counter_ns() - start) / 1_000_000
            self.stack.pop()
        record["output"] = result if isinstance(result, dict) else {"result": "completed"}
        return result

    def finish(self, order_id):
        self.connection.execute("UPDATE workflow_runs SET order_id = ? WHERE id = ?", (order_id, self.id))
        self.flush()

    def flush(self):
        # Completion metadata is buffered within the command transaction. Insert
        # parents before children, then commit immutable records with the outcome.
        for record in self.records:
            self._insert(record["id"], record["parent"], record["function"], record["inputs"], record["output"], record["duration"], record["status"])


def record_blocked(connection, product_id, error, now):
    if not connection.execute("SELECT 1 FROM products WHERE id = ?", (product_id,)).fetchone():
        return
    trace = RunTrace(connection, product_id, now, blocked=True)
    if error.trace:
        trace.records = error.trace.records
        trace.flush()
        return
    function_id = error.function_id if error.function_id in FUNCTION_BY_ID else "authorize_budget"
    trace._insert(str(uuid.uuid4()), None, FUNCTION_BY_ID[function_id], {"product_id": product_id}, {"reason": str(error)}, 0, "blocked")


def snapshot(connection, *, limit=20) -> dict:
    settings = {row["id"]: bool(row["enabled"]) for row in connection.execute("SELECT * FROM workers")}
    counts = {row["worker_id"]: dict(row) for row in connection.execute("SELECT worker_id, COUNT(*) AS executions, COALESCE(SUM(duration_ms), 0) AS duration_ms FROM execution_spans WHERE status = 'completed' GROUP BY worker_id")}
    workers = [{**worker, "enabled": settings[worker["id"]], "execution_count": counts.get(worker["id"], {}).get("executions", 0), "duration_ms": counts.get(worker["id"], {}).get("duration_ms", 0), "function_ids": [f["id"] for f in FUNCTIONS if f["worker_id"] == worker["id"]]} for worker in WORKERS]
    runs = []
    for row in connection.execute("SELECT r.*, p.title AS product_title FROM workflow_runs r JOIN products p ON p.id = r.product_id ORDER BY r.created_at DESC, r.rowid DESC LIMIT ?", (limit,)):
        spans = []
        for span in connection.execute("SELECT * FROM execution_spans WHERE run_id = ? ORDER BY rowid", (row["id"],)):
            item = dict(span)
            item["inputs"] = json.loads(item.pop("input_json"))
            item["outputs"] = json.loads(item.pop("output_json"))
            spans.append(item)
        runs.append({**dict(row), "spans": spans})
    totals = dict(connection.execute("SELECT COUNT(*) AS executions, COALESCE(SUM(duration_ms), 0) AS duration_ms FROM execution_spans").fetchone())
    return {"registry_version": 1, "workers": workers, "functions": FUNCTIONS, "runs": runs, "totals": {**totals, "model_calls": 0, "model_cost_micro_usd": 0, "input_tokens": 0, "output_tokens": 0},
            "routing": [{"function_id": function["id"], "worker_id": function["worker_id"], "engine": function["engine"], "provider": "local", "destination": "local-process", "model": None, "external_inference_enabled": False} for function in FUNCTIONS]}
