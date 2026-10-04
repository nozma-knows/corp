import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Database } from './database.js';
import { WORKERS, FUNCTIONS, FUNCTION_BY_ID, WORKER_BY_ID } from './registry.js';
import { DomainError } from './errors.js';
import type {
  FunctionDefinition,
  Inspector,
  Json,
  Run,
  Span,
  WorkerId,
} from '../shared/contracts.js';
interface RecordSpan {
  id: string;
  parent: string | null;
  fn: FunctionDefinition;
  inputs: Json;
  output: Json;
  duration: number;
  status: 'completed' | 'blocked';
}
export function initializeWorkers(db: Database) {
  for (const w of WORKERS) db.run('INSERT OR IGNORE INTO workers(id) VALUES (?)', w.id);
}
export class RunTrace {
  readonly id = randomUUID();
  private stack: string[] = [];
  records: RecordSpan[] = [];
  constructor(
    readonly db: Database,
    readonly productId: string,
    readonly now: number,
    blocked = false,
  ) {
    db.run(
      "INSERT INTO workflow_runs VALUES (?, 'digital_sale', ?, NULL, ?, 'scripted', ?)",
      this.id,
      blocked ? 'blocked' : 'completed',
      productId,
      now,
    );
  }
  stage<T>(functionId: string, inputs: Json, operation: () => T): T {
    const fn = FUNCTION_BY_ID.get(functionId)!;
    const worker = WORKER_BY_ID.get(fn.worker_id)!;
    const record: RecordSpan = {
      id: randomUUID(),
      parent: this.stack.at(-1) ?? null,
      fn,
      inputs,
      output: {},
      duration: 0,
      status: 'completed',
    };
    this.records.push(record);
    this.stack.push(record.id);
    const start = performance.now();
    try {
      if (
        !this.db.get<{ enabled: number }>('SELECT enabled FROM workers WHERE id=?', worker.id)
          ?.enabled
      )
        throw new DomainError(
          `${worker.name} is disabled. Enable this worker before running dependent work.`,
          409,
          worker.id,
          functionId,
        );
      const result = operation();
      record.output =
        result === undefined
          ? { result: 'completed' }
          : (JSON.parse(JSON.stringify(result)) as Json);
      return result;
    } catch (error) {
      if (error instanceof DomainError) {
        error.workerId ??= worker.id;
        error.functionId ??= functionId;
        error.trace = this;
        record.status = 'blocked';
        record.output = { reason: error.message };
      }
      throw error;
    } finally {
      record.duration = performance.now() - start;
      this.stack.pop();
    }
  }
  finish(orderId: string) {
    this.db.run('UPDATE workflow_runs SET order_id=? WHERE id=?', orderId, this.id);
    this.flush();
  }
  flush() {
    for (const r of this.records) {
      const worker = WORKER_BY_ID.get(r.fn.worker_id)!;
      this.db.run(
        "INSERT INTO execution_spans VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', 'local-process', NULL, ?, ?, ?, ?, NULL, NULL, 0, ?)",
        r.id,
        this.id,
        r.parent,
        worker.id,
        worker.name,
        worker.position,
        r.fn.id,
        r.fn.title,
        r.fn.engine,
        r.status,
        JSON.stringify(r.inputs),
        JSON.stringify(r.output),
        r.duration,
        this.now,
      );
    }
  }
}
export function recordBlocked(db: Database, productId: string, error: DomainError, now: number) {
  if (!db.get('SELECT 1 FROM products WHERE id=?', productId)) return;
  const trace = new RunTrace(db, productId, now, true);
  trace.records = error.trace?.records ?? [
    {
      id: randomUUID(),
      parent: null,
      fn: FUNCTION_BY_ID.get(error.functionId ?? 'authorize_budget')!,
      inputs: { product_id: productId },
      output: { reason: error.message },
      duration: 0,
      status: 'blocked',
    },
  ];
  trace.flush();
}
export function inspectorSnapshot(db: Database, limit = 20): Inspector {
  const settings = new Map(
    db
      .all<{ id: WorkerId; enabled: number }>('SELECT * FROM workers')
      .map((r) => [r.id, !!r.enabled]),
  );
  const counts = new Map(
    db
      .all<{ worker_id: WorkerId; executions: number; duration_ms: number }>(
        "SELECT worker_id,COUNT(*) AS executions,COALESCE(SUM(duration_ms),0) AS duration_ms FROM execution_spans WHERE status='completed' GROUP BY worker_id",
      )
      .map((r) => [r.worker_id, r]),
  );
  const runs = db
    .all<Omit<Run, 'spans'>>(
      'SELECT r.*,p.title AS product_title FROM workflow_runs r JOIN products p ON p.id=r.product_id ORDER BY r.created_at DESC,r.rowid DESC LIMIT ?',
      limit,
    )
    .map((r) => ({
      ...r,
      spans: db
        .all<Omit<Span, 'inputs' | 'outputs'> & { input_json: string; output_json: string }>(
          'SELECT * FROM execution_spans WHERE run_id=? ORDER BY rowid',
          r.id,
        )
        .map((s) => {
          const { input_json, output_json, ...rest } = s;
          return {
            ...rest,
            inputs: JSON.parse(input_json) as Json,
            outputs: JSON.parse(output_json) as Json,
          };
        }),
    }));
  const totals = db.get<{ executions: number; duration_ms: number }>(
    'SELECT COUNT(*) AS executions,COALESCE(SUM(duration_ms),0) AS duration_ms FROM execution_spans',
  )!;
  return {
    registry_version: 1,
    workers: WORKERS.map((w) => ({
      ...w,
      enabled: settings.get(w.id) ?? false,
      execution_count: counts.get(w.id)?.executions ?? 0,
      duration_ms: counts.get(w.id)?.duration_ms ?? 0,
      function_ids: FUNCTIONS.filter((f) => f.worker_id === w.id).map((f) => f.id),
    })),
    functions: FUNCTIONS,
    runs,
    totals: {
      ...totals,
      model_calls: 0,
      model_cost_micro_usd: 0,
      input_tokens: 0,
      output_tokens: 0,
    },
    routing: FUNCTIONS.map((f) => ({
      function_id: f.id,
      worker_id: f.worker_id,
      engine: f.engine,
      provider: 'local',
      destination: 'local-process',
      model: null,
      external_inference_enabled: false,
    })),
  };
}
