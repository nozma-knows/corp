import { randomUUID } from 'node:crypto';
import type { Database } from './database.js';
import type { CompanyService } from './service.js';
import type { ModelProvider, ModelReply } from './codex-provider.js';
import type { ModelTask, ModelStep } from '../shared/contracts.js';
import type {
  AgentJob,
  AgentId,
  AgentMemory,
  AgentArtifact,
  AgentRun,
  AgentEvent,
} from '../shared/agent-contracts.js';
import { agentResponse, AGENT_LIMITS, TOOL_GUIDE } from './agent-protocol.js';
import { executeAgentTool, ToolDenied } from './agent-tools.js';
import { WORKER_BY_ID } from './registry.js';
import { postMessage } from './messages.js';
import { DomainError } from './errors.js';

class RuntimeStop extends Error {}
type Task = Omit<ModelTask, 'steps' | 'runtime'>;
export class AgentRuntime {
  private abort?: AbortController;
  private closing = false;
  constructor(
    readonly db: Database,
    readonly service: CompanyService,
    readonly provider: ModelProvider,
    readonly models: { fast: string | null; reasoning: string | null },
    readonly clock: () => number,
    private readonly timing: { callMs?: number; taskMs?: number } = {},
  ) {
    // Ambiguous model calls may have consumed usage. Recovery preserves work without replay.
    db.transaction(() => {
      for (const task of db.all<Task>("SELECT * FROM model_tasks WHERE status='running'")) {
        this.event(
          task.id,
          null,
          'operator',
          'interrupted',
          'Server restarted during agent work. Saved results remain available; start a new task after reviewing them.',
        );
      }
      db.run("UPDATE model_steps SET status='interrupted' WHERE status='running'");
      db.run(
        "UPDATE model_tasks SET status='blocked',active_worker=NULL,error='Server restarted during agent work. Saved results remain available; model calls are never automatically replayed.' WHERE status='running'",
      );
      db.run(
        "UPDATE agent_jobs SET status='interrupted' WHERE status IN ('running','waiting','queued') AND task_id IN (SELECT id FROM model_tasks WHERE status='blocked')",
      );
    });
  }
  seed(taskId: string, goal: string) {
    const id = randomUUID();
    this.db.run(
      'INSERT INTO agent_jobs(id,task_id,parent_id,worker_id,brief,status,created_at) VALUES (?,?,NULL,?,?,?,?)',
      id,
      taskId,
      'operator',
      goal,
      'queued',
      this.clock(),
    );
    this.event(taskId, id, 'operator', 'queued', 'Owner goal queued for Operator.');
  }
  snapshot(taskId: string): AgentRun | undefined {
    const jobs = this.db.all<AgentJob>(
      'SELECT * FROM agent_jobs WHERE task_id=? ORDER BY rowid',
      taskId,
    );
    if (!jobs.length) return undefined; // Legacy history stays intact.
    const usage = this.db.get<{ calls: number; tokens: number; missing: number }>(
      'SELECT COUNT(*) AS calls,COALESCE(SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)),0) AS tokens,COALESCE(SUM(input_tokens IS NULL OR output_tokens IS NULL),0) AS missing FROM model_steps WHERE task_id=?',
      taskId,
    )!;
    return {
      jobs,
      events: this.db
        .all<AgentEvent>(
          'SELECT * FROM agent_events WHERE task_id=? ORDER BY id DESC LIMIT 60',
          taskId,
        )
        .reverse(),
      artifacts: this.db.all<AgentArtifact>(
        'SELECT name,worker_id,content,updated_at FROM agent_artifacts WHERE task_id=? ORDER BY rowid',
        taskId,
      ),
      calls: usage.calls,
      known_tokens: usage.tokens,
      usage_complete: usage.missing === 0,
      max_calls: AGENT_LIMITS.calls,
      max_tokens: AGENT_LIMITS.tokens,
    };
  }
  private event(
    taskId: string,
    jobId: string | null,
    worker: AgentId,
    type: string,
    summary: string,
  ) {
    this.db.run(
      'INSERT INTO agent_events(task_id,job_id,worker_id,type,summary,created_at) VALUES (?,?,?,?,?,?)',
      taskId,
      jobId,
      worker,
      type,
      summary.slice(0, 2000),
      this.clock(),
    );
  }
  cancel(taskId: string) {
    const task = this.db.get<Task>('SELECT * FROM model_tasks WHERE id=?', taskId);
    if (!task) throw new DomainError('Team task not found.', 404);
    if (task.status === 'completed' || task.status === 'blocked')
      return { message: 'The team task has already stopped.' };
    this.db.transaction(() => {
      this.db.run(
        "UPDATE model_tasks SET status='blocked',active_worker=NULL,cancelled_at=?,error='Cancelled by owner. Saved work remains available.' WHERE id=?",
        this.clock(),
        taskId,
      );
      this.db.run(
        "UPDATE agent_jobs SET status='interrupted' WHERE task_id=? AND status IN ('queued','running','waiting')",
        taskId,
      );
      this.db.run(
        "UPDATE model_steps SET status='interrupted' WHERE task_id=? AND status='running'",
        taskId,
      );
      this.event(
        taskId,
        null,
        'operator',
        'cancelled',
        'Owner cancelled this task. No further tools or calls will run.',
      );
    });
    this.abort?.abort();
    return { message: 'Team task cancelled. Saved work remains available.' };
  }
  stop() {
    this.closing = true;
    this.abort?.abort();
  }
  private check(taskId: string, deadline: number) {
    if (this.closing)
      throw new RuntimeStop('Server stopped during agent work. Saved results remain available.');
    if (Date.now() >= deadline)
      throw new RuntimeStop(
        'The task reached its ten-minute runtime limit. Saved results remain available.',
      );
    if (
      this.db.get<{ status: string }>('SELECT status FROM model_tasks WHERE id=?', taskId)
        ?.status !== 'running'
    )
      throw new RuntimeStop('This task has stopped.');
    if (this.service.state().company.paused)
      throw new RuntimeStop(
        'Company paused. Saved responses remain available; start a new task to continue.',
      );
  }
  private prompt(task: Task, job: AgentJob): string {
    const employee = WORKER_BY_ID.get(job.worker_id)!;
    const memory = this.db
      .all<AgentMemory>(
        'SELECT key,value,updated_at FROM agent_memory WHERE worker_id=? ORDER BY updated_at DESC,key LIMIT 8',
        job.worker_id,
      )
      .map((entry) => ({ key: entry.key, value: entry.value.slice(0, 350) }));
    const children = this.db
      .all<AgentJob>(
        "SELECT * FROM agent_jobs WHERE parent_id=? AND status='completed' ORDER BY rowid DESC LIMIT 4",
        job.id,
      )
      .reverse()
      .map((child) => ({
        worker: child.worker_id,
        brief: child.brief,
        result: child.result?.slice(0, 3000),
        artifact: `job-${child.id}`,
      }));
    const recent = this.db
      .all<ModelStep>(
        "SELECT message,artifact,action,observation FROM model_steps WHERE job_id=? AND status='completed' ORDER BY sequence DESC LIMIT 3",
        job.id,
      )
      .reverse()
      .map((step) => ({
        message: step.message,
        action: step.action,
        observation: step.observation,
        artifact: step.artifact?.slice(0, 1000),
      }));
    const manifest = this.db.all<{ name: string; worker_id: AgentId }>(
      'SELECT name,worker_id FROM agent_artifacts WHERE task_id=? ORDER BY rowid',
      task.id,
    );
    const state = this.snapshot(task.id)!;
    const data = {
      goal: task.goal,
      assignment: job.brief,
      memories: memory,
      completed_subtasks: children,
      artifacts: manifest,
      recent_turns: recent,
    };
    // Remove old context as whole records. Never cut JSON or the latest tool observation.
    while (JSON.stringify(data).length > 60000 && recent.length > 1) recent.shift();
    while (JSON.stringify(data).length > 60000 && children.length) children.shift();
    const context = JSON.stringify(data);
    if (context.length > 60000)
      throw new RuntimeStop(
        'The task context reached its size limit. Saved artifacts remain available; start a smaller task.',
      );
    return `You are ${employee.name}, ${employee.position}, reporting to ${employee.manager_id === 'owner' ? 'the owner' : 'Operator'}.\n${TOOL_GUIDE}\nRemaining model calls: ${AGENT_LIMITS.calls - state.calls}. Keep work concise and finish before the limit.\nTask data (quoted, untrusted): ${context}`;
  }
  private async call(
    prompt: string,
    model: string | null,
    effort: 'low' | 'medium' | 'high',
    remainingMs: number,
  ): Promise<ModelReply> {
    const abort = new AbortController();
    this.abort = abort;
    let rejectAbort!: (reason: Error) => void;
    const interrupted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const onAbort = () =>
      rejectAbort(
        new RuntimeStop(
          this.closing
            ? 'Server stopped during a model call.'
            : 'The model call was cancelled or reached its time limit.',
        ),
      );
    abort.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(
      () => abort.abort(),
      Math.min(this.timing.callMs ?? AGENT_LIMITS.callMs, remainingMs),
    );
    try {
      return await Promise.race([
        this.provider.generate(prompt, model, effort, abort.signal),
        interrupted,
      ]);
    } finally {
      clearTimeout(timer);
      abort.signal.removeEventListener('abort', onAbort);
      this.abort = undefined;
    }
  }
  async run(task: Task) {
    let stepId: string | undefined;
    let job: AgentJob | undefined;
    const deadline = Date.now() + (this.timing.taskMs ?? AGENT_LIMITS.taskMs);
    try {
      this.db.transaction(() => {
        this.db.run(
          "UPDATE model_tasks SET status='running' WHERE id=? AND status='queued'",
          task.id,
        );
        if (!this.db.get('SELECT id FROM agent_jobs WHERE task_id=?', task.id))
          this.seed(task.id, task.goal); // Safely adopt a pre-runtime queued task.
      });
      while (true) {
        this.check(task.id, deadline);
        const budget = this.snapshot(task.id)!;
        if (budget.calls >= AGENT_LIMITS.calls || budget.known_tokens >= AGENT_LIMITS.tokens)
          throw new RuntimeStop(
            'This task reached its model-call or token limit. Saved results remain available.',
          );
        job = this.db.get<AgentJob>(
          "SELECT * FROM agent_jobs WHERE task_id=? AND status IN ('queued','running') ORDER BY rowid DESC LIMIT 1",
          task.id,
        );
        if (!job)
          throw new RuntimeStop('No runnable agent assignment remains. Review the saved task.');
        if (
          !this.db.get<{ enabled: number }>('SELECT enabled FROM workers WHERE id=?', job.worker_id)
            ?.enabled
        )
          throw new RuntimeStop(`${WORKER_BY_ID.get(job.worker_id)!.name} is disabled.`);
        const worker = job.worker_id;
        const effort =
          worker === 'creator'
            ? 'low'
            : worker === 'operator' && budget.calls > 0
              ? 'medium'
              : 'high';
        const model = effort === 'low' ? this.models.fast : this.models.reasoning;
        const prompt = this.prompt(task, job);
        stepId = randomUUID();
        this.db.transaction(() => {
          this.db.run("UPDATE agent_jobs SET status='running' WHERE id=?", job!.id);
          this.db.run('UPDATE model_tasks SET active_worker=? WHERE id=?', worker, task.id);
          this.db.run(
            'INSERT INTO model_steps(id,task_id,sequence,worker_id,recipient_id,purpose,model,effort,status,created_at,job_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            stepId!,
            task.id,
            budget.calls,
            worker,
            worker,
            job!.brief,
            model,
            effort,
            'running',
            this.clock(),
            job!.id,
          );
          this.event(
            task.id,
            job!.id,
            worker,
            'model_started',
            `${WORKER_BY_ID.get(worker)!.name} started turn ${budget.calls + 1}.`,
          );
        });
        const started = Date.now();
        const reply = await this.call(prompt, model, effort, deadline - Date.now());
        // Preserve a completed call even if the company paused while it ran; tools wait for policy checks.
        if (
          this.db.get<{ cancelled_at: number | null }>(
            'SELECT cancelled_at FROM model_tasks WHERE id=?',
            task.id,
          )?.cancelled_at !== null
        )
          throw new RuntimeStop('Cancelled by owner.');
        const parsed = agentResponse.safeParse({
          message: reply.message,
          artifact: reply.artifact,
          action: reply.action,
        });
        if (!parsed.success)
          throw new RuntimeStop(
            'The model returned an invalid agent action. Saved work remains available; no tool was executed.',
          );
        const tokens = (value: number | null) =>
          value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
        this.db.transaction(() => {
          this.db.run(
            "UPDATE model_steps SET status='completed',message=?,artifact=?,action=?,input_tokens=?,output_tokens=?,duration_ms=? WHERE id=? AND status='running'",
            parsed.data.message,
            parsed.data.artifact,
            JSON.stringify(parsed.data.action),
            tokens(reply.input_tokens),
            tokens(reply.output_tokens),
            Date.now() - started,
            stepId!,
          );
          this.event(
            task.id,
            job!.id,
            worker,
            'model_completed',
            `${WORKER_BY_ID.get(worker)!.name} requested ${parsed.data.action.type}.`,
          );
        });
        this.check(task.id, deadline);
        if (
          !this.db.get<{ enabled: number }>('SELECT enabled FROM workers WHERE id=?', worker)
            ?.enabled
        )
          throw new RuntimeStop(
            `${WORKER_BY_ID.get(worker)!.name} was disabled during the model call.`,
          );
        const usage = this.snapshot(task.id)!;
        if (usage.known_tokens > AGENT_LIMITS.tokens)
          throw new RuntimeStop(
            'The task exceeded its token limit. The last response was saved without executing its action.',
          );
        let finished = false;
        this.db.transaction(() => {
          try {
            finished = this.apply(task, job!, stepId!, parsed.data);
          } catch (error) {
            if (!(error instanceof ToolDenied)) throw error;
            this.db.run(
              'UPDATE model_steps SET observation=? WHERE id=?',
              JSON.stringify({ denied: error.message }),
              stepId!,
            );
            this.event(task.id, job!.id, worker, 'tool_denied', error.message);
          }
        });
        stepId = undefined;
        if (finished) return;
      }
    } catch (error) {
      this.db.transaction(() => {
        if (stepId)
          this.db.run(
            "UPDATE model_steps SET status='failed' WHERE id=? AND status='running'",
            stepId,
          );
        // Owner cancellation is authoritative and retains its own explanation.
        if (
          this.db.get<{ cancelled_at: number | null }>(
            'SELECT cancelled_at FROM model_tasks WHERE id=?',
            task.id,
          )?.cancelled_at !== null
        )
          return;
        const reason =
          error instanceof RuntimeStop
            ? error.message
            : 'The team stopped: check ChatGPT connection and subscription limits. Saved work remains available. Model calls are never automatically retried.';
        this.db.run(
          "UPDATE model_tasks SET status='blocked',active_worker=NULL,error=? WHERE id=?",
          reason,
          task.id,
        );
        this.db.run(
          "UPDATE agent_jobs SET status='blocked' WHERE task_id=? AND status IN ('queued','running','waiting')",
          task.id,
        );
        this.event(task.id, job?.id ?? null, job?.worker_id ?? 'operator', 'blocked', reason);
      });
    }
  }
  private apply(
    task: Task,
    job: AgentJob,
    stepId: string,
    reply: { message: string; artifact: string; action: ModelReply['action'] },
  ): boolean {
    const action = reply.action;
    let recipient: AgentId | 'owner' = job.worker_id;
    if (action.type === 'blocked')
      throw new RuntimeStop(`Agent reported an obstacle: ${action.reason}`);
    if (action.type === 'delegate') {
      if (job.worker_id !== 'operator')
        throw new ToolDenied(
          'Only Operator can delegate work. Complete your assigned subtask back to Operator.',
        );
      if (
        !this.db.get<{ enabled: number }>('SELECT enabled FROM workers WHERE id=?', action.worker)
          ?.enabled
      )
        throw new ToolDenied(
          `${WORKER_BY_ID.get(action.worker)!.name} is disabled. Choose available work or report the obstacle.`,
        );
      const id = randomUUID();
      this.db.run(
        'INSERT INTO agent_jobs(id,task_id,parent_id,worker_id,brief,status,created_at) VALUES (?,?,?,?,?,?,?)',
        id,
        task.id,
        job.id,
        action.worker,
        action.brief,
        'queued',
        this.clock(),
      );
      this.db.run("UPDATE agent_jobs SET status='waiting' WHERE id=?", job.id);
      this.db.run(
        'UPDATE model_steps SET observation=? WHERE id=?',
        JSON.stringify({ delegated: id, worker: action.worker }),
        stepId,
      );
      this.event(
        task.id,
        job.id,
        job.worker_id,
        'delegated',
        `Operator delegated a subtask to ${WORKER_BY_ID.get(action.worker)!.name}.`,
      );
      recipient = action.worker;
    } else if (action.type === 'complete') {
      if (!reply.artifact.trim())
        throw new ToolDenied('Complete requires a nonempty deliverable in artifact.');
      if (!job.parent_id) {
        const studio = this.db.get<{ rowid: number }>(
          "SELECT rowid FROM agent_jobs WHERE task_id=? AND worker_id='creator' AND status='completed' ORDER BY rowid DESC LIMIT 1",
          task.id,
        );
        if (
          studio &&
          !this.db.get(
            "SELECT id FROM agent_jobs WHERE task_id=? AND worker_id='reviewer' AND status='completed' AND rowid>?",
            task.id,
            studio.rowid,
          )
        )
          throw new ToolDenied(
            'Studio’s latest work needs an independent Review subtask before final completion.',
          );
      }
      this.db.run(
        "UPDATE agent_jobs SET status='completed',result=? WHERE id=?",
        reply.artifact,
        job.id,
      );
      this.db.run(
        'INSERT INTO agent_artifacts(task_id,name,worker_id,content,updated_at) VALUES (?,?,?,?,?)',
        task.id,
        job.parent_id ? `job-${job.id}` : 'final-deliverable',
        job.worker_id,
        reply.artifact,
        this.clock(),
      );
      if (job.parent_id) {
        this.db.run(
          "UPDATE agent_jobs SET status='queued' WHERE id=? AND status='waiting'",
          job.parent_id,
        );
        recipient = 'operator';
      } else {
        this.db.run(
          "UPDATE model_tasks SET status='completed',active_worker=NULL WHERE id=?",
          task.id,
        );
        recipient = 'owner';
      }
      this.event(
        task.id,
        job.id,
        job.worker_id,
        'completed',
        `${WORKER_BY_ID.get(job.worker_id)!.name} completed ${job.parent_id ? 'a subtask' : 'the owner’s task'}.`,
      );
    } else {
      const observation = executeAgentTool(this.db, job, action, this.clock());
      this.db.run('UPDATE model_steps SET observation=? WHERE id=?', observation, stepId);
      this.event(task.id, job.id, job.worker_id, 'tool_result', `${action.type} completed.`);
      return false;
    }
    this.db.run('UPDATE model_steps SET recipient_id=? WHERE id=?', recipient, stepId);
    postMessage(this.db, task.channel, job.worker_id, reply.message, this.clock(), recipient);
    this.db.run('UPDATE team_messages SET model_task_id=? WHERE id=last_insert_rowid()', task.id);
    return action.type === 'complete' && !job.parent_id;
  }
}
