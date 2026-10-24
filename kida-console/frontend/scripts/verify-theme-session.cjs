// Real cookie-session smoke using an isolated database and temporary credentials.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const frontend = process.env.THEME_TEST_URL || 'http://127.0.0.1:4217';
const backend = path.resolve(__dirname, '../../backend');
(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'kida-theme-session-'));
  const password = randomBytes(24).toString('hex');
  const port = process.env.THEME_BACKEND_PORT || '0';
  let api;
  const server = spawn(
    process.env.BACKEND_PYTHON || path.join(backend, '.venv/bin/python'),
    ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', port],
    {
      cwd: backend,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        KIDA_DATABASE_PATH: path.join(temporary, 'auth.sqlite3'),
        KIDA_ADMIN_PASSWORD: password,
        KIDA_COOKIE_SECURE: 'false',
        KIDA_ALLOWED_ORIGINS: frontend,
        KIDA_CORE_URL: 'http://127.0.0.1:9',
      },
    },
  );
  const serverReady = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Temporary backend startup timed out')),
      10000,
    );
    let log = '';
    server.stderr.on('data', (data) => {
      log += data.toString();
      const address = log.match(/Uvicorn running on (http:\/\/127\.0\.0\.1:\d+)/);
      if (address) {
        clearTimeout(timeout);
        resolve(address[1]);
      }
    });
    server.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Temporary backend exited: ${code}`));
    });
  });
  let browser;
  try {
    api = await serverReady;
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || undefined,
    });
    const context = await browser.newContext();
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const response = await context.request.get(`${api}/api/auth/csrf`);
        if (response.ok()) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'isolated backend ready');
    await context.route('http://127.0.0.1:8000/api/**', async (route) => {
      const response = await route.fetch({
        url: route.request().url().replace('http://127.0.0.1:8000', api),
      });
      await route.fulfill({ response });
    });
    const first = await context.newPage();
    await first.goto(`${frontend}/login`);
    await first.locator('#username').fill('admin');
    await first.locator('#password').fill(password);
    await first.getByRole('button', { name: 'Entrar', exact: true }).click();
    await first.waitForURL('**/dashboard');
    await first.goto(`${frontend}/settings`);
    await first.locator('.theme-option').first().waitFor();
    const cookie = (await context.cookies()).find((cookie) => cookie.name === 'kida_session');
    assert.ok(cookie);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, 'Lax');
    assert.equal(cookie.path, '/');
    assert.equal(cookie.secure, false); // Explicit local HTTP setting for this temporary server.
    const second = await context.newPage();
    await second.goto(`${frontend}/settings`);
    await second.locator('.theme-option').first().waitFor();
    for (const page of [first, second]) {
      const account = await page.evaluate(async (api) => {
        const response = await fetch(`${api}/api/auth/session`, { credentials: 'include' });
        return (await response.json()).user;
      }, api);
      assert.equal(account.id, 1);
    }
    await first
      .locator('.theme-option')
      .filter({ has: first.locator('[data-theme="sakura"]') })
      .click();
    await second.waitForFunction(() => document.documentElement.dataset.theme === 'sakura');
    await first.getByRole('button', { name: 'Cerrar sesión' }).click();
    await first.waitForURL((url) => url.pathname === '/login');
    assert.equal(await first.locator('html').getAttribute('data-theme'), 'sakura');
    await second.reload();
    await second.waitForURL((url) => url.pathname === '/login');
    assert.equal(await second.locator('html').getAttribute('data-theme'), 'sakura');
    console.log(
      'PASS: real HttpOnly cookie shared across tabs, account theme sync, logout/reload retain appearance. Temporary backend/database only.',
    );
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      if (server.exitCode !== null) resolve();
      else server.once('exit', resolve);
    });
    await fs.rm(temporary, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
