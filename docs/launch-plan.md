# Agent-operated digital company: launch plan

Status: implementation brief, not an operating company. No money has been deposited, spent, or earned. No external accounts have been created.

## Agreed direction

- Initial operating capital: $1,000.
- Products: digital assets and online services, with later exploration of disclosed referrals or digital-service coordination.
- Start without an existing brand, audience, product catalog, or business accounts.
- Operate autonomously within enforced permissions and financial limits.
- Never authorize commitments that would exhaust available funds; maintain a buffer for external liabilities.
- Target: $10,000 monthly operating profit in the third operating month. This is a stretch objective, not a projected outcome.

## First milestone

One real customer order, delivered correctly, with its payment and every cost reconciled. First implement and demonstrate the complete workflow with simulated transactions. Market demand will be measured through real, bounded experiments.

## First business hypothesis

Test useful digital marketing kits for a narrow small-business audience, with editable templates and a higher-priced customization service. Independent cleaning businesses are an initial candidate, not a validated niche.

Evaluate three candidate audiences before selecting one. Record public evidence of customer needs, existing offers, reachable buyers, pricing, production requirements, intellectual-property risks, and channel suitability. Avoid treating generated research or invented customer personas as evidence of demand.

Start with three product concepts and a small catalog. Validate files, editable formats, licenses, product descriptions, and delivery before publication. Offer customization only within demonstrated production capacity.

Etsy is a candidate acquisition and sales channel. Verify current seller eligibility, generated-content rules, disclosure requirements, fees, allowed automation, and supported API capabilities before implementing its live adapter. An owned storefront is an alternative; customer acquisition must still be proven. Do not assume an Etsy integration is already available.

## Capital and authority

Proposed starting envelopes, held centrally rather than in agent-owned wallets:

| Envelope | USD |
| --- | ---: |
| Protected reserve | 400 |
| Models, tools, hosting | 150 |
| Brand, store setup, listings | 100 |
| Creation and quality checks | 100 |
| Customer acquisition experiments | 150 |
| Additional opportunity tests | 100 |
| Total | 1,000 |

Proposed discretionary ceilings: $25 per action and $40 per UTC accounting day. These ceilings do not override envelope limits, outstanding reservations, or the protected reserve. Larger commitments become reviewable proposals. Set the operating timezone explicitly before live launch.

Available discretionary funds = settled cash minus protected reserve minus remaining obligations/reservations minus additional liability provisions. Avoid double-counting a commitment and its corresponding reservation. Receivables and unsettled payments do not increase spending authority.

Reserve the worst permitted cost before an action. Reject actions whose cost cannot be bounded. Recheck authority immediately before external execution. Reserve renewal costs or disable renewal; apply hard provider limits or prepaid arrangements where available. A provider budget that only sends alerts is not a hard spending control.

No borrowing, overdrafts, speculative investments, or uncapped advertising. Unknown external liabilities can exceed expectations; the system prevents unauthorized commitments but cannot guarantee a nonnegative balance under every external event. Halt discretionary activity if reconciliation fails or reserve coverage becomes insufficient.

An LLM cannot alter policy, release its own reservation, approve its own exception, or write authoritative financial records.

## Product architecture

Use a modular monolith, durable workflows, and separate workers. Recommended stack: TypeScript/Next.js dashboard, Python domain and agent services, PostgreSQL, and Temporal for workflow durability. Run dependencies locally for development; assess hosted costs before committing company capital.

Modules:

1. Treasury and append-only double-entry ledger.
2. Deterministic policy checks and atomic budget reservations.
3. Workflow execution, approvals, cancellation, and recovery.
4. Bounded agent tasks with structured proposals and model-cost ceilings.
5. Business/product/experiment records and evidence.
6. Execution adapters for simulation and approved external providers.
7. Operator dashboard and audit trail.

Use versioned schemas at module boundaries. Keep secrets in adapters, outside model context. Use database transactions and an outbox for state changes and workflow dispatch. Assume at-least-once delivery and implement idempotent handlers. Persist external receipts and use reconciliation to resolve ambiguous action outcomes.

Modes: simulation, shadow, live. Mark every action, account, and financial event with its mode. Prevent virtual balances or test credentials from authorizing live actions. Live mode starts disabled.

## First workflow

Opportunity evidence → experiment proposal → policy check → product creation → quality check → publication → order → delivery → payment reconciliation → outcome review → reinvestment proposal.

Product publication, promotion, and customer communication are separate action classes with separate permissions. Provider terms and legal eligibility determine which can be automated. External content and customer uploads cannot change instructions, permissions, or treasury rules.

Begin with four agent assignments: researcher, product creator, quality reviewer, and business operator. Finance and permissions remain deterministic services. Add roles only when there is a demonstrated bottleneck.

## Dashboard

- Overview: settled cash, reserved funds, liability provisions, discretionary availability, actual profit, current mode, and unresolved problems.
- Work: tasks, owners, dependencies, artifacts, cost, and reasons for blocking.
- Experiments/products: hypothesis, spend, impressions, qualified visits, purchases, refunds, and contribution.
- Decisions: proposed action, evidence, bounded cost, expected outcome, deadline, and approval controls.
- Finance/activity: reconciled ledger and objective → proposal → action → evidence → outcome history.

Operator commands: pause new actions, change an allocation, redirect an experiment, approve a bounded exception, or stop a business. Audit commands and apply policy revisions at execution time. Pausing cannot reverse transactions already completed externally.

## Profit and incentives

Operating profit subtracts delivery, supplier, marketplace, payment, acquisition, model, infrastructure, subscription, and refund costs. Report tax provisions separately. Track owner time and development costs explicitly; do not label the company self-sustaining while hiding necessary subsidized work.

Distinguish orders, recognized revenue, settled cash, contribution margin, and operating profit. Report third-month results alongside trailing-30-day results rather than silently substituting a projected run rate.

Rewards affect task selection, evaluations, and proposed budgets; they do not imply model-weight updates. Reward verified contribution, quality, cooperation, and well-designed learning experiments. Reduce permissions for operational failures or policy breaches. Capital allocations require opportunity evidence regardless of an agent's score.

## Demand experiments and expansion

Each experiment records an audience, problem, offer, acquisition channel, maximum spend, deadline, measurements, and stop/review criteria before launch. Review uncertain results without manufacturing confidence from a few visits or purchases.

Month 1: find evidence of demand, launch a small offer, obtain first reconciled sales.
Month 2: improve conversion and delivery, identify repeatable positive contribution after acquisition costs.
Month 3: scale proven offers within available capital; evaluate an adjacent service only if it does not endanger the core operation.

Expand by increasing experiment budgets gradually after verified results, not by creating more agents or catalogs automatically. Account for payout delays and refunds before reinvesting receipts.

Explore middleman models initially through disclosed referrals with approved partners. Supplier coordination requires bounded supplier pricing, verified quality/capacity, customer expectations, and liability assessment. Do not hold funds on behalf of third parties.

## Operating restrictions

- Licensed/original assets and accurate claims about provenance and rights.
- No fake reviews, spam, impersonation, or fabricated evidence.
- No bypassing account restrictions, platform rules, or identity checks.
- No regulated advice, speculative trading, gambling, or sensitive-data services initially.
- Minimize retained customer data and respect deletion and retention requirements.
- Reject work outside verified capability and capacity.

## Unresolved launch inputs

1. Country/jurisdiction and legal account owner: individual or existing company.
2. Whether the $1,000 covers operating expenses only or also software development.

These do not block local design or simulated implementation. They do affect seller onboarding, available providers, taxes, and affordability of live launch. A person must complete required identity verification and legal acceptance; agents may prepare the materials.

## Definition of ready for live experiments

- Identity, ownership, payout account, and seller eligibility resolved.
- Current platform rules reviewed and adapter actions supported.
- Real opening balance verified independently of simulation configuration.
- Treasury concurrency, idempotency, permissions, and reconciliation checks pass.
- A complete simulated order and failure recovery are visible in the dashboard.
- Product and delivery quality checked; support/refund workflow defined.
- Experiment costs and stopping criteria bounded.

