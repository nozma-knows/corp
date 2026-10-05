import { defineRailway, github, project, service, volume } from 'railway/iac';

// Use a dedicated project/environment. Shared secrets are created in Railway,
// never read from the workstation or included in this infrastructure definition.
export default defineRailway((ctx) => {
  const data = volume('company-state', { region: 'us-west2', sizeMB: 1024 });
  const company = service('corp-company-staging', {
    source: github('nozma-knows/corp', { branch: 'main', checkSuites: true }),
    build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile.railway' },
    replicas: 1,
    deploy: {
      region: 'us-west2',
      healthcheckPath: '/health/ready',
      healthcheckTimeout: 60,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 5,
      sleepApplication: false,
      overlapSeconds: 0,
      drainingSeconds: 30,
    },
    volumeMounts: { '/data': data },
    env: {
      CORP_ENV: 'staging',
      CORP_DB_PATH: '/data/company/company.sqlite3',
      CORP_ALLOWED_HOSTS: 'localhost,127.0.0.1,[::1],healthcheck.railway.app',
      CORP_OPERATOR_PASSWORD_HASH: ctx.shared.CORP_OPERATOR_PASSWORD_HASH,
      CORP_SESSION_SECRET: ctx.shared.CORP_SESSION_SECRET,
      RAILWAY_RUN_UID: '0',
      PORT: '8000',
    },
  });
  return project('corp-company', { resources: [company, data] });
});
