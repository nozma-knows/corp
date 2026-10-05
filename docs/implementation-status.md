# Implementation status

The runtime, browser application, shared contracts, and tests are TypeScript. Fastify handles HTTP; Node 24's built-in SQLite provides WAL persistence. Server, accounting, workflows, worker registry, inspection, and presentation have separate modules. Dependencies are locked and audited in CI.

Implemented:

- Virtual opening capital, protected reserve, integer cents, balanced append-only journals.
- Atomic reservations, refund coverage, envelope budgets, spending limits and execution-time policy checks.
- Persistent idempotent successes/denials, rollback, pause/resume, cancellation, refunds, and atomic scripted ticks.
- Worker positions, hierarchy, owned functions, boundaries, disable/enable control, durable execution spans and nested accounting links.
- Four dashboard views: Balance, Messages, Decisions and Company map, with responsive controls and saved team handoffs.
- Real, bounded employee text tasks through the official Codex SDK and owner ChatGPT sign-in; persistent responses, generated deliverables, token usage, configurable model routes and reasoning effort.
- Separate async model execution with durable admission, no automatic retry of interrupted calls, owner-only device sign-in and private persistent authentication.
- Hosted owner sessions, HTTPS configuration checks, CSRF/origin protection, login throttling, protected API/export, request IDs and security headers.
- Checksum-verified migrations, startup integrity checks, verified online backups and restore tests.
- Non-root application container, Railway TypeScript infrastructure and root-owned volume initialization, readiness/liveness, graceful shutdown, CI and isolated browser/container smoke checks.

The ledger and sales remain an authenticated staging **simulation**. After the owner completes ChatGPT sign-in, employee text tasks make real Codex calls and save actual responses. Marketplace accounts, live revenue, outreach and payments are not connected. Generated drafts do not imply publication or verified demand. Old pre-inspector cycles are not backfilled with fabricated history. Subscription usage is reported separately from virtual money; unknown dollar cost is not invented.

Next work: validate a niche with attributable evidence; verify subscription-backed operation after owner sign-in and measure allowance consumption; create licensed deliverables; establish the legal seller/country and verified capital; connect permitted sales/payment providers; build durable outbox/webhook/reconciliation workflows; implement reward evaluation, reinvestment and evidence-based expansion. A seller account and provider credentials remain human onboarding steps.

One instance with SQLite is the supported deployment topology. Move to PostgreSQL and durable workflow processing before horizontal scaling or real financial operations. A virtual reserve cannot guarantee protection from future external liabilities. Hosting availability and provider charges are separate from the virtual ledger until real reconciliation is implemented.
