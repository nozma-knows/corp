# Corp · Company Lab

An observable operating core for an agent company, written in **TypeScript throughout**. The dashboard shows workers, positions, permissions, function ownership, routing, execution inputs/outputs, timing, and financial outcomes. Money and sales remain **virtual**. Real employee tasks use the official Codex SDK with **ChatGPT sign-in**. The team can create and review text deliverables; it does not publish assets, contact customers or move real money.

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
- **Messages**: a channel-based team board (`general`, `product-team`, `finance`). Employees share recorded task handoffs and finance decisions; you can post persistent owner notes. Messages are escaped, authenticated, bounded in the dashboard and protected against duplicate submissions. Send message saves an owner note; Ask team starts real model calls and saves the employees’ responses and deliverables.
- **Decisions**: proposed expenses awaiting your approval, tasks blocked by a worker or policy, and approved/declined expenses. Approvals use the existing financial checks; a paused company still permits declines and refunds.
- **Company map**: an illustrated office with Operations, Finance, Research, and Production/Quality rooms. Operator manages Scout, Studio and Review; Treasury reports directly to you. Select an employee for responsibilities and task-specific model recommendations. Replay actual recorded handoffs, with room highlights and communication bubbles. The replay is a view of past work and never executes another task.

Real team work is separate from virtual-sale simulation. Operator delegates to Scout, Scout briefs Studio, Studio passes its draft to Review, and Operator incorporates the review and returns the final deliverable. Each stage makes a real Codex call, saves the exact response and token usage when reported, and appears in Messages and Company map. Treasury never receives LLM authority. Previous history is preserved; old conversations are not invented.

## Connect ChatGPT and run a real task

1. Sign into the owner dashboard, open **Company map**, and click **Connect ChatGPT**.
2. Complete the official Codex device-code authorization with your ChatGPT account. Device-code login may need to be enabled in ChatGPT settings. No ChatGPT password or API key is entered into this app.
3. In **Messages**, enter a goal and click **Ask team**. Follow the actual replies, then open Company map for the saved work and final deliverable.

The official [Codex SDK](https://github.com/openai/codex/tree/main/sdk/typescript) wraps the Codex CLI. [Codex authentication](https://developers.openai.com/codex/auth) supports ChatGPT sign-in. Calls use the subscription’s Codex allowance and plan limits, not OpenAI API credits. API-key fallback is disabled. Account eligibility, exhausted allowance or revoked sign-in can block a task; the app does not purchase credits or retry blocked calls automatically.

Set `CORP_CODEX_MODEL_REASONING` and `CORP_CODEX_MODEL_FAST` to model IDs available to your Codex account if you want different models. Without these settings, Codex chooses its current default model. Operator, Scout and Review use medium/high reasoning; Studio uses low reasoning. Each handoff records the requested model (or explicitly says Codex default), reasoning effort, status, token counts and elapsed time. Unknown usage is shown as unknown; subscription dollar cost is not invented.

Admission is limited to one team task at a time and 20 tasks per rolling day, with five calls per task and a three-minute timeout per call. Pausing stops further stages after the current call; completed work remains saved. In-flight calls interrupted by a restart are marked interrupted and never replayed automatically. Calls happen outside synchronous SQLite transactions. Generated work cannot post sales or financial entries. The monetary action/daily limits are virtual ledger controls, not subscription-usage caps.

Codex authentication is stored in the private `codex` directory beside the SQLite database, on the Railway volume. This owner-only, single-account integration must not be exposed as a public shared model service. Do not copy credentials into Git or environment-variable/chat payloads. The SQLite backup command backs up the database, not the Codex login; sign in again after moving to a new server.

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

The [deployment runbook](docs/deployment.md) covers Railway configuration, secret generation, container testing, backups, recovery, and rollout checks. [`.railway/railway.ts`](.railway/railway.ts) defines one authenticated Docker service from `main` with persistent storage using TypeScript IaC. It needs a dedicated Railway project, sealed shared credentials, and a public domain targeting port 8000. The staging service is deployed in Railway; changes reach it through the configured GitHub source.

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
