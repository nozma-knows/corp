import { command, getState, getInspector, minor, date } from './api.js';
import { pages, icon, render, dialog } from './views.js';

let state, busy = false, lastSignature = '', toastTimer;
const main = document.querySelector('#main');
const modal = document.querySelector('#modal');
const currentPage = () => pages.some(([id]) => id === location.hash.slice(1)) ? location.hash.slice(1) : 'overview';

function navigation() {
  const page = currentPage();
  document.querySelector('#navigation').innerHTML = pages.map(([id, label, symbol]) => `<a href="#${id}" class="nav-item ${id === page ? 'selected' : ''}" ${id === page ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span>${id === 'team' ? '<small aria-hidden="true">4</small>' : ''}</a>`).join('');
  document.querySelector('#view-label').textContent = pages.find(([id]) => id === page)[1];
}

function paint() {
  if (!state) return;
  main.innerHTML = render(currentPage(), state);
  navigation();
  document.querySelector('#updated').textContent = `Updated ${date(state.server_time)}`;
}

async function refresh(force = false) {
  try {
    const [next, inspector] = await Promise.all([getState(), getInspector()]);
    next.inspector = inspector;
    const signature = JSON.stringify([next.company, next.events[0]?.id, next.envelopes, inspector.workers, inspector.runs[0]?.id]);
    state = next;
    if (force || signature !== lastSignature) paint();
    lastSignature = signature;
    document.querySelector('#connection').textContent = 'Local · connected';
    document.querySelector('#connection').classList.remove('disconnected');
  } catch (error) {
    document.querySelector('#connection').textContent = 'Connection unavailable';
    document.querySelector('#connection').classList.add('disconnected');
    if (!state) {
      main.innerHTML = '<div class="error-state"><h1>Company unavailable</h1><p>Check that the local server is running, then reconnect.</p><button class="button primary" data-action="retry">Reconnect</button></div>';
    }
    if (force) notify(error.message, true);
  }
}

function notify(message, error = false) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.className = `visible ${error ? 'error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = ''; }, 6000);
}

async function act(path, payload, method = 'POST') {
  if (busy) return false;
  busy = true;
  const key = crypto.randomUUID();
  document.querySelectorAll('button[data-action]:not([data-action="close"]), button[type="submit"]').forEach(button => { button.disabled = true; });
  try {
    let result;
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
    const field = modal.querySelector('.form-error');
    if (modal.open && field) field.textContent = error.message;
    else notify(error.message, true);
    return false;
  } finally {
    busy = false;
    document.querySelectorAll('#modal button').forEach(button => { button.disabled = false; });
    // The dialog lives outside main, so repainting restores underlying controls
    // without losing entered values or a validation error in the open dialog.
    paint();
  }
}

function open(kind, id) {
  document.querySelector('#modal-content').innerHTML = dialog(kind, state, id);
  modal.showModal();
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'close') return modal.close();
  if (action === 'retry') return refresh(true);
  if (!state || busy) return;
  if (['experiment', 'policy', 'allocations', 'journal', 'trace', 'refund', 'worker-detail', 'run-detail'].includes(action)) return open(action, button.dataset.id);
  if (action === 'trace-from-run') { modal.close(); return open('trace', button.dataset.id); }
  if (action === 'worker-toggle') {
    const worker = state.inspector.workers.find(worker => worker.id === button.dataset.id);
    return act(`/api/workers/${worker.id}`, { enabled: !worker.enabled });
  }
  if (action === 'pause') return act('/api/pause', { paused: !state.company.paused });
  if (action === 'automation') return act('/api/automation', { enabled: !state.company.auto_enabled });
  if (action === 'cycle' || action === 'product-cycle') return act('/api/simulation/cycle', { product_id: button.dataset.id || 'cleaning-kit' });
  if (action === 'execute' || action === 'cancel') return act(`/api/actions/${button.dataset.id}/${action}`);
});

document.addEventListener('submit', async event => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  const fields = new FormData(form);
  try {
    if (form.dataset.form === 'experiment') return await act('/api/experiments', { title: fields.get('title'), envelope_id: fields.get('envelope_id'), amount_minor: minor(fields.get('amount')) });
    if (form.dataset.form === 'policy') return await act('/api/policy', { action_limit_minor: minor(fields.get('action')), daily_limit_minor: minor(fields.get('daily')) }, 'PUT');
    if (form.dataset.form === 'allocations') return await act('/api/allocations', { envelopes_minor: Object.fromEntries(state.envelopes.map(row => [row.id, minor(fields.get(row.id))])) }, 'PUT');
    if (form.dataset.form === 'refund') return await act(`/api/orders/${form.dataset.id}/refund`);
  } catch (error) {
    form.querySelector('.form-error').textContent = error.message;
  }
});

window.addEventListener('hashchange', () => { paint(); main.focus({ preventScroll: true }); });
modal.addEventListener('click', event => { if (event.target === modal) modal.close(); });
navigation();
await refresh();
setInterval(() => { if (!busy && !modal.open && !document.hidden) refresh(); }, 3000);
