import { randomBytes } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { validatePasswordHash } from './auth.js';
export interface Settings {
  environment: 'local' | 'staging' | 'production';
  databasePath: string;
  publicOrigin?: string;
  allowedHosts: string[];
  passwordHash?: string;
  sessionSecret: string;
  sessionTtlSeconds: number;
  maxBodyBytes: number;
}
export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const environment = env.CORP_ENV ?? 'local';
  if (!['local', 'staging', 'production'].includes(environment))
    throw new Error('CORP_ENV must be local, staging, or production');
  const origin =
    env.CORP_PUBLIC_ORIGIN ??
    (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : undefined) ??
    (env.RENDER_EXTERNAL_HOSTNAME ? `https://${env.RENDER_EXTERNAL_HOSTNAME}` : undefined);
  let parsed: URL | undefined;
  if (origin) {
    parsed = new URL(origin);
    if (
      !['https:', 'http:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    )
      throw new Error('CORP_PUBLIC_ORIGIN must be a canonical HTTP(S) origin');
  }
  const passwordHash = env.CORP_OPERATOR_PASSWORD_HASH,
    sessionSecret = env.CORP_SESSION_SECRET ?? randomBytes(48).toString('base64url');
  if (passwordHash) {
    validatePasswordHash(passwordHash);
    if (!env.CORP_SESSION_SECRET || sessionSecret.length < 32)
      throw new Error('Password sessions require CORP_SESSION_SECRET of at least 32 characters');
  }
  if (
    environment !== 'local' &&
    (parsed?.protocol !== 'https:' ||
      !passwordHash ||
      !env.CORP_SESSION_SECRET ||
      sessionSecret.length < 32 ||
      !env.CORP_DB_PATH ||
      !isAbsolute(env.CORP_DB_PATH))
  )
    throw new Error(
      'Hosted mode requires an HTTPS origin, password hash, session secret, and absolute persistent database path',
    );
  const hosts = (env.CORP_ALLOWED_HOSTS ?? 'localhost,127.0.0.1,[::1]')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  if (hosts.some((h) => h.includes('*') || h.includes('/') || h.includes('@')))
    throw new Error('CORP_ALLOWED_HOSTS must contain exact hostnames');
  if (parsed) hosts.push(parsed.hostname);
  return {
    environment: environment as Settings['environment'],
    databasePath: env.CORP_DB_PATH ?? 'data/company.sqlite3',
    publicOrigin: parsed?.origin,
    allowedHosts: [...new Set(hosts)],
    passwordHash,
    sessionSecret,
    sessionTtlSeconds: 8 * 3600,
    maxBodyBytes: 65536,
  };
}
export const authRequired = (settings: Settings) =>
  settings.environment !== 'local' || !!settings.passwordHash;
