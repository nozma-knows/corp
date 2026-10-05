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

## Follow the company in four views

- **Balance**: settled cash, available funds, protected money, and recent transactions. Spending limits, team budgets, automatic tasks, refunds and exports remain available in secondary controls.
- **Messages**: a channel-based team board (`general`, `product-team`, `finance`). Employees share recorded task handoffs and finance decisions; you can post persistent owner notes. Messages are escaped, authenticated, bounded in the dashboard and protected against duplicate submissions. Owner notes do not trigger model replies.
- **Decisions**: proposed expenses awaiting your approval, tasks blocked by a worker or policy, and approved/declined expenses. Approvals use the existing financial checks; a paused company still permits declines and refunds.
- **Company map**: an illustrated office with Operations, Finance, Research, and Production/Quality rooms. Operator manages Scout, Studio and Review; Treasury reports directly to you. Select an employee for responsibilities and task-specific model recommendations. Replay actual recorded handoffs, with room highlights and communication bubbles. The replay is a view of past work and never executes another task.

Model recommendations distinguish reasoning, inexpensive drafting, and deterministic financial checks. No model provider is connected, and execution records continue to report zero model calls, tokens and cost. Previous task history is preserved; new messages are recorded with new tasks rather than backfilled as invented conversations.

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

The browser check uses an isolated authenticated company and captures the four workspace views, persisted owner notes, incoming-message draft preservation, task handoffs, decisions, worker and financial controls, session behavior, mobile width, and 200% text. Installed `/usr/bin/chromium` or `CORP_CHROMIUM_PATH` is also supported. Test artifacts and databases are ignored by Git. GitHub Actions runs these checks, a production dependency audit, and a container persistence/backup smoke test.

## Deploy staging

The [deployment runbook](docs/deployment.md) covers Railway configuration, secret generation, container testing, backups, recovery, and rollout checks. [`.railway/railway.ts`](.railway/railway.ts) defines one authenticated Docker service from `main` with persistent storage using TypeScript IaC. It needs a dedicated Railway project, sealed shared credentials, and a public domain targeting port 8000. Hosting access is not connected here; the definition is prepared for deployment, not a deployed service. Review the account’s current price before provisioning.

Hosted mode refuses to start without an HTTPS origin, an operator password hash, a random session secret, and an absolute persistent database path. Password sessions use HttpOnly/Secure/SameSite cookies, expiration and revocation, CSRF/origin checks, persistent login throttling, and generic error responses. APIs and exports require owner access. Secrets belong in the hosting provider, never in Git or chat.

## Source

```text
src/server/   API, configuration, auth, scheduler, commands, registry, accounting
src/client/   Typed dashboard, controls and execution inspector
src/shared/   API contracts shared by server and browser
migrations/   Checksum-verified SQLite schema migrations
public/       HTML, styles, icons; generated browser bundles are ignored
scripts/     Build and isolated browser/container verification
tests/       Financial, inspector, API/security and recovery tests
.railway/    TypeScript infrastructure definition
```

SQLite WAL and a single process suit this bounded staging simulation. The TypeScript migration preserves the original database schema and legacy command replay; stop the Python service and take a verified backup before switching an existing database. This architecture is not ready for horizontally scaled live financial operations. Those require PostgreSQL, durable external-action workflows, provider/webhook verification, payment reconciliation, verified capital, delivery artifacts, and model cost admission. See [implementation status](docs/implementation-status.md) and the [launch plan](docs/launch-plan.md).
