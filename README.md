# Corp · Company Lab

An observable operating core for an agent company, written in **TypeScript throughout**. The dashboard shows workers, positions, permissions, function ownership, routing, execution inputs/outputs, timing, and financial outcomes. This release uses **virtual money and scripted workers**. It does not call models, create business accounts, publish assets, contact customers, or move real money.

## Run

Requires Node.js 24.13+ in the Node 24 release line.

```sh
npm ci --ignore-scripts
npm run build
npm start
```

Open http://127.0.0.1:8000 on the machine running the server. Development: `npm run dev`. Local mode binds to loopback; internet exposure requires hosted configuration and owner authentication. The database defaults to `data/company.sqlite3`; changing `--database` selects a separate virtual company.

## Inspect and influence the company

- **Overview**: cash, commitments, profit, current work. Run a cycle: a $24 virtual sale incurs $4.50 costs and provisions its full $24 refund liability.
- **Agent team / Company map**: inspect each worker's position, manager, owned functions, permissions, and restrictions. Disable a worker to block its dependent workflow; Treasury remains mandatory.
- **Execution & inference**: inspect recorded function inputs, outputs, routing, durations, nested accounting spans, and the linked outcome. Model calls/tokens/costs remain zero because no model provider exists.
- **Businesses / Treasury**: reserve experiments, execute or cancel simulated expenses, refund orders, inspect balanced journals, export CSV.
- **Controls**: pause/resume, auto-run, spending limits, and budget allocations. Pause permits refunds and cancellations. Auto-run stops on policy denial.

The virtual company starts with $1,000, a $400 protected reserve, $25 per-action and $40 daily limits, and $600 of cumulative operating allocations. Integer USD cents, atomic commitments, full 30-day refund coverage, append-only records, and persistent command idempotency enforce financial boundaries. Profit reinvestment and actual agent rewards/expansion are future work. Scripted profit does not validate customer demand or the $10,000/month stretch target.

## Verify

```sh
npm run format:check
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

The browser check uses an isolated authenticated company and captures eight dashboard views, worker controls, financial controls, session behavior, mobile width, and 200% text. Installed `/usr/bin/chromium` or `CORP_CHROMIUM_PATH` is also supported. Test artifacts and databases are ignored by Git. GitHub Actions runs these checks, a production dependency audit, and a container persistence/backup smoke test.

## Deploy staging

The [deployment runbook](docs/deployment.md) covers configuration, secret generation, Render provisioning, container testing, backups, recovery, and rollout checks. [render.yaml](render.yaml) defines one authenticated Docker service with persistent storage. Provisioning needs a hosting account; applying the blueprint can incur provider charges. Review the current price in that account first.

Hosted mode refuses to start without an HTTPS origin, an operator password hash, a random session secret, and an absolute persistent database path. Password sessions use HttpOnly/Secure/SameSite cookies, expiration and revocation, CSRF/origin checks, persistent login throttling, and generic error responses. APIs and exports require owner access. Secrets belong in the hosting provider, never in Git or chat.

## Source

```text
src/server/   API, configuration, auth, scheduler, commands, registry, accounting
src/client/   Typed dashboard, controls and execution inspector
src/shared/   API contracts shared by server and browser
migrations/   Checksum-verified SQLite schema migrations
public/       HTML, styles, icons; generated browser bundles are ignored
scripts/   Build and isolated browser/container verification
tests/    Financial, inspector, API/security and recovery tests
```

SQLite WAL and a single process suit this bounded staging simulation. The TypeScript migration preserves the original database schema and legacy command replay; stop the Python service and take a verified backup before switching an existing database. This architecture is not ready for horizontally scaled live financial operations. Those require PostgreSQL, durable external-action workflows, provider/webhook verification, payment reconciliation, verified capital, delivery artifacts, and model cost admission. See [implementation status](docs/implementation-status.md) and the [launch plan](docs/launch-plan.md).
