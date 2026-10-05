import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Database } from '../src/server/database.js';
import { CompanyService } from '../src/server/service.js';
import { createApp } from '../src/server/api.js';
import { loadSettings } from '../src/server/settings.js';
import { ModelTasks } from '../src/server/model-tasks.js';
import type { ModelProvider, ModelReply } from '../src/server/codex-provider.js';
import { fixture } from './helpers.js';

class TestProvider implements ModelProvider {
  connected = true;
  prompts: string[] = [];
  calls: { model: string | null; effort: string }[] = [];
  failAt = -1;
  wait?: Promise<void>;
  async status() {
    return { connected: this.connected };
  }
  login() {
    this.connected = true;
  }
  close() {}
  async generate(
    prompt: string,
    model: string | null,
    effort: 'low' | 'medium' | 'high',
  ): Promise<ModelReply> {
    this.prompts.push(prompt);
    this.calls.push({ model, effort });
    if (this.wait) await this.wait;
    if (this.calls.length === this.failAt)
      throw new Error('TEST PROVIDER FAILURE with private transport data');
    return {
      message: `Test handoff ${this.calls.length}`,
      artifact: `Test deliverable ${this.calls.length}\n<img src=x onerror=alert(1)>`,
      input_tokens: 120,
      output_tokens: 50,
    };
  }
}
const routes = { fast: 'test-fast', reasoning: 'test-reasoning' };

test('real task orchestration saves provider responses, hierarchy and usage without creating sales', async () => {
  const f = fixture(),
    provider = new TestProvider(),
    tasks = new ModelTasks(f.db, f.service, provider, routes, f.clock);
  try {
    const result = await tasks.enqueue('real-task-123', {
      channel: 'product',
      goal: 'Write a useful cleaning business launch brief.',
    });
    tasks.tick();
    await tasks.idle();
    assert.equal(tasks.snapshot()[0].status, 'completed');
    assert.equal(tasks.snapshot()[0].steps.length, 5);
    assert.deepEqual(
      tasks.snapshot()[0].steps.map((step) => [step.worker_id, step.recipient_id]),
      [
        ['operator', 'researcher'],
        ['researcher', 'creator'],
        ['creator', 'reviewer'],
        ['reviewer', 'operator'],
        ['operator', 'owner'],
      ],
    );
    assert.deepEqual(
      provider.calls.map((call) => call.model),
      ['test-reasoning', 'test-reasoning', 'test-fast', 'test-reasoning', 'test-reasoning'],
    );
    assert.match(provider.prompts[3], /Test deliverable 3/);
    assert.equal(
      tasks.snapshot()[0].steps[4].artifact,
      'Test deliverable 5\n<img src=x onerror=alert(1)>',
    );
    assert.equal(f.service.state().messages.length, 6);
    assert.ok(
      f.service.state().messages.every((message) => message.model_task_id === result.run_id),
    );
    assert.equal(f.service.state().company.cash_minor, 100000);
    assert.equal(f.service.state().orders.length, 0);
    assert.equal(f.service.inspector().totals.model_calls, 5);
    assert.equal(f.service.inspector().totals.input_tokens, 600);
    assert.equal(f.service.inspector().totals.model_cost_micro_usd, null);
    provider.connected = false;
    assert.equal(
      (
        await tasks.enqueue('real-task-123', {
          channel: 'product',
          goal: 'Write a useful cleaning business launch brief.',
        })
      ).run_id,
      result.run_id,
    );
    tasks.tick();
    await tasks.idle();
    assert.equal(provider.calls.length, 5);
    await assert.rejects(
      tasks.enqueue('real-task-123', { channel: 'general', goal: 'Changed goal' }),
      /already used/,
    );
  } finally {
    await tasks.close();
    f.cleanup();
  }
});

test('provider failures preserve prior work and never retry an ambiguous call', async () => {
  const f = fixture(),
    provider = new TestProvider(),
    tasks = new ModelTasks(f.db, f.service, provider, routes, f.clock);
  provider.failAt = 3;
  try {
    await tasks.enqueue('failing-task-123', { channel: 'product', goal: 'Draft a launch plan.' });
    tasks.tick();
    await tasks.idle();
    const saved = tasks.snapshot()[0];
    assert.equal(saved.status, 'blocked');
    assert.deepEqual(
      saved.steps.map((step) => step.status),
      ['completed', 'completed', 'failed'],
    );
    assert.doesNotMatch(saved.error!, /private transport/);
    assert.equal(f.service.state().messages.length, 3);
    tasks.tick();
    await tasks.idle();
    assert.equal(provider.calls.length, 3);
    const restarted = new ModelTasks(f.db, f.service, provider, routes, f.clock);
    restarted.tick();
    await restarted.idle();
    assert.equal(provider.calls.length, 3);
    assert.equal(f.service.state().company.cash_minor, 100000);
  } finally {
    await tasks.close();
    f.cleanup();
  }
});

test('queued admission respects sign-in, company pause, disabled workers and serial work', async () => {
  const f = fixture(),
    provider = new TestProvider(),
    tasks = new ModelTasks(f.db, f.service, provider, routes, f.clock);
  try {
    provider.connected = false;
    await assert.rejects(
      tasks.enqueue('needs-auth-123', { channel: 'product', goal: 'Hi' }),
      /Connect ChatGPT/,
    );
    provider.connected = true;
    f.command('pause', { paused: true });
    await assert.rejects(
      tasks.enqueue('paused-task-123', { channel: 'product', goal: 'Hi' }),
      /Resume/,
    );
    f.command('pause', { paused: false });
    f.command('worker', { id: 'creator', enabled: false });
    await assert.rejects(
      tasks.enqueue('disabled-task-123', { channel: 'product', goal: 'Hi' }),
      /Studio is disabled/,
    );
    f.command('worker', { id: 'creator', enabled: true });
    await tasks.enqueue('serial-task-123', { channel: 'general', goal: 'Hi' });
    await assert.rejects(
      tasks.enqueue('parallel-task-123', { channel: 'product', goal: 'Another goal' }),
      /already has a task/,
    );
    let release!: () => void;
    provider.wait = new Promise((done) => {
      release = done;
    });
    tasks.tick();
    f.command('pause', { paused: true });
    release();
    await tasks.idle();
    assert.equal(provider.calls.length, 1);
    assert.equal(tasks.snapshot()[0].status, 'blocked');
    assert.equal(tasks.snapshot()[0].steps[0].status, 'completed');
  } finally {
    await tasks.close();
    f.cleanup();
  }
});

test('restart marks in-flight work interrupted rather than executing it twice', async () => {
  const f = fixture(),
    provider = new TestProvider(),
    tasks = new ModelTasks(f.db, f.service, provider, routes, f.clock);
  try {
    const result = await tasks.enqueue('restart-task-123', {
      channel: 'product',
      goal: 'Draft a plan',
    });
    f.db.run("UPDATE model_tasks SET status='running' WHERE id=?", result.run_id);
    f.db.run(
      "INSERT INTO model_steps(id,task_id,sequence,worker_id,recipient_id,purpose,effort,status,created_at) VALUES ('interrupted-step',?,0,'operator','researcher','Plan','high','running',?)",
      result.run_id!,
      f.clock(),
    );
    const restarted = new ModelTasks(f.db, f.service, provider, routes, f.clock);
    restarted.tick();
    await restarted.idle();
    assert.equal(restarted.snapshot()[0].status, 'blocked');
    assert.equal(restarted.snapshot()[0].steps[0].status, 'interrupted');
    assert.equal(provider.calls.length, 0);
  } finally {
    await tasks.close();
    f.cleanup();
  }
});

test('simultaneous duplicate submissions produce one task and one set of calls', async () => {
  const f = fixture(),
    provider = new TestProvider(),
    tasks = new ModelTasks(f.db, f.service, provider, routes, f.clock);
  try {
    const payload = { channel: 'product', goal: 'Write a launch plan.' };
    const [first, second] = await Promise.all([
      tasks.enqueue('concurrent-task-123', payload),
      tasks.enqueue('concurrent-task-123', payload),
    ]);
    assert.equal(first.run_id, second.run_id);
    tasks.tick();
    await tasks.idle();
    assert.equal(provider.calls.length, 5);
    assert.equal(tasks.snapshot().length, 1);
    assert.equal(f.service.state().messages.length, 6);
  } finally {
    await tasks.close();
    f.cleanup();
  }
});

test('upgrading a pre-model company preserves its ledger, messages and command replay', async () => {
  const f = fixture();
  const legacyMigrations = join(f.directory, 'legacy-migrations');
  mkdirSync(legacyMigrations);
  for (const name of [
    '001_initial.sql',
    '002_execution_inspector.sql',
    '003_operator_sessions.sql',
    '004_team_messages.sql',
  ])
    copyFileSync(resolve('migrations', name), join(legacyMigrations, name));
  const path = join(f.directory, 'legacy.sqlite3');
  const old = new Database(path, legacyMigrations),
    service = new CompanyService(old, f.clock);
  service.initialize();
  service.command('before-model-task', 'cycle', {});
  const before = service.state();
  old.close();
  const upgraded = new Database(path),
    current = new CompanyService(upgraded, f.clock);
  try {
    current.initialize();
    assert.equal(current.state().company.cash_minor, before.company.cash_minor);
    assert.equal(current.state().messages.length, before.messages.length);
    current.command('before-model-task', 'cycle', {});
    assert.equal(current.state().messages.length, before.messages.length);
    const provider = new TestProvider(),
      tasks = new ModelTasks(upgraded, current, provider, routes, f.clock);
    await tasks.enqueue('after-model-task', { channel: 'general', goal: 'Write a launch plan.' });
    tasks.tick();
    await tasks.idle();
    assert.equal(tasks.snapshot()[0].status, 'completed');
    assert.equal(current.state().company.cash_minor, before.company.cash_minor);
    upgraded.checkIntegrity();
    await tasks.close();
  } finally {
    upgraded.close();
    f.cleanup();
  }
});

test('team API protects mutations and returns persisted provider work through state', async () => {
  const f = fixture(),
    provider = new TestProvider();
  const server = await createApp({
    settings: loadSettings({ CORP_DB_PATH: f.db.path }),
    startWorker: false,
    modelProvider: provider,
  });
  try {
    const payload = { channel: 'product', goal: 'Draft a sales email without sending it.' };
    assert.equal(
      (await server.app.inject({ method: 'POST', url: '/api/team/tasks', payload })).statusCode,
      403,
    );
    const headers = {
      'x-operator-token': server.localToken,
      'idempotency-key': 'api-team-task-123',
    };
    assert.equal(
      (
        await server.app.inject({
          method: 'POST',
          url: '/api/team/tasks',
          headers,
          payload: { ...payload, sender_id: 'operator' },
        })
      ).statusCode,
      422,
    );
    assert.equal(
      (await server.app.inject({ method: 'POST', url: '/api/team/tasks', headers, payload }))
        .statusCode,
      202,
    );
    await server.modelTasks.idle();
    const state = (await server.app.inject('/api/state')).json();
    assert.equal(state.capabilities.llm_agents, true);
    assert.equal(state.model_tasks[0].status, 'completed');
    assert.equal(state.model_tasks[0].steps[4].output_tokens, 50);
    assert.equal(
      (await server.app.inject({ method: 'POST', url: '/api/models/connect', payload: {} }))
        .statusCode,
      403,
    );
  } finally {
    await server.app.close();
    f.cleanup();
  }
});
