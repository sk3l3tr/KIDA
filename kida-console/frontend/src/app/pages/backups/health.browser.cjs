/* Fully intercepted API. Never contacts CORE or performs real Health operations. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BACKUPS_TEST_URL || 'http://127.0.0.1:4227';
const output = process.env.HEALTH_TEST_OUTPUT || '/tmp/kida-backups-health-evidence';
const combinations = [
  ['professional', 'light'],
  ['professional', 'dark'],
  ['neobrutalism', 'light'],
  ['neobrutalism', 'dark'],
  ['sakura', 'light'],
  ['sakura', 'dark'],
  ['tokyo', 'dark'],
];
const remote = '<img src=x onerror="window.healthInjected=true">';
(async () => {
  const fixture = JSON.parse(
    await fs.readFile(
      path.resolve(__dirname, '../../../../../../tests/fixtures/backup-health.json'),
      'utf8',
    ),
  );
  const run = { ...fixture.closed, run_id: 'health /?&+#ñ', state: 'FUTURE_STATE', future: null };
  run.definition.name = remote + 'x'.repeat(180);
  run.diagnosis.evidence[0].logs = remote;
  run.resources = [{ kind: 'volume', identity: 'retained-resource' }];
  const record = {
    ...run,
    record_version: 1,
    report_status: 'FUTURE_REPORT',
    restore_provenance: {
      path: '/tmp/restored',
      identity: { device: 9007199254740992, inode: 1 },
      future: null,
    },
  };
  const config = {
    id: 'backup',
    name: 'backup',
    sources: [],
    targets: [],
    compression: 'tar_zstd',
    lifecycle: { pre_backup: [], post_backup: [] },
  };
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const results = [];
  try {
    for (const mobile of [false, true])
      for (const [theme, mode] of combinations) {
        console.log(`${theme}/${mode}/${mobile ? 'mobile' : 'desktop'} starting`);
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
        let rows = [structuredClone(record)],
          failHistory = false,
          failDetail = false,
          createFailure = 0,
          expire = false,
          releaseCreate = null,
          holdCreate = false;
        const details = new Map([[run.run_id, run]]),
          writes = [],
          reads = [],
          errors = [];
        await context.route('**/api/**', async (route) => {
          const request = route.request(),
            url = new URL(request.url());
          if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
          if (url.pathname.startsWith('/api/auth/'))
            return route.fulfill({
              json: { user: { id: 991, username: 'health-test' }, csrf_token: 'health-csrf' },
            });
          assert.ok(url.pathname.startsWith('/api/backup/'), `Unexpected API ${url.pathname}`);
          if (request.method() === 'GET') {
            reads.push({ path: url.pathname, search: url.search });
            if (expire) {
              expire = false;
              return route.fulfill({ status: 401, json: { detail: 'expired' } });
            }
            if (url.pathname === '/api/backup/config')
              return route.fulfill({ json: { backups: [config] } });
            if (url.pathname === '/api/backup/health') {
              if (failHistory) {
                failHistory = false;
                return route.fulfill({
                  status: 503,
                  json: { detail: { code: 'core_unavailable' } },
                });
              }
              return route.fulfill({ json: rows });
            }
            assert.equal(url.pathname, '/api/backup/health/get');
            const id = url.searchParams.get('run_id');
            assert.equal(url.search, `?run_id=${encodeURIComponent(id)}`);
            assert.ok(details.has(id));
            if (failDetail) {
              failDetail = false;
              return route.fulfill({ status: 503, json: { detail: { code: 'core_unavailable' } } });
            }
            return route.fulfill({ json: details.get(id) });
          }
          assert.equal(request.method(), 'POST');
          assert.equal(url.pathname, '/api/backup/health/create');
          assert.equal(request.headers()['x-csrf-token'], 'health-csrf');
          const body = request.postDataJSON();
          assert.deepEqual(Object.keys(body).sort(), ['definition_path', 'mode']);
          writes.push({ path: url.pathname, body });
          if (holdCreate) {
            holdCreate = false;
            await new Promise((resolve) => {
              releaseCreate = resolve;
            });
          }
          if (createFailure) {
            const status = createFailure;
            createFailure = 0;
            return route.fulfill({
              status,
              json: {
                detail: { code: status === 502 ? 'core_error' : 'core_timeout', message: remote },
              },
            });
          }
          const created = {
            ...structuredClone(fixture.created),
            ...body,
            run_id: `created-${writes.length}`,
            future: null,
          };
          details.set(created.run_id, created);
          rows.push({
            ...created,
            record_version: 1,
            report_status: 'PENDING',
            restore_provenance: null,
          });
          return route.fulfill({ json: created });
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`${base}/backups`);
        const view = page.locator('app-backups'),
          health = view.locator('app-backup-health');
        const refresh = health.getByRole('button', {
          name: 'Actualizar historial Health',
          exact: true,
        });
        const submit = health.getByRole('button', { name: 'Crear Health', exact: true });
        const input = health.getByLabel('Ruta de definición en CORE', { exact: true });
        const modeSelect = health.getByLabel('Modo de Health', { exact: true });
        const configRefresh = view.getByRole('button', {
          name: 'Actualizar configuraciones',
          exact: true,
        });
        const idle = () =>
          page.waitForFunction(() => {
            const button = document.querySelector('app-backup-health .section-header button');
            return !!button && !button.disabled;
          });
        const overflow = async () => {
          const sizes = await view.locator('ion-content').evaluate(async (content) => {
            const scroll = await content.getScrollElement(),
              layout = content.querySelector('.console-layout');
            return [
              document.documentElement.scrollWidth <= innerWidth,
              scroll.scrollWidth <= scroll.clientWidth,
              layout.scrollWidth <= layout.clientWidth,
            ];
          });
          assert.ok(sizes.every(Boolean), `Overflow ${theme}/${mode}/${mobile}: ${sizes}`);
        };
        await refresh.waitFor();
        await idle();
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        assert.equal(await page.locator('html').getAttribute('data-mode'), mode);
        const select = health.getByRole('button', {
          name: `Ver Health ${run.run_id}`,
          exact: true,
        });
        await select.focus();
        await page.keyboard.press('Enter');
        await idle();
        await health
          .getByRole('heading', { name: `Detalle de Health: ${run.run_id}`, exact: true })
          .waitFor();
        let text = await health.innerText();
        for (const value of [
          'FUTURE_STATE',
          'FUTURE_REPORT',
          'Precisión limitada',
          'retained-resource',
          'Docker unavailable',
          'validación funcional',
          remote,
        ])
          assert.ok(text.includes(value), value);
        await health.getByText('Ejecución completa (JSON)', { exact: true }).click();
        await health.getByText('Registro de historial completo (JSON)', { exact: true }).click();
        assert.equal(await health.locator('img,script').count(), 0);
        await overflow();
        await health
          .getByRole('heading', { name: 'Diagnóstico', exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `${output}/${theme}-${mode}-${mobile ? 'mobile' : 'desktop'}-detail.png`,
          fullPage: true,
        });
        // Snapshot, keyboard and theme changes in the existing configuration dialog.
        await view.getByRole('button', { name: 'Solicitar backup backup', exact: true }).click();
        const dialog = view.getByRole('dialog');
        await dialog.waitFor();
        assert.ok(await submit.isDisabled());
        assert.equal(
          await page.evaluate(() => document.activeElement?.textContent.trim()),
          'Cancelar',
        );
        await page.keyboard.press('Shift+Tab');
        assert.equal(
          await page.evaluate(() => document.activeElement?.textContent.trim()),
          'Confirmar',
        );
        await page.keyboard.press('Tab');
        assert.equal(
          await page.evaluate(() => document.activeElement?.textContent.trim()),
          'Cancelar',
        );
        await page.locator('html').evaluate(
          (html, theme) => {
            html.dataset.theme = theme;
          },
          theme === 'professional' ? 'sakura' : 'professional',
        );
        await page.screenshot({
          path: `${output}/${theme}-${mode}-${mobile ? 'mobile' : 'desktop'}-dialog.png`,
        });
        await page.locator('html').evaluate((html, theme) => {
          html.dataset.theme = theme;
        }, theme);
        await page.keyboard.press('Escape');
        assert.equal(writes.length, 0);
        failHistory = true;
        await refresh.click();
        await idle();
        await health
          .getByRole('alert')
          .filter({ hasText: 'Error de actualización del historial' })
          .waitFor();
        assert.ok((await health.innerText()).includes('Historial anterior, desactualizado'));
        failDetail = true;
        await refresh.click();
        await idle();
        await health.getByRole('alert').filter({ hasText: 'Error de detalle Health' }).waitFor();
        assert.ok((await health.innerText()).includes('Detalle anterior, desactualizado'));
        await refresh.click();
        await idle();
        assert.equal(await health.getByRole('alert').count(), 0);
        // Manual creation: held response proves the cross-panel lock and duplicate protection.
        await input.fill(' ./health/../manual.toml ');
        await modeSelect.selectOption('MANUAL');
        holdCreate = true;
        await submit.click();
        await page.waitForTimeout(100);
        assert.ok(await submit.isDisabled());
        assert.ok(await configRefresh.isDisabled());
        assert.ok(
          await view
            .getByRole('button', { name: 'Solicitar backup backup', exact: true })
            .isDisabled(),
        );
        assert.equal(writes.length, 1);
        assert.ok(releaseCreate);
        releaseCreate();
        releaseCreate = null;
        await idle();
        assert.deepEqual(writes[0].body, {
          definition_path: ' ./health/../manual.toml ',
          mode: 'MANUAL',
        });
        assert.equal(await input.inputValue(), '');
        await page.waitForFunction(
          () => document.activeElement?.textContent.trim() === 'Crear Health',
        );
        assert.ok((await health.getByRole('status').innerText()).includes('Crear no inicia'));
        assert.ok((await health.innerText()).includes('created-1'));
        // Automatic create still only creates, even if its refresh fails.
        await input.fill(' /srv/automatic.toml ');
        await modeSelect.selectOption('AUTOMATIC');
        failHistory = true;
        await submit.focus();
        await page.keyboard.press('Enter');
        await idle();
        assert.deepEqual(writes[1].body, {
          definition_path: ' /srv/automatic.toml ',
          mode: 'AUTOMATIC',
        });
        assert.ok((await health.getByRole('status').innerText()).includes('created-2'));
        await health
          .getByRole('alert')
          .filter({ hasText: 'Error de actualización del historial' })
          .waitFor();
        assert.equal(await input.inputValue(), '');
        await input.fill(' /srv/rejected.toml ');
        await modeSelect.selectOption('AUTOMATIC');
        createFailure = 502;
        await submit.click();
        await idle();
        await health.getByRole('alert').filter({ hasText: 'CORE rechazó' }).waitFor();
        assert.equal(await input.inputValue(), ' /srv/rejected.toml ');
        await page.waitForFunction(
          () => document.activeElement?.textContent.trim() === 'Crear Health',
        );
        createFailure = 504;
        await submit.click();
        await idle();
        const warning = health
          .getByRole('alert')
          .filter({ hasText: 'No se pudo confirmar la creación' });
        await warning.waitFor();
        await page.waitForFunction(
          () => document.activeElement?.textContent.trim() === 'Crear Health',
        );
        assert.ok((await warning.innerText()).includes('AUTOMATIC'));
        await refresh.click();
        await idle();
        assert.ok(await warning.isVisible());
        assert.equal(writes.length, 4);
        await submit.click();
        await idle();
        assert.ok(await warning.isVisible());
        assert.equal(writes.length, 5);
        // Selection disappearance only clears on a successful fresh history response.
        rows = [];
        await refresh.click();
        await idle();
        await health.getByText('No hay ejecuciones de Health.', { exact: true }).waitFor();
        assert.equal(await health.getByRole('heading', { name: /^Detalle de Health:/ }).count(), 0);
        await overflow();
        await health
          .getByRole('heading', { name: 'Crear Health', exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `${output}/${theme}-${mode}-${mobile ? 'mobile' : 'desktop'}-form.png`,
          fullPage: true,
        });
        const navigate = async (title) => {
          if (mobile) await page.locator('ion-menu-button').click();
          await page.locator('arca-menu-item').getByText(title, { exact: true }).click();
        };
        await input.fill(' cached form ');
        await navigate('Dashboard');
        await page.waitForURL('**/dashboard');
        await page.waitForFunction(
          () => document.querySelectorAll('app-backups form').length === 0,
        );
        rows = [structuredClone(record)];
        await navigate('Backups');
        await page.waitForURL('**/backups');
        await refresh.waitFor();
        await idle();
        assert.equal(await input.inputValue(), '');
        assert.equal(await health.getByRole('alert').count(), 0);
        expire = true;
        await refresh.click();
        await page.waitForURL((url) => url.pathname === '/login');
        await page.waitForFunction(
          () =>
            document.querySelectorAll(
              'app-backups form, app-backups .backup-list li, app-backup-health',
            ).length === 0,
        );
        assert.equal(await page.evaluate(() => window.healthInjected), undefined);
        assert.deepEqual(errors, []);
        results.push({ theme, mode, mobile, writes, reads, errors });
        console.log(`${theme}/${mode}/${mobile ? 'mobile' : 'desktop'} passed`);
        await context.close();
      }
    await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
