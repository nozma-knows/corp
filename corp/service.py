"""Company commands, idempotency, and a clearly labeled scripted simulator."""

import hashlib
import json
import time
import uuid

from .database import Database
from .inspector import RunTrace, initialize_workers, record_blocked, snapshot as inspector_snapshot
from .registry import AGENT_ROLES, WORKER_BY_ID
from .treasury import DomainError, authorize, balances, envelopes, event, post, scalar
from .workflows import check_delivery, prepare_delivery


ROLES = AGENT_ROLES


class CompanyService:
    def __init__(self, database: Database, clock=time.time):
        self.db, self.clock = database, clock

    def initialize(self):
        self.db.migrate()
        now = int(self.clock())
        with self.db.transaction() as connection:
            initialize_workers(connection)
            if connection.execute("SELECT 1 FROM company").fetchone():
                return
            connection.execute("INSERT INTO company(id, mode, reserve_minor, action_limit_minor, daily_limit_minor, created_at) VALUES (1, 'simulation', 40000, 2500, 4000, ?)", (now,))
            connection.executemany("INSERT INTO envelopes VALUES (?, ?, ?)", [
                ("models_tools_hosting", "Models, tools & hosting", 15000),
                ("brand_store_listings", "Brand & storefront", 10000),
                ("creation_quality", "Products & quality", 10000),
                ("customer_acquisition", "Customer acquisition", 15000),
                ("opportunity_tests", "Opportunity discovery", 10000),
            ])
            connection.executemany("INSERT INTO products VALUES (?, ?, ?, ?, ?, ?)", [
                ("cleaning-kit", "Cleaning business social kit", "Independent cleaning businesses", 2400, 450, "sage"),
                ("service-menu", "Editable service menu", "Local service businesses", 1900, 350, "sand"),
                ("custom-kit", "Customized brand starter", "Small businesses needing customization", 7900, 2000, "lavender"),
            ])
            post(connection, "opening", "Virtual opening capital", [("cash", 100000), ("equity", -100000)], now)
            event(connection, "system", "Treasury", "Company initialized", "$1,000 virtual capital. $400 protected reserve. Real-world execution disabled.", now)

    def state(self):
        now = int(self.clock())
        with self.db.snapshot() as connection:
            result = {"company": balances(connection, now), "envelopes": envelopes(connection), "roles": ROLES,
                      "products": [dict(r) for r in connection.execute("SELECT p.*, COUNT(o.id) AS orders, COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN o.gross_minor ELSE 0 END), 0) - COALESCE(SUM(o.cost_minor), 0) AS contribution_minor FROM products p LEFT JOIN orders o ON o.product_id = p.id GROUP BY p.id ORDER BY p.rowid")],
                      "orders": [dict(r) for r in connection.execute("SELECT o.*, p.title FROM orders o JOIN products p ON p.id = o.product_id ORDER BY o.created_at DESC, o.rowid DESC LIMIT 100")],
                      "actions": [dict(r) for r in connection.execute("SELECT * FROM actions ORDER BY created_at DESC, rowid DESC LIMIT 100")],
                      "events": [dict(r) for r in connection.execute("SELECT * FROM events ORDER BY id DESC LIMIT 100")],
                      "ledger": [], "server_time": now,
                      "capabilities": {"real_world_execution": False, "llm_agents": False, "simulator": "scripted", "profit_target_minor": 1000000}}
            for transaction in connection.execute("SELECT * FROM transactions ORDER BY created_at DESC, rowid DESC LIMIT 100"):
                result["ledger"].append({**dict(transaction), "lines": [dict(r) for r in connection.execute("SELECT account, amount_minor FROM journal_lines WHERE transaction_id = ? ORDER BY id", (transaction["id"],))]})
            result["company"]["order_count"] = scalar(connection, "SELECT COUNT(*) FROM orders")
            result["company"]["refund_count"] = scalar(connection, "SELECT COUNT(*) FROM orders WHERE status = 'refunded'")
            result["company"]["policy_healthy"] = result["company"]["cash_minor"] >= result["company"]["reserve_minor"] + result["company"]["reserved_minor"] + result["company"]["refund_buffer_minor"]
            return result

    def inspector(self):
        with self.db.snapshot() as connection:
            return inspector_snapshot(connection)

    def command(self, key: str, kind: str, payload: dict):
        now = int(self.clock())
        fingerprint = hashlib.sha256(json.dumps([kind, payload], sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        with self.db.transaction() as connection:
            prior = connection.execute("SELECT * FROM commands WHERE idempotency_key = ?", (key,)).fetchone()
            if prior:
                if prior["fingerprint"] != fingerprint:
                    raise DomainError("That idempotency key belongs to a different command.")
                result = json.loads(prior["result_json"])
            else:
                handlers = {"cycle": self._cycle, "pause": self._pause, "automation": self._automation,
                            "reserve": self._reserve, "execute": self._execute, "cancel": self._cancel,
                            "refund": self._refund, "policy": self._policy, "allocations": self._allocations, "worker": self._worker}
                if kind not in handlers:
                    raise DomainError("Unsupported command.", 422)
                connection.execute("SAVEPOINT action")
                try:
                    result = handlers[kind](connection, payload, now)
                except DomainError as exc:
                    # Record a denied decision without committing any partial work.
                    # A retried denial remains a denial after a policy change.
                    connection.execute("ROLLBACK TO action")
                    if kind == "cycle":
                        record_blocked(connection, payload.get("product_id", "cleaning-kit"), exc, now)
                    result = {"_error": {"message": str(exc), "status": exc.status}}
                    event(connection, "blocked", "Treasury", "Action blocked by policy", str(exc), now)
                connection.execute("RELEASE action")
                connection.execute("INSERT INTO commands VALUES (?, ?, ?, ?)", (key, fingerprint, json.dumps(result), now))
        if "_error" in result:
            raise DomainError(result["_error"]["message"], result["_error"]["status"])
        return result

    def _cycle(self, connection, payload, now):
        product = connection.execute("SELECT * FROM products WHERE id = ?", (payload.get("product_id", "cleaning-kit"),)).fetchone()
        if not product:
            raise DomainError("Unknown product.", 422)
        trace = RunTrace(connection, product["id"], now)
        product = trace.stage("select_product", {"product_id": product["id"]}, lambda: dict(product))
        cost = product["delivery_cost_minor"]
        trace.stage("authorize_budget", {"cost_minor": cost, "envelope_id": "creation_quality"}, lambda: authorize(connection, cost, "creation_quality", now))
        specification = trace.stage("prepare_delivery", {"product_id": product["id"]}, lambda: prepare_delivery(product))
        trace.stage("check_delivery", specification, lambda: check_delivery(specification))
        order_id = str(uuid.uuid4())
        # This local simulator settles immediately and fully reserves sale proceeds
        # for 30 days of possible refunds. It makes no demand prediction.
        def settle():
            connection.execute("INSERT INTO orders VALUES (?, ?, ?, ?, 'delivered', ?, ?)", (order_id, product["id"], product["price_minor"], cost, now + 30 * 86400, now))
            def accounting():
                sale = post(connection, "sale", f"Simulated sale: {product['title']}", [("cash", product["price_minor"]), ("revenue", -product["price_minor"])], now, order_id)
                expense = post(connection, "expense", "Simulated production, delivery and channel costs", [("expense", cost), ("cash", -cost)], now, order_id, "creation_quality")
                return {"sale_transaction_id": sale, "expense_transaction_id": expense}
            trace.stage("post_ledger", {"order_id": order_id, "revenue_minor": product["price_minor"], "cost_minor": cost}, accounting)
            return {"order_id": order_id, "status": "delivered", "simulation_only": True}
        trace.stage("settle_order", {"product_id": product["id"]}, settle)
        trace.finish(order_id)
        stages = [
            ("Scout", "Product hypothesis selected", f"{product['title']}. This is a scripted scenario, not observed demand."),
            ("Studio", "Simulated deliverable prepared", "Production and delivery costs are accounted for in this scenario."),
            ("Review", "Simulated quality stage completed", "This does not certify a real product or generate a sellable asset."),
            ("Operator", "Simulated order delivered", "Virtual payment settled. Sale proceeds remain reserved for possible refunds."),
        ]
        for actor, title, detail in stages:
            event(connection, "cycle", actor, title, detail, now, order_id)
        return {"message": "Simulated sale delivered and reconciled.", "order_id": order_id, "run_id": trace.id}

    def _pause(self, connection, payload, now):
        paused = bool(payload["paused"])
        connection.execute("UPDATE company SET paused = ?, auto_enabled = CASE WHEN ? THEN 0 ELSE auto_enabled END, policy_version = policy_version + 1 WHERE id = 1", (paused, paused))
        event(connection, "control", "You", "Company paused" if paused else "Company resumed", "New spending blocked. Refunds and cancellations remain available." if paused else "Spending is permitted within current financial limits. Auto-run remains off unless started.", now)
        return {"message": "Company paused." if paused else "Company resumed."}

    def _automation(self, connection, payload, now):
        enabled = bool(payload["enabled"])
        if enabled and balances(connection, now)["paused"]:
            raise DomainError("Resume the company before starting auto-run.")
        connection.execute("UPDATE company SET auto_enabled = ?, next_tick = ? WHERE id = 1", (enabled, now + 15))
        event(connection, "control", "You", "Simulation auto-run started" if enabled else "Simulation auto-run stopped", "One scripted cycle every 15 seconds; financial limits still apply.", now)
        return {"message": "Simulation auto-run started." if enabled else "Simulation auto-run stopped."}

    def tick(self):
        now = int(self.clock())
        with self.db.transaction() as connection:
            company = connection.execute("SELECT * FROM company WHERE id = 1").fetchone()
            if not company["auto_enabled"] or company["next_tick"] > now:
                return
            # The due timestamp and cycle commit atomically. Multiple local
            # workers cannot execute the same tick, and a crash rolls both back.
            try:
                connection.execute("SAVEPOINT cycle")
                self._cycle(connection, {"product_id": "cleaning-kit"}, now)
                connection.execute("UPDATE company SET next_tick = ? WHERE id = 1", (now + 15,))
            except DomainError as exc:
                connection.execute("ROLLBACK TO cycle")
                record_blocked(connection, "cleaning-kit", exc, now)
                connection.execute("UPDATE company SET auto_enabled = 0 WHERE id = 1")
                event(connection, "blocked", "Treasury", "Auto-run stopped by financial policy", str(exc), now)
            finally:
                connection.execute("RELEASE cycle")

    def _reserve(self, connection, payload, now):
        amount = payload["amount_minor"]
        authorize(connection, amount, payload["envelope_id"], now)
        action_id = str(uuid.uuid4())
        connection.execute("INSERT INTO actions VALUES (?, ?, ?, ?, 'reserved', ?, NULL)", (action_id, payload["title"], payload["envelope_id"], amount, now))
        event(connection, "reservation", "You", "Experiment funds reserved", payload["title"], now, action_id)
        return {"message": "Funds reserved. Execute or cancel the experiment when ready.", "action_id": action_id}

    def _action(self, connection, payload):
        action = connection.execute("SELECT * FROM actions WHERE id = ?", (payload["id"],)).fetchone()
        if not action:
            raise DomainError("Action not found.", 404)
        if action["status"] != "reserved":
            raise DomainError("This action is no longer pending.")
        return action

    def _execute(self, connection, payload, now):
        action = self._action(connection, payload)
        authorize(connection, action["amount_minor"], action["envelope_id"], now, action["id"])
        post(connection, "expense", f"Simulated experiment: {action['title']}", [("expense", action["amount_minor"]), ("cash", -action["amount_minor"])], now, action["id"], action["envelope_id"])
        connection.execute("UPDATE actions SET status = 'completed', completed_at = ? WHERE id = ?", (now, action["id"]))
        event(connection, "experiment", "Operator", "Simulated experiment executed", "Virtual expense recorded. No advertisement was published and no demand results were invented.", now, action["id"])
        return {"message": "Virtual expense recorded. Add real observations when live integrations exist."}

    def _cancel(self, connection, payload, now):
        action = self._action(connection, payload)
        connection.execute("UPDATE actions SET status = 'cancelled', completed_at = ? WHERE id = ?", (now, action["id"]))
        event(connection, "control", "You", "Reservation cancelled", action["title"], now, action["id"])
        return {"message": "Reservation released."}

    def _refund(self, connection, payload, now):
        order = connection.execute("SELECT * FROM orders WHERE id = ?", (payload["id"],)).fetchone()
        if not order:
            raise DomainError("Order not found.", 404)
        if order["status"] == "refunded":
            raise DomainError("This order has already been refunded.")
        if balances(connection, now)["cash_minor"] < order["gross_minor"]:
            raise DomainError("Insufficient settled cash to pay this refund.")
        post(connection, "refund", "Full simulated customer refund; production costs retained", [("revenue", order["gross_minor"]), ("cash", -order["gross_minor"])], now, order["id"])
        connection.execute("UPDATE orders SET status = 'refunded' WHERE id = ?", (order["id"],))
        if not balances(connection, now)["cash_minor"] >= balances(connection, now)["reserve_minor"] + balances(connection, now)["reserved_minor"] + balances(connection, now)["refund_buffer_minor"]:
            connection.execute("UPDATE company SET paused = 1, auto_enabled = 0 WHERE id = 1")
        event(connection, "refund", "Operator", "Simulated refund reconciled", "Revenue reversed. Production and channel costs remain expenses.", now, order["id"])
        return {"message": "Full virtual refund recorded. Original costs remain accounted for."}

    def _policy(self, connection, payload, now):
        connection.execute("UPDATE company SET action_limit_minor = ?, daily_limit_minor = ?, policy_version = policy_version + 1 WHERE id = 1", (payload["action_limit_minor"], payload["daily_limit_minor"]))
        event(connection, "control", "You", "Spending limits updated", "All unexecuted actions will be checked against the new policy.", now)
        return {"message": "Spending limits updated."}

    def _allocations(self, connection, payload, now):
        allocation = payload["envelopes_minor"]
        current = envelopes(connection)
        if set(allocation) != {row["id"] for row in current}:
            raise DomainError("Provide exactly the five existing budget envelopes.", 422)
        if sum(allocation.values()) > 100000 - balances(connection, now)["reserve_minor"]:
            raise DomainError("Allocations exceed the initial $600 operating pool. Profit reinvestment is not enabled in this version.")
        for row in current:
            if allocation[row["id"]] < row["spent_minor"] + row["reserved_minor"]:
                raise DomainError(f"{row['label']} cannot be reduced below spending plus reservations.")
        connection.executemany("UPDATE envelopes SET budget_minor = ? WHERE id = ?", [(value, key) for key, value in allocation.items()])
        event(connection, "control", "You", "Operating allocations updated", "Protected reserve retained. Existing commitments remain covered.", now)
        return {"message": "Allocations updated."}

    def _worker(self, connection, payload, now):
        worker = WORKER_BY_ID.get(payload["id"])
        if not worker or worker["kind"] != "agent":
            raise DomainError("Only agent workers can be enabled or disabled. Treasury remains mandatory.", 422)
        connection.execute("UPDATE workers SET enabled = ? WHERE id = ?", (payload["enabled"], worker["id"]))
        event(connection, "control", "You", f"{worker['name']} {'enabled' if payload['enabled'] else 'disabled'}", "Dependent work will check this worker's status before execution.", now)
        return {"message": f"{worker['name']} {'enabled' if payload['enabled'] else 'disabled'}."}
