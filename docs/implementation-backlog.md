# Implementation backlog

This is the build order. Completion requires demonstrated behavior, not only scaffolding. All early transactions are simulated and clearly labeled.

## 1. Domain foundation and financial controls

- Define versioned records for company, business, assignment, proposal, experiment, product, action, evidence, approval, and ledger transaction.
- Implement integer-minor-unit, double-entry accounting and mode isolation.
- Implement atomic reservations, envelope limits, liability provisions, and policy versions.
- Seed a virtual $1,000 opening balance; do not imply a real deposit.

Acceptance: balanced journal entries; concurrent requests cannot overspend; repeating a reservation request does not reserve twice; simulation cannot authorize live spending; corrections use reversing entries.

## 2. Durable execution and a simulated sales loop

- Implement action states: proposed, checked, awaiting approval where required, reserved, submitted, confirmed, reconciled; include rejected, cancelled, and ambiguous outcomes.
- Add transactional outbox and idempotency keys.
- Provide a simulated store/payment adapter with controlled sale, delay, timeout, duplicate event, and refund scenarios.
- Demonstrate an order, delivery artifact, settlement, costs, and resulting profit.

Acceptance: restart resumes the workflow; a timeout does not trigger an unverified duplicate charge; duplicate webhooks do not duplicate revenue; refunds update accounts correctly; paused actions cannot begin new external execution.

## 3. Operator dashboard

- Add overview, work, experiments/products, decisions, and finance/activity views.
- Connect views to authoritative API data.
- Add budget revisions, proposal review, and pause/resume commands with audit records.
- Show mode and whether figures are simulated, settled, or projected.

Acceptance: selecting an order explains its actions and financial outcome; pause works beyond the UI; operator authorization is enforced server-side; displayed totals agree with the ledger.

## 4. Bounded agent execution

- Implement structured researcher, creator, reviewer, and operator assignments.
- Assemble minimal context with evidence references.
- Bound model/tool spending, output size, retries, and wall-clock time.
- Persist model configuration, prompts/instruction versions, and results for inspection and replay.
- Validate output and require deterministic policy checks for every requested action.

Acceptance: malicious customer text cannot change permissions; invalid proposals fail safely; model failures do not loop indefinitely; agent estimates cannot overwrite observed results.

## 5. First business experiment

- Evaluate three niches with dated, attributable evidence.
- Select one offer and produce a small licensed/original product collection.
- Verify files, descriptions, delivery, and customization capacity.
- Define experiment budget, review deadline, and measurements.

Acceptance: selected niche is a recorded hypothesis; product checks pass; experiment economics include model, delivery, channel, and acquisition costs; no invented customers or sales.

## 6. Live provider adapter and launch

- Resolve jurisdiction, legal ownership, and scope of the $1,000.
- Confirm provider rules, API support, fees, account permissions, and customer obligations.
- Complete human-required account verification; store credentials securely.
- Reconcile the real opening balance and configure hard spending controls.
- Enable only validated action classes and run a bounded live experiment.

Acceptance: a real order is fulfilled and reconciled; ambiguous provider outcomes can be recovered; refunds and support work; reserves remain covered; no virtual cash enters real accounting.

## 7. Optimize and expand

- Analyze contribution, acquisition economics, quality, and forecast accuracy.
- Increase budgets only from settled funds and after demonstrated economics.
- Trial a related customization offer or disclosed referral agreement.
- Add adapter or agent roles only when an existing module boundary cannot serve the need.

Acceptance: scale decisions cite observed outcomes; full ongoing costs are reported; expansion is bounded and reversible where feasible.
