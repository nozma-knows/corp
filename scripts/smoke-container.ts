/** Real container acceptance: fail-closed config, non-root/read-only runtime, persistence and recovery. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { hashPassword } from '../src/server/auth.js';
import type { State } from '../src/shared/contracts.js';
const image = process.env.CORP_TEST_IMAGE ?? 'corp-staging',
  directory = mkdtempSync(join(tmpdir(), 'corp-container-'));
const env = { ...process.env };
for (const key of [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_TLS',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
])
  delete env[key];
const docker = (...args: string[]) =>
  execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
try {
  for (const railway of [false, true]) {
    const suffix = randomUUID(),
      name = `corp-smoke-${suffix}`,
      restore = `corp-restore-${suffix}`,
      volume = `corp-data-${suffix}`;
    const password = randomBytes(32).toString('base64url'),
      envFile = join(directory, 'runtime.env');
    writeFileSync(
      envFile,
      [
        `CORP_OPERATOR_PASSWORD_HASH=${await hashPassword(password)}`,
        `CORP_SESSION_SECRET=${randomBytes(48).toString('base64url')}`,
        ...(railway
          ? [
              'RAILWAY_PUBLIC_DOMAIN=company.example',
              'RAILWAY_VOLUME_MOUNT_PATH=/data',
              'CORP_DB_PATH=/data/company/company.sqlite3',
              'CORP_ALLOWED_HOSTS=localhost,127.0.0.1,healthcheck.railway.app',
            ]
          : ['CORP_PUBLIC_ORIGIN=https://company.example']),
      ].join('\n') + '\n',
      { mode: 0o600 },
    );
    const containers: string[] = [];
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    async function ready(container: string) {
      const binding = docker('port', container, '8000/tcp'),
        url = `http://${binding}`;
      for (let attempt = 0; attempt < 60; attempt++) {
        try {
          const response = await fetch(url + '/health/ready', {
            headers: { Host: 'company.example' },
          });
          if (response.ok) return url;
        } catch {}
        if (docker('inspect', '--format', '{{.State.Running}}', container) !== 'true')
          throw new Error('Container exited before readiness');
        await delay(150);
      }
      throw new Error('Container readiness timed out');
    }
    function start(container: string, extra: string[] = []) {
      docker(
        'run',
        '-d',
        '--name',
        container,
        '--init',
        '--read-only',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=16m',
        '--cap-drop=ALL',
        ...(railway
          ? [
              '--user=0',
              '--cap-add=CHOWN',
              '--cap-add=FOWNER',
              '--cap-add=DAC_OVERRIDE',
              '--cap-add=SETUID',
              '--cap-add=SETGID',
            ]
          : []),
        '--security-opt',
        'no-new-privileges:true',
        '--env-file',
        envFile,
        '--mount',
        `type=volume,src=${volume},dst=/data`,
        '-p',
        '127.0.0.1::8000',
        image,
        ...extra,
      );
      containers.push(container);
    }
    try {
      assert.throws(() => docker('run', '--rm', image), /Hosted mode requires/);
      docker('volume', 'create', volume);
      if (railway) {
        docker(
          'run',
          '--rm',
          '--user=0',
          '--mount',
          `type=volume,src=${volume},dst=/data`,
          image,
          'node',
          '-e',
          // A marker prevents Docker copy-up from reapplying image ownership to
          // an empty named volume on subsequent mounts. Railway doesn't copy-up.
          "const fs=require('fs');fs.writeFileSync('/data/.railway-volume','mounted',{mode:0o600});fs.chownSync('/data',0,0);fs.chmodSync('/data',0o700)",
        );
        const rootRun = [
          'run',
          '--rm',
          '--user=0',
          '--env-file',
          envFile,
          '--mount',
          `type=volume,src=${volume},dst=/data`,
        ];
        assert.throws(
          () => docker(...rootRun, '-e', 'CORP_DB_PATH=/data/outside.sqlite3', image),
          /Root startup requires a Railway volume/,
        );
        docker(
          ...rootRun,
          image,
          'node',
          '-e',
          "require('fs').symlinkSync('/tmp','/data/company')",
        );
        assert.throws(() => docker(...rootRun, image), /Company storage must be a real directory/);
        docker(...rootRun, image, 'node', '-e', "require('fs').unlinkSync('/data/company')");
      }
      start(name);
      let url = await ready(name);
      const processUid = docker(
        'exec',
        name,
        'node',
        '-e',
        String.raw`
          const fs = require('fs');
          for (const pid of fs.readdirSync('/proc').filter(p => /^\d+$/.test(p))) {
            try {
              const argv = fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\0');
              if ((argv[0] === 'node' || argv[0].endsWith('/node')) && argv[1] === 'dist/server/container.js')
                process.stdout.write(fs.readFileSync('/proc/'+pid+'/status','utf8').match(/^Uid:\s+(\d+)/m)[1]);
            } catch {}
          }
        `,
      );
      assert.equal(processUid, '1000');
      if (railway) {
        assert.equal(
          (await fetch(url + '/health/ready', { headers: { Host: 'healthcheck.railway.app' } }))
            .status,
          200,
        );
        const ownership = docker(
          'exec',
          name,
          'node',
          '-e',
          "const fs=require('fs');process.stdout.write(String(fs.statSync('/data/company').uid))",
        );
        assert.equal(ownership, '1000');
      }
      assert.equal(docker('inspect', '--format', '{{.HostConfig.ReadonlyRootfs}}', name), 'true');
      assert.equal(
        (await fetch(url + '/api/state', { headers: { Host: 'company.example' } })).status,
        401,
      );
      const root = await fetch(url + '/', { headers: { Host: 'company.example' } }),
        html = await root.text(),
        loginToken = html.match(/name="login-token" content="([^"]+)"/)![1];
      const login = await fetch(url + '/api/auth/login', {
        method: 'POST',
        headers: {
          Host: 'company.example',
          Origin: 'https://company.example',
          'Content-Type': 'application/json',
          'X-Operator-Token': loginToken,
        },
        body: JSON.stringify({ password }),
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get('set-cookie')!.split(';')[0],
        headers = { Host: 'company.example', Cookie: cookie };
      const page = await fetch(url + '/', { headers });
      const token = (await page.text()).match(/name="operator-token" content="([^"]+)"/)![1],
        key = randomUUID();
      const cycle = () =>
        fetch(url + '/api/simulation/cycle', {
          method: 'POST',
          headers: {
            ...headers,
            Origin: 'https://company.example',
            'Content-Type': 'application/json',
            'X-Operator-Token': token,
            'Idempotency-Key': key,
          },
          body: '{}',
        });
      assert.equal((await cycle()).status, 200);
      const state = async () => {
        const response = await fetch(url + '/api/state', { headers });
        assert.equal(response.status, 200);
        return (await response.json()) as State;
      };
      assert.equal((await state()).company.cash_minor, 101950);
      docker(
        'exec',
        name,
        'node',
        'dist/server/container.js',
        'backup',
        '--database',
        railway ? '/data/company/company.sqlite3' : '/data/company.sqlite3',
        '--output',
        railway ? '/data/company/backups/verified.sqlite3' : '/data/backups/verified.sqlite3',
      );
      docker('stop', '--time', '10', name);
      docker('start', name);
      url = await ready(name);
      assert.equal((await state()).company.order_count, 1);
      assert.equal((await cycle()).status, 200);
      assert.equal((await state()).company.order_count, 1);
      docker('stop', '--time', '10', name);
      start(restore, [
        'node',
        'dist/server/container.js',
        '--database',
        railway ? '/data/company/backups/verified.sqlite3' : '/data/backups/verified.sqlite3',
      ]);
      url = await ready(restore);
      assert.equal((await state()).company.cash_minor, 101950);
      assert.equal((await state()).company.order_count, 1);
      console.log(
        `${railway ? 'Railway root-owned volume' : 'Standard volume'} verified: missing config rejected, non-root app, read-only image, authenticated API, restart persistence, idempotent replay and backup restoration.`,
      );
    } finally {
      for (const container of containers.reverse()) {
        try {
          docker('rm', '-f', container);
        } catch {}
      }
      try {
        docker('volume', 'rm', volume);
      } catch {}
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
