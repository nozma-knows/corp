import type { DashboardState, Inspector } from '../shared/contracts.js';
import { money, escape as e, date } from './api.js';
import { icon } from './icons.js';

const label = (text: string, kind = '') => `<span class="tag ${kind}">${e(text)}</span>`;
const time = (duration: number) => `${Number(duration).toFixed(2)} ms`;

function workerNode(worker: Inspector['workers'][number], large = false) {
  return `<button class="org-node ${large ? 'manager-node' : ''} ${worker.kind === 'control' ? 'control-node' : ''} ${worker.enabled ? '' : 'worker-disabled'}" data-action="worker-detail" data-id="${worker.id}"><span class="org-icon">${icon(worker.kind === 'control' ? 'wallet' : worker.id === 'operator' ? 'sliders' : 'team')}</span><strong>${e(worker.name)}</strong><span class="org-position">${e(worker.position)}</span><span class="org-caption">${worker.function_ids.length} function${worker.function_ids.length === 1 ? '' : 's'} · ${worker.kind === 'control' ? 'Mandatory control' : worker.enabled ? 'Enabled' : 'Disabled'}</span></button>`;
}

export function companyMap(s: DashboardState) {
  const i = s.inspector;
  const operator = i.workers.find((w) => w.id === 'operator')!;
  const treasury = i.workers.find((w) => w.id === 'treasury')!;
  return `<div class="inspector-summary"><span>${i.workers.filter((w) => w.kind === 'agent').length} workers</span><span>1 mandatory control service</span><span>${i.functions.length} registered functions</span><span>Registry v${i.registry_version}</span></div>
  <section class="card organization-card"><div class="card-heading"><h2>Who owns what</h2><span class="muted">Select a position to inspect it</span></div><div class="organization"><div class="owner-node">${icon('sliders')}<strong>You</strong><span>Company owner · policy & capital</span></div><div class="org-owner-stem"></div><div class="org-branches"><div class="org-business"><div class="org-manager">${workerNode(operator, true)}</div><div class="org-team-line"></div><div class="org-workers">${i.workers
    .filter((w) => w.manager_id === 'operator')
    .map((w) => workerNode(w))
    .join(
      '',
    )}</div></div><div class="org-controls">${workerNode(treasury)}<p>Independent financial checks apply to every workflow. Workers cannot disable this service.</p></div></div></div></section>
  <section class="card"><div class="card-heading"><h2>How work connects</h2>${label('Digital sale workflow', 'green')}</div><p class="inspector-intro">The current path uses local rules. Each function is recorded when it runs; inputs, outputs, timing and the financial outcome stay connected.</p><div class="function-flow">${i.functions
    .map((f, index) => {
      const worker = i.workers.find((w) => w.id === f.worker_id)!;
      return `<div class="flow-item"><button class="function-node ${worker.enabled ? '' : 'worker-disabled'}" data-action="worker-detail" data-id="${worker.id}"><span class="function-number">0${index + 1}</span><strong>${e(f.title)}</strong><span>${e(worker.name)} · ${f.engine === 'control' ? 'Control' : 'Scripted'}</span></button>${index < i.functions.length - 1 ? icon('arrow') : ''}</div>`;
    })
    .join(
      '',
    )}</div><div class="card-footnote">Nested accounting is performed inside settlement. A blocked workflow commits its trace and reason, but rolls back its financial work.</div></section>
  <section class="card"><div class="card-heading"><h2>Function ownership</h2><a class="text-button" href="#inference">Inspect executions ${icon('arrow')}</a></div><div class="table-scroll"><table><thead><tr><th>Function</th><th>Position</th><th>Inputs → outputs</th><th>Engine</th></tr></thead><tbody>${i.functions
    .map((f) => {
      const worker = i.workers.find((w) => w.id === f.worker_id)!;
      return `<tr><td><strong>${e(f.title)}</strong><small class="cell-sub">${e(f.id)}</small></td><td><button class="text-button" data-action="worker-detail" data-id="${worker.id}">${e(worker.name)}</button><small class="cell-sub">${e(worker.position)}</small></td><td><span>${e(f.inputs.join(', '))}</span><small class="cell-sub">→ ${e(f.outputs.join(', '))}</small></td><td>${label(f.engine)}</td></tr>`;
    })
    .join('')}</tbody></table></div></section>`;
}

export function inferenceView(s: DashboardState) {
  const i = s.inspector;
  return `<div class="metrics inference-metrics"><div class="metric"><div class="metric-top">External model calls${icon('activity')}</div><div class="metric-value">${i.totals.model_calls}</div><div class="metric-note">No provider enabled</div></div><div class="metric"><div class="metric-top">Inference cost${icon('wallet')}</div><div class="metric-value">$0</div><div class="metric-note">No real or virtual model charge</div></div><div class="metric"><div class="metric-top">Model tokens${icon('link')}</div><div class="metric-value">0</div><div class="metric-note">Scripted functions consume no model tokens</div></div><div class="metric profit"><div class="metric-top">Recorded function executions${icon('check')}</div><div class="metric-value">${i.totals.executions}</div><div class="metric-note">Local timing and outcome recorded</div></div></div>
  <section class="card"><div class="card-heading"><h2>Where work is routed</h2>${label('Local execution only', 'green')}</div><p class="inspector-intro">There is no model inference in this version. These are the actual function destinations. Model, provider, token and cost fields remain empty on each local execution.</p><div class="table-scroll"><table><thead><tr><th>Worker / function</th><th>Engine</th><th>Destination</th><th>Model</th><th>External inference</th></tr></thead><tbody>${i.routing
    .map((route) => {
      const worker = i.workers.find((w) => w.id === route.worker_id)!;
      const f = i.functions.find((f) => f.id === route.function_id)!;
      return `<tr><td><strong>${e(worker.name)}</strong><small class="cell-sub">${e(f.title)}</small></td><td>${label(route.engine)}</td><td><span class="route-destination"><i class="status-dot active"></i>Local process</span></td><td>—</td><td>${label('Not enabled')}</td></tr>`;
    })
    .join('')}</tbody></table></div></section>
  <section class="card"><div class="card-heading"><h2>Workflow executions</h2>${label('Latest 20 runs')}</div>${i.runs.length ? `<div class="run-list">${i.runs.map((run) => `<button class="run-row" data-action="run-detail" data-id="${run.id}"><span class="run-symbol">${icon(run.status === 'blocked' ? 'pause' : 'check')}</span><span class="run-title"><strong>${e(run.product_title)}</strong><small>${e(run.id.slice(0, 8))} · ${date(run.created_at)}</small></span><span class="run-meta">${run.spans.length} function${run.spans.length === 1 ? '' : 's'}<small>0 model calls</small></span>${label(run.status, run.status === 'blocked' ? 'orange' : 'green')}${icon('arrow')}</button>`).join('')}</div>` : '<div class="empty-state"><strong>No executions recorded yet</strong><p>Run a cycle to inspect actual functions and their outcome. Older pre-inspector cycles are not backfilled with invented traces.</p></div>'}</section>`;
}

export function inspectorDialog(
  kind: string,
  s: DashboardState,
  id: string | undefined,
  head: (title: string, text: string) => string,
) {
  const i = s.inspector;
  if (kind === 'worker-detail') {
    const w = i.workers.find((w) => w.id === id)!;
    const functions = i.functions.filter((f) => f.worker_id === id);
    const manager =
      w.manager_id === 'owner'
        ? 'You · Company owner'
        : i.workers.find((worker) => worker.id === w.manager_id)!.name;
    return `${head(e(w.name), e(w.position))}<div class="worker-inspection"><div class="worker-detail-tags">${label(w.department)}${label(w.kind === 'control' ? 'Mandatory control' : w.enabled ? 'Enabled' : 'Disabled', w.enabled ? 'green' : 'orange')}</div><p>${e(w.purpose)}</p><dl class="policy-list"><div><dt>Reports to</dt><dd>${e(manager)}</dd></div><div><dt>Recorded completed functions</dt><dd>${w.execution_count}</dd></div><div><dt>Summed function time</dt><dd>${time(w.duration_ms)}</dd></div><div><dt>External model</dt><dd>Not enabled</dd></div></dl><h3>Owned functions</h3>${functions.map((f) => `<div class="owned-function"><strong>${e(f.title)}</strong><p>${e(f.inputs.join(', '))} → ${e(f.outputs.join(', '))}</p><code>${e(f.source)}</code></div>`).join('')}<h3>Permissions</h3><ul>${w.permissions.map((text) => `<li>${e(text)}</li>`).join('')}</ul><h3>Boundaries</h3><ul>${w.restrictions.map((text) => `<li>${e(text)}</li>`).join('')}</ul>${w.kind === 'agent' ? `<div class="dialog-footer"><button class="button ${w.enabled ? 'secondary' : 'primary'}" data-action="worker-toggle" data-id="${w.id}">${w.enabled ? 'Disable worker' : 'Enable worker'}</button></div>` : '<div class="card-footnote">Financial control remains enabled independently of worker settings.</div>'}</div>`;
  }
  const run = i.runs.find((run) => run.id === id)!;
  if (!run) return head('Run unavailable', 'This run is outside the latest 20 loaded executions.');
  return `${head('Inspect workflow execution', e(run.product_title))}<div class="run-inspection"><div class="worker-detail-tags">${label(run.status, run.status === 'blocked' ? 'orange' : 'green')}${label('Scripted scenario')}<span>${date(run.created_at)}</span></div>${run.status === 'blocked' ? '<p class="trace-warning">Financial work was rolled back. Completed spans below describe computations that occurred before the block, not committed transactions.</p>' : ''}${run.spans.map((span) => `<details class="span-detail ${span.parent_id ? 'nested-span' : ''}"><summary><span><strong>${e(span.function_title)}</strong><small>${e(span.worker_name)} · ${e(span.engine)} · ${time(span.duration_ms)}</small></span>${label(span.status, span.status === 'blocked' ? 'orange' : 'green')}</summary><div class="span-body"><dl><dt>Destination</dt><dd>Local process</dd><dt>Model / tokens</dt><dd>None / not applicable</dd><dt>Model cost</dt><dd>${money(span.cost_micro_usd / 10000)}</dd></dl><h4>Inputs</h4><pre>${e(JSON.stringify(span.inputs, null, 2))}</pre><h4>Output / outcome</h4><pre>${e(JSON.stringify(span.outputs, null, 2))}</pre></div></details>`).join('')}${run.order_id ? `<div class="dialog-footer"><button class="button secondary" data-action="trace-from-run" data-id="${run.order_id}">Follow financial outcome ${icon('arrow')}</button></div>` : ''}<div class="card-footnote">Recorded execution metadata and outputs. No hidden model reasoning or fabricated token usage is displayed.</div></div>`;
}
