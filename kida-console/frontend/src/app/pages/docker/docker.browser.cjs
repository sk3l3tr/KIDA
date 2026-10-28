/* Isolated ng serve + existing Playwright/Chromium; all API requests intercepted before navigation. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DOCKER_TEST_URL || 'http://localhost:4227';
const output = process.env.DOCKER_TEST_OUTPUT || '/tmp/kida-docker-evidence';
const combinations = [
  ['professional', 'light'],
  ['professional', 'dark'],
  ['neobrutalism', 'light'],
  ['neobrutalism', 'dark'],
  ['sakura', 'light'],
  ['sakura', 'dark'],
  ['tokyo', 'dark'],
];
const remote = '<img src=x onerror="window.dockerInjected=true">';
const id = 'f'.repeat(64);
const container = {
  id,
  name: remote,
  image: 'image:future',
  online: false,
  status: 'future-status',
  health: null,
  started_at: null,
  finished_at: null,
  exit_code: 0,
  restart_count: 2 ** 64 - 1,
  restart_policy: null,
  ports: [{ container_port: 0, protocol: 'future', host_ip: null, host_port: null }],
  networks: [{ name: 'network', ip_address: null, gateway: null, mac_address: null }],
  future: remote,
};
const project = {
  name: 'project /?&+#ñ',
  services: [{ name: null, containers: [container] }],
  future: null,
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
        let containers = [structuredClone(container)],
          projects = [structuredClone(project)];
        let failList = false,
          failProjects = false,
          uncertain = false,
          expireVersion = false;
        const writes = [],
          reads = [];
        await context.route('**/api/**', async (route) => {
          const request = route.request(),
            url = new URL(request.url());
          if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
          if (!url.pathname.startsWith('/api/docker'))
            return route.fulfill({
              json: { user: { id: 991, username: 'docker-test' }, csrf_token: 'isolated-test' },
            });
          if (request.method() === 'GET') {
            reads.push(url.pathname);
            if (url.pathname.endsWith('/containers')) {
              if (failList) {
                failList = false;
                return route.fulfill({
                  status: 503,
                  json: { detail: { code: 'core_unavailable' } },
                });
              }
              return route.fulfill({ json: { total: 99, running: 0, containers } });
            }
            if (url.pathname.endsWith('/version')) {
              if (expireVersion) return route.fulfill({ status: 401, json: { detail: 'expired' } });
              return route.fulfill({ json: { version: 'simulated-future', extra: null } });
            }
            if (url.pathname.endsWith('/inspect')) {
              assert.equal(url.searchParams.get('project'), project.name);
              assert.ok(request.url().endsWith(`project=${encodeURIComponent(project.name)}`));
              return route.fulfill({ json: project });
            }
            assert.equal(url.pathname, '/api/docker/compose/projects');
            if (failProjects) {
              failProjects = false;
              return route.fulfill({ status: 503, json: { detail: { code: 'core_unavailable' } } });
            }
            return route.fulfill({ json: projects });
          }
          assert.equal(request.method(), 'POST');
          assert.equal(request.headers()['x-csrf-token'], 'isolated-test');
          assert.deepEqual(request.postDataJSON(), { container: id });
          const action = url.pathname.split('/').at(-1);
          assert.ok(['start', 'stop', 'restart', 'delete'].includes(action));
          writes.push(action);
          if (uncertain) {
            uncertain = false;
            return route.fulfill({ status: 504, json: { detail: { code: 'core_timeout' } } });
          }
          if (action === 'delete') {
            containers = [];
            projects = [];
          }
          return route.fulfill({
            json: { container: 'canonical-id', status: `future-${action}`, extra: remote },
          });
        });
        const page = await context.newPage();
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`${base}/docker`);
        await page.waitForURL('**/docker/projects');
        const tab = (name) => page.getByRole('tab', { name, exact: true });
        await page.getByRole('button', { name: `Inspeccionar proyecto ${project.name}`, exact: true }).waitFor();
        const initialReads = reads.length;
        await tab('Contenedores').click();
        await page.waitForURL('**/docker/containers');
        assert.equal(reads.length, initialReads);
        await page.goBack();
        await page.waitForURL('**/docker/projects');
        await page.goForward();
        await page.waitForURL('**/docker/containers');
        assert.equal(reads.length, initialReads);
        const inventory = page.locator('app-docker .ion-page:not(.ion-page-hidden) .container-list');
        const action = (name) =>
          inventory.getByRole('button', { name: `${name} contenedor ${remote}`, exact: true });
        const dialog = page.getByRole('dialog');
        const refresh = page.getByRole('button', { name: 'Actualizar contenedores', exact: true });
        await action('Arrancar').waitFor();
        await page.waitForFunction(
          () => !document.querySelector('.container-list button').disabled,
        );
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        assert.equal(await page.locator('html').getAttribute('data-mode'), mode);
        assert.ok((await inventory.innerText()).includes(remote));
        assert.ok((await inventory.innerText()).includes('future-status'));
        assert.equal(await page.locator('app-docker img').count(), 0);
        await inventory.getByText(`Detalles del contenedor ${remote}`, { exact: true }).click();
        assert.ok((await inventory.innerText()).includes('Salida: 0'));
        assert.ok((await inventory.innerText()).includes('precisión limitada'));
        await tab('Proyectos').click();
        await page
          .getByRole('button', { name: `Inspeccionar proyecto ${project.name}`, exact: true })
          .click();
        await page
          .getByRole('heading', { name: `Inspección: ${project.name}`, exact: true })
          .waitFor();
        assert.ok(await page.locator('app-docker app-container-details:visible').count() >= 1);
        await tab('Contenedores').click();
        await page.waitForURL('**/docker/containers');
        assert.equal(reads.filter((r) => r.endsWith('/inspect')).length, 1);

        const checkOverflow = async () => {
          const measurements = await page
            .locator('app-docker .ion-page:not(.ion-page-hidden) ion-content').last()
            .evaluate(async (content) => {
              const scroll = await content.getScrollElement();
              const layout = content.querySelector('.docker-layout');
              return {
                scrollWidth: scroll.scrollWidth,
                scrollClient: scroll.clientWidth,
                layoutWidth: layout.scrollWidth,
                layoutClient: layout.clientWidth,
              };
            });
          assert.ok(
            measurements.scrollWidth <= measurements.scrollClient,
            JSON.stringify(measurements),
          );
          assert.ok(
            measurements.layoutWidth <= measurements.layoutClient,
            JSON.stringify(measurements),
          );
        };
        await checkOverflow();
        await page.locator('app-docker .ion-page:not(.ion-page-hidden) ion-content').last().evaluate(async (content) => {
          (await content.getScrollElement()).scrollTop = 0;
        });
        await page.screenshot({
          path: `${output}/${theme}-${mode}-${mobile ? 'mobile' : 'desktop'}-page.png`,
          fullPage: true,
        });
        await action('Parar').click();
        await dialog.waitFor();
        assert.ok((await dialog.innerText()).includes(id));
        assert.ok((await dialog.innerText()).includes(remote));
        assert.equal(await dialog.locator('img').count(), 0);
        assert.equal(
          await page.evaluate(() => document.activeElement?.textContent?.trim()),
          'Cancelar',
        );
        await page.keyboard.press('Shift+Tab');
        assert.equal(
          await page.evaluate(() => document.activeElement?.textContent?.trim()),
          'Confirmar',
        );
        await page.keyboard.press('Tab');
        assert.equal(
          await page.evaluate(() => document.activeElement?.textContent?.trim()),
          'Cancelar',
        );
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(writes.length, 0);
        await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Parar');
        await action('Reiniciar').click();
        await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
        assert.equal(writes.length, 0);
        await action('Arrancar').click();
        await page
          .getByText('Respuesta de CORE: canonical-id · future-start', { exact: true })
          .waitFor();
        await page.waitForFunction(
          () => !document.querySelector('.container-list button').disabled,
        );
        assert.deepEqual(writes, ['start']);
        for (const [label, name] of [
          ['Parar', 'stop'],
          ['Reiniciar', 'restart'],
        ]) {
          await action(label).click();
          await page.keyboard.press('Tab');
          await page.keyboard.press('Enter');
          await page
            .getByText(`Respuesta de CORE: canonical-id · future-${name}`, { exact: true })
            .waitFor();
          await page.waitForFunction(
            () => !document.querySelector('.container-list button').disabled,
          );
        }
        failList = true;
        failProjects = true;
        await action('Arrancar').click();
        await page.getByRole('alert').filter({ hasText: 'Error de actualización' }).waitFor();
        assert.ok(
          await page
            .getByText('Respuesta de CORE: canonical-id · future-start', { exact: true })
            .isVisible(),
        );
        assert.ok(
          await page.getByText('Datos anteriores, desactualizados;', { exact: false }).isVisible(),
        );
        await refresh.click();
        await page.waitForFunction(
          () => !document.querySelector('.container-list button').disabled,
        );
        uncertain = true;
        await action('Arrancar').click();
        await page
          .getByRole('alert')
          .filter({ hasText: 'No se pudo confirmar el resultado' })
          .waitFor();
        assert.ok(await action('Arrancar').isDisabled());
        assert.equal(writes.length, 5);
        await refresh.click();
        await page.waitForFunction(
          () => !document.querySelector('.container-list button').disabled,
        );
        assert.ok(
          await page.getByRole('alert').filter({ hasText: 'No se pudo confirmar' }).isVisible(),
        );
        await action('Eliminar').click();
        assert.ok((await dialog.innerText()).includes('irreversible'));
        // Cross-tab appearance update exercises the real theme service with a modal open.
        const alternative = theme === 'sakura' ? 'professional' : 'sakura';
        await page.evaluate(
          ({ theme, mode }) => {
            const key = 'kida:appearance:account:991';
            localStorage.setItem(key, JSON.stringify({ version: 1, theme, mode }));
            dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
          },
          { theme: alternative, mode },
        );
        await page.waitForFunction(
          (t) => document.documentElement.dataset.theme === t,
          alternative,
        );
        assert.ok(await dialog.isVisible());
        assert.equal(await page.evaluate(() => !!document.activeElement?.closest('dialog')), true);
        await page.evaluate(
          ({ theme, mode }) => {
            const key = 'kida:appearance:account:991';
            localStorage.setItem(key, JSON.stringify({ version: 1, theme, mode }));
            dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
          },
          { theme, mode },
        );
        await page.waitForFunction((t) => document.documentElement.dataset.theme === t, theme);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        assert.equal(await dialog.evaluate((e) => e.scrollWidth > e.clientWidth), false);
        await checkOverflow();
        await page.screenshot({
          path: `${output}/${theme}-${mode}-${mobile ? 'mobile' : 'desktop'}.png`,
          fullPage: true,
        });
        await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
        await page.getByText('No hay contenedores.', { exact: true }).waitFor();
        await page.waitForFunction(
          () => document.activeElement?.textContent?.trim() === 'Docker',
        );
        assert.equal(
          await page
            .getByRole('heading', { name: `Inspección: ${project.name}`, exact: true })
            .count(),
          0,
        );
        assert.equal(await page.evaluate(() => window.dockerInjected), undefined);
        assert.deepEqual(writes, ['start', 'stop', 'restart', 'start', 'start', 'delete']);
        for (const path of [
          '/containers',
          '/compose/version',
          '/compose/projects',
          '/compose/projects/inspect',
        ])
          assert.ok(reads.includes('/api/docker' + path));

        // Actual routed navigation reuses Ionic pages and reloads on re-entry.
        const navigate = async (title) => {
          if (mobile) await page.locator('ion-menu-button').click();
          await page.locator('arca-menu-item').getByText(title, { exact: true }).click();
        };
        await navigate('Backups');
        await page.waitForURL('**/backups');
        containers = [structuredClone(container)];
        projects = [structuredClone(project)];
        await navigate('Docker');
        await page.waitForURL('**/docker/projects');
        await tab('Contenedores').click();
        await page.waitForURL('**/docker/containers');
        await action('Eliminar').waitFor();
        await page.waitForFunction(
          () => !document.querySelector('.container-list button').disabled,
        );
        await action('Eliminar').click();
        await dialog.waitFor();
        const writesBeforeTab = writes.length;
        await page.goBack();
        await page.waitForURL('**/docker/projects');
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(writes.length, writesBeforeTab);
        await page.goto(`${base}/docker/containers`);
        await page.waitForURL('**/docker/containers');
        await action('Eliminar').waitFor();
        await page.reload();
        await page.waitForURL('**/docker/containers');
        await action('Eliminar').waitFor();
        expireVersion = true;
        await page.getByRole('button', { name: 'Actualizar versión', exact: true }).click();
        await page.waitForURL((url) => url.pathname === '/login');
        assert.equal(await page.locator('app-docker dialog[open]').count(), 0);
        evidence.push({
          theme,
          mode,
          mobile,
          writes,
          reads,
          checks: [
            'eight-contracts',
            'csrf',
            'full-id',
            'safe-text',
            'nullable-future',
            'unsafe-integer',
            'confirmation',
            'cancel-escape',
            'keyboard-focus',
            'focus-after-delete',
            'theme-in-dialog',
            'stale-refresh',
            'uncertainty-no-retry',
            'project-disappearance',
            'navigation-reentry',
            'session-expiry',
            'no-overflow',
            'ionic-scroll-no-overflow',
          ],
        });
        await context.close();
        console.log(`${theme}/${mode}/${mobile ? 'mobile' : 'desktop'} passed`);
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
