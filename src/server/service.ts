import { createHash, randomUUID } from 'node:crypto';
import type { Database } from './database.js';
import { RunTrace, initializeWorkers, recordBlocked, inspectorSnapshot } from './inspector.js';
import { AGENT_ROLES, WORKER_BY_ID } from './registry.js';
import { authorize, balances, envelopes, event, post, scalar } from './treasury.js';
import { DomainError } from './errors.js';
import { prepareDelivery, checkDelivery } from './workflows.js';
import { postMessage, messagesSnapshot } from './messages.js';
import { commandSchemas, type CommandKind, type CommandPayload } from './commands.js';
import type {
  State,
  Product,
  Order,
  Action,
  Transaction,
  Company,
  CommandResult,
  Json,
  WorkerId,
} from '../shared/contracts.js';

function canonical(value: Json): string {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return JSON.stringify(value);
}
/** Every mutation is a validated, atomic command; replay results survive restarts. */
export class CompanyService {
  constructor(
    readonly db: Database,
    readonly clock = () => Math.floor(Date.now() / 1000),
  ) {}
  initialize() {
    this.db.migrate();
    const now = this.clock();
    this.db.transaction(() => {
      initializeWorkers(this.db);
      if (this.db.get('SELECT 1 FROM company')) return;
      this.db.run(
        "INSERT INTO company(id,mode,reserve_minor,action_limit_minor,daily_limit_minor,created_at) VALUES (1,'simulation',40000,2500,4000,?)",
        now,
      );
      for (const row of [
        ['models_tools_hosting', 'Models, tools & hosting', 15000],
        ['brand_store_listings', 'Brand & storefront', 10000],
        ['creation_quality', 'Products & quality', 10000],
        ['customer_acquisition', 'Customer acquisition', 15000],
        ['opportunity_tests', 'Opportunity discovery', 10000],
      ] as const)
        this.db.run('INSERT INTO envelopes VALUES (?,?,?)', ...row);
      for (const row of [
        [
          'cleaning-kit',
          'Cleaning business social kit',
          'Independent cleaning businesses',
          2400,
          450,
          'sage',
        ],
        ['service-menu', 'Editable service menu', 'Local service businesses', 1900, 350, 'sand'],
        [
          'custom-kit',
          'Customized brand starter',
          'Small businesses needing customization',
          7900,
          2000,
          'lavender',
        ],
      ] as const)
        this.db.run('INSERT INTO products VALUES (?,?,?,?,?,?)', ...row);
      post(
        this.db,
        'opening',
        'Virtual opening capital',
        [
          { account: 'cash', amount_minor: 100000 },
          { account: 'equity', amount_minor: -100000 },
        ],
        now,
      );
      event(
        this.db,
        'system',
        'Treasury',
        'Company initialized',
        '$1,000 virtual capital. $400 protected reserve. Real-world execution disabled.',
        now,
      );
    });
    this.db.checkIntegrity();
  }
  state(): State {
    const now = this.clock(),
      db = this.db;
    return db.snapshot(() => {
      const balance = balances(db, now);
      return {
        company: {
          ...balance,
          order_count: scalar(db, 'SELECT COUNT(*) FROM orders'),
          refund_count: scalar(db, "SELECT COUNT(*) FROM orders WHERE status='refunded'"),
          policy_healthy:
            balance.cash_minor >=
            balance.reserve_minor + balance.reserved_minor + balance.refund_buffer_minor,
        },
        envelopes: envelopes(db),
        roles: AGENT_ROLES,
        products: db.all(
          "SELECT p.*,COUNT(o.id) AS orders,COALESCE(SUM(CASE WHEN o.status='delivered' THEN o.gross_minor ELSE 0 END),0)-COALESCE(SUM(o.cost_minor),0) AS contribution_minor FROM products p LEFT JOIN orders o ON o.product_id=p.id GROUP BY p.id ORDER BY p.rowid",
        ),
        orders: db.all(
          'SELECT o.*,p.title FROM orders o JOIN products p ON p.id=o.product_id ORDER BY o.created_at DESC,o.rowid DESC LIMIT 100',
        ),
        actions: db.all('SELECT * FROM actions ORDER BY created_at DESC,rowid DESC LIMIT 100'),
        events: db.all('SELECT * FROM events ORDER BY id DESC LIMIT 100'),
        messages: messagesSnapshot(db),
        ledger: db
          .all<Transaction>(
            'SELECT * FROM transactions ORDER BY created_at DESC,rowid DESC LIMIT 100',
          )
          .map((t) => ({
            ...t,
            lines: db.all(
              'SELECT account,amount_minor FROM journal_lines WHERE transaction_id=? ORDER BY id',
              t.id,
            ),
          })),
        server_time: now,
        capabilities: {
          real_world_execution: false,
          llm_agents: false,
          simulator: 'scripted',
          profit_target_minor: 1000000,
        },
      };
    });
  }
  inspector() {
    return this.db.snapshot(() => inspectorSnapshot(this.db));
  }
  schedulerFailed() {
    this.db.transaction(() => {
      this.db.exec('UPDATE company SET paused=1,auto_enabled=0 WHERE id=1');
      event(
        this.db,
        'blocked',
        'System',
        'Scheduler stopped after an error',
        'Company paused. Inspect server logs before resuming.',
        this.clock(),
      );
    });
  }
  command(key: string, kind: CommandKind, input: unknown): CommandResult {
    if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(key))
      throw new DomainError(
        'Provide an idempotency key of 8–128 ASCII identifier characters.',
        422,
      );
    const parsed = commandSchemas[kind].safeParse(input);
    if (!parsed.success) throw new DomainError('Check the entered values and try again.', 422);
    const payload = parsed.data,
      now = this.clock();
    const legacyJson = (value: Json) =>
      canonical(value).replace(
        /[\u007f-\uffff]/g,
        (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
      );
    const fingerprint = createHash('sha256')
      .update(legacyJson([kind, payload]))
      .digest('hex');
    const rawFingerprint = createHash('sha256')
      .update(legacyJson([kind, input as Json]))
      .digest('hex');
    const result = this.db.transaction(() => {
      const prior = this.db.get<{ fingerprint: string; result_json: string }>(
        'SELECT * FROM commands WHERE idempotency_key=?',
        key,
      );
      if (prior) {
        if (prior.fingerprint !== fingerprint && prior.fingerprint !== rawFingerprint)
          throw new DomainError('That idempotency key belongs to a different command.');
        return JSON.parse(prior.result_json) as
          CommandResult | { _error: { message: string; status: number } };
      }
      this.db.exec('SAVEPOINT action');
      let outcome: CommandResult | { _error: { message: string; status: number } };
      try {
        outcome = this.dispatch(kind, payload, now);
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        this.db.exec('ROLLBACK TO action');
        if (kind === 'cycle')
          recordBlocked(this.db, (payload as CommandPayload<'cycle'>).product_id, error, now);
        outcome = { _error: { message: error.message, status: error.status } };
        event(this.db, 'blocked', 'Treasury', 'Action blocked by policy', error.message, now);
      }
      this.db.exec('RELEASE action');
      this.db.run(
        'INSERT INTO commands VALUES (?,?,?,?)',
        key,
        fingerprint,
        JSON.stringify(outcome),
        now,
      );
      return outcome;
    });
    if ('_error' in result) throw new DomainError(result._error.message, result._error.status);
    return result;
  }
  private dispatch(
    kind: CommandKind,
    payload: CommandPayload<CommandKind>,
    now: number,
  ): CommandResult {
    switch (kind) {
      case 'message': {
        const message = payload as CommandPayload<'message'>;
        postMessage(this.db, message.channel, 'owner', message.body, now);
        return { message: 'Message posted to the team.' };
      }
      case 'cycle':
        return this.cycle(payload as CommandPayload<'cycle'>, now);
      case 'pause':
        return this.pause(payload as CommandPayload<'pause'>, now);
      case 'automation':
        return this.automation(payload as CommandPayload<'automation'>, now);
      case 'reserve':
        return this.reserve(payload as CommandPayload<'reserve'>, now);
      case 'execute':
        return this.execute(payload as CommandPayload<'execute'>, now);
      case 'cancel':
        return this.cancel(payload as CommandPayload<'cancel'>, now);
      case 'refund':
        return this.refund(payload as CommandPayload<'refund'>, now);
      case 'policy':
        return this.policy(payload as CommandPayload<'policy'>, now);
      case 'allocations':
        return this.allocations(payload as CommandPayload<'allocations'>, now);
      case 'worker':
        return this.worker(payload as CommandPayload<'worker'>, now);
    }
  }
  cycle(payload: CommandPayload<'cycle'>, now: number): CommandResult {
    const db = this.db,
      product = db.get<Product>('SELECT * FROM products WHERE id=?', payload.product_id);
    if (!product) throw new DomainError('Unknown product.', 422);
    const trace = new RunTrace(db, product.id, now);
    trace.stage('select_product', { product_id: product.id }, () => product);
    const cost = product.delivery_cost_minor;
    trace.stage('authorize_budget', { cost_minor: cost, envelope_id: 'creation_quality' }, () =>
      authorize(db, cost, 'creation_quality', now),
    );
    const spec = trace.stage('prepare_delivery', { product_id: product.id }, () =>
      prepareDelivery(product),
    );
    trace.stage('check_delivery', spec, () => checkDelivery(spec));
    const orderId = randomUUID();
    trace.stage('settle_order', { product_id: product.id }, () => {
      db.run(
        "INSERT INTO orders VALUES (?,?,?,?,'delivered',?,?)",
        orderId,
        product.id,
        product.price_minor,
        cost,
        now + 30 * 86400,
        now,
      );
      trace.stage(
        'post_ledger',
        { order_id: orderId, revenue_minor: product.price_minor, cost_minor: cost },
        () => ({
          sale_transaction_id: post(
            db,
            'sale',
            `Simulated sale: ${product.title}`,
            [
              { account: 'cash', amount_minor: product.price_minor },
              { account: 'revenue', amount_minor: -product.price_minor },
            ],
            now,
            orderId,
          ),
          expense_transaction_id: post(
            db,
            'expense',
            'Simulated production, delivery and channel costs',
            [
              { account: 'expense', amount_minor: cost },
              { account: 'cash', amount_minor: -cost },
            ],
            now,
            orderId,
            'creation_quality',
          ),
        }),
      );
      return { order_id: orderId, status: 'delivered', simulation_only: true };
    });
    trace.finish(orderId);
    for (const [actor, title, detail] of [
      [
        'Scout',
        'Product hypothesis selected',
        `${product.title}. This is a scripted scenario, not observed demand.`,
      ],
      [
        'Studio',
        'Simulated deliverable prepared',
        'Production and delivery costs are accounted for in this scenario.',
      ],
      [
        'Review',
        'Simulated quality stage completed',
        'This does not certify a real product or generate a sellable asset.',
      ],
      [
        'Operator',
        'Simulated order delivered',
        'Virtual payment settled. Sale proceeds remain reserved for possible refunds.',
      ],
    ])
      event(db, 'cycle', actor, title, detail, now, orderId);
    return {
      message: 'Simulated sale delivered and reconciled.',
      order_id: orderId,
      run_id: trace.id,
    };
  }
  private pause(payload: CommandPayload<'pause'>, now: number) {
    const p = Number(payload.paused);
    this.db.run(
      'UPDATE company SET paused=?,auto_enabled=CASE WHEN ? THEN 0 ELSE auto_enabled END,policy_version=policy_version+1 WHERE id=1',
      p,
      p,
    );
    event(
      this.db,
      'control',
      'You',
      p ? 'Company paused' : 'Company resumed',
      p
        ? 'New spending blocked. Refunds and cancellations remain available.'
        : 'Spending permitted within financial limits. Auto-run remains off unless started.',
      now,
    );
    return { message: p ? 'Company paused.' : 'Company resumed.' };
  }
  private automation(payload: CommandPayload<'automation'>, now: number) {
    if (payload.enabled && balances(this.db, now).paused)
      throw new DomainError('Resume the company before starting auto-run.');
    this.db.run(
      'UPDATE company SET auto_enabled=?,next_tick=? WHERE id=1',
      Number(payload.enabled),
      now + 15,
    );
    event(
      this.db,
      'control',
      'You',
      payload.enabled ? 'Simulation auto-run started' : 'Simulation auto-run stopped',
      'One scripted cycle every 15 seconds; financial limits still apply.',
      now,
    );
    return {
      message: payload.enabled ? 'Simulation auto-run started.' : 'Simulation auto-run stopped.',
    };
  }
  tick() {
    const now = this.clock();
    this.db.transaction(() => {
      const c = this.db.get<Company>('SELECT * FROM company WHERE id=1')!;
      if (!c.auto_enabled || c.next_tick > now) return;
      this.db.exec('SAVEPOINT cycle');
      try {
        this.cycle({ product_id: 'cleaning-kit' }, now);
        this.db.run('UPDATE company SET next_tick=? WHERE id=1', now + 15);
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        this.db.exec('ROLLBACK TO cycle');
        recordBlocked(this.db, 'cleaning-kit', error, now);
        this.db.exec('UPDATE company SET auto_enabled=0 WHERE id=1');
        event(
          this.db,
          'blocked',
          'Treasury',
          'Auto-run stopped by financial policy',
          error.message,
          now,
        );
      } finally {
        this.db.exec('RELEASE cycle');
      }
    });
  }
  private reserve(p: CommandPayload<'reserve'>, now: number) {
    authorize(this.db, p.amount_minor, p.envelope_id, now);
    const id = randomUUID();
    this.db.run(
      "INSERT INTO actions VALUES (?,?,?,?,'reserved',?,NULL)",
      id,
      p.title,
      p.envelope_id,
      p.amount_minor,
      now,
    );
    event(this.db, 'reservation', 'You', 'Experiment funds reserved', p.title, now, id);
    postMessage(
      this.db,
      'finance',
      'treasury',
      `The expense proposal “${p.title}” is ready for your decision. $${(p.amount_minor / 100).toFixed(2)} is held; no expense has been recorded.`,
      now,
      'owner',
    );
    return {
      message: 'Funds reserved. Execute or cancel the experiment when ready.',
      action_id: id,
    };
  }
  private action(id: string) {
    const a = this.db.get<Action>('SELECT * FROM actions WHERE id=?', id);
    if (!a) throw new DomainError('Action not found.', 404);
    if (a.status !== 'reserved') throw new DomainError('This action is no longer pending.');
    return a;
  }
  private execute(p: CommandPayload<'execute'>, now: number) {
    const a = this.action(p.id);
    authorize(this.db, a.amount_minor, a.envelope_id, now, a.id);
    post(
      this.db,
      'expense',
      `Simulated experiment: ${a.title}`,
      [
        { account: 'expense', amount_minor: a.amount_minor },
        { account: 'cash', amount_minor: -a.amount_minor },
      ],
      now,
      a.id,
      a.envelope_id,
    );
    this.db.run("UPDATE actions SET status='completed',completed_at=? WHERE id=?", now, a.id);
    postMessage(
      this.db,
      'finance',
      'treasury',
      `Your approved expense “${a.title}” is recorded: $${(a.amount_minor / 100).toFixed(2)}. The balance has been updated.`,
      now,
      'owner',
    );
    event(
      this.db,
      'experiment',
      'Operator',
      'Simulated experiment executed',
      'Virtual expense recorded. No advertisement was published and no demand results were invented.',
      now,
      a.id,
    );
    return {
      message: 'Virtual expense recorded. Add real observations when live integrations exist.',
    };
  }
  private cancel(p: CommandPayload<'cancel'>, now: number) {
    const a = this.action(p.id);
    this.db.run("UPDATE actions SET status='cancelled',completed_at=? WHERE id=?", now, a.id);
    postMessage(
      this.db,
      'finance',
      'treasury',
      `You declined “${a.title}”. The $${(a.amount_minor / 100).toFixed(2)} hold was released back to available funds.`,
      now,
      'owner',
    );
    event(this.db, 'control', 'You', 'Reservation cancelled', a.title, now, a.id);
    return { message: 'Reservation released.' };
  }
  private refund(p: CommandPayload<'refund'>, now: number) {
    const o = this.db.get<Order>('SELECT * FROM orders WHERE id=?', p.id);
    if (!o) throw new DomainError('Order not found.', 404);
    if (o.status === 'refunded') throw new DomainError('This order has already been refunded.');
    if (balances(this.db, now).cash_minor < o.gross_minor)
      throw new DomainError('Insufficient settled cash to pay this refund.');
    post(
      this.db,
      'refund',
      'Full simulated customer refund; production costs retained',
      [
        { account: 'revenue', amount_minor: o.gross_minor },
        { account: 'cash', amount_minor: -o.gross_minor },
      ],
      now,
      o.id,
    );
    this.db.run("UPDATE orders SET status='refunded' WHERE id=?", o.id);
    const b = balances(this.db, now);
    if (b.cash_minor < b.reserve_minor + b.reserved_minor + b.refund_buffer_minor)
      this.db.exec('UPDATE company SET paused=1,auto_enabled=0 WHERE id=1');
    event(
      this.db,
      'refund',
      'Operator',
      'Simulated refund reconciled',
      'Revenue reversed. Production and channel costs remain expenses.',
      now,
      o.id,
    );
    return { message: 'Full virtual refund recorded. Original costs remain accounted for.' };
  }
  private policy(p: CommandPayload<'policy'>, now: number) {
    this.db.run(
      'UPDATE company SET action_limit_minor=?,daily_limit_minor=?,policy_version=policy_version+1 WHERE id=1',
      p.action_limit_minor,
      p.daily_limit_minor,
    );
    event(
      this.db,
      'control',
      'You',
      'Spending limits updated',
      'All unexecuted actions will be checked against the new policy.',
      now,
    );
    return { message: 'Spending limits updated.' };
  }
  private allocations(p: CommandPayload<'allocations'>, now: number) {
    const current = envelopes(this.db),
      values = p.envelopes_minor;
    if (
      Object.keys(values).sort().join(',') !==
      current
        .map((r) => r.id)
        .sort()
        .join(',')
    )
      throw new DomainError('Provide exactly the five existing budget envelopes.', 422);
    if (
      Object.values(values).reduce((a, b) => a + b, 0) >
      100000 - balances(this.db, now).reserve_minor
    )
      throw new DomainError(
        'Allocations exceed the initial $600 operating pool. Profit reinvestment is not enabled in this version.',
      );
    for (const row of current)
      if (values[row.id] < row.spent_minor + row.reserved_minor)
        throw new DomainError(`${row.label} cannot be reduced below spending plus reservations.`);
    for (const [id, value] of Object.entries(values))
      this.db.run('UPDATE envelopes SET budget_minor=? WHERE id=?', value, id);
    event(
      this.db,
      'control',
      'You',
      'Operating allocations updated',
      'Protected reserve retained. Existing commitments remain covered.',
      now,
    );
    return { message: 'Allocations updated.' };
  }
  private worker(p: CommandPayload<'worker'>, now: number) {
    const w = WORKER_BY_ID.get(p.id as WorkerId);
    if (!w || w.kind !== 'agent')
      throw new DomainError(
        'Only agent workers can be enabled or disabled. Treasury remains mandatory.',
        422,
      );
    this.db.run('UPDATE workers SET enabled=? WHERE id=?', Number(p.enabled), w.id);
    const message = `${w.name} ${p.enabled ? 'enabled' : 'disabled'}`;
    event(
      this.db,
      'control',
      'You',
      message,
      "Dependent work will check this worker's status before execution.",
      now,
    );
    return { message: message + '.' };
  }
}
