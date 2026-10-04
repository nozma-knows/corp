"""Deterministic accounting and permissions; never delegated to an LLM."""

import sqlite3
import uuid


class DomainError(Exception):
    def __init__(self, message: str, status: int = 409, *, worker_id=None, function_id=None):
        super().__init__(message)
        self.status = status
        self.worker_id, self.function_id = worker_id, function_id
        self.trace = None


def scalar(connection, sql, args=()) -> int:
    return int(connection.execute(sql, args).fetchone()[0] or 0)


def balances(connection, now: int) -> dict:
    company = dict(connection.execute("SELECT * FROM company WHERE id = 1").fetchone())
    cash = scalar(connection, "SELECT SUM(amount_minor) FROM journal_lines WHERE account = 'cash'")
    reserved = scalar(connection, "SELECT SUM(amount_minor) FROM actions WHERE status = 'reserved'")
    refund_buffer = scalar(connection, "SELECT SUM(gross_minor) FROM orders WHERE status = 'delivered' AND refund_until > ?", (now,))
    spent_today = scalar(connection, "SELECT SUM(l.amount_minor) FROM journal_lines l JOIN transactions t ON t.id = l.transaction_id WHERE l.account = 'expense' AND t.created_at >= ?", (now - now % 86400,))
    profit = -scalar(connection, "SELECT SUM(amount_minor) FROM journal_lines WHERE account IN ('revenue', 'expense')")
    revenue = -scalar(connection, "SELECT SUM(amount_minor) FROM journal_lines WHERE account = 'revenue'")
    expenses = scalar(connection, "SELECT SUM(amount_minor) FROM journal_lines WHERE account = 'expense'")
    return {**company, "cash_minor": cash, "reserved_minor": reserved, "refund_buffer_minor": refund_buffer,
            "available_minor": max(0, cash - reserved - refund_buffer - company["reserve_minor"]),
            "profit_minor": profit, "revenue_minor": revenue, "expenses_minor": expenses, "spent_today_minor": spent_today}


def envelopes(connection) -> list[dict]:
    rows = []
    for row in connection.execute("SELECT * FROM envelopes ORDER BY rowid"):
        spent = scalar(connection, "SELECT SUM(l.amount_minor) FROM journal_lines l JOIN transactions t ON t.id = l.transaction_id WHERE l.account = 'expense' AND t.envelope_id = ?", (row["id"],))
        reserved = scalar(connection, "SELECT SUM(amount_minor) FROM actions WHERE envelope_id = ? AND status = 'reserved'", (row["id"],))
        rows.append({**dict(row), "spent_minor": spent, "reserved_minor": reserved, "remaining_minor": row["budget_minor"] - spent - reserved})
    return rows


def authorize(connection, amount: int, envelope_id: str, now: int, reservation_id: str | None = None) -> None:
    if type(amount) is not int or amount <= 0:
        raise DomainError("Action costs must be positive integer minor units.", 422)
    balance = balances(connection, now)
    if balance["paused"]:
        raise DomainError("Company paused. Resume it before starting new spending.")
    if amount > balance["action_limit_minor"]:
        raise DomainError("This action exceeds the per-action spending limit.")
    allocation = next((row for row in envelopes(connection) if row["id"] == envelope_id), None)
    if allocation is None:
        raise DomainError("Unknown budget envelope.", 422)
    # An existing reservation is already excluded from available funds.
    own_hold = amount if reservation_id else 0
    if amount > allocation["remaining_minor"] + own_hold:
        raise DomainError("This budget has insufficient uncommitted funds.")
    if amount > balance["available_minor"] + own_hold:
        raise DomainError("Spending would consume protected funds or refund coverage.")
    # Holds count against today's admission limit too, so parallel reservations
    # cannot accumulate beyond the daily cap.
    if balance["spent_today_minor"] + balance["reserved_minor"] - own_hold + amount > balance["daily_limit_minor"]:
        raise DomainError("The daily spending limit has been reached.")


def post(connection, kind: str, description: str, lines: list[tuple[str, int]], now: int,
         reference: str | None = None, envelope_id: str | None = None) -> str:
    if sum(amount for _, amount in lines) != 0 or len(lines) < 2:
        raise ValueError("A journal transaction must balance.")
    if any(type(amount) is not int or amount == 0 for _, amount in lines):
        raise ValueError("Journal amounts must be nonzero integer minor units.")
    transaction_id = str(uuid.uuid4())
    connection.execute("INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?)", (transaction_id, kind, description, reference, envelope_id, now))
    connection.executemany("INSERT INTO journal_lines(transaction_id, account, amount_minor) VALUES (?, ?, ?)", [(transaction_id, account, amount) for account, amount in lines])
    return transaction_id


def event(connection, kind: str, actor: str, title: str, detail: str, now: int, reference: str | None = None):
    connection.execute("INSERT INTO events(kind, actor, title, detail, reference, created_at) VALUES (?, ?, ?, ?, ?, ?)", (kind, actor, title, detail, reference, now))
