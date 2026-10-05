import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { CompanyService } from '../src/server/service.js';
import { WORKERS, FUNCTIONS } from '../src/server/registry.js';
function scenario(name: string, run: (f: ReturnType<typeof fixture>) => void) {
  test(name, () => {
    const f = fixture();
    try {
      run(f);
    } finally {
      f.cleanup();
    }
  });
}
scenario('registry references real workers, managers and function dependencies', () => {
  const ids = new Set<string>(WORKERS.map((w) => w.id));
  ids.add('owner');
  for (const w of WORKERS) assert.ok(ids.has(w.manager_id));
  for (const fn of FUNCTIONS) {
    assert.ok(ids.has(fn.worker_id));
    for (const dependency of fn.depends_on) assert.ok(FUNCTIONS.some((f) => f.id === dependency));
    assert.ok(fn.source.includes('.ts'));
  }
});
scenario('recorded local execution never invents model usage', ({ service, command }) => {
  const result = command('cycle'),
    i = service.inspector(),
    run = i.runs[0];
  assert.equal(run.id, result.run_id);
  assert.equal(run.order_id, result.order_id);
  assert.equal(run.spans.length, 6);
  assert.equal(i.totals.model_calls, 0);
  assert.equal(i.totals.model_cost_micro_usd, 0);
  for (const span of run.spans) {
    assert.equal(span.model, null);
    assert.equal(span.input_tokens, null);
    assert.equal(span.destination, 'local-process');
    assert.ok(span.duration_ms >= 0);
  }
  assert.equal(
    run.spans.find((s) => s.function_id === 'post_ledger')!.parent_id,
    run.spans.find((s) => s.function_id === 'settle_order')!.id,
  );
});
scenario(
  'disabled worker blocks dependent work without any financial change',
  ({ service, command }) => {
    command('worker', { id: 'creator', enabled: false });
    assert.throws(() => command('cycle'), /Studio is disabled/);
    const run = service.inspector().runs[0];
    assert.equal(run.status, 'blocked');
    assert.equal(run.order_id, null);
    assert.equal(run.spans.at(-1)!.worker_id, 'creator');
    assert.equal(run.spans.at(-1)!.status, 'blocked');
    assert.equal(service.state().company.cash_minor, 100000);
  },
);
scenario('Treasury remains mandatory', ({ service, command }) => {
  assert.throws(
    () => command('worker', { id: 'treasury', enabled: false }),
    /Treasury remains mandatory/,
  );
  assert.equal(service.inspector().workers.find((w) => w.id === 'treasury')!.enabled, true);
});
scenario('idempotent commands cannot duplicate runs or spans', ({ service, command }) => {
  command('cycle', {}, 'duplicate-trace');
  command('cycle', {}, 'duplicate-trace');
  assert.equal(service.inspector().runs.length, 1);
  assert.equal(service.inspector().totals.executions, 6);
});
scenario('execution history is append-only', ({ command, db }) => {
  command('cycle');
  assert.throws(
    () => db.transaction(() => db.exec("UPDATE execution_spans SET worker_name='Fake'")),
    /append-only/,
  );
  assert.throws(() => db.transaction(() => db.exec('DELETE FROM execution_spans')), /append-only/);
});
scenario('new companies have no fabricated trace history', ({ service }) => {
  assert.deepEqual(service.inspector().runs, []);
  assert.equal(service.inspector().totals.model_calls, 0);
});
scenario(
  'worker settings and history survive reinitialization',
  ({ service, command, db, clock }) => {
    command('cycle');
    command('worker', { id: 'reviewer', enabled: false });
    const restarted = new CompanyService(db, clock);
    restarted.initialize();
    assert.equal(service.inspector().runs.length, 1);
    assert.equal(restarted.inspector().workers.find((w) => w.id === 'reviewer')!.enabled, false);
  },
);
