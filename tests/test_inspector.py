import sqlite3
import tempfile
import unittest
from pathlib import Path

from corp.database import Database
from corp.registry import FUNCTIONS, WORKERS
from corp.service import CompanyService
from corp.treasury import DomainError


class InspectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = Database(Path(self.temp.name) / "company.sqlite3")
        self.service = CompanyService(self.db)
        self.service.initialize()

    def test_registry_has_valid_owners_managers_and_dependencies(self):
        workers = {w["id"] for w in WORKERS}
        functions = {f["id"] for f in FUNCTIONS}
        for worker in WORKERS:
            self.assertIn(worker["manager_id"], workers | {"owner"})
        for function in FUNCTIONS:
            self.assertIn(function["worker_id"], workers)
            self.assertTrue(set(function["depends_on"]) <= functions)

    def test_scripted_calls_are_not_reported_as_inference(self):
        result = self.service.command("inspector-cycle", "cycle", {})
        inspector = self.service.inspector()
        run = inspector["runs"][0]
        self.assertEqual(run["id"], result["run_id"])
        self.assertEqual(run["order_id"], result["order_id"])
        self.assertEqual(len(run["spans"]), 6)
        self.assertEqual(inspector["totals"]["model_calls"], 0)
        self.assertEqual(inspector["totals"]["model_cost_micro_usd"], 0)
        for span in run["spans"]:
            self.assertIsNone(span["model"])
            self.assertIsNone(span["input_tokens"])
            self.assertEqual(span["destination"], "local-process")
            self.assertGreaterEqual(span["duration_ms"], 0)
        ledger = next(s for s in run["spans"] if s["function_id"] == "post_ledger")
        settlement = next(s for s in run["spans"] if s["function_id"] == "settle_order")
        self.assertEqual(ledger["parent_id"], settlement["id"])

    def test_disabled_worker_blocks_dependent_work_without_spending(self):
        self.service.command("disable-studio", "worker", {"id": "creator", "enabled": False})
        with self.assertRaises(DomainError):
            self.service.command("blocked-studio", "cycle", {})
        run = self.service.inspector()["runs"][0]
        self.assertEqual(run["status"], "blocked")
        self.assertIsNone(run["order_id"])
        self.assertEqual(run["spans"][-1]["worker_id"], "creator")
        self.assertEqual(run["spans"][-1]["status"], "blocked")
        self.assertEqual(self.service.state()["company"]["cash_minor"], 100000)

    def test_treasury_cannot_be_disabled(self):
        with self.assertRaises(DomainError):
            self.service.command("disable-treasury", "worker", {"id": "treasury", "enabled": False})
        self.assertTrue(next(w for w in self.service.inspector()["workers"] if w["id"] == "treasury")["enabled"])

    def test_duplicate_command_does_not_duplicate_spans(self):
        for _ in range(2):
            self.service.command("duplicate-trace", "cycle", {})
        self.assertEqual(len(self.service.inspector()["runs"]), 1)
        self.assertEqual(self.service.inspector()["totals"]["executions"], 6)

    def test_inspector_history_is_immutable(self):
        self.service.command("immutable-trace", "cycle", {})
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db.transaction() as connection:
                connection.execute("UPDATE execution_spans SET worker_name = 'Fake'")

    def test_legacy_database_has_no_fabricated_history(self):
        self.assertEqual(self.service.inspector()["runs"], [])
        self.assertEqual(self.service.inspector()["totals"]["model_calls"], 0)

    def test_worker_settings_and_history_survive_restart(self):
        self.service.command("persist-cycle", "cycle", {})
        self.service.command("persist-disable", "worker", {"id": "reviewer", "enabled": False})
        restarted = CompanyService(self.db)
        restarted.initialize()
        self.assertEqual(len(restarted.inspector()["runs"]), 1)
        self.assertFalse(next(w for w in restarted.inspector()["workers"] if w["id"] == "reviewer")["enabled"])
