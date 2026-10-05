import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Database } from '../src/server/database.js';
import { CompanyService } from '../src/server/service.js';
import type { CommandKind } from '../src/server/commands.js';
export function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'corp-test-'));
  const db = new Database(join(directory, 'company.sqlite3'));
  let now = 1800000000;
  const service = new CompanyService(db, () => now);
  service.initialize();
  const command = (kind: CommandKind, payload: unknown = {}, key: string = randomUUID()) =>
    service.command(key, kind, payload);
  const reserve = (amount = 1200, key?: string) =>
    command(
      'reserve',
      { title: 'Test a listing', amount_minor: amount, envelope_id: 'customer_acquisition' },
      key,
    );
  return {
    directory,
    db,
    service,
    command,
    reserve,
    clock: () => now,
    advance: (seconds: number) => {
      now += seconds;
    },
    cleanup: () => {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
