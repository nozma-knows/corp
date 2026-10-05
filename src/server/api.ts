import Fastify, { LogController, type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import staticFiles from '@fastify/static';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { Database } from './database.js';
import { CompanyService } from './service.js';
import { OperatorAuth, COOKIE, equal } from './auth.js';
import { loadSettings, authRequired, type Settings } from './settings.js';
import { DomainError } from './errors.js';
import type { CommandKind } from './commands.js';

export async function createApp(
  options: {
    settings?: Settings;
    startWorker?: boolean;
    logger?: boolean;
    clock?: () => number;
  } = {},
) {
  const settings = options.settings ?? loadSettings(),
    db = new Database(settings.databasePath),
    service = new CompanyService(db, options.clock);
  try {
    service.initialize();
  } catch (error) {
    db.close();
    throw error;
  }
  const auth = new OperatorAuth(db, settings, options.clock),
    localToken = randomBytes(32).toString('base64url'),
    staticRoot = resolve('public');
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: settings.maxBodyBytes,
    trustProxy: false,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    requestTimeout: 30000,
    connectionTimeout: 10000,
    keepAliveTimeout: 5000,
    logController: new LogController({ disableRequestLogging: true }),
  });
  const index = readFileSync(resolve(staticRoot, 'index.html'), 'utf8'),
    loginPage = readFileSync(resolve(staticRoot, 'login.html'), 'utf8');
  await app.register(cookie);
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: settings.environment === 'local' ? null : [],
      },
    },
    hsts: settings.environment === 'local' ? false : { maxAge: 31536000 },
    referrerPolicy: { policy: 'no-referrer' },
  });
  function checkOrigin(req: FastifyRequest) {
    const expected = settings.publicOrigin ?? `http://${req.host}`;
    if (req.headers.origin && req.headers.origin !== expected)
      throw new DomainError('Origin does not match this dashboard.', 403);
  }
  function authorized(req: FastifyRequest) {
    if (authRequired(settings) && !auth.session(req.cookies[COOKIE]))
      throw new DomainError('Sign in to access the company.', 401);
    const expected = authRequired(settings) ? auth.csrf(req.cookies[COOKIE]) : localToken;
    if (!equal(String(req.headers['x-operator-token'] ?? ''), expected))
      throw new DomainError('Operator authorization required. Reload the dashboard.', 403);
    checkOrigin(req);
  }
  app.addHook('onRequest', async (req, reply) => {
    reply
      .header('X-Request-ID', req.id)
      .header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const path = req.url.split('?')[0];
    if (/%2f|%5c|\\|\/\.\.?(\/|$)/i.test(path))
      throw new DomainError('Noncanonical request path.', 400);
    if (path === '/' || path.startsWith('/api') || path.startsWith('/health'))
      reply.header('Cache-Control', 'no-store');
    if (!settings.allowedHosts.includes(req.hostname)) throw new DomainError('Invalid host.', 400);
    if (path.startsWith('/api') && req.headers['sec-fetch-site'] === 'cross-site')
      throw new DomainError('Cross-site access is not permitted.', 403);
    if (
      authRequired(settings) &&
      path.startsWith('/api') &&
      !['/api/health', '/api/auth/login'].includes(path) &&
      !auth.session(req.cookies[COOKIE])
    )
      throw new DomainError('Sign in to access the company.', 401);
  });
  app.addHook('onResponse', async (req, reply) => {
    app.log.info(
      {
        request_id: req.id,
        method: req.method,
        path: req.url.split('?')[0],
        status: reply.statusCode,
        duration_ms: reply.elapsedTime,
      },
      'http',
    );
  });
  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (error instanceof DomainError)
      return reply.code(error.status).send({ detail: error.message });
    if (error.statusCode && error.statusCode < 500)
      return reply.code(error.statusCode).send({
        detail:
          error.statusCode === 413 ? 'Request body exceeds the allowed size.' : 'Invalid request.',
      });
    app.log.error({ err: error, request_id: req.id }, 'Request failed');
    const unavailable = error.code === 'ERR_SQLITE_ERROR';
    if (unavailable) reply.header('Retry-After', '1');
    return reply.code(unavailable ? 503 : 500).send({
      detail: unavailable
        ? 'Company storage is temporarily unavailable.'
        : 'Request failed. Use the request ID to inspect server logs.',
      request_id: req.id,
    });
  });
  app.get('/', async (req, reply) => {
    reply.type('text/html');
    if (authRequired(settings) && !auth.session(req.cookies[COOKIE]))
      return loginPage.replace('__LOGIN_TOKEN__', auth.csrf());
    return index
      .replace(
        '__OPERATOR_TOKEN__',
        authRequired(settings) ? auth.csrf(req.cookies[COOKIE]) : localToken,
      )
      .replace('__AUTH_MODE__', authRequired(settings) ? 'session' : 'local');
  });
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    secure: settings.publicOrigin?.startsWith('https://') ?? false,
    sameSite: 'strict' as const,
  };
  app.post('/api/auth/login', async (req, reply) => {
    checkOrigin(req);
    if (!equal(String(req.headers['x-operator-token'] ?? ''), auth.csrf()))
      throw new DomainError('Reload the sign-in page and try again.', 403);
    const parsed = z.strictObject({ password: z.string().min(1).max(1024) }).safeParse(req.body);
    if (!parsed.success) throw new DomainError('Check your password and try again.', 422);
    const token = await auth.login(parsed.data.password, req.ip);
    reply.setCookie(COOKIE, token, { ...cookieOptions, maxAge: settings.sessionTtlSeconds });
    return { message: 'Signed in.' };
  });
  app.post('/api/auth/logout', async (req, reply) => {
    authorized(req);
    if (!authRequired(settings)) throw new DomainError('Sign-in is not enabled in local mode.');
    auth.logout(req.cookies[COOKIE]!);
    reply.clearCookie(COOKIE, cookieOptions);
    return { message: 'Signed out.' };
  });
  let schedulerHealthy = true;
  function ready(_req: FastifyRequest, reply: FastifyReply) {
    if (!schedulerHealthy || !db.get('SELECT id FROM company WHERE id=1'))
      return reply.code(503).send({ status: 'unavailable' });
    return { status: 'ok', mode: 'simulation', real_world_execution: false };
  }
  app.get('/api/health', ready);
  app.get('/health/ready', ready);
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/api/state', async () => service.state());
  app.get('/api/inspector', async () => service.inspector());
  function mutate(
    path: string,
    kind: CommandKind,
    method: 'POST' | 'PUT' = 'POST',
    map = (req: FastifyRequest) => req.body,
  ) {
    app.route({
      method,
      url: path,
      preHandler: async (req) => authorized(req),
      handler: async (req) =>
        service.command(String(req.headers['idempotency-key'] ?? ''), kind, map(req)),
    });
  }
  mutate('/api/simulation/cycle', 'cycle');
  mutate('/api/messages', 'message');
  mutate('/api/pause', 'pause');
  mutate('/api/automation', 'automation');
  mutate('/api/experiments', 'reserve');
  mutate('/api/policy', 'policy', 'PUT');
  mutate('/api/allocations', 'allocations', 'PUT');
  const empty = z.strictObject({});
  function onlyId(req: FastifyRequest) {
    if (!empty.safeParse(req.body ?? {}).success)
      throw new DomainError('Unexpected command fields.', 422);
    return { id: (req.params as { id: string }).id };
  }
  mutate('/api/actions/:id/execute', 'execute', 'POST', onlyId);
  mutate('/api/actions/:id/cancel', 'cancel', 'POST', onlyId);
  mutate('/api/orders/:id/refund', 'refund', 'POST', onlyId);
  mutate('/api/workers/:id', 'worker', 'POST', (req) => {
    const body = z.strictObject({ enabled: z.boolean() }).safeParse(req.body);
    if (!body.success) throw new DomainError('Check the worker settings.', 422);
    return { id: (req.params as { id: string }).id, ...body.data };
  });
  app.get('/api/ledger/export.csv', async (_req, reply) => {
    type ExportRow = {
      id: string;
      created_at: number;
      kind: string;
      description: string;
      reference: string | null;
      envelope_id: string | null;
      account: string;
      amount_minor: number;
      sequence: number;
    };
    const upper = db.get<{ id: number }>('SELECT MAX(id) AS id FROM journal_lines')!.id ?? 0;
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const protect = (v: string) => (/^[\s]*[=+\-@]|^[\t\r\n]/.test(v) ? "'" + v : v);
    async function* rows() {
      yield 'mode,transaction_id,created_at,kind,description,reference,envelope,account,amount_minor,currency\r\n';
      let after = 0;
      while (after < upper) {
        const page = db.all<ExportRow>(
          'SELECT t.*,l.account,l.amount_minor,l.id AS sequence FROM transactions t JOIN journal_lines l ON l.transaction_id=t.id WHERE l.id>? AND l.id<=? ORDER BY l.id LIMIT 250',
          after,
          upper,
        );
        if (!page.length) break;
        for (const r of page)
          yield [
            'simulation',
            r.id,
            r.created_at,
            r.kind,
            protect(r.description),
            r.reference,
            r.envelope_id,
            r.account,
            r.amount_minor,
            'USD',
          ]
            .map(cell)
            .join(',') + '\r\n';
        after = page.at(-1)!.sequence;
      }
    }
    return reply
      .type('text/csv')
      .header('Content-Disposition', 'attachment; filename="corp-simulation-ledger.csv"')
      .send(Readable.from(rows()));
  });
  await app.register(staticFiles, {
    root: staticRoot,
    prefix: '/static/',
    index: false,
    serveDotFiles: false,
  });
  const timer =
    options.startWorker === false
      ? undefined
      : setInterval(() => {
          try {
            service.tick();
          } catch (error) {
            schedulerHealthy = false;
            if (timer) clearInterval(timer);
            app.log.error({ err: error }, 'Simulation scheduler stopped');
            try {
              service.schedulerFailed();
            } catch (failure) {
              app.log.error({ err: failure }, 'Unable to persist scheduler stop');
            }
          }
        }, 1000);
  timer?.unref();
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
    db.close();
  });
  return { app, service, db, auth, settings, localToken };
}
