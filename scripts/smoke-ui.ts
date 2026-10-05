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
import type { ModelProvider } from '../src/server/codex-provider.js';
const directory = mkdtempSync(join(tmpdir(), 'corp-browser-'));
const password = 'isolated-browser-owner-password';
const settings = loadSettings({
  CORP_DB_PATH: join(directory, 'smoke.sqlite3'),
  CORP_OPERATOR_PASSWORD_HASH: await hashPassword(password),
  CORP_SESSION_SECRET: randomBytes(48).toString('base64url'),
});
// Fixtures validate browser → API → orchestration → SQLite. CI never authenticates or bills a provider.
let modelConnected = false;
let loginStarted = false;
let modelCalls = 0;
let modelWait: Promise<void> | undefined;
let modelRelease: () => void = () => {};
const modelProvider: ModelProvider = {
  async status() {
    return {
      connected: modelConnected,
      login:
        loginStarted && !modelConnected
          ? { url: 'https://auth.openai.com/codex/device', code: 'TEST-CODE' }
          : undefined,
    };
  },
  login() {
    loginStarted = true;
  },
  close() {},
  async generate() {
    modelCalls++;
    if (modelWait) await modelWait;
    return {
      message: `Fixture employee handoff ${modelCalls}`,
      artifact: `Fixture deliverable ${modelCalls}\n<img src=x onerror=alert(1)>`,
      input_tokens: 100,
      output_tokens: 40,
    };
  },
};
const { app } = await createApp({ settings, startWorker: false, modelProvider });
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
  await page.getByRole('button', { name: 'Run virtual sale', exact: true }).click();
  await waitFor(page, async () => (await state()).company.cash_minor === 101950, 'sale settlement');
  await page.getByRole('heading', { name: 'Company map', exact: true }).waitFor();
  await waitFor(
    page,
    async () => (await page.locator('.handoff-step').count()) === 6,
    'six recorded handoffs',
  );
  await page.locator('.handoff-step').filter({ hasText: 'Studio' }).click();
  const office = page.locator('#office-world');
  await waitFor(
    page,
    async () => (await office.getAttribute('data-ready')) === 'true',
    'Phaser office ready',
  );
  assert.equal(await office.getAttribute('data-people'), '6');
  assert.equal(await office.locator('canvas').count(), 1);
  await office
    .locator('canvas')
    .evaluate((canvas) => canvas.setAttribute('data-verification', 'retained'));
  await page.locator('.handoff-step').first().click();
  assert.equal(await office.locator('canvas').getAttribute('data-verification'), 'retained');
  await page.getByRole('button', { name: 'Control your avatar', exact: true }).click();
  await waitFor(
    page,
    async () => Number(await office.getAttribute('data-owner-y')) > 0,
    'owner placed',
  );
  const initialY = Number(await office.getAttribute('data-owner-y'));
  await page.keyboard.press('ArrowDown');
  await waitFor(
    page,
    async () => Number(await office.getAttribute('data-owner-y')) >= initialY + 31,
    'keyboard walking',
  );
  await page.keyboard.press('ArrowUp');
  await waitFor(
    page,
    async () => Math.abs(Number(await office.getAttribute('data-owner-y')) - initialY) < 1,
    'walk back to desk',
  );
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(200);
  assert.equal(
    Number(await office.getAttribute('data-owner-y')),
    initialY,
    'desk collision prevents walking through furniture',
  );
  assert.match(await page.locator('#office-world-status').innerText(), /open floor/);
  const bounds = await office.locator('canvas').boundingBox();
  assert.ok(bounds);
  await page.mouse.click(
    bounds.x + (bounds.width * 10.5) / 32,
    bounds.y + (bounds.height * 7.5) / 24,
  );
  await waitFor(
    page,
    async () => Math.abs(Number(await office.getAttribute('data-owner-x')) - 336) < 1,
    'click-to-walk',
  );
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  assert.equal(await office.getAttribute('data-zoom'), '1.25');
  await page.getByRole('button', { name: 'Fit office', exact: true }).click();
  assert.equal(await office.getAttribute('data-zoom'), '1.00');
  await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
  assert.equal(await office.getAttribute('data-motion'), 'paused');
  const pausedX = await office.getAttribute('data-owner-x');
  await page.getByRole('button', { name: 'Walk right', exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal(await office.getAttribute('data-owner-x'), pausedX);
  await page.getByRole('button', { name: 'Resume motion', exact: true }).click();
  await page.getByRole('button', { name: 'Preview a meeting', exact: true }).click();
  await waitFor(
    page,
    async () => (await office.getAttribute('data-phase')) === 'meeting',
    'characters walk to meeting table',
  );
  assert.equal(modelCalls, 0, 'preview never calls a model');
  assert.equal((await state()).company.order_count, 1, 'preview never creates sales');
  await page.locator('.handoff-step').first().click();
  assert.match(await page.locator('#office-world-status').innerText(), /Office preview/);
  assert.equal(await office.getAttribute('data-phase'), 'meeting');
  const meetingBounds = await office.locator('canvas').boundingBox();
  assert.ok(meetingBounds);
  await page.mouse.click(
    meetingBounds.x + (meetingBounds.width * 464) / 1024,
    meetingBounds.y + (meetingBounds.height * 344) / 768,
  );
  await page.locator('#modal[open]').waitFor();
  assert.match(await page.locator('#modal').innerText(), /Operator/);
  await page.locator('#modal [data-action="close"]').click();
  await page.screenshot({
    path: 'artifacts/gather-office-meeting.png',
    fullPage: true,
    style: '#toast {visibility:hidden}',
  });

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
  await page.getByRole('button', { name: 'Run virtual sale', exact: true }).click();
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
  await page.getByRole('button', { name: 'Run virtual sale', exact: true }).click();
  await waitFor(
    page,
    async () => (await page.locator('#toast').innerText()).includes('per-action spending limit'),
    'spending limit blocks task',
  );
  assert.equal((await state()).company.order_count, 2);
  await nav('Company map');
  await page.getByRole('button', { name: 'Connect ChatGPT', exact: true }).click();
  await waitFor(
    page,
    async () => (await page.locator('.model-connection').innerText()).includes('TEST-CODE'),
    'device sign-in code',
  );
  assert.equal(
    await page.getByRole('link', { name: 'OpenAI’s Codex sign-in' }).getAttribute('href'),
    'https://auth.openai.com/codex/device',
  );
  modelConnected = true;
  await waitFor(
    page,
    async () =>
      (await page.locator('.model-connection').innerText()).includes('Connected through Codex'),
    'subscription connection',
  );
  await page.getByRole('button', { name: 'Start team task', exact: true }).click();
  await page
    .getByLabel('Message #product-team', { exact: true })
    .fill('Write a launch email; do not send it.');
  const cashBefore = (await state()).company.cash_minor;
  modelWait = new Promise((done) => {
    modelRelease = done;
  });
  await page.getByRole('button', { name: 'Ask team', exact: true }).click();
  await nav('Company map');
  await waitFor(
    page,
    async () => (await page.locator('#office-world').getAttribute('data-ready')) === 'true',
    'live office ready',
  );
  assert.match(await page.locator('#office-world-status').innerText(), /Live task/);
  assert.match(
    await page.getByRole('button', { name: 'Inspect Operator', exact: true }).innerText(),
    /Working/,
  );
  assert.equal((await state()).model_tasks?.[0]?.active_worker, 'operator');
  modelWait = undefined;
  modelRelease();
  await waitFor(
    page,
    async () => (await state()).model_tasks?.[0]?.status === 'completed',
    'actual orchestration with fixture transport',
  );
  await nav('Messages');
  await waitFor(
    page,
    async () =>
      (await page.locator('.message-feed').innerText()).includes('Fixture employee handoff 5'),
    'saved provider handoffs',
  );
  assert.equal(modelCalls, 5);
  assert.equal((await state()).company.cash_minor, cashBefore);
  assert.equal(
    await page.locator('.message-task-label').filter({ hasText: 'AI reply' }).count(),
    5,
  );
  await nav('Company map');
  assert.match(await page.locator('.real-team-task').innerText(), /Fixture deliverable 5/);
  assert.match(await page.locator('.real-team-task').innerText(), /Codex default/);
  assert.equal(await page.locator('.model-artifact img').count(), 0);
  assert.match(await page.locator('.model-artifact').last().innerText(), /<img src=x/);
  await page.screenshot({
    path: 'artifacts/company-map-model-task.png',
    fullPage: true,
    style: '#toast {visibility:hidden}',
  });
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
  await waitFor(
    page,
    async () => (await page.locator('#office-world').getAttribute('data-motion')) === 'reduced',
    'reduced-motion office',
  );
  await page.getByRole('button', { name: 'Preview a meeting', exact: true }).click();
  const reducedCanvas = page.locator('#office-world canvas');
  await page.waitForTimeout(100);
  const stillFrame = await reducedCanvas.evaluate((canvas) =>
    (canvas as HTMLCanvasElement).toDataURL(),
  );
  await page.waitForTimeout(400);
  assert.equal(
    await reducedCanvas.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()),
    stillFrame,
    'reduced motion keeps the scene still',
  );
  await nav('Balance');
  assert.equal(await page.locator('#office-world canvas').count(), 0);
  await nav('Company map');
  await waitFor(
    page,
    async () => (await page.locator('#office-world').getAttribute('data-ready')) === 'true',
    'office remount',
  );
  assert.equal(
    await page.locator('#office-world canvas').count(),
    1,
    'navigation does not leak canvases',
  );
  const fallbackBrowser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-webgl'],
  });
  try {
    const fallbackContext = await fallbackBrowser.newContext({
      storageState: await page.context().storageState(),
      viewport: { width: 1280, height: 1000 },
    });
    const fallback = await fallbackContext.newPage();
    fallback.on('pageerror', (error) => errors.push(error.message));
    await fallback.goto(url + '/#company', { waitUntil: 'networkidle' });
    const fallbackOffice = fallback.locator('#office-world');
    await waitFor(
      fallback,
      async () => (await fallbackOffice.getAttribute('data-ready')) === 'true',
      'Canvas fallback ready',
    );
    assert.equal(await fallbackOffice.getAttribute('data-renderer'), 'canvas');
    await fallback.getByRole('button', { name: 'Control your avatar', exact: true }).click();
    await waitFor(
      fallback,
      async () => Number(await fallbackOffice.getAttribute('data-owner-y')) > 0,
      'fallback owner placed',
    );
    const before = Number(await fallbackOffice.getAttribute('data-owner-y'));
    await fallback.keyboard.press('ArrowDown');
    await waitFor(
      fallback,
      async () => Number(await fallbackOffice.getAttribute('data-owner-y')) > before + 30,
      'fallback animation',
    );
    await fallback.screenshot({
      path: 'artifacts/gather-office-canvas-fallback.png',
      fullPage: true,
    });
  } finally {
    await fallbackBrowser.close();
  }
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Operator password').waitFor();
  assert.equal((await page.request.get(url + '/api/state')).status(), 401);
  assert.deepEqual(errors, []);
  console.log(
    'Browser verified: Phaser office, walking, collision, meetings, sprite inspection, retained scene, zoom, reduced motion, subscription sign-in UI, five-call model task using fixture provider, safe saved deliverables, four views, balance and decisions, persisted safe messages, incoming update drafts, employee hierarchy, task replay, financial/worker controls, mobile and 200% text, sign-in/out.',
  );
} finally {
  modelWait = undefined;
  modelRelease();
  await browser?.close();
  await app.close();
  rmSync(directory, { recursive: true, force: true });
}
