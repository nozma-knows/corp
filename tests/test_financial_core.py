import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from corp.database import Database
from corp.service import CompanyService
from corp.treasury import DomainError, post


class FinancialCoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = 1800000000
        self.database = Database(Path(self.temp.name) / "company.sqlite3")
        self.service = CompanyService(self.database, clock=lambda: self.now)
        self.service.initialize()

    def command(self, kind, payload=None, key=None):
        return self.service.command(key or f"command-{kind}-{self.counter()}", kind, payload or {})

    def counter(self):
        self.sequence = getattr(self, "sequence", 0) + 1
        return self.sequence

    def reserve(self, amount=1200, key=None):
        return self.command("reserve", {"title": "Test a listing", "amount_minor": amount, "envelope_id": "customer_acquisition"}, key)

    def test_opening_balance_is_virtual_and_protected(self):
        state = self.service.state()
        self.assertEqual(state["company"]["cash_minor"], 100000)
        self.assertEqual(state["company"]["available_minor"], 60000)
        self.assertEqual(sum(row["budget_minor"] for row in state["envelopes"]), 60000)
        self.assertEqual(state["company"]["mode"], "simulation")
        self.assertFalse(state["capabilities"]["real_world_execution"])

    def test_sale_profit_excludes_reserved_refund_proceeds(self):
        self.command("cycle")
        company = self.service.state()["company"]
        self.assertEqual(company["cash_minor"], 101950)
        self.assertEqual(company["profit_minor"], 1950)
        self.assertEqual(company["refund_buffer_minor"], 2400)
        self.assertEqual(company["available_minor"], 59550)

    def test_refund_reverses_revenue_and_retains_cost(self):
        order = self.command("cycle")["order_id"]
        self.command("refund", {"id": order})
        company = self.service.state()["company"]
        self.assertEqual(company["cash_minor"], 99550)
        self.assertEqual(company["profit_minor"], -450)
        self.assertEqual(company["revenue_minor"], 0)
        self.assertEqual(company["refund_buffer_minor"], 0)
        self.assertEqual(company["expenses_minor"], 450)

    def test_idempotent_commands_survive_restart(self):
        first = self.command("cycle", key="stable-cycle-key")
        restarted = CompanyService(self.database, clock=lambda: self.now)
        restarted.initialize()
        second = restarted.command("stable-cycle-key", "cycle", {})
        self.assertEqual(first, second)
        self.assertEqual(restarted.state()["company"]["order_count"], 1)

    def test_key_reuse_for_different_payload_is_rejected(self):
        self.command("cycle", key="stable-cycle-key")
        with self.assertRaises(DomainError):
            self.command("cycle", {"product_id": "service-menu"}, key="stable-cycle-key")

    def test_denial_is_audited_and_replayed_after_policy_changes(self):
        self.command("policy", {"action_limit_minor": 100, "daily_limit_minor": 4000})
        with self.assertRaises(DomainError):
            self.command("cycle", key="denied-cycle")
        self.assertEqual(self.service.state()["events"][0]["kind"], "blocked")
        self.command("policy", {"action_limit_minor": 2500, "daily_limit_minor": 4000})
        with self.assertRaises(DomainError):
            self.command("cycle", key="denied-cycle")
        self.assertEqual(self.service.state()["company"]["order_count"], 0)

    def test_partial_command_work_rolls_back_before_recording_denial(self):
        original = self.service._cycle
        def failure(connection, payload, now):
            original(connection, payload, now)
            raise DomainError("Injected failure after accounting")
        with patch.object(self.service, "_cycle", failure):
            with self.assertRaises(DomainError):
                self.command("cycle")
        company = self.service.state()["company"]
        self.assertEqual(company["cash_minor"], 100000)
        self.assertEqual(company["order_count"], 0)

    def test_double_refund_cannot_remove_money_twice(self):
        order = self.command("cycle")["order_id"]
        self.command("refund", {"id": order})
        with self.assertRaises(DomainError):
            self.command("refund", {"id": order})
        self.assertEqual(self.service.state()["company"]["cash_minor"], 99550)

    def test_reservation_does_not_record_an_expense(self):
        action = self.reserve()["action_id"]
        company = self.service.state()["company"]
        self.assertEqual(company["reserved_minor"], 1200)
        self.assertEqual(company["cash_minor"], 100000)
        self.assertEqual(company["profit_minor"], 0)
        self.command("execute", {"id": action})
        company = self.service.state()["company"]
        self.assertEqual(company["cash_minor"], 98800)
        self.assertEqual(company["reserved_minor"], 0)
        self.assertEqual(company["profit_minor"], -1200)
        with self.assertRaises(DomainError):
            self.command("execute", {"id": action})

    def test_pause_blocks_spending_but_allows_cancel_and_refund(self):
        order = self.command("cycle")["order_id"]
        action = self.reserve()["action_id"]
        self.command("pause", {"paused": True})
        with self.assertRaises(DomainError):
            self.command("cycle")
        with self.assertRaises(DomainError):
            self.command("execute", {"id": action})
        self.command("cancel", {"id": action})
        self.command("refund", {"id": order})
        self.assertEqual(self.service.state()["company"]["reserved_minor"], 0)

    def test_policy_change_rechecks_pending_actions(self):
        action = self.reserve()["action_id"]
        self.command("policy", {"action_limit_minor": 1000, "daily_limit_minor": 4000})
        with self.assertRaises(DomainError):
            self.command("execute", {"id": action})
        self.assertEqual(self.service.state()["company"]["cash_minor"], 100000)

    def test_parallel_reservations_cannot_exceed_daily_limit(self):
        def attempt(index):
            try:
                self.reserve(2500, f"parallel-{index}")
                return True
            except DomainError:
                return False
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(attempt, range(8)))
        self.assertEqual(sum(results), 1)
        self.assertEqual(self.service.state()["company"]["reserved_minor"], 2500)

    def test_parallel_reservations_cannot_consume_protected_capital(self):
        self.command("policy", {"action_limit_minor": 2500, "daily_limit_minor": 60000})
        identifiers = [row["id"] for row in self.service.state()["envelopes"]]
        def attempt(index):
            try:
                self.service.command(f"capital-{index}", "reserve", {"title": "Concurrent experiment", "amount_minor": 2500, "envelope_id": identifiers[index % len(identifiers)]})
                return True
            except DomainError:
                return False
        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(attempt, range(100)))
        self.assertEqual(sum(results), 24)
        company = self.service.state()["company"]
        self.assertEqual(company["reserved_minor"], 60000)
        self.assertEqual(company["available_minor"], 0)
        self.assertTrue(company["policy_healthy"])

    def test_allocations_cannot_remove_committed_funds(self):
        self.reserve()
        values = {row["id"]: row["budget_minor"] for row in self.service.state()["envelopes"]}
        values["customer_acquisition"] = 0
        with self.assertRaises(DomainError):
            self.command("allocations", {"envelopes_minor": values})

    def test_auto_run_stops_when_daily_limit_is_reached(self):
        self.command("automation", {"enabled": True})
        for _ in range(12):
            self.now += 15
            self.service.tick()
        state = self.service.state()
        self.assertEqual(state["company"]["order_count"], 8)
        self.assertFalse(state["company"]["auto_enabled"])
        self.assertEqual(state["company"]["spent_today_minor"], 3600)
        self.assertEqual(state["events"][0]["kind"], "blocked")

    def test_two_workers_cannot_execute_same_tick(self):
        self.command("automation", {"enabled": True})
        self.now += 15
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda _: self.service.tick(), range(2)))
        self.assertEqual(self.service.state()["company"]["order_count"], 1)

    def test_refund_provision_expires_with_time(self):
        self.command("cycle")
        self.now += 30 * 86400 + 1
        company = self.service.state()["company"]
        self.assertEqual(company["refund_buffer_minor"], 0)
        self.assertEqual(company["available_minor"], 61950)

    def test_append_only_ledger_and_audit(self):
        for table in ("transactions", "journal_lines", "events"):
            with self.assertRaises(sqlite3.IntegrityError):
                with self.database.transaction() as connection:
                    connection.execute(f"DELETE FROM {table}")
        self.assertEqual(self.service.state()["company"]["cash_minor"], 100000)

    def test_unbalanced_journal_rejected_and_transactions_balance(self):
        with self.assertRaises(ValueError):
            with self.database.transaction() as connection:
                post(connection, "bad", "Unbalanced", [("cash", 100), ("equity", -99)], self.now)
        self.command("cycle")
        with self.database.snapshot() as connection:
            broken = connection.execute("SELECT transaction_id FROM journal_lines GROUP BY transaction_id HAVING SUM(amount_minor) != 0").fetchall()
        self.assertEqual(broken, [])


if __name__ == "__main__":
    unittest.main()
