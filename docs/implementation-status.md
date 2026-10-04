# Implementation status

The runtime, browser application, shared contracts, and tests are TypeScript. Fastify handles HTTP; Node 24's built-in SQLite provides WAL persistence. Server, accounting, workflows, worker registry, inspection, and presentation have separate modules. Dependencies are locked and audited in CI.

Implemented:

- Virtual opening capital, protected reserve, integer cents, balanced append-only journals.
- Atomic reservations, refund coverage, envelope budgets, spending limits and execution-time policy checks.
- Persistent idempotent successes/denials, rollback, pause/resume, cancellation, refunds, and atomic scripted ticks.
- Worker positions, hierarchy, owned functions, boundaries, disable/enable control, durable execution spans and nested accounting links.
- Eight dashboard views, truthful zero-inference reporting, responsive controls and workflow inspection.
- Hosted owner sessions, HTTPS configuration checks, CSRF/origin protection, login throttling, protected API/export, request IDs and security headers.
- Checksum-verified migrations, startup integrity checks, verified online backups and restore tests.
- Non-root container, persistent-volume deployment blueprint, readiness/liveness, graceful shutdown, CI and isolated browser/container smoke checks.

This is an authenticated staging **simulation**. Its money, customers, products, delivery and worker decisions are illustrative. No model credentials, marketplace accounts, generated assets, live revenue, outreach, or payments exist. No inference destination is invented. Old pre-inspector cycles are not backfilled with fabricated history.

Next work: validate a niche with attributable evidence; implement bounded model proposals and measured inference cost; create licensed deliverables; establish the legal seller/country and verified capital; connect permitted sales/payment providers; build durable outbox/webhook/reconciliation workflows; implement reward evaluation, reinvestment and evidence-based expansion. A seller account and provider credentials remain human onboarding steps.

One instance with SQLite is the supported deployment topology. Move to PostgreSQL and durable workflow processing before horizontal scaling or real financial operations. A virtual reserve cannot guarantee protection from future external liabilities. Hosting availability and provider charges are separate from the virtual ledger until real reconciliation is implemented.
