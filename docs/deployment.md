# Authenticated staging deployment

Deploy one container and one persistent disk for this simulation. Real money, marketplace operations, model calls and customer outreach remain disabled. Hosting expenses are real and are not reconciled into the virtual ledger.

## Railway

Use your existing Railway account with a **dedicated new project** named `corp-company` and an environment for staging. The TypeScript definition in [`.railway/railway.ts`](../.railway/railway.ts) manages that environment: one Docker service from GitHub `main` using `Dockerfile.railway`, one 1 GiB volume in `us-west2`, readiness checks, restart limits, no sleeping, and graceful draining. Do not apply this whole-environment definition to a project containing other services.

Railway's current Infrastructure as Code uses TypeScript; legacy `railway.json`/`railway.toml` configuration cannot be enabled for new services. The npm `railway` SDK is a development dependency. The separate **Railway CLI must be version 5.42.1 or newer**. See the [official IaC guide](https://docs.railway.com/infrastructure-as-code) and [CLI commands](https://docs.railway.com/cli/config).

1. Merge the reviewed Railway changes into `main` after GitHub checks pass. Install dependencies locally with `npm ci --ignore-scripts`. Connect your GitHub repository to Railway and create the dedicated project/environment. Check its current hosting and volume price; this is a continuously running service with persistent storage, not a free static website.
2. Generate credentials on your own terminal with `npm run password-hash` and `npm run session-secret`. The first asks for a password twice without echoing it; keep that password in your password manager. Add the resulting hash and random secret as **sealed shared variables** named `CORP_OPERATOR_PASSWORD_HASH` and `CORP_SESSION_SECRET` in the target Railway environment. Preserve the literal `$` separators in the hash. Never put credentials in Git or chat. IaC references these existing shared variables without storing their values.
3. Authenticate the Railway CLI in your own terminal and link to this dedicated project and environment. From the repository root:

   ```sh
   railway login
   railway link
   railway config plan
   railway config apply
   ```

   Review the plan: exactly the company service and its volume, no unrelated deletions, no additional replicas. Applying changes provisions resources and can incur charges. No hosting credentials are currently connected to this development environment; account provisioning and a real deployment have not yet been verified here.
4. In service Settings → Networking, generate a public domain targeting port **8000**. Generated domains are not created by the IaC definition. Railway supplies `RAILWAY_PUBLIC_DOMAIN`, which the server uses as its canonical HTTPS origin; creating a domain may require another deployment to inject it. An earlier startup without a public origin deliberately fails closed. For a custom domain, set `CORP_PUBLIC_ORIGIN` to the exact HTTPS origin as a sealed/shared configuration reference in the definition before switching domains.
5. Keep the volume at `/data`, database at `/data/company/company.sqlite3`, and **one instance**. `RAILWAY_RUN_UID=0` permits the container bootstrap to initialize Railway's root-owned volume. It changes only the mount's traversal permissions and the dedicated `company` directory, rejects symlink storage and paths outside that directory, then drops to UID/GID 1000 before starting the app. Database files, backups, sessions and normal requests run without root privileges. No recursive ownership change occurs. Railway's `healthcheck.railway.app` hostname is explicitly allowed.
6. Wait for `/health/ready` to return 200 over HTTPS. The dashboard must show sign-in. Confirm unauthenticated `/api/state`, `/api/inspector` and `/api/ledger/export.csv` return 401. Sign in, verify $1,000 virtual opening cash, run a cycle, inspect the execution spans, disable/enable Studio, and refund the order. Restart the service and confirm history persists; verify sign-out revokes the session.
7. Before subsequent deployments, pause auto-run and create a verified backup. GitHub source deployment waits for check suites. Configure the account's deployment settings to deploy only reviewed commits, and verify the commit SHA and persistence after each rollout. A volume-backed service has brief deployment downtime; do not assume overlapping replicas or zero-downtime rollouts.

The provider health check runs during deployment. Add ongoing external availability monitoring and alerts for unattended use. Enable Railway volume backup schedules in the account and keep restricted off-provider backups as well; neither is established just by committing IaC. Hosting and model bills are real expenses outside the virtual ledger.

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

`Dockerfile.railway` uses ordinary public CA trust because Railway’s builder rejects BuildKit secret mounts. It otherwise matches the runtime and build steps in `Dockerfile`, which retains the optional proxy CA secret for managed local builds. Select `Dockerfile.railway` in the Railway service settings.

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

This verifies both ordinary named volumes and root-owned Railway-style volumes: missing-config rejection, non-root application/read-only image, provider health checks, authentication, committed state and sessions after restart, idempotent replay, online backup, and restoration. The temporary test credentials and volume are removed afterward.

## Backups and recovery

For Railway, use the service shell with the container bootstrap so backup commands also drop privileges:

```sh
node dist/server/container.js backup \
  --database /data/company/company.sqlite3 \
  --output /data/company/backups/company-YYYYMMDD-HHMMSS.sqlite3
```

Export that verified file through an authorized secure transfer from the service volume; `railway run` runs locally and does **not** mount the remote volume. Do not treat a backup remaining only on the Railway volume as an off-host copy. Restore files inside `/data/company` owned by UID 1000.

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
