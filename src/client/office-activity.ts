import type { DashboardState } from '../shared/contracts.js';
import type { OfficePersonId } from '../shared/office-layout.js';

export interface OfficeCue {
  id: string;
  sender: OfficePersonId;
  recipient: OfficePersonId;
  message: string;
  mode: 'live' | 'recorded' | 'blocked';
}
export function officeCue(state: DashboardState, step: number): OfficeCue | null {
  const task = state.model_tasks?.[0];
  if (task) {
    const selected =
      task.status === 'running'
        ? (task.steps
            .filter(
              (s) =>
                s.status === 'completed' &&
                (!s.action || ['delegate', 'complete'].includes(JSON.parse(s.action).type)),
            )
            .at(-1) ?? task.steps.find((s) => s.status === 'running'))
        : task.steps[Math.min(step, task.steps.length - 1)];
    if (!selected) return null;
    return {
      id: `${task.id}:${selected.id}:${selected.status}:${task.status}`,
      sender: selected.worker_id,
      recipient: selected.recipient_id,
      message:
        selected.message ??
        (task.status === 'blocked'
          ? (task.error ?? 'This task is blocked.')
          : `${state.inspector.workers.find((w) => w.id === selected.worker_id)?.name ?? selected.worker_id} is working on the team task.`),
      mode:
        task.status === 'blocked' ||
        selected.status === 'failed' ||
        selected.status === 'interrupted'
          ? 'blocked'
          : task.status === 'running'
            ? 'live'
            : 'recorded',
    };
  }
  const run = state.inspector.runs[0],
    span = run?.spans[Math.min(step, run.spans.length - 1)];
  if (!span) return null;
  const handoff = state.messages.find(
    (m) => m.run_id === run.id && m.function_id === span.function_id,
  );
  return {
    id: `${run.id}:${span.id}`,
    sender: span.worker_id,
    recipient: handoff?.recipient_id ?? 'operator',
    message:
      handoff?.body ??
      (run.status === 'blocked' ? 'This simulation was blocked.' : span.function_title),
    mode: run.status === 'blocked' ? 'blocked' : 'recorded',
  };
}
