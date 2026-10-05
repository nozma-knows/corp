import type { DashboardState, MessageChannel, TeamMessage, WorkerId } from '../shared/contracts.js';
import { modelPlans } from '../shared/model-policy.js';
import { money, escape as e, date } from './api.js';
import { icon } from './icons.js';
import { dialog as financialDialog } from './views.js';
export { icon } from './icons.js';

export const pages = [
  ['balance', 'Balance', 'wallet'],
  ['messages', 'Messages', 'team'],
  ['decisions', 'Decisions', 'check'],
  ['company', 'Company map', 'link'],
];
export const channels: { id: MessageChannel; name: string; description: string }[] = [
  { id: 'general', name: 'general', description: 'Company updates and notes from you.' },
  {
    id: 'product',
    name: 'product-team',
    description: 'Scout, Studio and Review coordinate with Operator and Treasury.',
  },
  {
    id: 'finance',
    name: 'finance',
    description: 'Treasury reports on settlement and protected funds.',
  },
];
export interface WorkspaceUI {
  channel: MessageChannel;
  draft: string;
  step: number;
  replaying: boolean;
}
const tag = (label: string, kind = '') => `<span class="tag ${kind}">${e(label)}</span>`;
const name = (id: TeamMessage['sender_id'], s: DashboardState) =>
  id === 'owner' ? 'You' : (s.inspector.workers.find((w) => w.id === id)?.name ?? id);
const avatar = (id: TeamMessage['sender_id'], s: DashboardState) =>
  `<span class="employee-avatar employee-${id}" aria-hidden="true">${e(name(id, s).slice(0, 1))}</span>`;
const status = (id: WorkerId, s: DashboardState) =>
  !s.inspector.workers.find((w) => w.id === id)?.enabled
    ? 'Disabled'
    : s.company.paused
      ? 'Paused'
      : 'Ready';
const empty = (title: string, text: string) =>
  `<div class="simple-empty"><span class="empty-symbol">${icon('team')}</span><h3>${e(title)}</h3><p>${e(text)}</p></div>`;
function heading(title: string, subtitle: string, s: DashboardState) {
  return `<div class="page-heading"><div><span class="eyebrow">YOUR COMPANY</span><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions"><button class="button secondary" data-action="pause">${icon(s.company.paused ? 'play' : 'pause')}${s.company.paused ? 'Resume company' : 'Pause company'}</button><button class="button primary" data-action="cycle" ${s.company.paused ? 'disabled' : ''}>${icon('play')}Start team task</button></div></div>`;
}

function balance(s: DashboardState) {
  const c = s.company;
  return `${heading('Balance', 'A clear picture of your company’s money.', s)}
  <section class="balance-hero"><div><span class="eyebrow">COMPANY BALANCE · VIRTUAL USD</span><div class="balance-amount">${money(c.cash_minor)}</div><p>${money(c.available_minor)} available to spend</p></div><div class="balance-result"><span>Net profit</span><strong class="${c.profit_minor < 0 ? 'negative' : 'positive'}">${c.profit_minor > 0 ? '+' : ''}${money(c.profit_minor)}</strong><small>${c.order_count} order${c.order_count === 1 ? '' : 's'} · ${c.refund_count} refund${c.refund_count === 1 ? '' : 's'}</small></div></section>
  <div class="balance-breakdown"><div><span>Protected reserve</span><strong>${money(c.reserve_minor)}</strong><small>Always kept safe</small></div><div><span>Refund coverage</span><strong>${money(c.refund_buffer_minor)}</strong><small>Held for customer refunds</small></div><div><span>Awaiting decisions</span><strong>${money(c.reserved_minor)}</strong><a href="#decisions">Review commitments ${icon('arrow')}</a></div></div>
  <section class="card"><div class="card-heading"><h2>Money in & out</h2><a class="text-button" href="/api/ledger/export.csv">Export CSV ${icon('arrow')}</a></div><div class="money-list">${s.ledger
    .slice(0, 8)
    .map((tx) => {
      const amount = tx.lines.find((line) => line.account === 'cash')?.amount_minor ?? 0;
      return `<button class="money-row" data-action="journal" data-id="${tx.id}"><span class="money-symbol ${amount >= 0 ? 'incoming' : 'outgoing'}">${icon(amount >= 0 ? 'arrow' : 'wallet')}</span><span class="money-description"><strong>${e(tx.description.replace('Simulated ', '').replace('Virtual ', ''))}</strong><small>${date(tx.created_at)}</small></span><strong class="${amount >= 0 ? 'positive' : ''}">${amount > 0 ? '+' : ''}${money(amount)}</strong></button>`;
    })
    .join('')}</div></section>
  <details class="card company-settings"><summary>Company settings & order history</summary><div class="settings-buttons"><button class="button secondary" data-action="policy">Spending limits</button><button class="button secondary" data-action="allocations">Team budgets</button><button class="button secondary" data-action="automation" ${c.paused && !c.auto_enabled ? 'disabled' : ''}>${c.auto_enabled ? 'Stop automatic tasks' : 'Enable automatic tasks'}</button></div><p>${money(c.action_limit_minor)} per action · ${money(c.daily_limit_minor)} daily limit. Automatic tasks run every 15 seconds.</p>${s.orders.length ? s.orders.map((order) => `<div class="order-summary"><span>${e(order.title)}<small>${date(order.created_at)} · ${e(order.status)}</small></span>${order.status === 'delivered' ? `<button class="text-button" data-action="refund" data-id="${order.id}">Refund</button>` : tag('Refunded')}</div>`).join('') : '<p>No orders yet. Start a team task to follow the first one.</p>'}</details>`;
}

function messageRow(message: TeamMessage, s: DashboardState) {
  const recipient = message.recipient_id
    ? `<span class="message-to">to ${e(name(message.recipient_id, s))}</span>`
    : '';
  return `<article class="team-message" data-message-id="${message.id}">${avatar(message.sender_id, s)}<div class="message-content"><div class="message-meta"><strong>${e(name(message.sender_id, s))}</strong>${recipient}<time datetime="${new Date(message.created_at * 1000).toISOString()}">${date(message.created_at)}</time>${message.run_id ? '<span class="message-task-label">Task update</span>' : `<span class="message-task-label">${message.sender_id === 'owner' ? 'Owner note' : 'Team update'}</span>`}</div><p>${e(message.body)}</p></div></article>`;
}
function messages(s: DashboardState, ui: WorkspaceUI) {
  const channel = channels.find((c) => c.id === ui.channel)!;
  const rows = s.messages.filter((message) => message.channel === ui.channel);
  return `${heading('Messages', 'Your team’s conversations, all in one place.', s)}<section class="message-board"><aside class="channel-sidebar"><span class="channel-section-title">CHANNELS</span>${channels.map((c) => `<button class="channel-button ${ui.channel === c.id ? 'selected' : ''}" data-action="channel" data-id="${c.id}" aria-pressed="${ui.channel === c.id}"><span aria-hidden="true">#</span>${e(c.name)}</button>`).join('')}<span class="channel-section-title team-title">PEOPLE</span>${s.inspector.workers.map((w) => `<button class="channel-person" data-action="worker-detail" data-id="${w.id}">${avatar(w.id, s)}<span>${e(w.name)}<small>${e(w.role)}</small></span><i class="presence ${status(w.id, s) === 'Ready' ? 'available' : ''}" title="${status(w.id, s)}"></i></button>`).join('')}</aside><div class="channel-main"><header class="channel-header"><h2><span>#</span>${e(channel.name)}</h2><p>${e(channel.description)}</p></header><div class="message-feed" role="log" aria-label="${e(channel.name)} messages" aria-live="polite">${rows.length ? rows.map((m) => messageRow(m, s)).join('') : empty('The conversation starts here', ui.channel === 'general' ? 'Post a note for your team. Task handoffs appear in #product-team when you start a team task.' : 'Start a team task to see employees share results and hand work to each other.')}</div><form class="message-composer" data-form="message"><label for="message-body" class="sr-only">Message #${e(channel.name)}</label><textarea id="message-body" name="body" maxlength="2000" rows="2" placeholder="Message #${e(channel.name)}" required>${e(ui.draft)}</textarea><div class="composer-bottom"><small>You’re posting as the company owner. Notes are saved; automated replies are not connected.</small><button class="button primary" type="submit">Send message ${icon('arrow')}</button></div><div class="form-error" role="alert"></div></form><div class="channel-footnote">Latest 100 messages in this channel · employee updates come from recorded tasks</div></div></section>`;
}

function decisions(s: DashboardState) {
  const waiting = s.actions.filter((a) => a.status === 'reserved');
  const resolved = s.actions.filter((a) => a.status !== 'reserved');
  const latestByProduct = new Map<string, DashboardState['inspector']['runs'][number]>();
  for (const run of s.inspector.runs)
    if (!latestByProduct.has(run.product_id)) latestByProduct.set(run.product_id, run);
  const blocked = [...latestByProduct.values()].filter((run) => run.status === 'blocked');
  return `${heading('Decisions', 'See what needs you, what’s blocked, and what’s been decided.', s)}<div class="decision-intro"><span>${waiting.length ? `${waiting.length} decision${waiting.length === 1 ? '' : 's'} waiting for you` : 'You’re all caught up'}</span><button class="button secondary" data-action="experiment">${icon('plus')}Propose an expense</button></div><div class="decision-board"><section class="decision-column"><div class="decision-column-title"><span class="decision-dot waiting"></span><h2>Needs your decision</h2><span>${waiting.length}</span></div>${waiting.length ? waiting.map((a) => `<article class="decision-card"><span class="decision-owner">${avatar('treasury', s)} Treasury · budget review</span><h3>${e(a.title)}</h3><p>${e(s.envelopes.find((row) => row.id === a.envelope_id)?.label ?? a.envelope_id)}</p><strong class="decision-amount">${money(a.amount_minor)}</strong><small>Funds held. No expense recorded yet.</small><div class="decision-actions"><button class="button small secondary" data-action="cancel" data-id="${a.id}">Decline</button><button class="button small primary" data-action="execute" data-id="${a.id}" ${s.company.paused ? 'disabled' : ''}>Approve expense</button></div>${s.company.paused ? '<p class="decision-warning">Resume the company to approve spending.</p>' : ''}</article>`).join('') : empty('No decisions waiting', 'Propose an expense when you want to approve a team budget.')}</section><section class="decision-column"><div class="decision-column-title"><span class="decision-dot blocked"></span><h2>Blocked tasks</h2><span>${blocked.length}</span></div>${
    blocked.length
      ? blocked
          .slice(0, 8)
          .map((run) => {
            const span = run.spans.find((span) => span.status === 'blocked');
            const reason =
              span?.outputs && typeof span.outputs === 'object' && !Array.isArray(span.outputs)
                ? span.outputs.reason
                : '';
            return `<article class="decision-card"><span class="decision-owner">${avatar(span?.worker_id ?? 'operator', s)} ${e(span?.worker_name ?? 'Operator')}</span><h3>${e(run.product_title)}</h3><p>${e(reason || 'This task needs attention before it can proceed.')}</p><small>${date(run.created_at)} · No money committed</small><a class="text-button" href="#company">Check the team ${icon('arrow')}</a></article>`;
          })
          .join('')
      : empty('Nothing blocked', 'Tasks that fail a team or spending check will appear here.')
  }</section><section class="decision-column"><div class="decision-column-title"><span class="decision-dot done"></span><h2>Decided</h2><span>${resolved.length}</span></div>${
    resolved.length
      ? resolved
          .slice(0, 10)
          .map(
            (a) =>
              `<article class="decision-card"><div class="decision-status">${tag(a.status === 'completed' ? 'Approved & spent' : 'Declined', a.status === 'completed' ? 'green' : '')}<span>${money(a.amount_minor)}</span></div><h3>${e(a.title)}</h3><p>${a.status === 'completed' ? 'Expense recorded in the balance.' : 'Held funds returned to available cash.'}</p><small>${date(a.completed_at ?? a.created_at)}</small></article>`,
          )
          .join('')
      : empty(
          'A clear decision history',
          'Approved and declined expenses stay here for your reference.',
        )
  }</section></div>`;
}

const officePerson = (id: WorkerId, s: DashboardState) =>
  `<button class="office-person ${status(id, s) === 'Disabled' ? 'worker-disabled' : ''}" data-action="worker-detail" data-id="${id}" aria-label="Inspect ${e(name(id, s))}"><span class="person-figure person-${id}" aria-hidden="true"><i class="person-head"></i><i class="person-body"></i></span><span class="person-name">${e(name(id, s))}<small>${e(s.inspector.workers.find((w) => w.id === id)!.role)}</small></span><span class="person-status">${status(id, s)}</span></button>`;
function office(s: DashboardState, ui: WorkspaceUI) {
  const run = s.inspector.runs[0];
  const span = run?.spans[Math.min(ui.step, run.spans.length - 1)];
  const sender = span?.worker_id;
  const handoff = span
    ? s.messages.find((m) => m.run_id === run.id && m.function_id === span.function_id)
    : undefined;
  const communication = (workers: WorkerId[]) =>
    sender && workers.includes(sender) && span
      ? `<div class="room-communication">${icon('team')}<span>${e(span.worker_name)}${handoff?.recipient_id ? ` → ${e(name(handoff.recipient_id, s))}` : ' · recorded step'}<small>${e(span.function_title)}</small></span></div>`
      : '';
  return `${heading('Company map', 'An office with clear teams, ownership, and communication.', s)}<div class="office-layout"><section class="office-card"><div class="office-toolbar"><div><strong>The company office</strong><span>4 employees · 1 independent finance control</span></div><span class="office-key"><i class="presence available"></i>${s.company.paused ? 'Company paused' : 'Team ready'}</span></div><div class="office-floor ${ui.replaying ? 'replaying' : ''}"><div class="office-room leadership-room ${sender === 'operator' ? 'room-active' : ''}"><div class="room-heading"><span>01 · LEADERSHIP</span><h2>Operations</h2></div><div class="owner-office"><span class="owner-desk">You <small>Company owner</small></span><span class="hierarchy-arrow">↓ sets goals & spending limits</span></div><div class="desk-scene"><span class="desk desk-manager" aria-hidden="true"><i></i></span>${officePerson('operator', s)}<span class="plant plant-one" aria-hidden="true">✦</span></div><p class="room-note">Operator manages Scout, Studio and Review.</p>${communication(['operator'])}</div><div class="office-room finance-room ${sender === 'treasury' ? 'room-active' : ''}"><div class="room-heading"><span>02 · FINANCIAL CONTROL</span><h2>Finance</h2></div><div class="finance-report">Reports directly to you</div><div class="desk-scene"><span class="desk desk-finance" aria-hidden="true"><i></i></span>${officePerson('treasury', s)}<span class="filing-cabinet" aria-hidden="true"></span></div><p class="room-note">Treasury checks every budget and records the money.</p>${communication(['treasury'])}</div><div class="office-corridor"><span>Operator delegates ↓</span><span class="corridor-line"></span><span>Teams share work ↔</span></div><div class="office-room research-room ${sender === 'researcher' ? 'room-active' : ''}"><div class="room-heading"><span>03 · STRATEGY TEAM</span><h2>Research</h2></div><div class="desk-scene"><span class="desk desk-research" aria-hidden="true"><i></i></span>${officePerson('researcher', s)}<span class="research-board" aria-hidden="true"><i></i><i></i><i></i></span></div><p class="room-note">Scout finds the opportunity and passes a brief to the team.</p>${communication(['researcher'])}</div><div class="office-room production-room ${sender === 'creator' || sender === 'reviewer' ? 'room-active' : ''}"><div class="room-heading"><span>04 · PRODUCT TEAM</span><h2>Production & quality</h2></div><div class="collaboration-scene"><span class="team-table" aria-hidden="true"><i></i><i></i></span>${officePerson('creator', s)}<span class="team-handoff" aria-hidden="true">↔</span>${officePerson('reviewer', s)}</div><p class="room-note">Studio creates. Review checks. Both report to Operator.</p>${communication(['creator', 'reviewer'])}</div></div><div class="office-caption">Select an employee to see their responsibilities and model plan.</div></section><aside class="office-activity card"><span class="eyebrow">TEAM COMMUNICATION</span><h2>${run ? 'Last team task' : 'How work moves'}</h2>${run ? `<p class="office-task-title">${e(run.product_title)}</p><span class="replay-label">${ui.replaying ? 'Replaying recorded handoffs' : `${date(run.created_at)} · ${run.status}`}</span><ol class="handoff-steps">${run.spans.map((stage, index) => `<li><button class="handoff-step ${index === ui.step ? 'current' : ''}" data-action="handoff-step" data-id="${index}" aria-pressed="${index === ui.step}">${avatar(stage.worker_id, s)}<span><strong>${e(stage.worker_name)}</strong><small>${e(stage.function_title)}</small></span>${stage.status === 'blocked' ? icon('pause') : icon('check')}</button></li>`).join('')}</ol><div class="handoff-bubble"><span>${span ? `${e(span.worker_name)}${handoff?.recipient_id ? ` → ${e(name(handoff.recipient_id, s))}` : ''}` : 'Team update'}</span><p>${handoff ? e(handoff.body) : span?.status === 'blocked' ? 'This task was blocked. No money was committed.' : run.status === 'blocked' ? 'This step ran before a later block. Its financial effects were rolled back.' : 'This step completed in the recorded team task.'}</p></div><button class="button secondary replay-button" data-action="replay" ${ui.replaying ? 'disabled' : ''}>${icon('play')}Replay teamwork</button><a class="text-button" href="#messages">Open team messages ${icon('arrow')}</a>` : `<ol class="workflow-guide"><li><strong>Operator</strong> delegates a task.</li><li><strong>Scout</strong> selects an opportunity.</li><li><strong>Treasury</strong> checks the budget.</li><li><strong>Studio → Review</strong> creates and checks the delivery.</li><li><strong>Operator → Treasury</strong> settles and reconciles.</li></ol><p>Start a team task to see the actual handoffs here.</p>`}</aside></div><section class="card model-plan-card"><div class="card-heading"><div><h2>The right model for the task</h2><p>Planning recommendations. Current tasks use local rules; no model provider is connected.</p></div>${tag('Model plan')}</div><div class="model-plan-grid">${s.inspector.workers.map((w) => `<button class="model-plan-person" data-action="worker-detail" data-id="${w.id}">${avatar(w.id, s)}<strong>${e(w.name)}</strong><span>${e(modelPlans[w.id][0].model)}</span><small>${e(modelPlans[w.id][0].task)}</small></button>`).join('')}</div></section>`;
}

export function render(page: string, s: DashboardState, ui: WorkspaceUI) {
  if (page === 'messages') return messages(s, ui);
  if (page === 'decisions') return decisions(s);
  if (page === 'company') return office(s, ui);
  return balance(s);
}
export function dialog(kind: string, s: DashboardState, id?: string) {
  if (kind !== 'worker-detail') return financialDialog(kind, s, id);
  const worker = s.inspector.workers.find((w) => w.id === id);
  if (!worker) return '';
  const manager =
    worker.manager_id === 'owner' ? 'You, the company owner' : name(worker.manager_id, s);
  return `<div class="dialog-header"><button class="dialog-close" data-action="close" aria-label="Close dialog">×</button><span class="eyebrow">${e(worker.department)} TEAM</span><h2 id="modal-title">${e(worker.name)}</h2><p>${e(worker.position)}</p></div><div class="employee-detail"><div class="employee-reporting"><span>Reports to <strong>${e(manager)}</strong></span>${tag(status(worker.id, s), worker.enabled ? 'green' : '')}</div><h3>Responsibilities</h3><ul>${s.inspector.functions
    .filter((f) => f.worker_id === worker.id)
    .map((f) => `<li>${e(f.title)}</li>`)
    .join(
      '',
    )}</ul><h3>Model choices by task</h3>${modelPlans[worker.id].map((plan) => `<div class="employee-model"><strong>${e(plan.task)}</strong>${tag(plan.model)}<p>${e(plan.reason)}</p></div>`).join('')}<p class="model-plan-note">These are model recommendations. This company currently runs scripted tasks with no external AI calls.</p>${worker.kind === 'agent' ? `<div class="dialog-footer"><button class="button secondary" data-action="worker-toggle" data-id="${worker.id}">${worker.enabled ? 'Disable worker' : 'Enable worker'}</button></div>` : '<p>Treasury stays enabled to protect the company’s balance.</p>'}</div>`;
}
