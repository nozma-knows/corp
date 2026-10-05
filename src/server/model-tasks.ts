import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from './database.js';
import type { CompanyService } from './service.js';
import type { ModelProvider } from './codex-provider.js';
import type { ModelTask, ModelStep, WorkerId } from '../shared/contracts.js';
import { DomainError } from './errors.js';
import { postMessage } from './messages.js';
import { WORKER_BY_ID } from './registry.js';
import { AgentRuntime } from './agent-runtime.js';

const request = z.strictObject({
  channel: z.enum(['general', 'product', 'finance']),
  goal: z.string().trim().min(1).max(2000),
});
export class ModelTasks {
  private pending?: Promise<void>;
  readonly runtime: AgentRuntime;
  private closing = false;
  healthy = true;
  constructor(
    readonly db: Database,
    readonly service: CompanyService,
    readonly provider: ModelProvider,
    readonly models: { fast: string | null; reasoning: string | null },
    readonly clock = () => Math.floor(Date.now() / 1000),
  ) {
    this.runtime = new AgentRuntime(db, service, provider, models, clock);
  }
  snapshot(): ModelTask[] {
    return this.db
      .all<Omit<ModelTask, 'steps'>>(
        'SELECT id,channel,goal,status,active_worker,error,created_at FROM model_tasks ORDER BY created_at DESC,rowid DESC LIMIT 20',
      )
      .map((task) => ({
        ...task,
        runtime: this.runtime.snapshot(task.id),
        steps: this.db.all<ModelStep>(
          'SELECT * FROM model_steps WHERE task_id=? ORDER BY sequence',
          task.id,
        ),
      }));
  }
  async enqueue(key: string, input: unknown) {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(key))
      throw new DomainError('A valid idempotency key is required.', 422);
    const parsed = request.safeParse(input);
    if (!parsed.success) throw new DomainError('Enter a team goal and a valid channel.', 422);
    const { channel, goal } = parsed.data;
    const existing = this.db.get<{ id: string; channel: string; goal: string }>(
      'SELECT * FROM model_tasks WHERE request_key=?',
      key,
    );
    if (existing) {
      if (existing.goal !== goal || existing.channel !== channel)
        throw new DomainError('This request key was already used for another task.', 409);
      return { message: 'Team task saved.', run_id: existing.id };
    }
    if (!(await this.provider.status()).connected)
      throw new DomainError('Connect ChatGPT in Company map before asking the team.', 409);
    const id = randomUUID();
    const savedId = this.db.transaction(() => {
      // Check again after the asynchronous login probe, before reserving a task.
      const concurrent = this.db.get<{ id: string; channel: string; goal: string }>(
        'SELECT * FROM model_tasks WHERE request_key=?',
        key,
      );
      if (concurrent) {
        if (concurrent.channel !== channel || concurrent.goal !== goal)
          throw new DomainError('This request key was already used for another task.', 409);
        return concurrent.id;
      }
      if (this.db.get<{ paused: number }>('SELECT paused FROM company WHERE id=1')!.paused)
        throw new DomainError('Resume the company before starting a team task.');
      if (this.db.get("SELECT id FROM model_tasks WHERE status IN ('queued','running')"))
        throw new DomainError('The team already has a task. Wait for it to finish.', 409);
      const count = this.db.get<{ total: number }>(
        'SELECT COUNT(*) AS total FROM model_tasks WHERE created_at>?',
        this.clock() - 86400,
      )!.total;
      if (count >= 20) throw new DomainError('The team has reached its 20-task daily limit.', 429);
      this.checkWorker('operator');
      this.db.run(
        'INSERT INTO model_tasks(id,request_key,channel,goal,status,created_at) VALUES (?,?,?,?,?,?)',
        id,
        key,
        channel,
        goal,
        'queued',
        this.clock(),
      );
      this.runtime.seed(id, goal);
      postMessage(this.db, channel, 'owner', goal, this.clock(), 'operator');
      this.db.run('UPDATE team_messages SET model_task_id=? WHERE id=last_insert_rowid()', id);
      return id;
    });
    return { message: 'Team task queued. Follow the real replies in Messages.', run_id: savedId };
  }
  private checkWorker(id: WorkerId) {
    if (!this.db.get<{ enabled: number }>('SELECT enabled FROM workers WHERE id=?', id)?.enabled)
      throw new DomainError(`${WORKER_BY_ID.get(id)!.name} is disabled.`);
  }
  tick() {
    if (!this.healthy) throw new Error('Model task storage is unavailable');
    if (this.pending || this.closing || this.service.state().company.paused) return;
    const task = this.db.get<Omit<ModelTask, 'steps'>>(
      "SELECT * FROM model_tasks WHERE status='queued' ORDER BY rowid LIMIT 1",
    );
    if (!task) return;
    this.pending = this.runtime
      .run(task)
      .catch(() => {
        this.healthy = false;
      })
      .finally(() => {
        this.pending = undefined;
      });
  }
  async idle() {
    await this.pending;
  }
  cancel(taskId: string) {
    return this.runtime.cancel(taskId);
  }
  async close() {
    this.closing = true;
    this.runtime.stop();
    await this.idle();
    this.provider.close();
  }
}
