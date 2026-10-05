import assert from 'node:assert/strict';
import test from 'node:test';
import { Database } from '../src/server/database.js';
import { CompanyService } from '../src/server/service.js';
import { ModelTasks } from '../src/server/model-tasks.js';
import { AgentRuntime } from '../src/server/agent-runtime.js';
import { AGENT_LIMITS } from '../src/server/agent-protocol.js';
import { createApp } from '../src/server/api.js';
import { loadSettings } from '../src/server/settings.js';
import type { ModelReply, ModelProvider } from '../src/server/codex-provider.js';
import type { AgentAction } from '../src/shared/agent-contracts.js';
import { fixture } from './helpers.js';

const reply = (
  action: AgentAction,
  artifact = 'Actual supplied-information deliverable',
): ModelReply => ({
  action,
  artifact,
  message: 'Actual provider handoff',
  input_tokens: 100,
  output_tokens: 50,
});
class ScriptedAgent implements ModelProvider {
  prompts: string[] = [];
  calls = 0;
  constructor(
    readonly respond: (index: number, signal: AbortSignal) => ModelReply | Promise<ModelReply>,
  ) {}
  async status() {
    return { connected: true };
  }
  login() {}
  close() {}
  async generate(
    prompt: string,
    _model: string | null,
    _effort: 'low' | 'medium' | 'high',
    signal: AbortSignal,
  ) {
    this.prompts.push(prompt);
    return this.respond(this.calls++, signal);
  }
}
const models = { fast: 'fast', reasoning: 'reasoning' };
async function finish(tasks: ModelTasks, key = 'agent-task-123') {
  const result = await tasks.enqueue(key, {
    channel: 'product',
    goal: 'Create a useful launch brief from supplied information.',
  });
  tasks.tick();
  await tasks.idle();
  return result.run_id;
}

test('a simple goal completes in one agent turn without a fixed pipeline or unused employees', async () => {
  const f = fixture(),
    provider = new ScriptedAgent(() => reply({ type: 'complete' })),
    tasks = new ModelTasks(f.db, f.service, provider, models, f.clock);
  try {
    f.command('worker', { id: 'creator', enabled: false });
    await finish(tasks);
    const task = tasks.snapshot()[0];
    assert.equal(task.status, 'completed');
    assert.equal(provider.calls, 1);
    assert.equal(task.runtime?.jobs.length, 1);
    assert.equal(task.steps[0].recipient_id, 'owner');
    assert.equal(task.runtime?.artifacts[0].name, 'final-deliverable');
    assert.equal(f.service.state().company.cash_minor, 100000);
  } finally {
    await tasks.close();
    f.cleanup();
  }
});

test('tool observations feed the next turn; employee memory survives restart and stays scoped', async () => {
  const f = fixture();
  const actions: AgentAction[] = [
    { type: 'memory.write', key: 'tone', value: 'Plain, concise language' },
    { type: 'delegate', worker: 'researcher', brief: 'Develop the brief.' },
    { type: 'memory.read', key: 'tone' },
    { type: 'memory.write', key: 'source', value: 'Use supplied information only' },
    { type: 'artifact.save', name: 'research-brief', content: 'Saved Scout brief' },
    { type: 'complete' },
    { type: 'artifact.read', name: 'research-brief' },
    { type: 'complete' },
  ];
  const provider = new ScriptedAgent((index) => reply(actions[index]));
  const tasks = new ModelTasks(f.db, f.service, provider, models, f.clock);
  try {
    await finish(tasks);
    assert.equal(tasks.snapshot()[0].status, 'completed');
    assert.match(provider.prompts[3], /\\"value\\":null/);
    assert.match(provider.prompts[7], /Saved Scout brief/);
    assert.doesNotMatch(provider.prompts[2], /Plain, concise language/);
    const reopened = new Database(f.db.path),
      service = new CompanyService(reopened, f.clock);
    service.initialize();
    const second = new ScriptedAgent((index) =>
      reply(index === 0 ? { type: 'memory.read', key: 'tone' } : { type: 'complete' }),
    );
    const resumed = new ModelTasks(reopened, service, second, models, f.clock);
    try {
      await finish(resumed, 'next-agent-task');
      assert.match(second.prompts[0], /Plain, concise language/);
      assert.match(second.prompts[1], /Plain, concise language/);
      assert.equal(reopened.all('SELECT * FROM agent_memory').length, 2);
      assert.ok(
        tasks
          .snapshot()
          .find((task) =>
            task.runtime?.artifacts.some((artifact) => artifact.name === 'research-brief'),
          ),
      );
    } finally {
      await resumed.close();
      reopened.close();
    }
  } finally {
    await tasks.close();
    f.cleanup();
  }
});

test('delegation, artifact ownership and independent review are enforced; denied tools can be corrected', async () => {
  const f = fixture();
  const actions: AgentAction[] = [
    { type: 'delegate', worker: 'researcher', brief: 'Research supplied information.' },
    { type: 'delegate', worker: 'creator', brief: 'Try to bypass Operator.' },
    { type: 'artifact.save', name: 'shared', content: 'Scout-owned brief' },
    { type: 'complete' },
    { type: 'artifact.save', name: 'shared', content: 'Try to overwrite Scout' },
    { type: 'artifact.read', name: 'shared' },
    { type: 'delegate', worker: 'creator', brief: 'Produce a draft.' },
    { type: 'complete' },
    { type: 'complete' },
    { type: 'delegate', worker: 'reviewer', brief: 'Review Studio’s latest draft.' },
    { type: 'complete' },
    { type: 'complete' },
  ];
  const provider = new ScriptedAgent((index) => reply(actions[index]));
  const tasks = new ModelTasks(f.db, f.service, provider, models, f.clock);
  try {
    await finish(tasks);
    const task = tasks.snapshot()[0];
    assert.equal(task.status, 'completed');
    assert.equal(task.runtime?.calls, 12);
    assert.equal(task.runtime?.events.filter((event) => event.type === 'tool_denied').length, 3);
    assert.equal(
      task.runtime?.artifacts.find((artifact) => artifact.name === 'shared')?.content,
      'Scout-owned brief',
    );
    assert.ok(task.runtime?.jobs.every((job) => job.status === 'completed'));
    assert.match(provider.prompts[2], /Only Operator can delegate/);
    assert.match(provider.prompts[9], /independent Review/);
    assert.equal(f.service.state().orders.length, 0);
  } finally {
    await tasks.close();
    f.cleanup();
  }
});

test('nonterminating agents stop at the call budget even when token usage is unknown', async () => {
  const f = fixture(),
    provider = new ScriptedAgent(() => ({
      ...reply({ type: 'company.read' }),
      input_tokens: null,
      output_tokens: null,
    })),
    tasks = new ModelTasks(f.db, f.service, provider, models, f.clock);
  try {
    await finish(tasks);
    const task = tasks.snapshot()[0];
    assert.equal(task.status, 'blocked');
    assert.equal(provider.calls, AGENT_LIMITS.calls);
    assert.equal(task.runtime?.usage_complete, false);
    assert.equal(task.runtime?.known_tokens, 0);
    assert.match(task.error!, /limit/);
    tasks.tick();
    await tasks.idle();
    assert.equal(provider.calls, AGENT_LIMITS.calls);
  } finally {
    await tasks.close();
    f.cleanup();
  }
});

test('a response exceeding the token threshold is saved without executing its write', async () => {
  const f = fixture(),
    provider = new ScriptedAgent(() => ({
      ...reply({ type: 'memory.write', key: 'over-budget', value: 'Do not save' }),
      input_tokens: AGENT_LIMITS.tokens + 1,
    })),
    tasks = new ModelTasks(f.db, f.service, provider, models, f.clock);
  try {
    await finish(tasks);
    assert.equal(tasks.snapshot()[0].status, 'blocked');
    assert.equal(tasks.snapshot()[0].steps[0].status, 'completed');
    assert.equal(f.db.all('SELECT * FROM agent_memory').length, 0);
    assert.equal(provider.calls, 1);
  } finally {
    await tasks.close();
    f.cleanup();
  }
});

test('unknown or malformed actions never become executable code or leak provider payloads', async () => {
  for (const action of [
    { type: 'shell', command: 'private malicious payload' },
    { type: 'memory.write', key: '../credentials', value: 'private malicious payload' },
    { type: 'memory.write', key: 'valid', value: 'private malicious payload', worker: 'treasury' },
  ]) {
    const f = fixture(),
      provider = new ScriptedAgent(() => ({
        ...reply({ type: 'complete' }),
        action: action as AgentAction,
      })),
      tasks = new ModelTasks(f.db, f.service, provider, models, f.clock);
    try {
      await finish(tasks);
      assert.equal(tasks.snapshot()[0].status, 'blocked');
      assert.doesNotMatch(tasks.snapshot()[0].error!, /private malicious payload/);
      assert.equal(f.db.all('SELECT * FROM agent_memory').length, 0);
      assert.equal(f.service.state().company.cash_minor, 100000);
    } finally {
      await tasks.close();
      f.cleanup();
    }
  }
});

test('owner cancellation interrupts a call even if the provider ignores abort; late results execute nothing', async () => {
  const f = fixture();
  let resolve!: (result: ModelReply) => void;
  const waiting = new Promise<ModelReply>((done) => {
    resolve = done;
  });
  const provider = new ScriptedAgent(() => waiting),
    tasks = new ModelTasks(f.db, f.service, provider, models, f.clock);
  try {
    const result = await tasks.enqueue('cancel-agent-123', {
      channel: 'general',
      goal: 'Wait for a model reply.',
    });
    tasks.tick();
    assert.equal(provider.calls, 1);
    tasks.cancel(result.run_id);
    await tasks.idle();
    resolve(reply({ type: 'memory.write', key: 'late', value: 'Do not save' }));
    await Promise.resolve();
    const task = tasks.snapshot()[0];
    assert.equal(task.status, 'blocked');
    assert.match(task.error!, /Cancelled by owner/);
    assert.equal(task.steps[0].status, 'interrupted');
    assert.equal(f.db.all('SELECT * FROM agent_memory').length, 0);
    tasks.cancel(result.run_id);
    assert.equal(
      tasks.snapshot()[0].runtime?.events.filter((event) => event.type === 'cancelled').length,
      1,
    );
    assert.throws(() => tasks.cancel('missing-task'), /not found/);
  } finally {
    await tasks.close();
    f.cleanup();
  }
});

test('cancelling queued work makes no call; startup interrupts parent and child assignments without replay', async () => {
  const f = fixture(),
    provider = new ScriptedAgent(() => reply({ type: 'complete' })),
    tasks = new ModelTasks(f.db, f.service, provider, models, f.clock);
  try {
    const queued = await tasks.enqueue('cancel-queued-123', {
      channel: 'general',
      goal: 'A queued goal.',
    });
    tasks.cancel(queued.run_id);
    tasks.tick();
    await tasks.idle();
    assert.equal(provider.calls, 0);
    const live = await tasks.enqueue('restart-agent-123', {
      channel: 'general',
      goal: 'A restart goal.',
    });
    f.db.run("UPDATE model_tasks SET status='running' WHERE id=?", live.run_id);
    const parent = tasks.snapshot()[0].runtime!.jobs[0];
    f.db.run("UPDATE agent_jobs SET status='waiting' WHERE id=?", parent.id);
    f.db.run(
      "INSERT INTO agent_jobs(id,task_id,parent_id,worker_id,brief,status,created_at) VALUES ('child',?,?,'researcher','Research','running',?)",
      live.run_id,
      parent.id,
      f.clock(),
    );
    const restarted = new ModelTasks(f.db, f.service, provider, models, f.clock);
    restarted.tick();
    await restarted.idle();
    const task = restarted.snapshot()[0];
    assert.equal(task.status, 'blocked');
    assert.ok(task.runtime?.jobs.every((job) => job.status === 'interrupted'));
    assert.equal(provider.calls, 0);
    assert.equal(task.runtime?.events.filter((event) => event.type === 'interrupted').length, 1);
  } finally {
    await tasks.close();
    f.cleanup();
  }
});

test('per-call timeouts release the runner and preserve prior state', async () => {
  const f = fixture(),
    provider = new ScriptedAgent(() => new Promise<ModelReply>(() => {})),
    tasks = new ModelTasks(f.db, f.service, provider, models, f.clock);
  const runtime = new AgentRuntime(f.db, f.service, provider, models, f.clock, { callMs: 20 });
  try {
    await tasks.enqueue('timeout-agent-123', { channel: 'general', goal: 'Timeout goal.' });
    await runtime.run(tasks.snapshot()[0]);
    assert.equal(tasks.snapshot()[0].status, 'blocked');
    assert.equal(tasks.snapshot()[0].steps[0].status, 'failed');
    assert.match(tasks.snapshot()[0].error!, /time limit/);
    assert.equal(provider.calls, 1);
  } finally {
    runtime.stop();
    await tasks.close();
    f.cleanup();
  }
});

test('agent memory has bounded capacity and cancelled task tools cannot mutate it', async () => {
  const f = fixture(),
    provider = new ScriptedAgent((index) =>
      reply(
        index === 0
          ? { type: 'memory.write', key: 'extra', value: 'Do not save' }
          : { type: 'complete' },
      ),
    ),
    tasks = new ModelTasks(f.db, f.service, provider, models, f.clock);
  try {
    for (let i = 0; i < AGENT_LIMITS.memoryKeys; i++)
      f.db.run(
        'INSERT INTO agent_memory VALUES (?,?,?,?)',
        'operator',
        `key-${i}`,
        'A saved fact',
        f.clock(),
      );
    await finish(tasks);
    assert.equal(tasks.snapshot()[0].status, 'completed');
    assert.equal(f.db.all('SELECT * FROM agent_memory').length, AGENT_LIMITS.memoryKeys);
    assert.match(provider.prompts[1], /Memory is full/);
  } finally {
    await tasks.close();
    f.cleanup();
  }
});

test('task cancellation and memory management require owner authorization and preserve active context', async () => {
  const f = fixture(),
    provider = new ScriptedAgent(() => new Promise<ModelReply>(() => {}));
  const server = await createApp({
    settings: loadSettings({ CORP_DB_PATH: f.db.path }),
    startWorker: false,
    modelProvider: provider,
  });
  try {
    const queued = await server.modelTasks.enqueue('api-cancel-123', {
      channel: 'general',
      goal: 'API cancellation.',
    });
    server.db.run(
      'INSERT INTO agent_memory VALUES (?,?,?,?)',
      'operator',
      'tone',
      'Plain language',
      f.clock(),
    );
    const cancelPath = `/api/team/tasks/${queued.run_id}/cancel`;
    assert.equal((await server.app.inject({ method: 'POST', url: cancelPath })).statusCode, 403);
    assert.equal(
      (await server.app.inject({ method: 'DELETE', url: '/api/agents/operator/memory/tone' }))
        .statusCode,
      403,
    );
    const headers = { 'x-operator-token': server.localToken };
    assert.equal(
      (
        await server.app.inject({
          method: 'DELETE',
          url: '/api/agents/operator/memory/tone',
          headers,
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (await server.app.inject({ method: 'POST', url: cancelPath, headers })).statusCode,
      200,
    );
    assert.equal(
      (
        await server.app.inject({
          method: 'DELETE',
          url: '/api/agents/operator/memory/tone',
          headers,
        })
      ).statusCode,
      200,
    );
    assert.deepEqual((await server.app.inject('/api/agents/memory')).json(), []);
    assert.equal(
      (
        await server.app.inject({
          method: 'DELETE',
          url: '/api/agents/treasury/memory/tone',
          headers,
        })
      ).statusCode,
      422,
    );
    assert.equal(
      (await server.app.inject({ method: 'POST', url: '/api/team/tasks/missing/cancel', headers }))
        .statusCode,
      404,
    );
  } finally {
    await server.app.close();
    f.cleanup();
  }
});
