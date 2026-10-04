/** Isolated real-browser acceptance test. Never reads or writes the main company. */
import { chromium, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApp } from '../src/server/api.js';
import { hashPassword } from '../src/server/auth.js';
import { loadSettings } from '../src/server/settings.js';
import type { State } from '../src/shared/contracts.js';
const directory = mkdtempSync(join(tmpdir(), 'corp-browser-')),
  password = 'isolated-browser-owner-password';
const settings = loadSettings({
  CORP_DB_PATH: join(directory, 'smoke.sqlite3'),
  CORP_OPERATOR_PASSWORD_HASH: await hashPassword(password),
  CORP_SESSION_SECRET: randomBytes(48).toString('base64url'),
});
const { app } = await createApp({ settings, startWorker: false });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
mkdirSync('artifacts', { recursive: true });
async function waitFor(page: Page, check: () => Promise<boolean>, description: string) {
  for (let i = 0; i < 80; i++) {
    if (await check()) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out: ${description}`);
}
try {
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  assert.equal((await fetch(url + '/api/state')).status, 401);
  const executablePath =
    process.env.CORP_CHROMIUM_PATH ??
    (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }),
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const state = async () => {
    const response = await page.request.get(url + '/api/state');
    assert.equal(response.status(), 200);
    return (await response.json()) as State;
  };
  const expectVisible = async (selector: string) =>
    assert.ok(await page.locator(selector).isVisible(), `Expected ${selector} visible`);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByLabel('Operator password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Your company, at a glance.' }).waitFor();
  await page.getByRole('button', { name: 'Run a cycle', exact: true }).click();
  await waitFor(page, async () => (await state()).company.cash_minor === 101950, 'sale settlement');
  await page.screenshot({ path: 'artifacts/dashboard-after-cycle.png', fullPage: true });
  await page.getByRole('link', { name: 'Treasury', exact: true }).click();
  await page.getByRole('button', { name: 'New experiment' }).click();
  await page.getByLabel('Experiment name').fill('Test two listing designs');
  await page.getByLabel('Maximum cost (USD)').fill('12');
  await page.getByRole('button', { name: 'Reserve funds', exact: true }).click();
  await waitFor(page, async () => (await state()).company.reserved_minor === 1200, 'reservation');
  await page.getByRole('button', { name: 'Pause company', exact: true }).click();
  await waitFor(page, async () => (await state()).company.paused === 1, 'pause');
  assert.ok(await page.getByRole('button', { name: 'Execute', exact: true }).isDisabled());
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await waitFor(page, async () => (await state()).company.reserved_minor === 0, 'cancellation');
  await page.getByRole('button', { name: 'Refund', exact: true }).click();
  await page.getByRole('button', { name: 'Record full refund', exact: true }).click();
  await waitFor(page, async () => (await state()).company.cash_minor === 99550, 'refund');
  assert.equal((await state()).company.profit_minor, -450);
  await page.getByRole('button', { name: 'Resume company', exact: true }).click();
  await waitFor(page, async () => (await state()).company.paused === 0, 'resume');
  await page.getByRole('link', { name: 'Controls', exact: true }).click();
  await page.getByRole('button', { name: 'Edit limits' }).click();
  await page.getByLabel('Per-action ceiling (USD)').fill('1');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  await waitFor(page, async () => (await state()).company.action_limit_minor === 100, 'policy');
  await page.getByRole('button', { name: 'Run a cycle', exact: true }).click();
  await waitFor(
    page,
    async () =>
      (await page.locator('#toast').textContent())?.includes('per-action spending limit') ?? false,
    'policy rejection',
  );
  assert.equal((await state()).company.order_count, 1);
  await page.getByRole('button', { name: 'Edit limits' }).click();
  await page.getByLabel('Per-action ceiling (USD)').fill('25');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  await waitFor(
    page,
    async () => (await state()).company.action_limit_minor === 2500,
    'restore policy',
  );
  for (const name of [
    'Overview',
    'Agent team',
    'Company map',
    'Businesses',
    'Execution & inference',
    'Treasury',
    'Activity',
    'Controls',
  ]) {
    await page.getByRole('link', { name, exact: true }).click();
    await expectVisible('#main h1');
  }
  await page.getByRole('link', { name: 'Company map', exact: true }).click();
  await page.locator('.org-node').filter({ hasText: 'Studio' }).click();
  await page.getByRole('button', { name: 'Disable worker', exact: true }).click();
  await waitFor(page, async () => !(await page.locator('#modal').isVisible()), 'worker disabled');
  await page.getByRole('button', { name: 'Run a cycle', exact: true }).click();
  await waitFor(
    page,
    async () =>
      (await page.locator('#toast').textContent())?.includes('Studio is disabled') ?? false,
    'worker rejection',
  );
  assert.equal((await state()).company.cash_minor, 99550);
  await page.locator('.org-node').filter({ hasText: 'Studio' }).click();
  await page.getByRole('button', { name: 'Enable worker', exact: true }).click();
  await waitFor(page, async () => !(await page.locator('#modal').isVisible()), 'worker enabled');
  await page.screenshot({ path: 'artifacts/company-map.png', fullPage: true });
  await page.getByRole('link', { name: 'Execution & inference', exact: true }).click();
  await page.screenshot({ path: 'artifacts/inference.png', fullPage: true });
  await page.locator('.run-row').last().click();
  assert.equal(await page.locator('.span-detail').count(), 6);
  await page.locator('.span-detail summary').first().click();
  assert.match((await page.locator('.span-body').first().textContent()) ?? '', /cleaning-kit/);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Your company, at a glance.' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/dashboard-mobile.png', fullPage: true });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    'mobile horizontal overflow',
  );
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    '200% text overflow',
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Operator password').waitFor();
  assert.equal((await page.request.get(url + '/api/state')).status(), 401);
  assert.deepEqual(errors, []);
  console.log(
    'Browser verified: sign-in/out, eight views, financial controls, worker controls, execution spans, session reload, mobile and 200% text.',
  );
} finally {
  await browser?.close();
  await app.close();
  rmSync(directory, { recursive: true, force: true });
}
