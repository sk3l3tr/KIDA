/* Fully intercepted API, including auth. No CORE, backup, Health or Docker operations. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BACKUPS_TEST_URL || 'http://127.0.0.1:4227';
const output = process.env.REPORTS_TEST_OUTPUT || '/tmp/kida-backups-reports-evidence';
const combinations = [
  ['professional', 'light'],
  ['professional', 'dark'],
  ['neobrutalism', 'light'],
  ['neobrutalism', 'dark'],
  ['sakura', 'light'],
  ['sakura', 'dark'],
  ['tokyo', 'dark'],
];
const remote = '<img src=x onerror="window.reportInjected=true">';
const reportId = ` report /?&+#ñ ${remote} `;
const secondId = 'second-report';
const markdown = `# Informe remoto\n\n${remote}\n<script>window.reportInjected=true</script>\n[enlace](javascript:window.reportInjected=true)\n  espacios  exactos\n${'long-remote-text'.repeat(30)}\n`;
(async () => {
  const fixture = JSON.parse(
    await fs.readFile(
      path.resolve(__dirname, '../../../../../../tests/fixtures/backup-health.json'),
      'utf8',
    ),
  );
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
        let ids = [reportId, secondId],
          failList = false,
          failGet = false,
          expire = false,
          failHistory = false,
          deletion = 'false',
          holdDelete = false,
          releaseDelete;
        const writes = [],
          reads = [],
          errors = [];
        await context.route('**/api/**', async (route) => {
          const request = route.request(),
            url = new URL(request.url());
          if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
          if (url.pathname.startsWith('/api/auth/'))
            return route.fulfill({
              json: { user: { id: 991, username: 'reports-test' }, csrf_token: 'reports-csrf' },
            });
          assert.ok(url.pathname.startsWith('/api/backup/'), `Unexpected API ${url.pathname}`);
          if (request.method() === 'GET') {
            reads.push({ path: url.pathname, search: url.search });
            if (expire) {
              expire = false;
              return route.fulfill({ status: 401, json: { detail: 'expired' } });
            }
            if (url.pathname === '/api/backup/config')
              return route.fulfill({ json: { backups: [] } });
            if (url.pathname === '/api/backup/health') {
              if (failHistory) {
                failHistory = false;
                return route.fulfill({
                  status: 503,
                  json: { detail: { code: 'core_unavailable' } },
                });
              }
              return route.fulfill({
                json: [
                  {
                    ...fixture.closed,
                    run_id: reportId,
                    record_version: 1,
                    restore_provenance: null,
                    report_status: ids.includes(reportId) ? 'AVAILABLE' : 'DELETED',
                    report_path: ids.includes(reportId) ? '/reports/test.md' : null,
                  },
                ],
              });
            }
            if (url.pathname === '/api/backup/health/reports') {
              if (failList) {
                failList = false;
                return route.fulfill({
                  status: 503,
                  json: { detail: { code: 'core_unavailable' } },
                });
              }
              return route.fulfill({ json: ids });
            }
            assert.equal(url.pathname, '/api/backup/health/reports/get');
            const id = url.searchParams.get('run_id');
            assert.equal(url.search, `?run_id=${encodeURIComponent(id)}`);
            assert.ok(ids.includes(id));
            if (failGet) {
              failGet = false;
              return route.fulfill({ status: 503, json: { detail: { code: 'core_unavailable' } } });
            }
            return route.fulfill({ json: { run_id: id, markdown, future: null } });
          }
          assert.equal(request.method(), 'POST');
          assert.equal(url.pathname, '/api/backup/health/reports/delete');
          assert.equal(request.headers()['x-csrf-token'], 'reports-csrf');
          const body = request.postDataJSON();
          assert.deepEqual(Object.keys(body), ['run_id']);
          assert.ok(ids.includes(body.run_id));
          writes.push({ path: url.pathname, body });
          if (holdDelete) {
            holdDelete = false;
            await new Promise((resolve) => {
              releaseDelete = resolve;
            });
          }
          if (deletion === 'rejected')
            return route.fulfill({
              status: 502,
              json: { detail: { code: 'core_error', message: remote } },
            });
          if (deletion === 'uncertain')
            return route.fulfill({ status: 504, json: { detail: { code: 'core_timeout' } } });
          if (deletion === 'true') ids = ids.filter((id) => id !== body.run_id);
          return route.fulfill({
            json: { run_id: body.run_id, deleted: deletion === 'true', future: null },
          });
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`${base}/backups`);
        const view = page.locator('app-backups'),
          reports = view.locator('app-backup-reports');
        const refresh = reports.getByRole('button', { name: 'Actualizar informes', exact: true });
        const select = reports.getByRole('button', {
          name: `Ver informe ${reportId}`,
          exact: true,
        });
        const remove = reports.getByRole('button', {
          name: `Eliminar informe ${reportId}`,
          exact: true,
        });
        const dialog = reports.getByRole('dialog', {
          name: 'Confirmar eliminación de informe',
          exact: true,
        });
        const idle = () =>
          page.waitForFunction(() => {
            const button = document.querySelector('app-backup-reports .section-header button');
            return !!button && !button.disabled;
          });
        const overflow = async () => {
          const measurements = await view.locator('ion-content').evaluate(async (content) => {
            const scroll = await content.getScrollElement(),
              layout = content.querySelector('.console-layout');
            const dialog = content.querySelector('app-backup-reports dialog');
            return [
              document.documentElement.scrollWidth <= innerWidth,
              scroll.scrollWidth <= scroll.clientWidth,
              layout.scrollWidth <= layout.clientWidth,
              !dialog?.open || dialog.scrollWidth <= dialog.clientWidth,
            ];
          });
          assert.ok(
            measurements.every(Boolean),
            `Overflow ${theme}/${mode}/${mobile}: ${measurements}`,
          );
        };
        await refresh.waitFor();
        await idle();
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        assert.equal(await page.locator('html').getAttribute('data-mode'), mode);
        await select.focus();
        await page.keyboard.press('Enter');
        await idle();
        await reports.getByRole('heading', { name: `Informe: ${reportId}`, exact: true }).waitFor();
        assert.equal(await reports.getByTestId('report-markdown').textContent(), markdown);
        assert.equal(await reports.locator('img,script,a').count(), 0);
        await overflow();
        await reports.getByTestId('report-markdown').scrollIntoViewIfNeeded();
        const prefix = `${output}/${theme}-${mode}-${mobile ? 'mobile' : 'desktop'}`;
        await page.screenshot({ path: `${prefix}-report.png`, fullPage: true });
        // Failed reads retain the preceding successful content and selection.
        failGet = true;
        await select.click();
        await idle();
        assert.equal(await reports.getByTestId('report-markdown').textContent(), markdown);
        assert.ok((await reports.innerText()).includes('desactualizado'));
        await select.click();
        await idle();
        failList = true;
        await refresh.click();
        await idle();
        assert.equal(await reports.getByTestId('report-markdown').textContent(), markdown);
        await refresh.click();
        await idle();
        await remove.click();
        await dialog.waitFor();
        assert.ok((await dialog.textContent()).includes(reportId));
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
        assert.ok(
          await view
            .getByRole('button', { name: 'Actualizar configuraciones', exact: true })
            .isDisabled(),
        );
        assert.ok(
          await view.getByRole('button', { name: 'Crear Health', exact: true }).isDisabled(),
        );
        assert.ok(
          await reports
            .getByRole('button', { name: `Ver informe ${secondId}`, exact: true })
            .isDisabled(),
        );
        await overflow();
        await page.screenshot({ path: `${prefix}-dialog.png`, fullPage: true });
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(writes.length, 0);
        await page.waitForFunction(() =>
          document.activeElement?.getAttribute('aria-label')?.startsWith('Eliminar informe'),
        );
        await remove.click();
        await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
        assert.equal(writes.length, 0);
        const confirm = async () => {
          await remove.click();
          await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
          await idle();
        };
        // A false response is displayed accurately, even if its follow-up list fails.
        failList = true;
        await confirm();
        assert.equal(writes.length, 1);
        assert.deepEqual(writes[0].body, { run_id: reportId });
        assert.ok(
          (await reports.getByRole('status').innerText()).includes(
            'CORE no confirmó la eliminación del informe',
          ),
        );
        assert.equal(await reports.getByTestId('report-markdown').textContent(), markdown);
        await refresh.click();
        await idle();
        deletion = 'rejected';
        await confirm();
        assert.equal(writes.length, 2);
        assert.ok((await reports.getByRole('alert').innerText()).includes(remote));
        assert.equal(await reports.locator('img,script,a').count(), 0);
        deletion = 'uncertain';
        await confirm();
        const warning = reports.getByRole('alert').filter({ hasText: 'No se pudo confirmar' });
        await warning.waitFor();
        assert.ok((await warning.textContent()).includes(reportId));
        assert.equal(writes.length, 3);
        await refresh.click();
        await idle();
        assert.ok(await warning.isVisible());
        assert.equal(writes.length, 3);
        // Hold a successful deletion to check shared blocking during the request.
        deletion = 'true';
        holdDelete = true;
        failHistory = true;
        const beforeHistory = reads.filter((r) => r.path === '/api/backup/health').length;
        await remove.click();
        await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
        await page.waitForFunction(
          () => document.querySelector('app-backup-reports .section-header button').disabled,
        );
        assert.ok(
          await view
            .getByRole('button', { name: 'Actualizar configuraciones', exact: true })
            .isDisabled(),
        );
        assert.ok(
          await view.getByRole('button', { name: 'Crear Health', exact: true }).isDisabled(),
        );
        assert.equal(writes.length, 4);
        assert.ok(releaseDelete);
        releaseDelete();
        await idle();
        await remove.waitFor({ state: 'hidden' });
        assert.equal(await reports.getByTestId('report-markdown').count(), 0);
        assert.ok((await reports.getByRole('status').innerText()).includes('Informe eliminado'));
        assert.ok(await warning.isVisible());
        assert.ok(reads.filter((r) => r.path === '/api/backup/health').length > beforeHistory);
        await reports.getByRole('button', { name: `Ver informe ${secondId}`, exact: true }).click();
        await idle();
        await reports
          .getByRole('button', { name: `Eliminar informe ${secondId}`, exact: true })
          .click();
        await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
        await idle();
        await reports.getByText('No hay informes de Health.', { exact: true }).waitFor();
        assert.equal(writes.length, 5);
        assert.ok(await warning.isVisible());
        assert.equal(await reports.getByRole('heading', { name: /^Informe:/ }).count(), 0);
        await overflow();
        await page.screenshot({ path: `${prefix}-empty.png`, fullPage: true });
        const navigate = async (title) => {
          if (mobile) await page.locator('ion-menu-button').click();
          await page.locator('arca-menu-item').getByText(title, { exact: true }).click();
        };
        await navigate('Dashboard');
        await page.waitForURL('**/dashboard');
        await page.waitForFunction(
          () => document.querySelectorAll('app-backup-reports').length === 0,
        );
        ids = [reportId, secondId];
        await navigate('Backups');
        await page.waitForURL('**/backups');
        await refresh.waitFor();
        await idle();
        assert.equal(await reports.getByRole('alert').count(), 0);
        assert.equal(await reports.getByTestId('report-markdown').count(), 0);
        await select.click();
        await idle();
        expire = true;
        await refresh.click();
        await page.waitForURL((url) => url.pathname === '/login');
        await page.waitForFunction(
          () =>
            document.querySelectorAll(
              'app-backup-reports, app-backup-health, app-backups .backup-list li',
            ).length === 0,
        );
        assert.equal(await page.evaluate(() => window.reportInjected), undefined);
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
