import {
  createHash,
  createHmac,
  randomBytes,
  pbkdf2 as pbkdf2Callback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import type { Database } from './database.js';
import type { Settings } from './settings.js';
import { event } from './treasury.js';
import { DomainError } from './errors.js';
const pbkdf2 = promisify(pbkdf2Callback);
const ITERATIONS = 600000;
export const COOKIE = 'corp_session';
export function validatePasswordHash(value: string) {
  const [algorithm, rounds, salt, digest, ...extra] = value.split('$');
  if (
    extra.length ||
    algorithm !== 'pbkdf2_sha256' ||
    !/^\d+$/.test(rounds ?? '') ||
    Number(rounds) < ITERATIONS ||
    Number(rounds) > 2000000 ||
    !/^([a-f0-9]{2}){16,64}$/.test(salt ?? '') ||
    !/^[a-f0-9]{64}$/.test(digest ?? '')
  )
    throw new Error('Invalid operator password hash; use npm run password-hash');
}
export async function hashPassword(password: string) {
  if (password.length < 12 || password.length > 1024)
    throw new Error('Use an operator password of 12–1024 characters');
  const salt = randomBytes(16);
  const digest = await pbkdf2(password, salt, ITERATIONS, 32, 'sha256');
  return `pbkdf2_sha256$${ITERATIONS}$${salt.toString('hex')}$${digest.toString('hex')}`;
}
export function equal(left: string, right: string) {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export class OperatorAuth {
  readonly credentialVersion: string;
  private inFlight = 0;
  constructor(
    readonly db: Database,
    readonly settings: Settings,
    readonly clock = () => Math.floor(Date.now() / 1000),
  ) {
    // Rotating either the owner credential or session secret revokes all prior sessions.
    this.credentialVersion = createHash('sha256')
      .update(`${settings.passwordHash ?? 'local'}:${settings.sessionSecret}`)
      .digest('hex');
  }
  csrf(token = 'login') {
    return createHmac('sha256', this.settings.sessionSecret).update(token).digest('hex');
  }
  session(token: string | undefined) {
    if (!token || token.length > 128) return false;
    return !!this.db.get(
      'SELECT 1 FROM operator_sessions WHERE token_hash=? AND credential_version=? AND expires_at>?',
      createHash('sha256').update(token).digest('hex'),
      this.credentialVersion,
      this.clock(),
    );
  }
  private throttle(subject: string, now: number) {
    const row = this.db.get<{ failures: number; window_started: number }>(
      'SELECT * FROM login_attempts WHERE subject_hash=?',
      subject,
    );
    if (row && row.window_started >= now - 900 && row.failures >= 5)
      throw new DomainError('Too many sign-in attempts. Try again in 15 minutes.', 429);
  }
  async login(password: string, peer: string) {
    if (!this.settings.passwordHash) throw new DomainError('Sign-in is not enabled in local mode.');
    const subject = createHmac('sha256', this.settings.sessionSecret).update(peer).digest('hex');
    this.throttle(subject, this.clock());
    if (this.inFlight >= 2) throw new DomainError('Sign-in is busy. Try again shortly.', 429);
    this.inFlight++;
    let valid: boolean;
    try {
      const [, rounds, salt, expected] = this.settings.passwordHash.split('$');
      const actual = await pbkdf2(password, Buffer.from(salt, 'hex'), Number(rounds), 32, 'sha256');
      valid = timingSafeEqual(actual, Buffer.from(expected, 'hex'));
    } finally {
      this.inFlight--;
    }
    const now = this.clock();
    const token = this.db.transaction(() => {
      this.throttle(subject, now);
      this.db.run('DELETE FROM login_attempts WHERE window_started<?', now - 900);
      if (!valid) {
        this.db.run(
          'INSERT INTO login_attempts VALUES (?,?,1) ON CONFLICT(subject_hash) DO UPDATE SET failures=failures+1',
          subject,
          now,
        );
        event(
          this.db,
          'security',
          'Authentication',
          'Sign-in rejected',
          'Invalid credentials. No password or client address stored in the audit trail.',
          now,
        );
        return null;
      }
      this.db.run('DELETE FROM login_attempts WHERE subject_hash=?', subject);
      this.db.run(
        'DELETE FROM operator_sessions WHERE expires_at<=? OR credential_version!=?',
        now,
        this.credentialVersion,
      );
      this.db.exec(
        'DELETE FROM operator_sessions WHERE token_hash IN (SELECT token_hash FROM operator_sessions ORDER BY created_at DESC,rowid DESC LIMIT -1 OFFSET 9)',
      );
      const token = randomBytes(48).toString('base64url');
      this.db.run(
        'INSERT INTO operator_sessions VALUES (?,?,?,?)',
        createHash('sha256').update(token).digest('hex'),
        this.credentialVersion,
        now + this.settings.sessionTtlSeconds,
        now,
      );
      event(
        this.db,
        'security',
        'You',
        'Operator signed in',
        'Authenticated owner session created.',
        now,
      );
      return token;
    });
    if (!token) throw new DomainError('Invalid credentials.', 401);
    return token;
  }
  logout(token: string) {
    this.db.transaction(() => {
      this.db.run(
        'DELETE FROM operator_sessions WHERE token_hash=?',
        createHash('sha256').update(token).digest('hex'),
      );
      event(
        this.db,
        'security',
        'You',
        'Operator signed out',
        'Owner session revoked.',
        this.clock(),
      );
    });
  }
}
