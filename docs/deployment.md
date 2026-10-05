# Authenticated staging deployment

Deploy one container and one persistent disk for this simulation. Real money, marketplace operations, model calls and customer outreach remain disabled. Hosting expenses are real and are not reconciled into the virtual ledger.

## Render

1. Connect the GitHub repository `nozma-knows/corp` to your Render account. Apply `render.yaml` from `main` using Blueprints. Confirm the current service/disk charge in Render; this configuration requires paid persistent storage.
2. Generate the owner password hash locally with `npm run password-hash`. The command requests the password twice without echoing it; use a password manager and at least 12 characters. Copy only the resulting hash to Render's secret `CORP_OPERATOR_PASSWORD_HASH`. Do not paste passwords or secrets into chat, PRs, logs, or Git.
3. The blueprint generates `CORP_SESSION_SECRET`. Render provides `RENDER_EXTERNAL_HOSTNAME`, which the application uses as its canonical HTTPS origin. For a custom domain, set `CORP_PUBLIC_ORIGIN` to that exact HTTPS origin before using it. Only explicitly configured hostnames are trusted.
4. Keep `CORP_DB_PATH=/data/company.sqlite3` on the mounted disk, one instance, and automatic deployment off. Deploy the reviewed, tested commit. Persistent disks may cause a short rollout interruption; schedule it accordingly.
5. Wait for `/health/ready` to return 200. Open the HTTPS URL: it must show sign-in. Check that unauthenticated `/api/state`, `/api/inspector`, and `/api/ledger/export.csv` return 401.
6. Sign in. Verify virtual opening cash, run one cycle, inspect six spans and nested accounting, disable/enable Studio, and refund the order. Restart the service and confirm the company history persists. Verify sign-out revokes the session.

No Render account/token is configured in the current development environment. The blueprint is prepared; provisioning requires your account connection. Provider prices and capacity should be confirmed in the account before applying it. The configuration does not imply a deployed URL exists.

## Container on an existing server

Provide TLS with your server's reverse proxy; keep the backend port bound to loopback. Store runtime values in a protected file outside the repository or inject them with the server's secret manager. The `.env.example` lists configuration names. Preserve the literal `$` characters in password hashes: Docker `--env-file` treats them literally; shell expansion or Compose interpolation can corrupt them.

```sh
docker build -t corp-staging .
docker volume create corp-company-data
docker run -d --name corp-company --init \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop=ALL --security-opt no-new-privileges:true \
  --env-file /secure/location/corp-runtime.env \
  --mount type=volume,src=corp-company-data,dst=/data \
  -p 127.0.0.1:8000:8000 corp-staging
```

The image runs as UID 1000. Bind mounts need that user to own the data directory; named volumes inherit the image directory's ownership. Hosted mode fails to start without valid HTTPS origin, password hash, secret, and absolute database path. Local unauthenticated mode refuses non-loopback binding. Do not use local mode for a public deployment.

The image uses Node 24; `package-lock.json` locks the runtime dependencies. In a managed development environment with a session proxy, supply its CA through a BuildKit secret:

```sh
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -t corp-staging .
```

The certificate exists only during dependency installation. TLS verification stays enabled. CI builds with ordinary public CA trust.

Container acceptance check against the image, with disposable state:

```sh
npm run test:container
```

This verifies missing-config rejection, non-root/read-only execution, authentication, committed state and sessions after restart, idempotent replay, online backup, and restoration. The temporary test credentials and volume are removed afterward.

## Backups and recovery

Create a backup before each deployment and at least daily while testing. Keep an encrypted off-host copy with restricted access; a backup on the same disk does not protect against disk/provider loss. Owner sessions exist in the database: treat backups as sensitive and rotate the session secret after restoring to revoke old sessions.

```sh
docker exec corp-company node dist/server/main.js backup \
  --database /data/company.sqlite3 \
  --output /data/backups/company-YYYYMMDD-HHMMSS.sqlite3
docker cp corp-company:/data/backups/company-YYYYMMDD-HHMMSS.sqlite3 /secure/backup/location/
```

Use a unique filename: backups refuse overwrite and become visible only after SQLite's online snapshot and integrity check complete. Do not copy a live SQLite database file directly; its WAL may contain committed data not present in the main file.

To recover: pause testing, stop the application, preserve the old database and its WAL/SHM companions, place the verified backup on the persistent volume at a **new** path owned by UID 1000, point `CORP_DB_PATH` at it, rotate `CORP_SESSION_SECRET`, and restart the tested image. Startup checks SQLite, references, financial balance, and migration checksums. Verify opening/current cash, ledger balance, order count, and trace history before resuming. Keep the old files until recovery is confirmed.

Before migrating an existing Python database, stop that process, back up with the built TypeScript CLI, and start this runtime with the same database path. Original schema and legacy idempotency hashes are compatible. Do not roll an upgraded database back to older code without testing schema compatibility; unknown or modified migrations deliberately fail closed.

## Operations and limits

- `/health/live` reports process responsiveness; `/health/ready` also checks company storage and scheduler health. Monitor both through the hosting provider.
- Logs contain request IDs, method/path/status and timing; they omit request bodies, cookies, and query strings. Unexpected failures return generic responses with the request ID for diagnosis.
- A scheduler exception disables auto-run, pauses the company when storage is available, and fails readiness. Inspect logs and restart after fixing the cause. Policy denials simply stop auto-run and leave normal health intact.
- `SIGTERM`/`SIGINT` stop scheduling, drain Fastify, and close storage. Do not forcibly terminate a healthy service during an ordinary rollout.
- Rotating the operator hash **or** session secret revokes existing sessions. Password hashing is asynchronous; login work is capped and failed attempts persist with a 15-minute throttle. Proxy headers are not trusted, so a hosting proxy may cause attempts to share one throttle bucket.
- API bodies are limited to 64 KiB. UI history is bounded; CSV streams the immutable ledger in pages. Single-process SQLite writes are synchronous and serialized. This is a bounded staging topology; use PostgreSQL and durable external-action processing before horizontal scaling or live finance.
- Automated scheduled backups/off-host storage and alert delivery depend on the hosting account and are not configured by this repository alone. Set them up before sustained unattended operation.
