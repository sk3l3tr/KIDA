/* Run against an isolated ng serve; every API response is mocked before navigation.
 * PLAYWRIGHT_MODULE points to an existing Playwright installation (no app dependency).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SCHEDULER_TEST_URL || 'http://127.0.0.1:4226';
const output = process.env.SCHEDULER_TEST_OUTPUT || '/tmp/kida-scheduler-evidence';
const combinations = [
  ['professional', 'light'],
  ['professional', 'dark'],
  ['neobrutalism', 'light'],
  ['neobrutalism', 'dark'],
  ['sakura', 'light'],
  ['sakura', 'dark'],
  ['tokyo', 'dark'],
];
const html = '<img src=x onerror="window.schedulerInjected=true">';
const user = {
  id: 'c6482104-f062-44d2-9fbe-53942c708567',
  origin: 'USER',
  command: 'system.info',
  params: null,
  schedule: { type: 'interval', seconds: 60 },
  next_enqueue_at: '2030-01-01T12:00:00Z',
  future: { text: html },
};
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const evidence = [],
    errors = [];
  try {
    for (const mobile of [false, true])
      for (const [theme, mode] of combinations) {
        const context = await browser.newContext({
          viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
          timezoneId: 'Europe/Madrid',
          reducedMotion: 'reduce',
        });
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
        let entries = [
          structuredClone(user),
          { ...structuredClone(user), id: 'internal', origin: 'INTERNAL' },
          { ...structuredClone(user), id: 'future', origin: 'FUTURE' },
        ];
        const writes = [],
          filters = [];
        let failList = false,
          failAfterWrite = false,
          rejectWrite = false;
        await context.route('**/api/**', async (route) => {
          const request = route.request(),
            url = new URL(request.url());
          if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
          if (!url.pathname.startsWith('/api/scheduler'))
            return route.fulfill({
              json: { user: { id: 991, username: 'scheduler-test' }, csrf_token: 'isolated-test' },
            });
          if (request.method() === 'GET') {
            const origin = url.searchParams.get('origin');
            assert.ok(['USER', 'INTERNAL', 'ALL'].includes(origin));
            filters.push(origin);
            if (failList) {
              failList = false;
              return route.fulfill({ status: 503, json: { detail: { code: 'core_unavailable' } } });
            }
            return route.fulfill({
              json: entries.filter((e) => origin === 'ALL' || e.origin === origin),
            });
          }
          assert.equal(request.method(), 'POST');
          assert.equal(request.headers()['x-csrf-token'], 'isolated-test');
          const body = request.postDataJSON();
          writes.push({ path: url.pathname, body });
          if (rejectWrite) {
            rejectWrite = false;
            return route.fulfill({ status: 504, json: { detail: { code: 'core_timeout' } } });
          }
          if (failAfterWrite) {
            failAfterWrite = false;
            failList = true;
          }
          if (url.pathname.endsWith('/add')) {
            const created = { ...structuredClone(user), ...body, id: `created-${writes.length}` };
            entries.push(created);
            return route.fulfill({ json: created });
          }
          assert.equal(url.pathname, '/api/scheduler/delete');
          assert.deepEqual(Object.keys(body), ['id']);
          const deleted = entries.find((e) => e.id === body.id);
          assert.equal(deleted.origin, 'USER');
          entries = entries.filter((e) => e.id !== body.id);
          return route.fulfill({ json: deleted });
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`${base}/scheduler`);
        await page.getByText('Origen de los datos visibles: Usuario.', { exact: true }).waitFor();
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        assert.equal(await page.locator('html').getAttribute('data-mode'), mode);
        const create = page.getByRole('button', { name: 'Crear programación', exact: true });
        const dialog = page.getByRole('dialog');
        const controls = await page.evaluate(() => {
          const properties = [
            'backgroundColor',
            'color',
            'borderTopWidth',
            'borderTopColor',
            'borderRadius',
            'padding',
            'fontFamily',
          ];
          return ['#scheduler-command', '#scheduler-origin', '#scheduler-params'].map(
            (selector) => {
              const style = getComputedStyle(document.querySelector(selector));
              return Object.fromEntries(properties.map((property) => [property, style[property]]));
            },
          );
        });
        assert.deepEqual(controls[1], controls[0]);
        assert.deepEqual(controls[2], controls[0]);

        await page.getByLabel('Comando', { exact: true }).fill(html);
        await page.getByLabel('Parámetros JSON', { exact: true }).fill(JSON.stringify({ html }));
        await page.getByLabel('Modalidad').selectOption('interval');
        await page.getByLabel('Intervalo en segundos').fill('60');
        // Opening failures must leave both actions available and send no HTTP write.
        const failNextDialog = () =>
          page.evaluate(() => {
            const showModal = HTMLDialogElement.prototype.showModal;
            HTMLDialogElement.prototype.showModal = function () {
              HTMLDialogElement.prototype.showModal = showModal;
              throw new DOMException('Test opening failure', 'InvalidStateError');
            };
          });
        await failNextDialog();
        await create.click();
        await page
          .getByRole('alert')
          .filter({ hasText: 'No se pudo abrir la confirmación.' })
          .waitFor();
        assert.equal(writes.length, 0);
        assert.ok(await create.isEnabled());
        await create.click();
        await dialog.waitFor();
        assert.ok((await dialog.innerText()).includes(html));
        assert.equal(await dialog.locator('img').count(), 0);
        assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Cancelar');
        for (let i = 0; i < 5; ++i) {
          await page.keyboard.press('Tab');
          assert.ok(await page.evaluate(() => !!document.activeElement?.closest('dialog')));
        }
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(writes.length, 0);
        await page.waitForFunction(
          () => document.activeElement?.textContent?.trim() === 'Crear programación',
        );
        assert.equal(await page.getByLabel('Comando', { exact: true }).inputValue(), html);
        await create.click();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');
        await page.getByText('Programación creada', { exact: true }).waitFor();
        await page.waitForFunction(() => !document.querySelector('#scheduler-origin').disabled);
        await page.waitForFunction(
          () =>
            document.activeElement?.textContent?.trim() === 'Crear programación' &&
            !document.activeElement.disabled,
        );
        assert.equal(writes.length, 1);
        assert.deepEqual(writes[0].body, {
          command: html,
          params: { html },
          schedule: { type: 'interval', seconds: 60 },
        });
        assert.equal(await page.getByLabel('Comando', { exact: true }).inputValue(), '');
        assert.equal(await page.locator('app-scheduler img').count(), 0);
        assert.equal(await page.evaluate(() => window.schedulerInjected), undefined);

        await page.getByLabel('Filtro de origen').selectOption('INTERNAL');
        await page.getByText('Origen de los datos visibles: Interno.', { exact: true }).waitFor();
        assert.equal(await page.locator('.schedule-list button').count(), 0);
        await page.getByLabel('Filtro de origen').selectOption('ALL');
        await page.getByText('Origen de los datos visibles: Todos.', { exact: true }).waitFor();
        assert.equal(await page.locator('.schedule-list button').count(), 2);
        const remove = page.getByRole('button', {
          name: `Eliminar programación ${user.id}`,
          exact: true,
        });
        await failNextDialog();
        await remove.click();
        await page
          .getByRole('alert')
          .filter({ hasText: 'No se pudo abrir la confirmación.' })
          .waitFor();
        assert.equal(writes.length, 1);
        assert.ok(await remove.isEnabled());
        await remove.click();
        assert.ok((await dialog.innerText()).includes('no cancela comandos ya encolados'));
        assert.ok((await dialog.innerText()).includes(user.id));
        await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
        assert.equal(writes.length, 1);
        await remove.click();
        await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
        await page.getByText('Programación eliminada', { exact: true }).waitFor();
        await page.waitForFunction(() => !document.querySelector('#scheduler-origin').disabled);
        await page.waitForFunction(
          () => document.activeElement?.textContent?.trim() === 'Programaciones',
        );
        assert.equal(writes.length, 2);
        assert.equal(filters.at(-1), 'ALL');

        // Actual browser Date behavior for both DST transitions and second precision.
        await page.getByLabel('Comando', { exact: true }).fill('system.info');
        await page.getByLabel('Modalidad').selectOption('once');
        await page.getByLabel('Fecha y hora local', { exact: false }).fill('2030-03-31T02:30:15');
        await create.click();
        await page.getByRole('alert').filter({ hasText: 'no existe' }).waitFor();
        assert.equal(await dialog.count(), 0);
        assert.equal(writes.length, 2);
        await page.getByLabel('Fecha y hora local', { exact: false }).fill('2030-10-27T02:30:15');
        await create.click();
        assert.ok((await dialog.innerText()).includes('UTC+02:00'));
        assert.ok((await dialog.innerText()).includes('2030-10-27T00:30:15.000Z'));
        failAfterWrite = true;
        await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'Error de actualización' }).waitFor();
        assert.ok(await page.getByText('Programación creada', { exact: true }).isVisible());
        assert.ok(
          await page.getByText('Datos anteriores, desactualizados;', { exact: false }).isVisible(),
        );
        assert.equal(writes.length, 3);
        assert.deepEqual(writes[2].body.schedule, { type: 'once', at: '2030-10-27T00:30:15.000Z' });
        await page.getByRole('button', { name: 'Actualizar listado', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('#scheduler-origin').disabled);

        await page.getByLabel('Comando', { exact: true }).fill('system.health');
        await page.getByLabel('Parámetros JSON', { exact: true }).fill('null');
        await page.getByLabel('Modalidad').selectOption('cron');
        await page.getByLabel('Expresión cron').fill('0 2 * * *');
        rejectWrite = true;
        await create.click();
        await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
        await page
          .getByRole('alert')
          .filter({ hasText: 'No se pudo confirmar el resultado' })
          .waitFor();
        assert.equal(writes.length, 4);
        assert.equal(
          await page.getByLabel('Comando', { exact: true }).inputValue(),
          'system.health',
        );
        await create.click();
        assert.ok(
          await page.evaluate(
            () =>
              document.querySelector('dialog').scrollWidth <=
              document.querySelector('dialog').clientWidth,
          ),
        );
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        );
        assert.equal(overflow, false);
        await page.screenshot({
          path: `${output}/${theme}-${mode}-${mobile ? 'mobile' : 'desktop'}.png`,
          fullPage: true,
        });
        await page.keyboard.press('Escape');
        evidence.push({
          theme,
          mode,
          mobile,
          writes: writes.length,
          filters,
          checks: [
            'create',
            'delete',
            'filter',
            'safe-text',
            'keyboard',
            'focus',
            'focus-after-refresh',
            'focus-after-delete',
            'dialog-open-failure',
            'shared-themed-controls',
            'DST-gap',
            'DST-overlap',
            'stale-refresh',
            'uncertain-write',
            'no-retries',
            'no-overflow',
          ],
        });
        await context.close();
      }
    assert.deepEqual(errors, []);
    await fs.writeFile(`${output}/results.json`, JSON.stringify({ evidence, errors }, null, 2));
    console.log(JSON.stringify({ cases: evidence.length, errors, output }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
