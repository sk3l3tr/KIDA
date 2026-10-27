/* UI verification only: intercept every API request. Power requests never reach CORE. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SYSTEM_TEST_URL || 'http://127.0.0.1:4230';
const output = process.env.SYSTEM_TEST_OUTPUT || '/tmp/kida-system-redesign-evidence';
const combinations = [
  ['professional', 'light'],
  ['professional', 'dark'],
  ['neobrutalism', 'light'],
  ['neobrutalism', 'dark'],
  ['sakura', 'light'],
  ['sakura', 'dark'],
  ['tokyo', 'dark'],
];
const temperature = (device, label, value, extra = {}) => ({
  type: 'temperature',
  device,
  label,
  value,
  unit: 'C',
  status: 'OK',
  alarm: false,
  max: null,
  critical: null,
  ...extra,
});
const health = {
  overall: 'OK',
  future: { extra: 'visible' },
  sensors: [
    temperature('coretemp', 'Package id 0', 50, { critical: 105 }),
    ...Array.from({ length: 14 }, (_, i) =>
      temperature('coretemp', `Core ${i}`, 44 + (i % 7), { critical: 105 }),
    ),
    {
      type: 'fan',
      device: 'qc71_laptop.hwmon.fan',
      label: 'fan1',
      value: 1992,
      unit: 'RPM',
      status: 'OK',
      alarm: false,
      fault: false,
    },
    { type: 'fan', label: 'alert-fan', value: 1200, unit: 'RPM', status: 'CRITICAL', alarm: true, fault: null },
    { type: 'fan', label: 'unknown-fan', value: null, unit: null, status: 'FUTURE', alarm: null, fault: null },
    {
      type: 'fan',
      device: 'qc71_laptop.hwmon.fan',
      label: 'fan2',
      value: 0,
      unit: 'RPM',
      status: 'CRITICAL',
      alarm: false,
      fault: false,
    },
    temperature('nvme', 'Composite', 31.85, { critical: 84.85 }),
    temperature('nvme', 'Sensor 2', 30.85, { max: 65261.85 }),
    temperature('iwlwifi_1_5', 'temp1', 33),
    temperature('acpitz_0', 'temp1', 49),
    temperature('acpitz_1', 'temp1', 49),
    {
      type: 'voltage',
      device: 'future',
      label: 'duplicate',
      value: 0,
      unit: 'V',
      status: 'FUTURE',
      extra: 'search-me',
    },
    {
      type: 'voltage',
      device: 'future',
      label: 'duplicate',
      value: null,
      unit: 'V',
      status: 'unknown',
    },
  ],
};
const wake = {
  rtc_device: 'rtc0',
  rtcwake_available: true,
  rtc_alarm_available: true,
  s5_wake_status: 'unverified',
  warnings: ['Permiso denegado al leer /dev/rtc0'],
};

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const results = [];
  try {
    for (const width of [360, 768, 1440])
      for (const [theme, mode] of combinations) {
        const context = await browser.newContext({ viewport: { width, height: 1000 } });
        await context.addInitScript(
          ({ theme, mode }) => {
            for (const scope of ['global', 'account:991'])
              localStorage.setItem(
                `kida:appearance:${scope}`,
                JSON.stringify({ version: 1, theme, mode }),
              );
          },
          { theme, mode },
        );
        const reads = { health: 0, wake: 0 },
          writes = [],
          errors = [];
        let failHealth = false,
          emptyHealth = false;
        await context.route('**/api/**', async (route) => {
          const req = route.request(),
            path = new URL(req.url()).pathname;
          if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
          if (path.startsWith('/api/auth/'))
            return route.fulfill({
              json: { user: { id: 991, username: 'system-test' }, csrf_token: 'test-token' },
            });
          if (req.method() !== 'GET') {
            assert.ok(
              ['/api/system/shutdown', '/api/system/reboot', '/api/system/power-cycle'].includes(
                path,
              ),
            );
            writes.push({ path, body: req.postDataJSON() });
            return route.fulfill({
              status: 504,
              json: { detail: { code: 'core_timeout', message: 'Test timeout' } },
            });
          }
          if (path === '/api/system/health') {
            reads.health++;
            if (failHealth)
              return route.fulfill({ status: 503, json: { detail: { code: 'core_unavailable' } } });
            return route.fulfill({
              json: emptyHealth ? { overall: 'unknown', sensors: [] } : health,
            });
          }
          if (path === '/api/system/wake-capabilities') {
            reads.wake++;
            return route.fulfill({ json: wake });
          }
          if (path === '/api/system/info')
            return route.fulfill({
              json: {
                hostname: 'test',
                os: {},
                kernel: {},
                hardware: {},
                cpu: {},
                memory: {},
                graphics: [],
                disks: [],
              },
            });
          throw Error(`Unexpected API request: ${path}`);
        });
        const page = await context.newPage();
        page.setDefaultTimeout(12000);
        page.on('pageerror', (e) => errors.push(e.message));
        const name = `${theme}-${mode}-${width}`;
        console.log(`${name} starting`);
        await page.goto(`${base}/system`);
        await page.waitForURL('**/system/overview');
        const overview = page.locator('app-system-overview');
        await overview.locator('app-system-fan-row').filter({ hasText: 'fan1' }).waitFor();
        assert.equal(await overview.locator('app-system-sensor-card').count(), 22);
        const fans = overview.locator('app-system-fan-row');
        assert.equal(await fans.count(), 4);
        assert.equal(await fans.locator('.spinning').count(), 2);
        assert.equal(await fans.locator('.danger').count(), 2);
        const stoppedIcon = fans.filter({ hasText: 'fan2' }).locator('.fan-icon');
        assert.equal(await stoppedIcon.evaluate((el) => {
          const probe = document.createElement('span');
          probe.style.backgroundColor = 'var(--kida-muted)';
          el.appendChild(probe);
          const matches = getComputedStyle(el).backgroundColor === getComputedStyle(probe).backgroundColor;
          probe.remove();
          return matches;
        }), true);
        assert.match(await fans.filter({ hasText: 'unknown-fan' }).innerText(), /Fallo: Desconocido/);
        assert.doesNotMatch(await fans.first().innerText(), /Temperatura/);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(await fans.first().locator('svg').evaluate((el) => getComputedStyle(el).animationName), 'none');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        assert.notEqual(await fans.first().locator('svg').evaluate((el) => getComputedStyle(el).animationName), 'none');
        assert.equal(await overview.locator('.compact').count(), 14);
        assert.deepEqual(reads, { health: 1, wake: 1 });
        assert.equal(await page.locator('ion-tab-bar').getAttribute('slot'), 'top');
        assert.deepEqual(
          await page.evaluate(() => [
            document.documentElement.dataset.theme,
            document.documentElement.dataset.mode,
          ]),
          [theme, mode],
        );
        await page.screenshot({ path: `${output}/${name}-overview.png` });
        await page.locator('ion-tab-button[tab="sensors"]').click();
        await page.waitForURL('**/system/sensors');
        const inspector = page.locator('app-system-inspector');
        await inspector.locator('#sensor-search').fill('search-me');
        assert.equal(await inspector.locator('tbody tr').count(), 1);
        await inspector.locator('#sensor-search').fill('duplicate');
        assert.equal(await inspector.locator('tbody tr').count(), 2);
        await inspector.locator('#sensor-search').fill('');
        assert.equal(await inspector.locator('tbody tr').count(), 26);
        await inspector.locator('.table-wrap').focus();
        await page.keyboard.press('ArrowRight');
        await page.screenshot({ path: `${output}/${name}-sensors.png` });
        await page.locator('ion-tab-button[tab="energy"]').click();
        await page.waitForURL('**/system/energy');
        const energy = page.locator('app-system-energy');
        await energy.getByText('Permiso denegado', { exact: false }).waitFor();
        assert.deepEqual(reads, { health: 1, wake: 1 });
        const shutdown = energy.getByRole('button', { name: 'Apagar', exact: true });
        await shutdown.focus();
        await page.keyboard.press('Enter');
        const alert = page.locator('ion-alert.system-confirmation');
        await alert.waitFor();
        await page.waitForFunction(() =>
          document.activeElement?.classList.contains('alert-button-role-cancel'),
        );
        assert.ok((await alert.innerText()).includes('Cuándo: +1'));
        for (let i = 0; i < 4; i++) {
          await page.keyboard.press('Tab');
          assert.ok(await alert.evaluate((el) => el.contains(document.activeElement)));
        }
        await alert.getByRole('button', { name: 'Cancelar', exact: true }).click();
        await alert.waitFor({ state: 'detached' });
        await page.waitForFunction(() => document.activeElement?.textContent.trim() === 'Apagar');
        assert.equal(writes.length, 0);
        await energy.getByRole('radio', { name: 'Segundos desde la ejecución' }).check();
        assert.equal(await energy.locator('#wake-time').count(), 0);
        await energy.locator('#wake-seconds').fill('119');
        assert.equal(
          await energy.getByRole('button', { name: 'Ciclo de energía', exact: true }).isDisabled(),
          true,
        );
        await energy.locator('#wake-seconds').fill('120');
        await energy.getByRole('button', { name: 'Ciclo de energía', exact: true }).click();
        await alert.waitFor();
        assert.ok((await alert.innerText()).includes('120 segundos'));
        await alert.getByRole('button', { name: 'Cancelar', exact: true }).click();
        await alert.waitFor({ state: 'detached' });
        await page.screenshot({ path: `${output}/${name}-energy.png` });
        for (const selector of [
          'app-system-overview',
          'app-system-inspector',
          'app-system-energy',
        ]) {
          // Cached tabs are checked after activation below; only visible pages participate in layout.
          if (await page.locator(selector).isVisible())
            assert.ok(
              await page.locator(selector).evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
              `${name} ${selector} overflow`,
            );
        }
        await page.goBack();
        await page.waitForURL('**/system/sensors');
        await page.goForward();
        await page.waitForURL('**/system/energy');
        assert.deepEqual(reads, { health: 1, wake: 1 });
        await page.waitForFunction(
          () => [...document.querySelectorAll('app-system-energy')].length === 1,
        );
        // Exercise confirmation and uncertainty only against the intercepted API.
        await energy.getByRole('button', { name: 'Reiniciar', exact: true }).click();
        await alert.waitFor();
        await alert.getByRole('button', { name: 'Confirmar', exact: true }).click();
        await energy.getByText('Ejecución incierta', { exact: false }).waitFor();
        assert.deepEqual(writes, [{ path: '/api/system/reboot', body: { when: '+1' } }]);
        await page.locator('ion-tab-button[tab="overview"]').click();
        await page.waitForURL('**/system/overview');
        assert.ok(
          await overview.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          `${name} overview overflow`,
        );
        failHealth = true;
        await overview.getByRole('button', { name: 'Actualizar Salud y sensores' }).click();
        await overview.getByText('Datos anteriores', { exact: false }).waitFor();
        assert.equal(await overview.locator('app-system-sensor-card').count(), 22);
        failHealth = false;
        emptyHealth = true;
        await overview.getByRole('button', { name: 'Actualizar Salud y sensores' }).click();
        await page.waitForFunction(
          () =>
            document.querySelectorAll('app-system-overview app-system-sensor-card').length === 0,
        );
        assert.equal(reads.wake, 1);
        // Direct route reload exercises parent/child lifecycle order without tab history.
        await page.goto(`${base}/system/energy`);
        await energy.getByRole('button', { name: 'Apagar', exact: true }).click();
        await alert.waitFor();
        // A route change invalidates an open dialog; never confirm it after leaving.
        await page.evaluate(() => document.querySelector('ion-tab-button[tab="sensors"]').click());
        await page.waitForURL('**/system/sensors');
        await alert.waitFor({ state: 'detached' });
        assert.equal(writes.length, 1);
        await page.screenshot({ path: `${output}/${name}-empty.png` });
        // Reenter the cached System container from another ARCA page using history.
        const beforeReturn = { ...reads };
        if (width < 992) {
          await page.evaluate(() => {
            window.systemDrawerReady = false;
            document.addEventListener(
              'ionDidOpen',
              () => {
                window.systemDrawerReady = true;
              },
              { once: true },
            );
          });
        }
        await page
          .locator('arca-menu-item [tabindex]')
          .filter({ hasText: 'Settings' })
          .first()
          .evaluate((el) => el.click());
        await page.waitForURL('**/settings');
        if (width < 992) {
          await page.waitForFunction(() => window.systemDrawerReady);
          await page
            .locator('ion-menu')
            .evaluateAll((menus) => Promise.all(menus.map((menu) => menu.close())));
        }
        await page.goBack();
        await page.waitForURL('**/system/sensors');
        await inspector.getByText('Última actualización:', { exact: false }).waitFor();
        assert.deepEqual(reads, { health: beforeReturn.health + 1, wake: beforeReturn.wake + 1 });
        // Activate a tab through its native keyboard link, then cancel a power dialog.
        await page.locator('ion-tab-button[tab="energy"] a').focus();
        await page.keyboard.press('Enter');
        await page.waitForURL('**/system/energy');
        await page.waitForFunction(
          () => document.querySelectorAll('app-system-energy').length === 1,
        );
        await energy.getByRole('button', { name: 'Apagar', exact: true }).click();
        await alert.waitFor();
        await alert.getByRole('button', { name: 'Cancelar', exact: true }).click();
        await alert.waitFor({ state: 'detached' });
        assert.equal(writes.length, 1);
        assert.deepEqual(errors, []);
        results.push({ theme, mode, width, reads, writes: writes.length, errors });
        console.log(`${name} passed`);
        await context.close();
      }
    await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
    console.log(`Passed ${results.length} theme/viewport combinations`);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
