import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRailwayContext, project } from 'railway/iac';
import infrastructure from '../.railway/railway.js';

test('Railway deployment preserves the single-writer and secret-storage requirements', async () => {
  const definition = await infrastructure(
    createRailwayContext({ environment: 'staging' }),
    project,
  );
  const resources = definition.resources?.flat() ?? [];
  const services = resources.filter((resource) => resource.type === 'service');
  assert.equal(services.length, 1);
  const company = services[0];
  assert.equal(company.source?.branch, 'main');
  assert.equal(company.deploy?.numReplicas, 1);
  assert.equal(company.deploy?.sleepApplication, false);
  assert.equal(company.deploy?.overlapSeconds, 0);
  assert.equal(company.deploy?.healthcheckPath, '/health/ready');
  assert.equal(company.volumeAttachments?.['company-state'].mountPath, '/data');
  assert.ok(
    resources.some(
      (resource) => resource.address === company.volumeAttachments?.['company-state'].volume,
    ),
  );
  for (const name of ['CORP_OPERATOR_PASSWORD_HASH', 'CORP_SESSION_SECRET']) {
    assert.deepEqual(company.variables?.[name], { type: 'sharedReference', name });
  }
});
