/** Isolated acceptance tests for the four-view workspace. Never touches the hosted company. */
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
const directory = mkdtempSync(join(tmpdir(), 'corp-browser-'));
const password = 'isolated-browser-owner-password';
const settings = loadSettings({
  CORP_DB_PATH: join(directory, 'smoke.sqlite3'),
  CORP_OPERATOR_PASSWORD_HASH: await hashPassword(password),
  CORP_SESSION_SECRET: randomBytes(48).toString('base64url'),
});
const { app } = await createApp({ settings, startWorker: false });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
mkdirSync('artifacts', { recursive: true });
async function waitFor(page: Page, check: () => Promise<boolean>, description: string) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await page.waitForTimeout(80);
  }
  throw new Error(`Timed out: ${description}`);
}
try {
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  assert.equal((await fetch(url + '/api/state')).status, 401);
  assert.equal(
    (
      await fetch(url + '/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'general', body: 'Untrusted note' }),
      })
    ).status,
    401,
  );
  const executablePath =
    process.env.CORP_CHROMIUM_PATH ??
    (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const state = async () => {
    const response = await page.request.get(url + '/api/state');
    assert.equal(response.status(), 200);
    return (await response.json()) as State;
  };
  const nav = async (label: string) => {
    await page.getByRole('link', { name: label, exact: true }).click();
    await page.getByRole('heading', { name: label, exact: true }).waitFor();
  };
  const settingsOpen = async () => {
    const details = page.locator('.company-settings');
    if (!(await details.evaluate((node) => node.hasAttribute('open'))))
      await details.locator('summary').click();
  };
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByLabel('Operator password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Balance', exact: true }).waitFor();
  assert.deepEqual(await page.locator('#navigation a span').allTextContents(), [
    'Balance',
    'Messages',
    'Decisions',
    'Company map',
  ]);
  assert.match(await page.locator('.balance-amount').innerText(), /1,000/);
  await page.screenshot({
    path: 'artifacts/balance.png',
    fullPage: true,
    style: '#toast {visibility:hidden}',
  });
  await page.getByRole('button', { name: 'Start team task', exact: true }).click();
  await waitFor(page, async () => (await state()).company.cash_minor === 101950, 'sale settlement');
  await page.getByRole('heading', { name: 'Company map', exact: true }).waitFor();
  await waitFor(
    page,
    async () => (await page.locator('.handoff-step').count()) === 6,
    'six recorded handoffs',
  );
  await page.locator('.handoff-step').filter({ hasText: 'Studio' }).click();
  await page.screenshot({
    path: 'artifacts/company-map.png',
    fullPage: true,
    style: '#toast {visibility:hidden}',
  });
  await page.getByRole('button', { name: 'Inspect Studio', exact: true }).click();
  assert.match(await page.locator('#modal').innerText(), /Reports to Operator/);
  assert.match(await page.locator('#modal').innerText(), /Fast model/i);
  await page.getByRole('button', { name: 'Disable worker', exact: true }).click();
  await waitFor(page, async () => !(await page.locator('#modal').isVisible()), 'worker disabled');
  await page.getByRole('button', { name: 'Start team task', exact: true }).click();
  await waitFor(
    page,
    async () => (await page.locator('#toast').innerText()).includes('Studio is disabled'),
    'disabled worker blocks task',
  );
  assert.equal((await state()).company.cash_minor, 101950);
  await nav('Decisions');
  assert.match(await page.locator('.decision-board').innerText(), /Studio is disabled/);
  await nav('Company map');
  await page.getByRole('button', { name: 'Inspect Studio', exact: true }).click();
  await page.getByRole('button', { name: 'Enable worker', exact: true }).click();
  await waitFor(page, async () => !(await page.locator('#modal').isVisible()), 'worker enabled');
  await page.screenshot({
    path: 'artifacts/company-map-blocked.png',
    fullPage: true,
    style: '#toast {visibility:hidden}',
  });
  await nav('Messages');
  assert.equal(await page.locator('.team-message').count(), 6); // Five committed handoffs and one truthful block.
  assert.match(await page.locator('.message-feed').innerText(), /to Review/);
  await page.getByRole('button', { name: 'finance', exact: true }).click();
  assert.match(await page.locator('.message-feed').innerText(), /30-day refund coverage/);
  await page.getByRole('button', { name: 'general', exact: true }).click();
  const note = '<img src=x onerror=alert(1)>\nFocus on one product this week.';
  await page.getByLabel('Message #general', { exact: true }).fill(note);
  await page.getByRole('button', { name: 'product-team', exact: true }).click();
  await page.getByLabel('Message #product-team', { exact: true }).fill('Unsent product draft');
  // An incoming task update must not erase a note or steal the caret.
  await page.evaluate(async () => {
    const response = await fetch('/api/simulation/cycle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Operator-Token': document.querySelector<HTMLMetaElement>('meta[name="operator-token"]')!
          .content,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: '{}',
    });
    if (!response.ok) throw new Error('Incoming test task failed');
  });
  await waitFor(
    page,
    async () => (await page.locator('.team-message').count()) === 11,
    'incoming team messages',
  );
  assert.equal(
    await page.getByLabel('Message #product-team', { exact: true }).inputValue(),
    'Unsent product draft',
  );
  assert.ok(
    await page
      .getByLabel('Message #product-team', { exact: true })
      .evaluate((node) => node === document.activeElement),
  );
  await page.getByRole('button', { name: 'general', exact: true }).click();
  assert.equal(await page.getByLabel('Message #general', { exact: true }).inputValue(), note);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await waitFor(
    page,
    async () => (await page.locator('.team-message').count()) === 1,
    'owner note posted',
  );
  assert.equal(await page.locator('.message-feed img').count(), 0);
  assert.equal(await page.getByLabel('Message #general', { exact: true }).inputValue(), '');
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'general', exact: true }).click();
  assert.match(await page.locator('.message-feed').innerText(), /Focus on one product this week/);
  await page.getByRole('button', { name: 'product-team', exact: true }).click();
  await page.screenshot({
    path: 'artifacts/messages.png',
    fullPage: true,
    style: '#toast {visibility:hidden}',
  });
  await nav('Decisions');
  await page.getByRole('button', { name: 'Propose an expense', exact: true }).click();
  await page.getByLabel('Experiment name').fill('Test two listing designs');
  await page.getByLabel('Maximum cost (USD)').fill('12');
  await page.getByRole('button', { name: 'Reserve funds', exact: true }).click();
  await waitFor(page, async () => (await state()).company.reserved_minor === 1200, 'reservation');
  await page.screenshot({
    path: 'artifacts/decisions.png',
    fullPage: true,
    style: '#toast {visibility:hidden}',
  });
  await page.getByRole('button', { name: 'Pause company', exact: true }).click();
  await waitFor(page, async () => (await state()).company.paused === 1, 'pause');
  assert.ok(await page.getByRole('button', { name: 'Approve expense', exact: true }).isDisabled());
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  await waitFor(page, async () => (await state()).company.reserved_minor === 0, 'decline');
  await nav('Balance');
  await settingsOpen();
  await page.getByRole('button', { name: 'Refund', exact: true }).first().click();
  await page.getByRole('button', { name: 'Record full refund', exact: true }).click();
  await waitFor(page, async () => (await state()).company.refund_count === 1, 'refund');
  await page.getByRole('button', { name: 'Resume company', exact: true }).click();
  await waitFor(page, async () => (await state()).company.paused === 0, 'resume');
  await nav('Decisions');
  await page.getByRole('button', { name: 'Propose an expense', exact: true }).click();
  await page.getByLabel('Experiment name').fill('Approved team budget');
  await page.getByLabel('Maximum cost (USD)').fill('12');
  await page.getByRole('button', { name: 'Reserve funds', exact: true }).click();
  await waitFor(
    page,
    async () => (await state()).company.reserved_minor === 1200,
    'second reservation',
  );
  await page.getByRole('button', { name: 'Approve expense', exact: true }).click();
  await waitFor(
    page,
    async () =>
      (await state()).actions.some(
        (a) => a.title === 'Approved team budget' && a.status === 'completed',
      ),
    'expense approved',
  );
  await page.getByText('Approved & spent', { exact: true }).waitFor();
  assert.match(await page.locator('.decision-board').innerText(), /Approved & Spent/i);
  await nav('Balance');
  await settingsOpen();
  await page.getByRole('button', { name: 'Spending limits', exact: true }).click();
  await page.getByLabel('Per-action ceiling (USD)').fill('1');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  await waitFor(page, async () => (await state()).company.action_limit_minor === 100, 'limits');
  await page.getByRole('button', { name: 'Start team task', exact: true }).click();
  await waitFor(
    page,
    async () => (await page.locator('#toast').innerText()).includes('per-action spending limit'),
    'spending limit blocks task',
  );
  assert.equal((await state()).company.order_count, 2);
  // Verify every view on a phone and with larger text, not only the landing view.
  for (const view of ['Balance', 'Messages', 'Decisions', 'Company map']) {
    await nav(view);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `${view}: mobile horizontal overflow`,
    );
    await page.screenshot({
      path: `artifacts/${view.toLowerCase().replaceAll(' ', '-')}-mobile.png`,
      fullPage: true,
      style: '#toast {visibility:hidden}',
    });
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `${view}: 200% text overflow`,
    );
    await page.evaluate(() => (document.documentElement.style.fontSize = ''));
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await nav('Company map');
  await page.getByRole('button', { name: 'Replay teamwork', exact: true }).click();
  assert.ok(
    !(await page.locator('.replay-label').innerText()).includes('Replaying'),
    'Reduced motion skips timed replay',
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Operator password').waitFor();
  assert.equal((await page.request.get(url + '/api/state')).status(), 401);
  assert.deepEqual(errors, []);
  console.log(
    'Browser verified: four views, balance and decisions, persisted safe messages, incoming update drafts, employee hierarchy, task replay, financial/worker controls, mobile and 200% text, sign-in/out.',
  );
} finally {
  await browser?.close();
  await app.close();
  rmSync(directory, { recursive: true, force: true });
}
