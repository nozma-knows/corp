import { randomUUID } from 'node:crypto';
import type { Database } from './database.js';
import { DomainError } from './errors.js';
import type { Balance, Company, Envelope, JournalLine } from '../shared/contracts.js';

export function scalar(
  db: Database,
  sql: string,
  ...args: Parameters<Database['get']> extends [string, ...infer A] ? A : never
): number {
  const row = db.get<Record<string, number | null>>(sql, ...args);
  return Number(row ? Object.values(row)[0] || 0 : 0);
}
export function balances(db: Database, now: number): Balance {
  const company = db.get<Company>('SELECT * FROM company WHERE id=1');
  if (!company) throw new Error('Company not initialized');
  const cash = scalar(db, "SELECT SUM(amount_minor) FROM journal_lines WHERE account='cash'");
  const reserved = scalar(db, "SELECT SUM(amount_minor) FROM actions WHERE status='reserved'");
  const refunds = scalar(
    db,
    "SELECT SUM(gross_minor) FROM orders WHERE status='delivered' AND refund_until>?",
    now,
  );
  return {
    ...company,
    cash_minor: cash,
    reserved_minor: reserved,
    refund_buffer_minor: refunds,
    available_minor: Math.max(0, cash - reserved - refunds - company.reserve_minor),
    profit_minor:
      0 -
      scalar(
        db,
        "SELECT SUM(amount_minor) FROM journal_lines WHERE account IN ('revenue','expense')",
      ),
    revenue_minor:
      0 - scalar(db, "SELECT SUM(amount_minor) FROM journal_lines WHERE account='revenue'"),
    expenses_minor: scalar(
      db,
      "SELECT SUM(amount_minor) FROM journal_lines WHERE account='expense'",
    ),
    spent_today_minor: scalar(
      db,
      "SELECT SUM(l.amount_minor) FROM journal_lines l JOIN transactions t ON t.id=l.transaction_id WHERE l.account='expense' AND t.created_at>=?",
      now - (now % 86400),
    ),
  };
}
export function envelopes(db: Database): Envelope[] {
  return db.all<Envelope>('SELECT * FROM envelopes ORDER BY rowid').map((row) => {
    const spent = scalar(
      db,
      "SELECT SUM(l.amount_minor) FROM journal_lines l JOIN transactions t ON t.id=l.transaction_id WHERE l.account='expense' AND t.envelope_id=?",
      row.id,
    );
    const reserved = scalar(
      db,
      "SELECT SUM(amount_minor) FROM actions WHERE envelope_id=? AND status='reserved'",
      row.id,
    );
    return {
      ...row,
      spent_minor: spent,
      reserved_minor: reserved,
      remaining_minor: row.budget_minor - spent - reserved,
    };
  });
}
export function authorize(
  db: Database,
  amount: number,
  envelopeId: string,
  now: number,
  reservationId?: string,
) {
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new DomainError('Action costs must be positive integer minor units.', 422);
  const balance = balances(db, now);
  if (balance.paused)
    throw new DomainError('Company paused. Resume it before starting new spending.');
  if (amount > balance.action_limit_minor)
    throw new DomainError('This action exceeds the per-action spending limit.');
  const allocation = envelopes(db).find((row) => row.id === envelopeId);
  if (!allocation) throw new DomainError('Unknown budget envelope.', 422);
  const ownHold = reservationId ? amount : 0;
  if (amount > allocation.remaining_minor + ownHold)
    throw new DomainError('This budget has insufficient uncommitted funds.');
  if (amount > balance.available_minor + ownHold)
    throw new DomainError('Spending would consume protected funds or refund coverage.');
  if (
    balance.spent_today_minor + balance.reserved_minor - ownHold + amount >
    balance.daily_limit_minor
  )
    throw new DomainError('The daily spending limit has been reached.');
}
export function post(
  db: Database,
  kind: string,
  description: string,
  lines: JournalLine[],
  now: number,
  reference: string | null = null,
  envelopeId: string | null = null,
) {
  if (
    lines.length < 2 ||
    lines.reduce((sum, l) => sum + l.amount_minor, 0) !== 0 ||
    lines.some((l) => !Number.isSafeInteger(l.amount_minor) || l.amount_minor === 0)
  )
    throw new Error('A journal transaction must balance with nonzero integer minor units.');
  const id = randomUUID();
  db.run(
    'INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?)',
    id,
    kind,
    description,
    reference,
    envelopeId,
    now,
  );
  for (const line of lines)
    db.run(
      'INSERT INTO journal_lines(transaction_id,account,amount_minor) VALUES (?, ?, ?)',
      id,
      line.account,
      line.amount_minor,
    );
  return id;
}
export function event(
  db: Database,
  kind: string,
  actor: string,
  title: string,
  detail: string,
  now: number,
  reference: string | null = null,
) {
  db.run(
    'INSERT INTO events(kind,actor,title,detail,reference,created_at) VALUES (?, ?, ?, ?, ?, ?)',
    kind,
    actor,
    title,
    detail,
    reference,
    now,
  );
}
