import type { DashboardState, CompanyEvent } from '../shared/contracts.js';
import { money, escape as e, date } from './api.js';
import { icon } from './icons.js';
import { companyMap, inferenceView, inspectorDialog } from './inspector.js';
export { icon } from './icons.js';

export const pages = [
  ['overview', 'Overview', 'grid'],
  ['team', 'Agent team', 'team'],
  ['company', 'Company map', 'link'],
  ['businesses', 'Businesses', 'store'],
  ['inference', 'Execution & inference', 'activity'],
  ['treasury', 'Treasury', 'wallet'],
  ['activity', 'Activity', 'activity'],
  ['settings', 'Controls', 'sliders'],
];

function heading(title: string, description: string, s: DashboardState) {
  return `<div class="page-heading"><div><div class="eyebrow">YOUR COMPANY WORKSPACE</div><h1>${title}</h1><p>${description}</p></div><div class="heading-actions"><button class="button secondary" data-action="pause">${icon(s.company.paused ? 'play' : 'pause')}${s.company.paused ? 'Resume company' : 'Pause company'}</button><button class="button primary" data-action="cycle" ${s.company.paused ? 'disabled' : ''}>${icon('play')}Run a cycle</button></div></div>`;
}

function tag(label: string | number, type = 'neutral') {
  return `<span class="tag ${type}">${e(label)}</span>`;
}
function empty(title: string, text: string) {
  return `<div class="empty-state">${icon('activity')}<strong>${title}</strong><p>${text}</p></div>`;
}

function metric(label: string, value: string | number, note: string, type = '', symbol = 'wallet') {
  return `<div class="metric ${type}"><div class="metric-top"><span>${label}</span>${icon(symbol)}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></div>`;
}

function capital(s: DashboardState) {
  const c = s.company;
  const total = Math.max(c.cash_minor, 1);
  const parts: [string, number, string][] = [
    ['Protected reserve', c.reserve_minor, 'protected'],
    ['Refund coverage', c.refund_buffer_minor, 'refund'],
    ['Pending commitments', c.reserved_minor, 'pending'],
    ['Available to spend', c.available_minor, 'available'],
  ];
  return `<section class="card capital-card"><div class="card-heading"><h2>Capital, under control</h2>${tag(c.policy_healthy ? 'Protected' : 'Needs attention', c.policy_healthy ? 'green' : 'orange')}</div><div class="capital-total">${money(c.cash_minor)}<span>settled virtual cash</span></div><div class="capital-bar" role="img" aria-label="Capital allocation">${parts.map(([label, amount, color]) => `<span class="${color}" style="width:${Math.min(100, (amount / total) * 100)}%" title="${label}: ${money(amount)}"></span>`).join('')}</div><div class="capital-legend">${parts.map(([label, amount, color]) => `<div><span><i class="legend-dot ${color}"></i>${label}</span><strong>${money(amount)}</strong></div>`).join('')}</div><div class="card-footnote">Sale proceeds stay reserved for possible refunds for 30 days.</div></section>`;
}

function timeline(events: CompanyEvent[], limit = 5) {
  return events.length
    ? `<div class="timeline">${events
        .slice(0, limit)
        .map(
          (item) =>
            `<div class="timeline-item"><span class="timeline-node ${item.kind === 'blocked' ? 'orange' : ''}">${icon(item.kind === 'refund' ? 'wallet' : item.kind === 'control' ? 'sliders' : 'check')}</span><div><div class="timeline-top"><strong>${e(item.title)}</strong><span>${date(item.created_at)}</span></div><p>${e(item.detail)}</p><span class="actor">${e(item.actor)}</span>${item.reference ? `<button class="text-button trace-link" data-action="trace" data-id="${e(item.reference)}">Follow outcome ${icon('arrow')}</button>` : ''}</div></div>`,
        )
        .join('')}</div>`
    : empty('A clean starting point', 'Company actions will appear here.');
}

function agentCards(s: DashboardState, compact = false) {
  return `<div class="${compact ? 'agent-row' : 'team-grid'}">${s.roles
    .map((role, index) => {
      const worker = s.inspector.workers.find((worker) => worker.id === role.id)!;
      const count = worker.execution_count;
      return `<article class="${compact ? 'agent-small' : 'card agent-card'}"><div class="agent-avatar role-${index}">${icon(['activity', 'store', 'check', 'sliders'][index])}</div><div class="agent-info"><button class="agent-name" data-action="worker-detail" data-id="${role.id}">${role.name}</button><span>${compact ? role.role : role.position}</span>${compact ? '' : `<p>${role.purpose}</p><div class="agent-detail">${count} recorded function${count === 1 ? '' : 's'}<br>Engine: local rules · ${worker.function_ids.length} owned function${worker.function_ids.length === 1 ? '' : 's'}</div>`}</div><span class="agent-status ${s.company.auto_enabled ? 'running' : ''}">${!worker.enabled ? 'Disabled' : s.company.paused ? 'Paused' : s.company.auto_enabled ? 'Scheduled' : 'Ready'}</span></article>`;
    })
    .join('')}</div>`;
}

function productCards(s: DashboardState) {
  return `<div class="product-grid">${s.products.map((p, index) => `<article class="product-card"><div class="product-art ${e(p.color)}"><div class="product-sheet"><div class="product-sheet-line"></div><span>${['BRIGHT<br>SPACES.', 'YOUR<br>SERVICES.', 'MAKE IT<br>YOURS.'][index]}</span><div class="product-sheet-lines"><i></i><i></i><i></i></div><small>${['SOCIAL TEMPLATE KIT', 'EDITABLE SERVICE MENU', 'CUSTOM BRAND STARTER'][index]}</small></div><div class="product-mini-sheet"><span>${['HELLO<br>FRESH.', 'SIMPLY<br>CLEAR.', 'YOUR<br>BRAND.'][index]}</span></div><span class="concept-label">PRODUCT CONCEPT</span></div><div class="product-content"><div class="product-title"><h3>${e(p.title)}</h3>${tag('Simulation')}</div><p>${e(p.audience)}</p><div class="product-numbers"><div><small>Scenario price</small><strong>${money(p.price_minor)}</strong></div><div><small>Contribution / sale</small><strong>${money(p.price_minor - p.delivery_cost_minor)}</strong></div></div><div class="product-bottom"><span>${p.orders} virtual orders</span><button class="text-button" data-action="product-cycle" data-id="${e(p.id)}" ${s.company.paused ? 'disabled' : ''}>Test sale ${icon('arrow')}</button></div></div></article>`).join('')}</div>`;
}

function budgets(s: DashboardState, full = false) {
  return `<section class="card"><div class="card-heading"><h2>Operating budgets</h2><button class="text-button" data-action="allocations">Reallocate ${icon('arrow')}</button></div><div class="budget-list">${s.envelopes.map((row) => `<div class="budget-row"><div class="budget-label"><span>${e(row.label)}</span><span><strong>${money(row.remaining_minor)}</strong> <small>/ ${money(row.budget_minor)} left</small></span></div><div class="budget-track"><span class="spent" style="width:${row.budget_minor ? (row.spent_minor / row.budget_minor) * 100 : 0}%"></span><span class="reserved" style="width:${row.budget_minor ? (row.reserved_minor / row.budget_minor) * 100 : 0}%"></span></div>${full ? `<p class="budget-note">${money(row.spent_minor)} spent · ${money(row.reserved_minor)} reserved</p>` : ''}</div>`).join('')}</div><div class="card-footnote">${money(s.company.spent_today_minor)} spent today · ${money(s.company.daily_limit_minor)} daily ceiling</div></section>`;
}

function actions(s: DashboardState) {
  return `<section class="card"><div class="card-heading"><h2>Experiments & commitments</h2><button class="text-button" data-action="experiment">${icon('plus')}New experiment</button></div>${s.actions.length ? `<div class="action-list">${s.actions.map((a) => `<div class="action-row"><div><strong>${e(a.title)}</strong><small>${e(s.envelopes.find((row) => row.id === a.envelope_id)?.label || a.envelope_id)} · ${money(a.amount_minor)}</small></div><div class="action-controls">${tag(a.status, a.status === 'reserved' ? 'orange' : 'neutral')}${a.status === 'reserved' ? `<button class="button small secondary" data-action="cancel" data-id="${a.id}">Cancel</button><button class="button small primary" data-action="execute" data-id="${a.id}" ${s.company.paused ? 'disabled' : ''}>Execute</button>` : ''}</div></div>`).join('')}</div>` : empty('No committed experiments yet', 'Reserve a bounded amount, then execute or cancel the simulated expense.')}</section>`;
}

function orders(s: DashboardState) {
  return `<section class="card"><div class="card-heading"><h2>Simulated orders</h2>${tag(`${s.company.order_count} total`)}</div>${s.orders.length ? `<div class="table-scroll"><table><thead><tr><th>Product</th><th>Created</th><th>Revenue</th><th>Cost</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${s.orders.map((o) => `<tr><td><strong>${e(o.title)}</strong><small class="cell-sub">${o.id.slice(0, 8)}</small></td><td>${date(o.created_at)}</td><td>${money(o.status === 'refunded' ? 0 : o.gross_minor)}</td><td>${money(o.cost_minor)}</td><td>${tag(o.status, o.status === 'delivered' ? 'green' : 'orange')}</td><td>${o.status !== 'refunded' ? `<button class="text-button" data-action="refund" data-id="${o.id}">Refund</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('Your first order starts here', 'Run a scripted cycle to follow a virtual sale through delivery and accounting.')}</section>`;
}

function ledger(s: DashboardState) {
  return `<section class="card"><div class="card-heading"><h2>Append-only financial ledger</h2><a class="text-button" href="/api/ledger/export.csv">Export CSV ${icon('arrow')}</a></div><div class="table-scroll"><table><thead><tr><th>Transaction</th><th>Recorded</th><th>Type</th><th>Cash movement</th><th><span class="sr-only">Details</span></th></tr></thead><tbody>${s.ledger
    .map((t) => {
      const amount = t.lines.find((line) => line.account === 'cash')?.amount_minor || 0;
      return `<tr><td><strong>${e(t.description)}</strong><small class="cell-sub">${t.id.slice(0, 8)}</small></td><td>${date(t.created_at)}</td><td>${tag(t.kind)}</td><td class="money-cell ${amount > 0 ? 'positive' : ''}">${amount > 0 ? '+' : ''}${money(amount)}</td><td><button class="text-button" data-action="journal" data-id="${t.id}">Inspect</button></td></tr>`;
    })
    .join(
      '',
    )}</tbody></table></div><div class="card-footnote">Corrections add entries. Existing financial records cannot be edited or deleted.</div></section>`;
}

export function render(page: string, s: DashboardState) {
  const c = s.company;
  if (page === 'company')
    return `${heading('See how the company works.', 'Workers, positions, function ownership, and the connections between them.', s)}${companyMap(s)}`;
  if (page === 'inference')
    return `${heading('Follow every execution.', 'Inspect function calls, destinations, timing, and financial outcomes.', s)}${inferenceView(s)}`;
  if (page === 'overview') {
    const targetProgress = Math.max(
      0,
      Math.min(100, (c.profit_minor / s.capabilities.profit_target_minor) * 100),
    );
    return `${heading('Your company, at a glance.', 'Follow the work. Control the capital. Understand every outcome.', s)}
    <div class="metrics">${metric('Settled cash', money(c.cash_minor), 'Started with $1,000 virtual capital')}${metric('Available to spend', money(c.available_minor), 'After reserves & commitments')}${metric('Operating profit', money(c.profit_minor), 'All recorded scenario costs included', c.profit_minor < 0 ? 'negative' : 'profit', 'activity')}${metric('Completed orders', c.order_count, `${c.refund_count} refunds · virtual customers`, '', 'store')}</div>
    <div class="overview-grid">${capital(s)}<section class="card recent-card"><div class="card-heading"><h2>What’s happening</h2><a class="text-button" href="#activity">All activity ${icon('arrow')}</a></div>${timeline(s.events, 4)}</section></div>
    <section class="team-strip"><div class="card-heading"><h2>Your operating team</h2><span class="muted">4 scripted roles</span></div>${agentCards(s, true)}<div class="team-strip-footer"><span><i class="status-dot ${c.auto_enabled ? 'active' : ''}"></i>${c.paused ? 'Company paused' : c.auto_enabled ? 'Auto-run enabled · one cycle every 15 seconds' : 'Ready for the first cycle'}</span><button class="text-button" data-action="automation" ${c.paused ? 'disabled' : ''}>${c.auto_enabled ? 'Stop auto-run' : 'Start auto-run'} ${icon('arrow')}</button></div></section>
    <div class="bottom-grid">${budgets(s)}<section class="card next-card"><div class="eyebrow">NEXT REAL-WORLD MILESTONE</div><h2>Prove someone<br>will buy.</h2><p>Choose one niche, create a useful digital offer, and test demand with a bounded budget.</p><div class="milestone-list"><div>${icon('check')}Operating controls in place</div><div><span class="step-circle">2</span>Validate a niche & product</div><div><span class="step-circle">3</span>Connect a verified seller account</div></div><div class="goal-row"><span>Month 3 stretch target</span><strong>$10,000 / month</strong></div><div class="goal-track"><span style="width:${targetProgress}%"></span></div><small>Real operating profit. Simulated results do not validate demand.</small></section></div>`;
  }
  if (page === 'team')
    return `${heading('A small team. Shared outcomes.', 'Inspect each role before adding more agents or autonomy.', s)}${agentCards(s)}<section class="card info-card"><h2>How the team works</h2><p>Each cycle follows a fixed scenario: select a hypothesis, prepare a deliverable, record a quality stage, then deliver and reconcile an order. These roles are scripted; no language model or customer is involved.</p><div class="workflow-chain">${s.roles.map((r, i) => `<span><small>0${i + 1}</small>${r.role}</span>${i < 3 ? icon('arrow') : ''}`).join('')}</div><p>Future model-backed agents will submit structured proposals. Treasury checks and financial records remain outside their authority.</p></section>`;
  if (page === 'businesses')
    return `${heading('Start narrow. Learn, then grow.', 'Digital assets and customization are the first business hypotheses.', s)}<div class="business-banner"><div><span class="eyebrow">BUSINESS 01</span><h2>Digital product studio</h2><p>A small collection for service businesses. Prices and costs below are illustrative simulation inputs.</p></div>${tag('Not launched', 'orange')}</div>${productCards(s)}${actions(s)}${orders(s)}`;
  if (page === 'treasury')
    return `${heading('Every dollar has a job.', 'Inspect cash, commitments, budget allocations, and balanced journal entries.', s)}<div class="overview-grid">${capital(s)}${budgets(s, true)}</div>${actions(s)}${orders(s)}${ledger(s)}`;
  if (page === 'activity')
    return `${heading('Follow the decisions.', 'A persistent record of work, controls, and financial outcomes.', s)}<section class="card full-timeline"><div class="card-heading"><h2>Company activity</h2>${tag('Latest 100 events')}</div>${timeline(s.events, 100)}</section>`;
  return `${heading('Autonomy with boundaries.', 'Change company limits. Pause work whenever you need to intervene.', s)}<div class="controls-grid"><section class="card control-card"><div class="card-heading"><h2>Company execution</h2>${tag(c.paused ? 'Paused' : 'Ready', c.paused ? 'orange' : 'green')}</div><p>Pause blocks new expenses and cycles. Cancellations and customer refunds remain available.</p><button class="button ${c.paused ? 'primary' : 'secondary'}" data-action="pause">${icon(c.paused ? 'play' : 'pause')}${c.paused ? 'Resume company' : 'Pause company'}</button><hr><div class="card-heading"><h2>Automatic simulation</h2>${tag(c.auto_enabled ? 'Running' : 'Off', c.auto_enabled ? 'green' : 'neutral')}</div><p>Run one scripted sale every 15 seconds. Stops automatically when a financial limit blocks the next cycle.</p><button class="button secondary" data-action="automation" ${c.paused ? 'disabled' : ''}>${c.auto_enabled ? 'Stop auto-run' : 'Start auto-run'}</button></section><section class="card control-card"><div class="card-heading"><h2>Spending policy</h2><button class="text-button" data-action="policy">Edit limits ${icon('arrow')}</button></div><dl class="policy-list"><div><dt>Per-action ceiling</dt><dd>${money(c.action_limit_minor)}</dd></div><div><dt>Daily spending ceiling</dt><dd>${money(c.daily_limit_minor)}</dd></div><div><dt>Protected reserve</dt><dd>${money(c.reserve_minor)}</dd></div><div><dt>Borrowing / overdrafts</dt><dd>Disabled</dd></div><div><dt>Real-world execution</dt><dd>Disabled</dd></div><div><dt>Policy revision</dt><dd>${c.policy_version}</dd></div></dl><p>Changing a limit never overrides available funds, refund provisions, or budget allocations. The $400 reserve floor stays protected.</p></section></div><section class="card info-card"><h2>What comes before live operation</h2><p>Confirm the legal seller and operating country, verify marketplace rules, connect payment and sales providers, and test reconciliation and delivery. This app has owner sign-in but no external accounts, live adapters, or model credentials.</p><p>Results measure this simulation’s accounting behavior. They do not predict revenue or establish product-market fit.</p></section>`;
}

export function dialog(kind: string, s: DashboardState, id?: string) {
  const close =
    '<button class="dialog-close" data-action="close" aria-label="Close dialog">×</button>';
  const head = (title: string, text: string) =>
    `<div class="dialog-header">${close}<span class="eyebrow">COMPANY CONTROL</span><h2 id="modal-title">${title}</h2><p>${text}</p></div>`;
  if (['worker-detail', 'run-detail'].includes(kind)) return inspectorDialog(kind, s, id, head);
  const footer = (label: string) =>
    `<div class="form-error" role="alert"></div><div class="dialog-footer"><button type="button" class="button secondary" data-action="close">Cancel</button><button class="button primary" type="submit">${label}</button></div>`;
  if (kind === 'experiment')
    return `${head('Reserve an experiment budget', 'Funds are held now. No expense is recorded until you execute the simulated experiment.')}<form data-form="experiment"><label>Experiment name<input name="title" required minlength="3" maxlength="120" placeholder="Test two listing designs"></label><label>Budget envelope<select name="envelope_id">${s.envelopes.map((row) => `<option value="${row.id}" ${row.id === 'customer_acquisition' ? 'selected' : ''}>${e(row.label)} · ${money(row.remaining_minor)} left</option>`).join('')}</select></label><label>Maximum cost (USD)<input name="amount" type="number" min="0.01" step="0.01" max="${s.company.action_limit_minor / 100}" value="12" required></label><p class="form-hint">Per-action limit: ${money(s.company.action_limit_minor)}. No real advertising will be purchased.</p>${footer('Reserve funds')}</form>`;
  if (kind === 'policy')
    return `${head('Set spending limits', 'Current policy is checked again immediately before execution.')}<form data-form="policy"><label>Per-action ceiling (USD)<input name="action" type="number" min="0.01" max="600" step="0.01" value="${s.company.action_limit_minor / 100}" required></label><label>Daily spending ceiling (USD)<input name="daily" type="number" min="0.01" max="600" step="0.01" value="${s.company.daily_limit_minor / 100}" required></label><p class="form-hint">Daily spending uses UTC. Pending reservations also count against admission limits.</p>${footer('Save limits')}</form>`;
  if (kind === 'allocations')
    return `${head('Reallocate operating capital', 'Move funds between envelopes. Allocations may total at most $600; spent and reserved funds cannot be removed.')}<form data-form="allocations">${s.envelopes.map((row) => `<label>${e(row.label)}<input name="${row.id}" type="number" min="${(row.spent_minor + row.reserved_minor) / 100}" max="600" step="0.01" value="${row.budget_minor / 100}" required></label>`).join('')}${footer('Save allocations')}</form>`;
  if (kind === 'journal') {
    const tx = s.ledger.find((row) => row.id === id);
    if (!tx)
      return head(
        'Transaction unavailable',
        'This entry is outside the latest 100 displayed transactions. Export the ledger for full history.',
      );
    return `${head('Inspect a journal entry', e(tx.description))}<div class="journal-detail"><div class="journal-meta">${tag(tx.kind)}<span>${date(tx.created_at)}</span></div><table><thead><tr><th>Account</th><th>Debit</th><th>Credit</th></tr></thead><tbody>${tx.lines.map((line) => `<tr><td>${e(line.account)}</td><td>${line.amount_minor > 0 ? money(line.amount_minor) : '—'}</td><td>${line.amount_minor < 0 ? money(-line.amount_minor) : '—'}</td></tr>`).join('')}</tbody></table><div class="journal-balanced">${icon('check')}Balanced: debits equal credits</div><small>Transaction ${e(tx.id)}</small></div>`;
  }
  if (kind === 'trace') {
    const events = s.events.filter((row) => row.reference === id).reverse();
    const order = s.orders.find((row) => row.id === id);
    const txs = s.ledger.filter((row) => row.reference === id);
    return `${head('Follow the outcome', order ? e(order.title) : 'Experiment decisions and accounting')}<div class="trace-content">${timeline(events, 100)}${order ? `<dl class="policy-list"><div><dt>Virtual revenue</dt><dd>${money(order.status === 'refunded' ? 0 : order.gross_minor)}</dd></div><div><dt>Retained costs</dt><dd>${money(order.cost_minor)}</dd></div><div><dt>Contribution</dt><dd>${money((order.status === 'refunded' ? 0 : order.gross_minor) - order.cost_minor)}</dd></div></dl>` : ''}<h3>Related financial entries</h3>${txs.length ? txs.map((tx) => `<div class="trace-finance">${e(tx.description)} ${tag(tx.kind)}</div>`).join('') : '<p>No expense recorded yet.</p>'}</div>`;
  }
  if (kind === 'refund') {
    const order = s.orders.find((row) => row.id === id);
    if (!order)
      return head('Order unavailable', 'This order is outside the latest 100 displayed orders.');
    return `${head('Refund this virtual order?', e(order.title))}<form data-form="refund" data-id="${id}"><p class="refund-confirm">Return <strong>${money(order.gross_minor)}</strong> to the simulated customer. The ${money(order.cost_minor)} production and channel cost remains an expense.</p>${footer('Record full refund')}</form>`;
  }
  return '';
}
