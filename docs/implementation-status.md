# First implementation status

## Working now

| Area | Implemented |
| --- | --- |
| Financial state | Virtual opening capital, balanced journal, immutable posted records |
| Treasury | Protected reserve, refund coverage, envelope budgets, atomic commitments |
| Spending | Per-action and daily ceilings; execution-time policy checks |
| Commands | Persistent idempotency, transactional rollback, audited denials |
| Operator control | Pause/resume, budget changes, limits, cancellation, refunds |
| Simulation | Scripted sale/delivery/accounting cycle; recurring local scheduler |
| Dashboard | Overview, team, businesses, treasury, activity, controls |
| Verification | Financial/API tests and isolated browser workflow checks |

## Deliberate implementation choices

The first application uses Python/FastAPI, SQLite WAL, and dependency-free browser modules. This makes the financial core and dashboard runnable with the installed environment and avoids recurring hosted services during validation. Domain, database, API, and presentation are separated.

The architecture brief's PostgreSQL, Temporal, and framework-based frontend remain candidates for later multi-user/live operations. The local scheduler is appropriate for atomic simulated cycles; it is not a substitute for a durable external-action workflow engine.

The existing Sites skill is available as guidance, but its required local setup/publishing scripts were not present or readable. No Site was registered and no hosted deployment was created. Source work continued locally.

## Next work

1. Research candidate niches with dated, attributable evidence and select a bounded real demand experiment.
2. Add model-backed structured proposal workers with model/tool cost admission and provider limits.
3. Produce actual original/licensed digital deliverables with file and quality validation.
4. Resolve operating country, legal owner, and whether software development is included in the $1,000.
5. Verify platform rules and connect a permitted sales adapter and payout account.
6. Implement external-action state machines, outbox dispatch, provider idempotency and webhook verification, and reconciliation for ambiguous outcomes.
7. Add deployment authentication, backups, monitoring, and recovery checks before real-money execution.
8. Implement evidence-based reinvestment, rewards/allocation evaluation, and expansion proposals.

## Important boundaries

- Virtual capital is not evidence of a real deposit.
- Scripted roles do not use LLMs or conduct real research.
- Simulated quality stages do not certify actual products.
- Refunding removes virtual revenue while retaining scenario costs.
- No actual customer data, outreach, payments, ads, listings, or business accounts exist.
- A protected buffer and admission checks cannot guarantee protection from arbitrary future external liabilities.
