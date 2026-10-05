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
- **Company map**: a Gather-style pixel office rendered with Phaser, with walking characters, furniture, doors, and Operations, Finance, Strategy, and Product/Quality rooms. Click the floor or use arrow keys/WASD while the office is focused to move your avatar; touch direction buttons are also available. Select an employee for responsibilities, reporting lines and model recommendations. Operator manages Scout, Studio and Review; Treasury reports directly to you. Employees meet at the team table for live or selected saved handoffs, with actual recorded messages and distinct live, recorded, preview and blocked labels. Preview a meeting and replay controls never execute a task or call a model.

The office renderer loads only when Company map opens and stays mounted during dashboard updates. Art is generated locally without external assets. WebGL has a Canvas fallback; zoom, fit, motion pause and reduced-motion support keep the office usable on mobile and slower devices. The employee roster and task history remain accessible outside the canvas.

Real team work is separate from virtual-sale simulation. The in-house agent runtime starts with Operator and the owner's goal. Operator chooses useful subtasks for Scout, Studio or Review, waits for each result, then decides what to do next. Simple goals can finish in one turn; Studio work requires independent Review before final completion. Each turn makes a real Codex call and saves its response, requested action and reported usage. Actual handoffs appear in Messages and Company map; tool use keeps an employee at work rather than inventing a meeting. Treasury never receives LLM authority. Previous history is preserved; old conversations are not invented.

## In-house agent orchestration

The lightweight runtime owns scheduling, the agent loop, permissions, context, tool execution and persistence. Codex is the model transport. Employees can read virtual company state, save/read task artifacts, and save/read their own cross-task memory. Operator alone delegates and delivers the final result. Tool results feed the next model turn, so the workflow adapts to the goal rather than following a fixed sequence.

Open **Agent activity** on a task to see assignments, events and usage. **Stop team task** cancels queued or active work. Inspect an employee to view and clear its saved memories; clearing is disabled while a task is active. The [runtime design](docs/agent-runtime.md) describes the registered tools, state transitions and recovery rules.

## Connect ChatGPT and run a real task

1. Sign into the owner dashboard, open **Company map**, and click **Connect ChatGPT**.
2. Complete the official Codex device-code authorization with your ChatGPT account. Device-code login may need to be enabled in ChatGPT settings. No ChatGPT password or API key is entered into this app.
3. In **Messages**, enter a goal and click **Ask team**. Follow the actual replies, then open Company map for the saved work and final deliverable.

The official [Codex SDK](https://github.com/openai/codex/tree/main/sdk/typescript) wraps the Codex CLI. [Codex authentication](https://developers.openai.com/codex/auth) supports ChatGPT sign-in. Calls use the subscription’s Codex allowance and plan limits, not OpenAI API credits. API-key fallback is disabled. Account eligibility, exhausted allowance or revoked sign-in can block a task; the app does not purchase credits or retry blocked calls automatically.

Set `CORP_CODEX_MODEL_REASONING` and `CORP_CODEX_MODEL_FAST` to model IDs available to your Codex account if you want different models. Without these settings, Codex chooses its current default model. Operator, Scout and Review use medium/high reasoning; Studio uses low reasoning. Each handoff records the requested model (or explicitly says Codex default), reasoning effort, status, token counts and elapsed time. Unknown usage is shown as unknown; subscription dollar cost is not invented.

Admission is limited to one team task at a time and 20 tasks per rolling day. A task stops at 12 model calls, a 60,000 reported-token threshold, ten minutes total, or three minutes per call. Token usage is known only after a response, so the last response can exceed the threshold; its action will not execute in that case. Unknown usage remains unknown and the call/time limits still apply. Pausing preserves the current response and stops subsequent tools or calls. Owner cancellation stops immediately; a call may already have consumed subscription usage. In-flight calls interrupted by a restart are marked interrupted and never replayed automatically. Calls happen outside synchronous SQLite transactions. Generated work cannot post sales or financial entries. The monetary action/daily limits are virtual ledger controls, not subscription-usage caps.

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

The browser check uses an isolated authenticated company and captures the four workspace views, persisted owner notes, incoming-message draft preservation, adaptive agent delegation, memory save/clear, in-flight cancellation, decisions, worker and financial controls, session behavior, mobile width, and 200% text. Office checks cover walking, furniture collisions, character inspection, meetings, live task status using a fixture provider, retained canvas, zoom, motion pause, reduced motion and the Canvas fallback. Installed `/usr/bin/chromium` or `CORP_CHROMIUM_PATH` is also supported. Test artifacts and databases are ignored by Git. GitHub Actions runs these checks, a production dependency audit, and a container persistence/backup smoke test.

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
