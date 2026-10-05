import type { DashboardState, CommandResult } from '../shared/contracts.js';
import { element, message } from './dom.js';
import { command, getState, getInspector, minor, date } from './api.js';
import { pages, channels, icon, render, dialog, type WorkspaceUI } from './workspace.js';
import type { MessageChannel } from '../shared/contracts.js';
import type { OfficeView } from './office-scene.js';

let state: DashboardState | undefined,
  busy = false,
  lastSignature = '',
  toastTimer: ReturnType<typeof setTimeout> | undefined;
const main = element('#main');
const modal = element<HTMLDialogElement>('#modal');
const ui: WorkspaceUI = { channel: 'product', draft: '', step: 0, replaying: false };
const drafts = new Map<MessageChannel, string>();
let replayTimer: ReturnType<typeof setInterval> | undefined;
let officeView: OfficeView | undefined;
let officeLoading: Promise<typeof import('./office-scene.js')> | undefined;

function syncOffice() {
  const host = main.querySelector<HTMLElement>('#office-world');
  if (!host || !state) {
    officeView?.destroy();
    officeView = undefined;
    return;
  }
  if (officeView) {
    officeView.sync(state, ui.step);
    return;
  }
  officeLoading ??= import('./office-scene.js');
  officeLoading
    .then((module) => {
      const current = main.querySelector<HTMLElement>('#office-world');
      if (!current || !state || officeView) return;
      officeView = module.createOffice(current, state, ui.step, (id) => {
        if (id === 'owner') current.focus({ preventScroll: true });
        else open('worker-detail', id);
      });
    })
    .catch(() => {
      officeLoading = undefined;
      const current = main.querySelector<HTMLElement>('#office-world');
      if (current)
        current.innerHTML =
          '<p class="office-loading">The animated office could not load. Employee details and saved handoffs are available below.</p>';
    });
}
const currentPage = () => {
  const page = location.hash.slice(1);
  if (pages.some(([id]) => id === page)) return page;
  if (page === 'team') return 'company';
  if (page === 'activity') return 'messages';
  return 'balance';
};

function navigation() {
  const page = currentPage();
  element('#navigation').innerHTML = pages
    .map(
      ([id, label, symbol]) =>
        `<a href="#${id}" class="nav-item ${id === page ? 'selected' : ''}" ${id === page ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span>${id === 'decisions' && state?.actions.some((a) => a.status === 'reserved') ? `<small>${state.actions.filter((a) => a.status === 'reserved').length}</small>` : ''}</a>`,
    )
    .join('');
  element('#view-label').textContent = pages.find(([id]) => id === page)![1];
}

function paint() {
  if (!state) return;
  ui.step = Math.max(
    0,
    Math.min(
      ui.step,
      (state.model_tasks?.[0]?.steps.length || state.inspector.runs[0]?.spans.length || 1) - 1,
    ),
  );
  const settingsOpen = main.querySelector('.company-settings')?.hasAttribute('open');
  const composer = main.querySelector<HTMLTextAreaElement>('#message-body');
  const focused = document.activeElement === composer && !!composer;
  const selection = composer ? [composer.selectionStart, composer.selectionEnd] : [0, 0];
  const feed = main.querySelector('.message-feed');
  const scroll = feed?.scrollTop ?? 0;
  const atBottom = !feed || feed.scrollHeight - feed.clientHeight - scroll < 40;
  ui.draft = drafts.get(ui.channel) ?? '';
  // Keep the running scene and avatar positions across polling and handoff selection.
  const officeHost = currentPage() === 'company' ? main.querySelector('#office-world') : null;
  const officeFocused = !!officeHost && document.activeElement === officeHost;
  officeHost?.remove();
  main.innerHTML = render(currentPage(), state, ui);
  if (officeHost) main.querySelector('#office-world')?.replaceWith(officeHost);
  syncOffice();
  if (officeFocused) (officeHost as HTMLElement).focus({ preventScroll: true });
  if (settingsOpen) main.querySelector('.company-settings')?.setAttribute('open', '');
  const nextFeed = main.querySelector('.message-feed');
  if (nextFeed) nextFeed.scrollTop = atBottom ? nextFeed.scrollHeight : scroll;
  if (focused) {
    const next = main.querySelector<HTMLTextAreaElement>('#message-body');
    next?.focus({ preventScroll: true });
    next?.setSelectionRange(selection[0], selection[1]);
  }
  navigation();
  element('.mode-notice').textContent = state.model_connection?.connected
    ? 'Real employee tasks use Codex with ChatGPT sign-in. Money and sales remain virtual.'
    : 'Money and sales are virtual. Connect ChatGPT in Company map for real employee tasks.';
  element('#updated').textContent = `Updated ${date(state.server_time)}`;
}

async function refresh(force = false) {
  try {
    const [next, inspector] = await Promise.all([getState(), getInspector()]);
    const nextState: DashboardState = { ...next, inspector };
    if (state?.inspector.runs[0]?.id !== inspector.runs[0]?.id) {
      stopReplay();
      ui.step = 0;
    }
    const signature = JSON.stringify([
      next.company,
      next.events[0]?.id,
      next.envelopes,
      inspector.workers,
      inspector.runs[0]?.id,
      next.messages.at(-1)?.id,
      next.model_tasks,
      next.model_connection,
      next.agent_memory,
    ]);
    state = nextState;
    if (force || signature !== lastSignature) paint();
    lastSignature = signature;
    element('#connection').textContent = 'Company · connected';
    element('#connection').classList.remove('disconnected');
  } catch (error) {
    element('#connection').textContent = 'Connection unavailable';
    element('#connection').classList.add('disconnected');
    if (!state) {
      main.innerHTML =
        '<div class="error-state"><h1>Company unavailable</h1><p>Check that the local server is running, then reconnect.</p><button class="button primary" data-action="retry">Reconnect</button></div>';
    }
    if (force) notify(message(error), true);
  }
}

function notify(message: string, error = false) {
  const toast = element('#toast');
  toast.textContent = message;
  toast.className = `visible ${error ? 'error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = '';
  }, 6000);
}

async function act(path: string, payload: unknown = {}, method = 'POST') {
  if (busy) return false;
  busy = true;
  const key = crypto.randomUUID();
  document
    .querySelectorAll<HTMLButtonElement>(
      'button[data-action]:not([data-action="close"]), button[type="submit"]',
    )
    .forEach((button) => {
      button.disabled = true;
    });
  try {
    let result: CommandResult;
    try {
      result = await command(path, payload, method, key);
    } catch (error) {
      // Repeat only transport failures, using the same key. A rejected policy
      // decision is shown to the operator instead of being retried.
      if (!(error instanceof TypeError)) throw error;
      result = await command(path, payload, method, key);
    }
    modal.close();
    await refresh(true);
    notify(result.message);
    return true;
  } catch (error) {
    // Policy and worker rejections still record a blocked task. Refresh that
    // outcome immediately so Decisions and Messages show the same result.
    await refresh();
    const field = modal.querySelector('.form-error');
    if (modal.open && field) field.textContent = message(error);
    else notify(message(error), true);
    return false;
  } finally {
    busy = false;
    element<HTMLButtonElement>('#sign-out').disabled = false;
    document.querySelectorAll<HTMLButtonElement>('#modal button').forEach((button) => {
      button.disabled = false;
    });
    // The dialog lives outside main, so repainting restores underlying controls
    // without losing entered values or a validation error in the open dialog.
    paint();
  }
}

function open(kind: string, id?: string) {
  if (!state) return;
  element('#modal-content').innerHTML = dialog(kind, state, id);
  modal.showModal();
}
function stopReplay() {
  clearInterval(replayTimer);
  ui.replaying = false;
}
function replay() {
  stopReplay();
  const stages = state?.model_tasks?.[0]?.steps.length || state?.inspector.runs[0]?.spans.length;
  if (!stages) return;
  ui.step = 0;
  ui.replaying = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  paint();
  if (!ui.replaying) return;
  replayTimer = setInterval(() => {
    if (currentPage() !== 'company') return stopReplay();
    if (ui.step < stages - 1) ui.step++;
    else stopReplay();
    paint();
  }, 9000);
}
document.addEventListener('input', (event) => {
  if (event.target instanceof HTMLTextAreaElement && event.target.id === 'message-body')
    drafts.set(ui.channel, event.target.value);
});

document.addEventListener('click', async (event) => {
  const button =
    event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('[data-action]')
      : null;
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'close') return modal.close();
  if (action === 'retry') return refresh(true);
  if (action === 'logout') {
    try {
      await command('/api/auth/logout');
      location.replace('/');
    } catch (error) {
      notify(message(error), true);
    }
    return;
  }
  if (!state || busy) return;
  if (action?.startsWith('office-')) {
    const directions = {
      'office-up': { x: 0, y: -1 },
      'office-down': { x: 0, y: 1 },
      'office-left': { x: -1, y: 0 },
      'office-right': { x: 1, y: 0 },
    };
    if (action === 'office-motion') officeView?.motion();
    else if (action === 'office-preview') officeView?.preview();
    else if (action === 'office-fit') officeView?.home();
    else if (action === 'office-zoom-in') officeView?.zoom(0.25);
    else if (action === 'office-zoom-out') officeView?.zoom(-0.25);
    else if (action === 'office-focus') main.querySelector<HTMLElement>('#office-world')?.focus();
    else if (action in directions) officeView?.move(directions[action as keyof typeof directions]);
    return;
  }
  if (action === 'channel') {
    const channel = channels.find((c) => c.id === button.dataset.id);
    if (!channel) return;
    ui.channel = channel.id;
    return paint();
  }
  if (action === 'connect-chatgpt') return act('/api/models/connect');
  if (action === 'cancel-team-task') return act(`/api/team/tasks/${button.dataset.id}/cancel`);
  if (action === 'clear-agent-memory')
    return act(`/api/agents/${button.dataset.worker}/memory/${button.dataset.id}`, {}, 'DELETE');
  if (action === 'team-task') {
    ui.channel = 'product';
    location.hash = 'messages';
    paint();
    main.querySelector<HTMLTextAreaElement>('#message-body')?.focus();
    return;
  }
  if (action === 'replay') return replay();
  if (action === 'handoff-step') {
    stopReplay();
    ui.step = Number(button.dataset.id);
    return paint();
  }
  if (
    [
      'experiment',
      'policy',
      'allocations',
      'journal',
      'trace',
      'refund',
      'worker-detail',
      'run-detail',
    ].includes(action || '')
  )
    return open(action!, button.dataset.id);
  if (action === 'trace-from-run') {
    modal.close();
    return open('trace', button.dataset.id);
  }
  if (action === 'worker-toggle') {
    const worker = state.inspector.workers.find((worker) => worker.id === button.dataset.id)!;
    return act(`/api/workers/${worker.id}`, { enabled: !worker.enabled });
  }
  if (action === 'pause') return act('/api/pause', { paused: !state.company.paused });
  if (action === 'automation')
    return act('/api/automation', { enabled: !state.company.auto_enabled });
  if (action === 'cycle' || action === 'product-cycle') {
    if (await act('/api/simulation/cycle', { product_id: button.dataset.id || 'cleaning-kit' })) {
      location.hash = 'company';
      replay();
    }
    return;
  }
  if (action === 'execute' || action === 'cancel')
    return act(`/api/actions/${button.dataset.id}/${action}`);
});

document.addEventListener('submit', async (event) => {
  const form =
    event.target instanceof Element ? event.target.closest<HTMLFormElement>('[data-form]') : null;
  if (!form || !state) return;
  event.preventDefault();
  const fields = new FormData(form);
  try {
    if (form.dataset.form === 'message') {
      const channel = ui.channel;
      const team =
        event instanceof SubmitEvent &&
        event.submitter instanceof HTMLButtonElement &&
        event.submitter.value === 'team';
      if (
        await act(
          team ? '/api/team/tasks' : '/api/messages',
          team ? { channel, goal: fields.get('body') } : { channel, body: fields.get('body') },
        )
      ) {
        drafts.delete(channel);
        paint();
        main.querySelector<HTMLTextAreaElement>('#message-body')?.focus({ preventScroll: true });
      }
      return;
    }
    if (form.dataset.form === 'experiment')
      return await act('/api/experiments', {
        title: fields.get('title'),
        envelope_id: fields.get('envelope_id'),
        amount_minor: minor(fields.get('amount')),
      });
    if (form.dataset.form === 'policy')
      return await act(
        '/api/policy',
        {
          action_limit_minor: minor(fields.get('action')),
          daily_limit_minor: minor(fields.get('daily')),
        },
        'PUT',
      );
    if (form.dataset.form === 'allocations')
      return await act(
        '/api/allocations',
        {
          envelopes_minor: Object.fromEntries(
            state.envelopes.map((row) => [row.id, minor(fields.get(row.id))]),
          ),
        },
        'PUT',
      );
    if (form.dataset.form === 'refund') return await act(`/api/orders/${form.dataset.id}/refund`);
  } catch (error) {
    element('.form-error', form).textContent = message(error);
  }
});

window.addEventListener('hashchange', () => {
  if (currentPage() !== 'company') stopReplay();
  paint();
  main.focus({ preventScroll: true });
});
modal.addEventListener('click', (event) => {
  if (event.target === modal) modal.close();
});
navigation();
element('#sign-out').hidden = document.body.dataset.authMode !== 'session';
await refresh();
setInterval(() => {
  if (!busy && !modal.open && !document.hidden) refresh();
}, 3000);
