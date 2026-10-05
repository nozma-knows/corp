import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fixture } from './helpers.js';
import { Database } from '../src/server/database.js';
import { CompanyService } from '../src/server/service.js';
test('verified online backup restores ledger, commands and execution history', async () => {
  const f = fixture();
  try {
    f.command('cycle', {}, 'persisted-backup-key');
    const destination = join(f.directory, 'backup.sqlite3');
    await f.db.backup(destination);
    const restored = new Database(destination);
    try {
      const service = new CompanyService(restored, f.clock);
      service.initialize();
      assert.equal(service.state().company.cash_minor, 101950);
      assert.equal(service.inspector().runs.length, 1);
      service.command('persisted-backup-key', 'cycle', {});
      assert.equal(service.state().company.order_count, 1);
    } finally {
      restored.close();
    }
    await assert.rejects(f.db.backup(destination), /overwrite/);
  } finally {
    f.cleanup();
  }
});
test('changed or unknown applied migrations fail before any mutation', () => {
  const f = fixture();
  try {
    const directory = join(f.directory, 'migrations');
    mkdirSync(directory);
    for (const file of readdirSync('migrations'))
      copyFileSync(join('migrations', file), join(directory, file));
    writeFileSync(
      join(directory, '001_initial.sql'),
      readFileSync(join(directory, '001_initial.sql'), 'utf8') + '\n-- illegal change\n',
    );
    const db = new Database(f.db.path, directory);
    try {
      assert.throws(() => db.migrate(), /Applied migration changed/);
    } finally {
      db.close();
    }
    f.db.transaction(() =>
      f.db.run('INSERT INTO schema_migrations VALUES (?,?)', '999_future.sql', 'future'),
    );
    assert.throws(() => f.db.migrate(), /newer migrations/);
    assert.equal(f.service.state().company.cash_minor, 100000);
  } finally {
    f.cleanup();
  }
});
test('migration failure rolls back earlier statements and metadata atomically', () => {
  const f = fixture();
  try {
    const directory = join(f.directory, 'migrations');
    mkdirSync(directory);
    for (const file of readdirSync('migrations'))
      copyFileSync(join('migrations', file), join(directory, file));
    writeFileSync(
      join(directory, '004_broken.sql'),
      'CREATE TABLE should_not_exist (id INTEGER); INVALID SQL;',
    );
    const db = new Database(f.db.path, directory);
    try {
      assert.throws(() => db.migrate());
      assert.equal(db.get("SELECT 1 FROM sqlite_master WHERE name='should_not_exist'"), undefined);
      assert.equal(
        db.get("SELECT 1 FROM schema_migrations WHERE version='004_broken.sql'"),
        undefined,
      );
    } finally {
      db.close();
    }
  } finally {
    f.cleanup();
  }
});
test('legacy migration metadata adopts checksums without inventing history', () => {
  const f = fixture();
  try {
    f.db.transaction(() => f.db.exec('UPDATE schema_migrations SET checksum=NULL'));
    f.db.migrate();
    assert.ok(
      f.db
        .all<{ checksum: string }>('SELECT checksum FROM schema_migrations')
        .every((r) => r.checksum),
    );
    assert.deepEqual(f.service.inspector().runs, []);
  } finally {
    f.cleanup();
  }
});
test('legacy Python command fingerprints still replay after the TypeScript migration', () => {
  const f = fixture();
  try {
    const original = f.command('cycle', {}, 'legacy-command-key');
    const fingerprint = createHash('sha256').update('["cycle",{}]').digest('hex');
    f.db.transaction(() =>
      f.db.run(
        'UPDATE commands SET fingerprint=? WHERE idempotency_key=?',
        fingerprint,
        'legacy-command-key',
      ),
    );
    assert.deepEqual(f.service.command('legacy-command-key', 'cycle', {}), original);
    assert.equal(f.service.state().company.order_count, 1);
  } finally {
    f.cleanup();
  }
});
