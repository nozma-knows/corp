import { randomBytes } from 'node:crypto';
import { stdin, stdout } from 'node:process';
import { parseArgs } from 'node:util';
import { createApp } from './api.js';
import { loadSettings } from './settings.js';
import { hashPassword } from './auth.js';
import { Database } from './database.js';
import { existsSync } from 'node:fs';

async function hiddenPassword(prompt: string): Promise<string> {
  if (!stdin.isTTY)
    throw new Error(
      'Password hashing requires an interactive terminal; plaintext is never accepted in arguments or environment',
    );
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let text = '';
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', receive);
      stdout.write('\n');
    };
    const receive = (data: Buffer) => {
      for (const character of data.toString('utf8')) {
        if (character === '\u0003') {
          finish();
          reject(new Error('Cancelled'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          resolve(text);
          return;
        }
        if (character === '\u007f' || character === '\b') text = text.slice(0, -1);
        else if (character >= ' ') text += character;
      }
    };
    stdin.on('data', receive);
  });
}
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      host: { type: 'string' },
      port: { type: 'string' },
      database: { type: 'string' },
      output: { type: 'string' },
    },
  });
  const command = positionals[0] ?? 'serve';
  if (positionals.length > 1) throw new Error('Unexpected arguments');
  if (command === 'password-hash') {
    const password = await hiddenPassword('Operator password (at least 12 characters): '),
      confirmation = await hiddenPassword('Confirm password: ');
    if (password !== confirmation) throw new Error('Passwords do not match');
    stdout.write((await hashPassword(password)) + '\n');
    return;
  }
  if (command === 'session-secret') {
    stdout.write(randomBytes(48).toString('base64url') + '\n');
    return;
  }
  if (command === 'backup') {
    if (!values.database || !values.output)
      throw new Error('Backup requires --database and --output');
    if (!existsSync(values.database)) throw new Error('Backup source does not exist');
    const db = new Database(values.database);
    try {
      db.checkIntegrity();
      await db.backup(values.output);
      stdout.write('Verified backup created.\n');
    } finally {
      db.close();
    }
    return;
  }
  if (command !== 'serve') throw new Error('Use serve, password-hash, session-secret, or backup');
  const settings = loadSettings({
    ...process.env,
    ...(values.database ? { CORP_DB_PATH: values.database } : {}),
  });
  const host = values.host ?? (settings.environment === 'local' ? '127.0.0.1' : '0.0.0.0'),
    port = Number(values.port ?? process.env.PORT ?? 8000);
  if (settings.environment === 'local' && !['127.0.0.1', 'localhost', '::1'].includes(host))
    throw new Error(
      'Local mode binds to loopback only; configure staging authentication before exposing a server',
    );
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const { app } = await createApp({ settings, logger: true });
  const shutdown = async () => {
    try {
      await app.close();
    } catch (error) {
      app.log.error(error);
      process.exitCode = 1;
    }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  try {
    await app.listen({ host, port });
  } catch (error) {
    await app.close();
    throw error;
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Startup failed');
  process.exitCode = 1;
});
