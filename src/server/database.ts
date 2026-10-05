import { DatabaseSync, backup, type SQLInputValue } from 'node:sqlite';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  linkSync,
  unlinkSync,
  existsSync,
  chmodSync,
  openSync,
  closeSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

/** One connection per process; synchronous transactions cannot interleave with async work. */
export class Database {
  readonly connection: DatabaseSync;
  constructor(
    readonly path: string,
    readonly migrationsPath = resolve('migrations'),
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.connection = new DatabaseSync(path, { timeout: 5000 });
    chmodSync(path, 0o600);
    this.connection.exec(
      'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;',
    );
  }
  get<T>(sql: string, ...args: SQLInputValue[]): T | undefined {
    return this.connection.prepare(sql).get(...args) as T | undefined;
  }
  all<T>(sql: string, ...args: SQLInputValue[]): T[] {
    return this.connection.prepare(sql).all(...args) as T[];
  }
  run(sql: string, ...args: SQLInputValue[]) {
    return this.connection.prepare(sql).run(...args);
  }
  exec(sql: string) {
    this.connection.exec(sql);
  }
  transaction<T>(operation: () => T): T {
    this.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      if (result instanceof Promise) throw new Error('Transactions must be synchronous');
      this.exec('COMMIT');
      return result;
    } catch (error) {
      this.exec('ROLLBACK');
      throw error;
    }
  }
  snapshot<T>(operation: () => T): T {
    this.exec('BEGIN');
    try {
      return operation();
    } finally {
      this.exec('ROLLBACK');
    }
  }
  migrate() {
    this.transaction(() => {
      this.exec(
        'CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, checksum TEXT)',
      );
      if (
        !this.all<{ name: string }>('PRAGMA table_info(schema_migrations)').some(
          (c) => c.name === 'checksum',
        )
      )
        this.exec('ALTER TABLE schema_migrations ADD COLUMN checksum TEXT');
      const files = readdirSync(this.migrationsPath)
        .filter((f) => /^\d+_.*\.sql$/.test(f))
        .sort();
      const applied = new Map(
        this.all<{ version: string; checksum: string | null }>(
          'SELECT * FROM schema_migrations',
        ).map((r) => [r.version, r.checksum]),
      );
      if ([...applied.keys()].some((f) => !files.includes(f)))
        throw new Error('Database has newer migrations than this application');
      for (const file of files) {
        const source = readFileSync(join(this.migrationsPath, file), 'utf8');
        const checksum = createHash('sha256').update(source).digest('hex');
        if (applied.has(file)) {
          if (applied.get(file) && applied.get(file) !== checksum)
            throw new Error(`Applied migration changed: ${file}`);
          this.run(
            'UPDATE schema_migrations SET checksum=? WHERE version=? AND checksum IS NULL',
            checksum,
            file,
          );
        } else {
          this.exec(source);
          this.run('INSERT INTO schema_migrations VALUES (?, ?)', file, checksum);
        }
      }
    });
  }
  checkIntegrity() {
    this.snapshot(() => {
      const check = this.get<Record<string, string>>('PRAGMA quick_check(1)');
      if (!check || Object.values(check)[0] !== 'ok' || this.get('PRAGMA foreign_key_check'))
        throw new Error('Database integrity check failed');
      if (
        this.get(
          'SELECT t.id FROM transactions t LEFT JOIN journal_lines l ON l.transaction_id=t.id GROUP BY t.id HAVING COUNT(l.id)<2 OR COALESCE(SUM(l.amount_minor),0)!=0 LIMIT 1',
        )
      )
        throw new Error('Financial journal integrity check failed');
    });
  }
  async backup(destination: string) {
    mkdirSync(dirname(destination), { recursive: true });
    if (existsSync(destination)) throw new Error('Refusing to overwrite an existing backup');
    const temporary = join(dirname(destination), `.corp-backup-${randomUUID()}`);
    try {
      closeSync(openSync(temporary, 'wx', 0o600));
      await backup(this.connection, temporary);
      chmodSync(temporary, 0o600);
      const check = new DatabaseSync(temporary, { readOnly: true });
      try {
        if (Object.values(check.prepare('PRAGMA quick_check(1)').get()!)[0] !== 'ok')
          throw new Error('Backup integrity check failed');
      } finally {
        check.close();
      }
      linkSync(temporary, destination);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
  close() {
    this.connection.close();
  }
}
