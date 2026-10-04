# Corp · Company Lab

A working local dashboard and operating core for an agent-run digital company. This first slice uses **virtual money and scripted roles only**. It does not create accounts, call language models, publish products, advertise, contact customers, or move real money.

## Run locally

Requires Python 3.12 or later. From this project directory:

```sh
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.lock
python -m pip install -e '.[test]' --no-deps
python -m corp
```

Open **http://127.0.0.1:8000** on the machine running the server. A remote workspace's loopback URL is not automatically reachable from your own computer. No hosted deployment was created: the Sites setup scripts were unavailable in this workspace.

The server deliberately binds only to loopback. Do not expose it to the internet. A per-process operator token and same-origin checks protect local mutations; these are not public authentication or authorization.

On Windows, activate the environment with `.venv\Scripts\Activate.ps1` in PowerShell. The lock file records the tested application and API-test dependency versions; browser QA remains optional.

For a different port or a separate simulated company:

```sh
python -m corp --port 8002 --database /tmp/another-simulated-company.sqlite3
```

State persists in `data/company.sqlite3` by default. Keep that database if you want to retain activity and ledger history. Opening another database starts a separate virtual company; the UI has no destructive reset control.

## Try the first workflow

1. On **Overview**, click **Run a cycle**. The default virtual product sells for $24 and incurs $4.50 of scenario costs. Profit becomes $19.50; its $24 proceeds remain covered for possible refunds.
2. Open **Treasury**, create a $12 experiment, and reserve its funds. Cash does not change until **Execute** records the virtual expense. **Cancel** releases the reservation.
3. Pause the company. New cycles and spending stop; cancellation and refunds remain available.
4. Refund an order. The ledger reverses its revenue, retains production costs, and updates cash and profit.
5. Open **Controls** to change per-action/daily limits. Pending actions are checked against the latest policy when executed.
6. Use **Start auto-run** to perform a scripted cycle every 15 seconds. It automatically stops when policy blocks the next cycle. Pausing disables auto-run; resuming does not silently restart it.
7. Inspect financial entries or follow an outcome from **Activity**. Export the full ledger as CSV from **Treasury**.

## Implemented controls

- Virtual $1,000 opening capital; $400 protected reserve; five operating envelopes totaling $600.
- Integer minor units, balanced double-entry posting, append-only financial and audit records.
- Atomic spending reservations, per-action and daily limits, and envelope constraints.
- Full sale proceeds retained as refund coverage for 30 actual elapsed days in this simple simulator.
- Persistent idempotency for both accepted and denied commands, with rejection auditing and transactional rollback.
- Automatic simulation ticks commit atomically with their scheduling state and survive process restarts.
- Pause, resume, cancellation, refunds, budget reallocations, and policy changes.
- Six responsive dashboard views and a complete simulated sale/refund workflow.

All financial days use UTC; displayed timestamps use the browser's timezone. Budget ceilings represent cumulative lifetime allocations for this initial $600 pool. Reinvestment or expansion of the pool is not implemented yet.

## Verification

```sh
python -m unittest discover -s tests -v
```

The financial/API suite covers concurrent commitments, reserve coverage, daily limits, idempotency across restart, command rollback, immutable records, authorization, origin checks, refunds, and pause behavior.

Optional browser workflow check, using an isolated temporary company on port 8001:

```sh
python -m pip install playwright
python -m playwright install chromium
python scripts/smoke_ui.py
```

The check also supports installed `/usr/bin/chromium` or `CORP_CHROMIUM_PATH`. It checks the actual UI flows, all six views, mobile width, and 200% text enlargement, and captures previews under ignored `artifacts/`. It does not modify the main company database.

## Source structure

```text
corp/
  api.py             Local API, validation, authorization, scheduler lifecycle
  database.py        SQLite connections, migrations, atomic writes
  treasury.py        Accounting and deterministic financial policy
  service.py         Idempotent commands and scripted company cycles
  migrations/        Versioned database schema
  static/            Dashboard views, API client, controls, styles
tests/               Financial and API invariants
scripts/smoke_ui.py   Isolated browser workflow verification
```

## Next implementation boundaries

This is a local prototype with meaningful financial safeguards, not a production deployment. SQLite WAL provides durable local state and serialized writes. Real operations require a server deployment, authenticated operator identities, verified opening balances, external adapters and reconciliation, delivery artifacts, durable asynchronous work orchestration, backups, monitoring, and tested provider-specific failure handling.

Keep real credentials outside model context. A future model worker submits proposals to these boundaries; it does not get unrestricted database or payment access. No simulated balance can authorize real spending. Move toward PostgreSQL and a durable workflow engine when multi-user/live execution demands them.

The product concepts, prices, costs, quality stages, and customers are illustrative scenarios. No sellable design assets are produced yet, and simulated profits are not demand evidence. Tax calculation, marketplace eligibility, customer obligations, and account onboarding remain unresolved.

## Planning artifacts

- [Launch plan](docs/launch-plan.md)
- [Implementation backlog](docs/implementation-backlog.md)
- [Current implementation status](docs/implementation-status.md)
- [Example treasury configuration](config/treasury.example.json): planning example, not a runtime configuration file. Changes to it do not alter an existing company database.
