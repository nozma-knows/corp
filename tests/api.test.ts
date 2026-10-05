import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/server/api.js';
import { hashPassword, OperatorAuth } from '../src/server/auth.js';
import { loadSettings } from '../src/server/settings.js';
import { post } from '../src/server/treasury.js';
const password = 'test-owner-password-2026';
const passwordHash = await hashPassword(password);
async function scenario(
  name: string,
  hosted: boolean,
  run: (f: Awaited<ReturnType<typeof createApp>>, headers: Record<string, string>) => Promise<void>,
) {
  test(name, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'corp-api-'));
    const settings = loadSettings({
      CORP_ENV: hosted ? 'staging' : 'local',
      CORP_DB_PATH: join(dir, 'api.sqlite3'),
      ...(hosted
        ? {
            CORP_PUBLIC_ORIGIN: 'https://company.example',
            CORP_OPERATOR_PASSWORD_HASH: passwordHash,
            CORP_SESSION_SECRET: randomBytes(48).toString('base64url'),
          }
        : {}),
    });
    const f = await createApp({ settings, startWorker: false });
    const headers = {
      host: hosted ? 'company.example' : 'localhost',
      'X-Operator-Token': f.localToken,
      'Idempotency-Key': randomUUID(),
    };
    try {
      await run(f, headers);
    } finally {
      await f.app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
await scenario(
  'local mutation requires CSRF and an idempotency key',
  false,
  async ({ app }, headers) => {
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/simulation/cycle', payload: {} })).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/simulation/cycle',
          payload: {},
          headers: { 'X-Operator-Token': headers['X-Operator-Token'] },
        })
      ).statusCode,
      422,
    );
  },
);
await scenario(
  'foreign origin, cross-site requests and untrusted hosts are rejected',
  false,
  async ({ app }, headers) => {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/simulation/cycle',
          payload: {},
          headers: { ...headers, Origin: 'https://evil.example' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ url: '/api/state', headers: { host: 'evil.example' } })).statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ url: '/api/state', headers: { 'sec-fetch-site': 'cross-site' } }))
        .statusCode,
      403,
    );
  },
);
await scenario(
  'invalid money, booleans and unknown fields fail validation',
  false,
  async ({ app, service }, headers) => {
    for (const amount of [-100, 1.2, true])
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: '/api/experiments',
            headers,
            payload: { title: 'Experiment', envelope_id: 'creation_quality', amount_minor: amount },
          })
        ).statusCode,
        422,
      );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/simulation/cycle',
          headers,
          payload: { mode: 'live' },
        })
      ).statusCode,
      422,
    );
    assert.equal(service.state().company.cash_minor, 100000);
  },
);
await scenario(
  'HTTP retries are idempotent and CSV retains safe monetary values',
  false,
  async ({ app, service }, headers) => {
    for (let i = 0; i < 2; i++)
      assert.equal(
        (await app.inject({ method: 'POST', url: '/api/simulation/cycle', headers, payload: {} }))
          .statusCode,
        200,
      );
    assert.equal(service.state().company.order_count, 1);
    assert.equal(service.state().company.profit_minor, 1950);
    const csv = await app.inject('/api/ledger/export.csv');
    assert.match(csv.body, /simulation/);
    assert.match(csv.body, /amount_minor/);
    assert.equal(csv.headers['content-type'], 'text/csv');
  },
);
await scenario(
  'root supplies local CSRF and security headers without caching',
  false,
  async ({ app, localToken }) => {
    const page = await app.inject('/');
    assert.match(page.body, new RegExp(localToken));
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.match(String(page.headers['content-security-policy']), /frame-ancestors 'none'/);
    assert.ok(page.headers['x-request-id']);
  },
);
await scenario(
  'hosted data and export require a session; health and sign-in remain accessible',
  true,
  async ({ app }, headers) => {
    for (const url of ['/api/state', '/api/inspector', '/api/ledger/export.csv'])
      assert.equal((await app.inject({ url, headers })).statusCode, 401);
    assert.equal((await app.inject({ url: '/health/ready', headers })).statusCode, 200);
    const page = await app.inject({ url: '/', headers });
    assert.match(page.body, /login-form/);
    assert.doesNotMatch(page.body, /operator-token/);
    assert.ok(page.headers['strict-transport-security']);
  },
);
await scenario(
  'hosted login, session CSRF, foreign origin and logout behave correctly',
  true,
  async ({ app, auth }, headers) => {
    const loginHeaders = {
      host: headers.host,
      'X-Operator-Token': auth.csrf(),
      Origin: 'https://company.example',
    };
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: loginHeaders,
          payload: { password: 'wrong-password' },
        })
      ).statusCode,
      401,
    );
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: loginHeaders,
      payload: { password },
    });
    assert.equal(login.statusCode, 200);
    const setCookie = String(login.headers['set-cookie']);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0],
      token = cookie.slice(cookie.indexOf('=') + 1),
      sessionHeaders = {
        host: headers.host,
        cookie,
        'X-Operator-Token': auth.csrf(token),
        'Idempotency-Key': randomUUID(),
      };
    assert.equal(
      (await app.inject({ url: '/api/state', headers: sessionHeaders })).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/simulation/cycle',
          headers: { ...sessionHeaders, 'X-Operator-Token': auth.csrf() },
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/simulation/cycle',
          headers: { ...sessionHeaders, Origin: 'https://evil.example' },
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/simulation/cycle',
          headers: sessionHeaders,
          payload: {},
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/logout',
          headers: sessionHeaders,
          payload: {},
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: '/api/state', headers: sessionHeaders })).statusCode,
      401,
    );
  },
);
await scenario(
  'sessions expire and rotation of either credential revokes prior tokens',
  true,
  async ({ db, settings }) => {
    let now = 1800000000;
    const auth = new OperatorAuth(db, settings, () => now),
      token = await auth.login(password, 'client');
    assert.ok(auth.session(token));
    assert.equal(
      new OperatorAuth(
        db,
        { ...settings, sessionSecret: randomBytes(48).toString('base64url') },
        () => now,
      ).session(token),
      false,
    );
    assert.equal(
      new OperatorAuth(
        db,
        { ...settings, passwordHash: await hashPassword('different-owner-password') },
        () => now,
      ).session(token),
      false,
    );
    now += settings.sessionTtlSeconds;
    assert.equal(auth.session(token), false);
    const stored = db.get<{ token_hash: string }>('SELECT token_hash FROM operator_sessions')!;
    assert.notEqual(stored.token_hash, token);
  },
);
await scenario(
  'throttling persists across auth instances and has a bounded window',
  true,
  async ({ db, settings }) => {
    let now = 1800000000;
    const auth = new OperatorAuth(db, settings, () => now);
    for (let i = 0; i < 5; i++)
      await assert.rejects(auth.login('incorrect-password', 'same-client'), /Invalid credentials/);
    const restarted = new OperatorAuth(db, settings, () => now);
    await assert.rejects(restarted.login(password, 'same-client'), /Too many sign-in attempts/);
    now += 901;
    const token = await restarted.login(password, 'same-client');
    assert.ok(restarted.session(token));
    assert.doesNotMatch(
      JSON.stringify(db.all('SELECT * FROM events')),
      /incorrect-password|same-client/,
    );
  },
);
await scenario(
  'request bodies are capped and internal errors never leak details',
  false,
  async ({ app, service }, headers) => {
    const oversize = await app.inject({
      method: 'POST',
      url: '/api/experiments',
      headers,
      payload: { title: 'x'.repeat(70000) },
    });
    assert.equal(oversize.statusCode, 413);
    service.state = () => {
      throw new Error('private database password');
    };
    const failed = await app.inject('/api/state');
    assert.equal(failed.statusCode, 500);
    assert.doesNotMatch(failed.body, /private database password/);
    assert.ok(failed.json().request_id);
  },
);
test('hosted configuration fails closed with missing or malformed settings', () => {
  for (const env of [
    { CORP_ENV: 'staging' },
    { CORP_ENV: 'production', CORP_PUBLIC_ORIGIN: 'http://company.example' },
    { CORP_ENV: 'unexpected' },
    { CORP_PUBLIC_ORIGIN: 'https://company.example/path' },
    { CORP_ALLOWED_HOSTS: '*' },
    { CORP_OPERATOR_PASSWORD_HASH: 'not-a-password-hash' },
  ])
    assert.throws(() => loadSettings(env));
});

test('Railway domain supports HTTPS sessions and provider health checks without opening the API', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'corp-railway-'));
  const env = {
    CORP_ENV: 'staging',
    RAILWAY_PUBLIC_DOMAIN: 'company.up.railway.app',
    CORP_ALLOWED_HOSTS: 'localhost,healthcheck.railway.app',
    CORP_DB_PATH: join(directory, 'company.sqlite3'),
    CORP_OPERATOR_PASSWORD_HASH: passwordHash,
    CORP_SESSION_SECRET: randomBytes(48).toString('base64url'),
  };
  const settings = loadSettings(env);
  assert.equal(settings.publicOrigin, 'https://company.up.railway.app');
  assert.equal(
    loadSettings({ ...env, CORP_PUBLIC_ORIGIN: 'https://custom.example' }).publicOrigin,
    'https://custom.example',
  );
  assert.throws(() =>
    loadSettings({ ...env, RAILWAY_PUBLIC_DOMAIN: 'company.up.railway.app/path' }),
  );
  const { app } = await createApp({ settings, startWorker: false });
  try {
    assert.equal(
      (await app.inject({ url: '/health/ready', headers: { host: 'healthcheck.railway.app' } }))
        .statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: '/api/state', headers: { host: 'healthcheck.railway.app' } }))
        .statusCode,
      401,
    );
    assert.equal(
      (await app.inject({ url: '/', headers: { host: 'company.up.railway.app' } })).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: '/health/ready', headers: { host: 'foreign.example' } })).statusCode,
      400,
    );
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('scheduler exceptions pause the company and fail readiness', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'corp-scheduler-'));
  context.mock.timers.enable({ apis: ['setInterval'] });
  const settings = loadSettings({ CORP_DB_PATH: join(directory, 'company.sqlite3') });
  const { app, service } = await createApp({ settings });
  try {
    service.tick = () => {
      throw new Error('Injected scheduler failure');
    };
    context.mock.timers.tick(1000);
    assert.equal((await app.inject('/health/ready')).statusCode, 503);
    assert.equal((await app.inject('/health/live')).statusCode, 200);
    assert.equal(service.state().company.paused, 1);
    assert.equal(service.state().company.auto_enabled, 0);
    assert.equal(service.state().events[0].title, 'Scheduler stopped after an error');
  } finally {
    await app.close();
    context.mock.timers.reset();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('export neutralizes spreadsheet formulas without changing numeric amounts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'corp-export-'));
  const settings = loadSettings({ CORP_DB_PATH: join(directory, 'company.sqlite3') });
  const { app, db } = await createApp({ settings, startWorker: false });
  try {
    db.transaction(() =>
      post(
        db,
        'expense',
        ' =SUM(1,2)',
        [
          { account: 'expense', amount_minor: 100 },
          { account: 'cash', amount_minor: -100 },
        ],
        1800000000,
        null,
        'customer_acquisition',
      ),
    );
    const exported = await app.inject('/api/ledger/export.csv');
    assert.ok(exported.body.includes('"\' =SUM(1,2)"'));
    assert.ok(exported.body.includes('"-100"'));
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
