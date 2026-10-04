import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fixture } from './helpers.js';
import { DomainError } from '../src/server/errors.js';
import { CompanyService } from '../src/server/service.js';
import { post } from '../src/server/treasury.js';

function scenario(name: string, run: (f: ReturnType<typeof fixture>) => unknown) {
  test(name, async () => {
    const f = fixture();
    try {
      await run(f);
    } finally {
      f.cleanup();
    }
  });
}
scenario('opening capital is virtual and $400 is protected', ({ service }) => {
  const s = service.state();
  assert.equal(s.company.cash_minor, 100000);
  assert.equal(s.company.available_minor, 60000);
  assert.equal(
    s.envelopes.reduce((n, r) => n + r.budget_minor, 0),
    60000,
  );
  assert.equal(s.company.mode, 'simulation');
  assert.equal(s.capabilities.real_world_execution, false);
});
scenario('a sale reports profit and covers the full refund liability', ({ service, command }) => {
  command('cycle');
  const c = service.state().company;
  assert.equal(c.cash_minor, 101950);
  assert.equal(c.profit_minor, 1950);
  assert.equal(c.refund_buffer_minor, 2400);
  assert.equal(c.available_minor, 59550);
});
scenario('refund reverses revenue and retains costs, even while paused', ({ service, command }) => {
  const id = command('cycle').order_id!;
  command('pause', { paused: true });
  command('refund', { id });
  const c = service.state().company;
  assert.equal(c.cash_minor, 99550);
  assert.equal(c.profit_minor, -450);
  assert.equal(c.revenue_minor, 0);
  assert.equal(c.refund_buffer_minor, 0);
  assert.equal(c.expenses_minor, 450);
  assert.throws(() => command('refund', { id }), DomainError);
  assert.equal(service.state().company.cash_minor, 99550);
});
scenario('idempotent success survives reinitialization', ({ service, command, db, clock }) => {
  const key = randomUUID(),
    first = command('cycle', {}, key);
  const restarted = new CompanyService(db, clock);
  restarted.initialize();
  assert.deepEqual(restarted.command(key, 'cycle', {}), first);
  assert.equal(service.state().company.order_count, 1);
  assert.throws(
    () => restarted.command(key, 'cycle', { product_id: 'service-menu' }),
    /different command/,
  );
});
scenario(
  'denial is persistent, audited and not retried after policy changes',
  ({ service, command }) => {
    command('policy', { action_limit_minor: 100, daily_limit_minor: 4000 });
    const key = randomUUID();
    assert.throws(() => command('cycle', {}, key));
    assert.equal(service.state().events[0].kind, 'blocked');
    command('policy', { action_limit_minor: 2500, daily_limit_minor: 4000 });
    assert.throws(() => command('cycle', {}, key));
    assert.equal(service.state().company.order_count, 0);
  },
);
scenario('a domain error after posting rolls back all financial work', ({ service, command }) => {
  const original = service.cycle.bind(service);
  service.cycle = (p, n) => {
    original(p, n);
    throw new DomainError('Injected failure after accounting');
  };
  assert.throws(() => command('cycle'), /Injected failure/);
  assert.equal(service.state().company.cash_minor, 100000);
  assert.equal(service.state().company.order_count, 0);
  assert.equal(service.inspector().runs[0].order_id, null);
});
scenario(
  'unexpected failures roll back and allow an identical retry',
  ({ service, command, db }) => {
    const original = service.cycle.bind(service),
      key = randomUUID();
    service.cycle = (p, n) => {
      original(p, n);
      throw new Error('Unexpected failure');
    };
    assert.throws(() => command('cycle', {}, key));
    assert.equal(service.state().company.cash_minor, 100000);
    assert.equal(db.all('SELECT * FROM commands').length, 0);
    service.cycle = original;
    command('cycle', {}, key);
    assert.equal(service.state().company.order_count, 1);
  },
);
scenario(
  'reservation holds funds and execution records exactly one expense',
  ({ service, command, reserve }) => {
    const id = reserve().action_id!;
    let c = service.state().company;
    assert.equal(c.reserved_minor, 1200);
    assert.equal(c.cash_minor, 100000);
    assert.equal(c.profit_minor, 0);
    command('execute', { id });
    c = service.state().company;
    assert.equal(c.cash_minor, 98800);
    assert.equal(c.reserved_minor, 0);
    assert.equal(c.profit_minor, -1200);
    assert.throws(() => command('execute', { id }));
  },
);
scenario(
  'pause blocks new expenses but cancellation stays available',
  ({ service, command, reserve }) => {
    const id = reserve().action_id!;
    command('pause', { paused: true });
    assert.throws(() => command('cycle'));
    assert.throws(() => command('execute', { id }));
    assert.throws(() => command('automation', { enabled: true }));
    command('cancel', { id });
    assert.equal(service.state().company.reserved_minor, 0);
  },
);
scenario(
  'pending actions must pass changed policy before execution',
  ({ service, command, reserve }) => {
    const id = reserve().action_id!;
    command('policy', { action_limit_minor: 1000, daily_limit_minor: 4000 });
    assert.throws(() => command('execute', { id }));
    assert.equal(service.state().company.cash_minor, 100000);
  },
);
scenario(
  'allocations cannot remove commitments or expand the initial pool',
  ({ service, command, reserve }) => {
    reserve();
    const values = Object.fromEntries(service.state().envelopes.map((r) => [r.id, r.budget_minor]));
    assert.throws(() =>
      command('allocations', { envelopes_minor: { ...values, customer_acquisition: 0 } }),
    );
    assert.throws(() =>
      command('allocations', { envelopes_minor: { ...values, customer_acquisition: 60000 } }),
    );
  },
);
scenario(
  'auto-run stops at the daily cap and two ticks cannot duplicate a sale',
  ({ service, command, advance }) => {
    command('automation', { enabled: true });
    advance(15);
    service.tick();
    service.tick();
    assert.equal(service.state().company.order_count, 1);
    for (let i = 0; i < 11; i++) {
      advance(15);
      service.tick();
    }
    const c = service.state().company;
    assert.equal(c.order_count, 8);
    assert.equal(c.auto_enabled, 0);
    assert.equal(c.spent_today_minor, 3600);
  },
);
scenario('refund provision expires after 30 elapsed days', ({ service, command, advance }) => {
  command('cycle');
  advance(30 * 86400 + 1);
  assert.equal(service.state().company.refund_buffer_minor, 0);
  assert.equal(service.state().company.available_minor, 61950);
});
scenario(
  'ledger and audit are append-only and every transaction balances',
  ({ service, command, db, clock }) => {
    for (const table of ['transactions', 'journal_lines', 'events'])
      assert.throws(() => db.transaction(() => db.exec(`DELETE FROM ${table}`)), /append-only/);
    assert.throws(() =>
      db.transaction(() =>
        post(
          db,
          'bad',
          'Unbalanced',
          [
            { account: 'cash', amount_minor: 100 },
            { account: 'equity', amount_minor: -99 },
          ],
          clock(),
        ),
      ),
    );
    command('cycle');
    assert.deepEqual(
      db.all(
        'SELECT transaction_id FROM journal_lines GROUP BY transaction_id HAVING SUM(amount_minor)!=0',
      ),
      [],
    );
    assert.equal(service.state().company.order_count, 1);
    db.checkIntegrity();
  },
);
scenario('invalid money values are rejected before mutation', ({ service, command }) => {
  for (const amount of [-100, 1.2, true, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(
      () =>
        command('reserve', {
          title: 'Invalid cost',
          amount_minor: amount,
          envelope_id: 'creation_quality',
        }),
      DomainError,
    );
  assert.equal(service.state().company.cash_minor, 100000);
});
scenario(
  'independent processes serialize reservations and cannot consume protected capital',
  async ({ db, service, command, directory }) => {
    command('policy', { action_limit_minor: 2500, daily_limit_minor: 60000 });
    const ids = service.state().envelopes.map((r) => r.id);
    const workerSource = `const { parentPort, workerData }=require('node:worker_threads'); (async()=>{ const { tsImport }=await import('tsx/esm/api'); const { Database }=await tsImport(workerData.databaseModule,workerData.serviceModule); const { CompanyService }=await tsImport(workerData.serviceModule,workerData.serviceModule); const db=new Database(workerData.path); const service=new CompanyService(db,()=>1800000000); let admitted=0; try { for(let i=0;i<25;i++){try{service.command(require('node:crypto').randomUUID(),'reserve',{title:'Concurrent hold',amount_minor:2500,envelope_id:workerData.ids[i%5]});admitted++;}catch(e){if(!e.status)throw e;}} }finally{db.close();} parentPort.postMessage(admitted); })().catch(e=>{throw e;});`;
    const counts = await Promise.all(
      Array.from(
        { length: 4 },
        () =>
          new Promise<number>((resolve, reject) => {
            const w = new Worker(workerSource, {
              eval: true,
              workerData: {
                path: db.path,
                ids,
                databaseModule: new URL('../src/server/database.ts', import.meta.url).href,
                serviceModule: new URL('../src/server/service.ts', import.meta.url).href,
              },
            });
            w.once('message', resolve);
            w.once('error', reject);
          }),
      ),
    );

    assert.equal(
      counts.reduce((a, b) => a + b, 0),
      24,
    );
    assert.equal(service.state().company.reserved_minor, 60000);
    assert.equal(service.state().company.available_minor, 0);
    assert.ok(service.state().company.policy_healthy);
    assert.ok(existsSync(join(directory, 'company.sqlite3')));
  },
);
