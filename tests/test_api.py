import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from corp.api import create_app


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = create_app(Path(self.temp.name) / "api.sqlite3", start_worker=False)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.headers = {"X-Operator-Token": self.app.state.operator_token, "Idempotency-Key": "test-request-001"}

    def test_mutation_requires_operator_token(self):
        response = self.client.post("/api/simulation/cycle", json={})
        self.assertEqual(response.status_code, 403)

    def test_mutation_requires_idempotency_key(self):
        response = self.client.post("/api/simulation/cycle", json={}, headers={"X-Operator-Token": self.app.state.operator_token})
        self.assertEqual(response.status_code, 422)

    def test_foreign_origin_and_host_are_rejected(self):
        response = self.client.post("/api/simulation/cycle", json={}, headers={**self.headers, "Origin": "https://evil.example"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.get("/api/state", headers={"Host": "evil.example"}).status_code, 400)

    def test_negative_fractional_boolean_and_extra_inputs_are_rejected(self):
        for amount in (-100, 1.2, True):
            response = self.client.post("/api/experiments", json={"title": "Experiment", "envelope_id": "creation_quality", "amount_minor": amount}, headers=self.headers)
            self.assertEqual(response.status_code, 422)
        response = self.client.post("/api/simulation/cycle", json={"mode": "live"}, headers=self.headers)
        self.assertEqual(response.status_code, 422)

    def test_route_idempotency_and_state_consistency(self):
        for _ in range(2):
            self.assertEqual(self.client.post("/api/simulation/cycle", json={}, headers=self.headers).status_code, 200)
        company = self.client.get("/api/state").json()["company"]
        self.assertEqual(company["order_count"], 1)
        self.assertEqual(company["profit_minor"], 1950)

    def test_csv_export_and_local_dashboard(self):
        response = self.client.get("/api/ledger/export.csv")
        self.assertIn("simulation", response.text)
        self.assertIn("amount_minor", response.text)
        index = self.client.get("/")
        self.assertEqual(index.status_code, 200)
        self.assertIn(self.app.state.operator_token, index.text)
        self.assertIn("frame-ancestors 'none'", index.headers["content-security-policy"])


if __name__ == "__main__":
    unittest.main()
