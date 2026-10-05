import type { DashboardState, MessageChannel, TeamMessage, WorkerId } from '../shared/contracts.js';
import { modelPlans } from '../shared/model-policy.js';
import { officeCue } from './office-activity.js';
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
    : s.model_tasks?.[0]?.status === 'running' && s.model_tasks[0].active_worker === id
      ? 'Working'
      : s.company.paused
        ? 'Paused'
        : 'Ready';
const empty = (title: string, text: string) =>
  `<div class="simple-empty"><span class="empty-symbol">${icon('team')}</span><h3>${e(title)}</h3><p>${e(text)}</p></div>`;
function heading(title: string, subtitle: string, s: DashboardState) {
  return `<div class="page-heading"><div><span class="eyebrow">YOUR COMPANY</span><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions"><button class="button secondary" data-action="pause">${icon(s.company.paused ? 'play' : 'pause')}${s.company.paused ? 'Resume company' : 'Pause company'}</button><button class="button primary" data-action="${s.model_connection?.connected ? 'team-task' : 'cycle'}" ${s.company.paused ? 'disabled' : ''}>${icon('play')}${s.model_connection?.connected ? 'Start team task' : 'Run virtual sale'}</button></div></div>`;
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
  return `<article class="team-message" data-message-id="${message.id}">${avatar(message.sender_id, s)}<div class="message-content"><div class="message-meta"><strong>${e(name(message.sender_id, s))}</strong>${recipient}<time datetime="${new Date(message.created_at * 1000).toISOString()}">${date(message.created_at)}</time>${message.model_task_id ? `<span class="message-task-label">${message.sender_id === 'owner' ? 'Team goal' : 'AI reply'}</span>` : message.run_id ? '<span class="message-task-label">Simulation</span>' : `<span class="message-task-label">${message.sender_id === 'owner' ? 'Owner note' : 'Team update'}</span>`}</div><p>${e(message.body)}</p></div></article>`;
}
function messages(s: DashboardState, ui: WorkspaceUI) {
  const channel = channels.find((c) => c.id === ui.channel)!;
  const rows = s.messages.filter((message) => message.channel === ui.channel);
  return `${heading('Messages', 'Your team’s conversations, all in one place.', s)}<section class="message-board"><aside class="channel-sidebar"><span class="channel-section-title">CHANNELS</span>${channels.map((c) => `<button class="channel-button ${ui.channel === c.id ? 'selected' : ''}" data-action="channel" data-id="${c.id}" aria-pressed="${ui.channel === c.id}"><span aria-hidden="true">#</span>${e(c.name)}</button>`).join('')}<span class="channel-section-title team-title">PEOPLE</span>${s.inspector.workers.map((w) => `<button class="channel-person" data-action="worker-detail" data-id="${w.id}">${avatar(w.id, s)}<span>${e(w.name)}<small>${e(w.role)}</small></span><i class="presence ${status(w.id, s) === 'Ready' ? 'available' : ''}" title="${status(w.id, s)}"></i></button>`).join('')}</aside><div class="channel-main"><header class="channel-header"><h2><span>#</span>${e(channel.name)}</h2><p>${e(channel.description)}</p></header><div class="message-feed" role="log" aria-label="${e(channel.name)} messages" aria-live="polite">${rows.length ? rows.map((m) => messageRow(m, s)).join('') : empty('The conversation starts here', ui.channel === 'general' ? 'Post a note for your team. Task handoffs appear in #product-team when you start a team task.' : 'Start a team task to see employees share results and hand work to each other.')}</div><form class="message-composer" data-form="message"><label for="message-body" class="sr-only">Message #${e(channel.name)}</label><textarea id="message-body" name="body" maxlength="2000" rows="2" placeholder="Message #${e(channel.name)}" required>${e(ui.draft)}</textarea><div class="composer-bottom"><small>You’re posting as the company owner. ${s.model_connection?.connected ? 'Choose Ask team to get real employee replies using Codex.' : 'Connect ChatGPT in Company map to ask the team.'}</small><span class="composer-actions"><button class="button secondary" type="submit" name="intent" value="team" ${!s.model_connection?.connected || s.company.paused || s.model_tasks?.some((t) => t.status === 'queued' || t.status === 'running') ? 'disabled' : ''}>Ask team</button><button class="button primary" type="submit" name="intent" value="note">Send message ${icon('arrow')}</button></span></div><div class="form-error" role="alert"></div></form><div class="channel-footnote">Latest 100 messages in this channel · AI replies and simulation updates are labeled</div></div></section>`;
}

function decisions(s: DashboardState) {
  const waiting = s.actions.filter((a) => a.status === 'reserved');
  const resolved = s.actions.filter((a) => a.status !== 'reserved');
  const latestByProduct = new Map<string, DashboardState['inspector']['runs'][number]>();
  for (const run of s.inspector.runs)
    if (!latestByProduct.has(run.product_id)) latestByProduct.set(run.product_id, run);
  const blocked = [...latestByProduct.values()].filter((run) => run.status === 'blocked');
  const modelBlock = s.model_tasks?.[0]?.status === 'blocked' ? s.model_tasks[0] : undefined;
  return `${heading('Decisions', 'See what needs you, what’s blocked, and what’s been decided.', s)}${modelBlock ? `<section class="card"><h2>Team task needs attention</h2><strong>${e(modelBlock.goal)}</strong><p>${e(modelBlock.error ?? 'The team stopped.')}</p><a href="#company" class="text-button">Review connection and saved work</a></section>` : ''}<div class="decision-intro"><span>${waiting.length ? `${waiting.length} decision${waiting.length === 1 ? '' : 's'} waiting for you` : 'You’re all caught up'}</span><button class="button secondary" data-action="experiment">${icon('plus')}Propose an expense</button></div><div class="decision-board"><section class="decision-column"><div class="decision-column-title"><span class="decision-dot waiting"></span><h2>Needs your decision</h2><span>${waiting.length}</span></div>${waiting.length ? waiting.map((a) => `<article class="decision-card"><span class="decision-owner">${avatar('treasury', s)} Treasury · budget review</span><h3>${e(a.title)}</h3><p>${e(s.envelopes.find((row) => row.id === a.envelope_id)?.label ?? a.envelope_id)}</p><strong class="decision-amount">${money(a.amount_minor)}</strong><small>Funds held. No expense recorded yet.</small><div class="decision-actions"><button class="button small secondary" data-action="cancel" data-id="${a.id}">Decline</button><button class="button small primary" data-action="execute" data-id="${a.id}" ${s.company.paused ? 'disabled' : ''}>Approve expense</button></div>${s.company.paused ? '<p class="decision-warning">Resume the company to approve spending.</p>' : ''}</article>`).join('') : empty('No decisions waiting', 'Propose an expense when you want to approve a team budget.')}</section><section class="decision-column"><div class="decision-column-title"><span class="decision-dot blocked"></span><h2>Blocked tasks</h2><span>${blocked.length}</span></div>${
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
  `<button class="gather-person ${status(id, s) === 'Disabled' ? 'worker-disabled' : ''}" data-action="worker-detail" data-id="${id}" aria-label="Inspect ${e(name(id, s))}">${avatar(id, s)}<span><strong>${e(name(id, s))}</strong><small>${e(s.inspector.workers.find((w) => w.id === id)!.role)} · ${status(id, s)}</small></span></button>`;
function modelTaskCard(s: DashboardState, step: number) {
  const task = s.model_tasks?.[0];
  if (!task) return '';
  const selected = task.steps[Math.min(step, task.steps.length - 1)];
  const final = task.status === 'completed' ? task.steps.at(-1)?.id : undefined;
  const runtime = task.runtime;
  return `<section class="card real-team-task"><span class="eyebrow">REAL TEAM TASK</span><h2>${e(task.goal)}</h2>${tag(task.status, task.status === 'completed' ? 'green' : '')}<p>${task.active_worker ? `${e(name(task.active_worker, s))} is working…` : task.status === 'queued' ? 'Waiting for the team.' : task.error ? e(task.error) : 'The team’s deliverable is saved below.'}</p><ol class="handoff-steps">${task.steps.map((stage, index) => `<li><button class="handoff-step ${index === step ? 'current' : ''}" data-action="handoff-step" data-id="${index}">${avatar(stage.worker_id, s)}<span><strong>${e(name(stage.worker_id, s))}${stage.worker_id === stage.recipient_id ? '' : ` → ${e(name(stage.recipient_id, s))}`}</strong><small>${e(stage.model ?? 'Codex default')} · ${e(stage.effort)} reasoning · ${e(stage.status)}</small></span></button></li>`).join('')}</ol>${selected ? `<p>${e(selected.message ?? 'Waiting for a model response…')}</p><small>${selected.input_tokens ?? 'Unknown'} input tokens · ${selected.output_tokens ?? 'Unknown'} output tokens</small>` : ''}${task.steps
    .filter((stage) => stage.artifact)
    .map(
      (stage) =>
        `<details ${stage.id === final ? 'open' : ''}><summary>${e(name(stage.worker_id, s))} · ${stage.id === final ? 'Final deliverable' : 'Saved work'}</summary><pre class="model-artifact">${e(stage.artifact!)}</pre></details>`,
    )
    .join('')}${
    runtime
      ? `<details class="agent-activity"><summary>Agent activity · ${runtime.calls}/${runtime.max_calls} turns</summary><p>${runtime.known_tokens.toLocaleString()} reported tokens${runtime.usage_complete ? '' : ' · some usage is unknown'} · ${runtime.max_tokens.toLocaleString()} token stopping threshold</p><ol class="agent-job-list">${runtime.jobs.map((job) => `<li><strong>${e(name(job.worker_id, s))}</strong> · ${e(job.status)}<p>${e(job.brief)}</p></li>`).join('')}</ol><ol class="agent-event-list">${runtime.events.map((event) => `<li>${e(event.summary)}</li>`).join('')}</ol>${runtime.artifacts
          .filter(
            (artifact) =>
              !artifact.name.startsWith('job-') && artifact.name !== 'final-deliverable',
          )
          .map(
            (artifact) =>
              `<details><summary>${e(artifact.name)} · ${e(name(artifact.worker_id, s))}</summary><pre class="model-artifact">${e(artifact.content)}</pre></details>`,
          )
          .join('')}</details>`
      : ''
  }${['queued', 'running'].includes(task.status) ? `<button class="button secondary" data-action="cancel-team-task" data-id="${e(task.id)}">Stop team task</button>` : ''}<p class="model-plan-note">Uses Codex with ChatGPT sign-in and your plan’s usage limits. The virtual balance does not represent subscription usage or real sales.</p></section>`;
}
function modelConnection(s: DashboardState) {
  const connection = s.model_connection;
  return `<section class="card model-connection"><div class="card-heading"><div><h2>ChatGPT connection</h2><p>${connection?.connected ? 'Connected through Codex · ChatGPT subscription' : 'Connect your ChatGPT account to run real employee tasks.'}</p></div>${tag(connection?.connected ? 'Connected' : 'Sign-in required', connection?.connected ? 'green' : '')}</div>${connection?.connected ? `<p>Operator, Scout and Review: ${e(connection.models.reasoning ?? 'Codex default')} with medium or high reasoning. Studio: ${e(connection.models.fast ?? 'Codex default')} with low reasoning. Treasury: code, no model.</p><a class="button primary" href="#messages">Give the team a goal</a>` : connection?.login ? `<p>You started sign-in for this company server. Open <a href="https://auth.openai.com/codex/device" target="_blank" rel="noopener noreferrer">OpenAI’s Codex sign-in</a> and enter <strong>${e(connection.login.code)}</strong>. This code expires after 15 minutes.</p><p>Enable device-code login in ChatGPT settings if OpenAI asks you to. This dashboard never asks for your ChatGPT password.</p>` : `<p>${connection?.error ? e(connection.error) : 'One-time sign-in is stored privately on this server’s persistent volume.'}</p><button class="button primary" data-action="connect-chatgpt">Connect ChatGPT</button>`}</section>`;
}
function officeActivity(s: DashboardState, ui: WorkspaceUI) {
  const run = s.inspector.runs[0];
  const span = run?.spans[Math.min(ui.step, run.spans.length - 1)];
  const handoff = span
    ? s.messages.find((m) => m.run_id === run.id && m.function_id === span.function_id)
    : undefined;
  if (s.model_tasks?.length) return modelTaskCard(s, ui.step);
  return `<span class="eyebrow">TEAM COMMUNICATION</span><h2>${run ? 'Recorded teamwork' : 'How work moves'}</h2>${run ? `<p class="office-task-title">${e(run.product_title)}</p><span class="replay-label">${ui.replaying ? 'Replaying recorded handoffs' : `${date(run.created_at)} · ${run.status}`}</span><ol class="handoff-steps">${run.spans.map((stage, index) => `<li><button class="handoff-step ${index === ui.step ? 'current' : ''}" data-action="handoff-step" data-id="${index}" aria-pressed="${index === ui.step}">${avatar(stage.worker_id, s)}<span><strong>${e(stage.worker_name)}</strong><small>${e(stage.function_title)}</small></span>${stage.status === 'blocked' ? icon('pause') : icon('check')}</button></li>`).join('')}</ol><div class="handoff-bubble"><span>${span ? `${e(span.worker_name)}${handoff?.recipient_id ? ` → ${e(name(handoff.recipient_id, s))}` : ''}` : 'Team update'}</span><p>${handoff ? e(handoff.body) : run.status === 'blocked' ? 'This task was blocked. No money was committed.' : 'This step completed in the recorded team task.'}</p></div><button class="button secondary replay-button" data-action="replay" ${ui.replaying ? 'disabled' : ''}>${icon('play')}Replay teamwork</button>` : `<ol class="workflow-guide"><li><strong>You</strong> give Operator a goal.</li><li><strong>Operator → Scout</strong> turns it into a brief.</li><li><strong>Scout, Studio and Review</strong> complete assigned subtasks back to Operator.</li><li><strong>Operator → You</strong> returns the reviewed deliverable.</li></ol><p>Preview a meeting to explore the office, or give the team a goal in Messages.</p>`}<a class="text-button" href="#messages">Open team messages ${icon('arrow')}</a>`;
}
function office(s: DashboardState, ui: WorkspaceUI) {
  const cue = officeCue(s, ui.step);
  const activity = cue
    ? `${cue.mode === 'live' ? 'Live task' : cue.mode === 'blocked' ? 'Blocked task' : 'Recorded handoff'} · ${name(cue.sender, s)} → ${name(cue.recipient, s)}`
    : 'Office open · no team task running.';
  return `${heading('Company map', 'A place for your team to work, walk around and meet.', s)}
  <div class="gather-layout"><section class="gather-office" aria-label="Company office"><header class="gather-window-bar"><div><span class="office-live-dot"></span><strong>corp. headquarters</strong><span class="gather-population">6 people · 4 business units</span></div><span class="gather-floor-label">FLOOR 01</span></header>
  <div class="gather-controls"><button class="button secondary" data-action="office-preview" ${s.company.paused || s.model_tasks?.[0]?.status === 'running' || s.inspector.workers.some((worker) => ['operator', 'researcher'].includes(worker.id) && !worker.enabled) ? 'disabled' : ''}>${icon('team')}Preview a meeting</button><div class="gather-camera"><button class="world-control" data-action="office-motion" aria-pressed="false">Pause motion</button><button class="world-control" data-action="office-zoom-out" aria-label="Zoom out">−</button><button class="world-control" data-action="office-fit">Fit office</button><button class="world-control" data-action="office-zoom-in" aria-label="Zoom in">+</button></div></div>
  <div id="office-world" class="gather-world" tabindex="0" role="group" aria-label="Interactive company office" aria-describedby="office-instructions"><p class="office-loading">Opening the office…</p></div>
  <div class="gather-status"><span class="office-status-dot"></span><span id="office-world-status" aria-live="polite">${e(activity)}</span></div>
  <div class="gather-roster"><button class="gather-person" data-action="office-focus" aria-label="Control your avatar">${avatar('owner', s)}<span><strong>You</strong><small>Owner · arrow keys to walk</small></span></button>${s.inspector.workers.map((w) => officePerson(w.id, s)).join('')}</div>
  <div class="gather-help"><p id="office-instructions">Click the floor to walk. Select a character to meet the employee. Focus the office and use arrow keys or WASD.</p><div class="office-dpad" aria-label="Walk your avatar"><button data-action="office-up" aria-label="Walk up">↑</button><button data-action="office-left" aria-label="Walk left">←</button><button data-action="office-down" aria-label="Walk down">↓</button><button data-action="office-right" aria-label="Walk right">→</button></div><small>Movement visualizes activity. A preview never starts a task or a model call.</small></div></section>
  <aside class="office-activity card gather-activity">${officeActivity(s, ui)}</aside></div>
  ${modelConnection(s)}
  <section class="card model-plan-card"><div class="card-heading"><div><h2>The right model for the task</h2><p>${s.model_connection?.connected ? 'Real team tasks use Codex; the model and reasoning effort are saved with every handoff.' : 'Connect ChatGPT to give your employees real tasks. Treasury always uses code.'}</p></div>${tag('Model plan')}</div><div class="model-plan-grid">${s.inspector.workers.map((w) => `<button class="model-plan-person" data-action="worker-detail" data-id="${w.id}">${avatar(w.id, s)}<strong>${e(w.name)}</strong><span>${e(modelPlans[w.id][0].model)}</span><small>${e(modelPlans[w.id][0].task)}</small></button>`).join('')}</div></section>`;
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
  const memories = s.agent_memory?.filter((memory) => memory.worker_id === worker.id) ?? [];
  const activeTask = s.model_tasks?.some((task) => ['queued', 'running'].includes(task.status));
  const manager =
    worker.manager_id === 'owner' ? 'You, the company owner' : name(worker.manager_id, s);
  return `<div class="dialog-header"><button class="dialog-close" data-action="close" aria-label="Close dialog">×</button><span class="eyebrow">${e(worker.department)} TEAM</span><h2 id="modal-title">${e(worker.name)}</h2><p>${e(worker.position)}</p></div><div class="employee-detail"><div class="employee-reporting"><span>Reports to <strong>${e(manager)}</strong></span>${tag(status(worker.id, s), worker.enabled ? 'green' : '')}</div><h3>Responsibilities</h3><ul>${s.inspector.functions
    .filter((f) => f.worker_id === worker.id)
    .map((f) => `<li>${e(f.title)}</li>`)
    .join(
      '',
    )}</ul><h3>Model choices by task</h3>${modelPlans[worker.id].map((plan) => `<div class="employee-model"><strong>${e(plan.task)}</strong>${tag(plan.model)}<p>${e(plan.reason)}</p></div>`).join('')}<p class="model-plan-note">${s.model_connection?.connected ? 'Real team tasks call Codex using the configured model route and reasoning effort. Virtual sales remain simulated.' : 'Connect ChatGPT in Company map to enable real team tasks.'}</p>${worker.kind === 'agent' ? `<details class="employee-memory"><summary>Employee memory · ${memories.length} saved</summary><p>Notes this employee can recall across tasks. Clear a note to remove it from future task context.</p>${memories.length ? memories.map((memory) => `<div class="employee-memory-entry"><strong>${e(memory.key)}</strong><pre class="model-artifact">${e(memory.value)}</pre><button class="text-button" data-action="clear-agent-memory" data-worker="${worker.id}" data-id="${e(memory.key)}" ${activeTask ? 'disabled' : ''}>Clear memory ${e(memory.key)}</button></div>`).join('') : '<p>No saved memories yet.</p>'}</details><div class="dialog-footer"><button class="button secondary" data-action="worker-toggle" data-id="${worker.id}">${worker.enabled ? 'Disable worker' : 'Enable worker'}</button></div>` : '<p>Treasury stays enabled to protect the company’s balance.</p>'}</div>`;
}
