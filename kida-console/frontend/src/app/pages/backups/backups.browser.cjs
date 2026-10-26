/* All API requests, including authentication, are intercepted before navigation. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BACKUPS_TEST_URL || 'http://127.0.0.1:4227';
const output = process.env.BACKUPS_TEST_OUTPUT || '/tmp/kida-backups-config-evidence';
const combinations = [
  ['professional', 'light'],
  ['professional', 'dark'],
  ['neobrutalism', 'light'],
  ['neobrutalism', 'dark'],
  ['sakura', 'light'],
  ['sakura', 'dark'],
  ['tokyo', 'dark'],
];
const remote = '<img src=x onerror="window.backupInjected=true">';
const job = {
  id: 'backup /?&+#ñ',
  name: remote,
  sources: ['/srv/data'],
  targets: [{ path: '/mnt/backups', required: false, filesystem_uuid: null, future: null }],
  compression: 'future-compression',
  lifecycle: { pre_backup: [], post_backup: [], future: 'kept' },
  schedule: null,
  retention: null,
  future: { unsafe: 9007199254740992 },
};
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const results = [];
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
        let jobs = [structuredClone(job)],
          failList = false,
          uncertain = false,
          expire = false;
        const writes = [],
          reads = [],
          errors = [];
        await context.route('**/api/**', async (route) => {
          const request = route.request(),
            url = new URL(request.url());
          if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
          if (url.pathname.startsWith('/api/auth/'))
            return route.fulfill({
              json: { user: { id: 991, username: 'backups-test' }, csrf_token: 'test-token' },
            });
          assert.ok(url.pathname.startsWith('/api/backup/'), `Unexpected API: ${url.pathname}`);
          if (request.method() === 'GET') {
            if (url.pathname === '/api/backup/health') return route.fulfill({ json: [] });
            assert.equal(url.pathname, '/api/backup/config');
            reads.push(url.pathname);
            if (expire) {
              expire = false;
              return route.fulfill({ status: 401, json: { detail: 'expired' } });
            }
            if (failList) {
              failList = false;
              return route.fulfill({ status: 503, json: { detail: { code: 'core_unavailable' } } });
            }
            return route.fulfill({ json: { backups: jobs, future: null } });
          }
          assert.equal(request.method(), 'POST');
          assert.equal(request.headers()['x-csrf-token'], 'test-token');
          const body = request.postDataJSON();
          writes.push({ path: url.pathname, body });
          if (url.pathname === '/api/backup/config/create') {
            const created = { ...structuredClone(job), ...body, id: 'created-id' };
            jobs.push(created);
            return route.fulfill({ json: created });
          }
          assert.deepEqual(body, { id: job.id });
          if (uncertain) {
            uncertain = false;
            return route.fulfill({ status: 504, json: { detail: { code: 'core_timeout' } } });
          }
          if (url.pathname === '/api/backup/config/delete') {
            jobs = jobs.filter((j) => j.id !== job.id);
            return route.fulfill({ json: job });
          }
          assert.equal(url.pathname, '/api/backup/run');
          return route.fulfill({
            json: { state: 'QUEUED', execution_id: 'execution-123', future: null },
          });
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        console.log(`${theme}/${mode}/${mobile ? 'mobile' : 'desktop'} starting`);
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`${base}/backups`);
        const view = page.locator('app-backups'),
          dialog = view.getByRole('dialog');
        const refresh = view.getByRole('button', {
          name: 'Actualizar configuraciones',
          exact: true,
        });
        const run = view.getByRole('button', { name: `Solicitar backup ${remote}`, exact: true });
        const remove = view.getByRole('button', {
          name: `Eliminar configuración ${remote}`,
          exact: true,
        });
        const waitIdle = () =>
          page.waitForFunction(
            () => !document.querySelector('app-backups .section-header button').disabled,
          );
        const checkOverflow = async () => {
          const measurements = await view.locator('ion-content').evaluate(async (content) => {
            const scroll = await content.getScrollElement(),
              layout = content.querySelector('.console-layout');
            const dialog = content.querySelector('dialog');
            return {
              document: document.documentElement.scrollWidth <= innerWidth,
              scroll: scroll.scrollWidth <= scroll.clientWidth,
              layout: layout.scrollWidth <= layout.clientWidth,
              dialog: !dialog.open || dialog.scrollWidth <= dialog.clientWidth,
            };
          });
          for (const [name, ok] of Object.entries(measurements))
            assert.ok(ok, `Overflow ${name}: ${theme}/${mode}/${mobile}`);
        };
        await run.waitFor();
        await waitIdle();
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        assert.equal(await page.locator('html').getAttribute('data-mode'), mode);
        await view
          .getByRole('button', { name: `Ver configuración ${remote}`, exact: true })
          .click();
        await view.getByRole('heading', { name: `Detalles: ${remote}`, exact: true }).waitFor();
        assert.ok((await view.innerText()).includes('Precisión limitada'));
        assert.equal(await view.locator('img').count(), 0);
        await view.getByText('Configuración completa (JSON)', { exact: true }).click();
        assert.ok((await view.innerText()).includes('future-compression'));
        await checkOverflow();
        await run.click();
        await dialog.waitFor();
        assert.ok((await dialog.innerText()).includes(job.id));
        await page.waitForFunction(
          () => document.activeElement?.textContent?.trim() === 'Cancelar',
        );
        await page.keyboard.press('Shift+Tab');
        assert.equal(
          await page.evaluate(() => document.activeElement.textContent.trim()),
          'Confirmar',
        );
        await page.keyboard.press('Tab');
        assert.equal(
          await page.evaluate(() => document.activeElement.textContent.trim()),
          'Cancelar',
        );
        await checkOverflow();
        await page.screenshot({
          path: `${output}/${theme}-${mode}-${mobile ? 'mobile' : 'desktop'}-dialog.png`,
          fullPage: true,
        });
        const alternative = theme === 'sakura' ? 'professional' : 'sakura';
        await page.evaluate(
          ({ theme, mode }) => {
            const key = 'kida:appearance:account:991';
            const value = JSON.stringify({ version: 1, theme, mode });
            localStorage.setItem(key, value);
            dispatchEvent(
              new StorageEvent('storage', { key, newValue: value, storageArea: localStorage }),
            );
          },
          { theme: alternative, mode },
        );
        await page.waitForFunction(
          (t) => document.documentElement.dataset.theme === t,
          alternative,
        );
        assert.ok(await dialog.isVisible());
        await checkOverflow();
        await page.evaluate(
          ({ theme, mode }) => {
            const key = 'kida:appearance:account:991';
            const value = JSON.stringify({ version: 1, theme, mode });
            localStorage.setItem(key, value);
            dispatchEvent(
              new StorageEvent('storage', { key, newValue: value, storageArea: localStorage }),
            );
          },
          { theme, mode },
        );
        await page.waitForFunction((t) => document.documentElement.dataset.theme === t, theme);
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(writes.length, 0);
        await page.waitForFunction(
          () => document.activeElement?.textContent?.trim() === 'Solicitar backup',
        );
        // Invalid JSON stays local; full form exercises every advanced field.
        await view.getByLabel('Nombre', { exact: true }).fill(' created ');
        await view.getByLabel('Origen 1', { exact: true }).fill(' /srv/a ');
        await view.getByRole('button', { name: 'Añadir origen', exact: true }).click();
        await view.getByLabel('Origen 2', { exact: true }).fill('/srv/b');
        await view.getByLabel('Ruta destino 1', { exact: true }).fill(' /mnt/a ');
        await view.getByLabel('Destino 1 obligatorio', { exact: true }).uncheck();
        await view.getByLabel(/^UUID destino 1: modo/).selectOption('null');
        await view.getByRole('button', { name: 'Añadir destino', exact: true }).click();
        await view.getByLabel('Ruta destino 2', { exact: true }).fill('/mnt/b');
        await view.getByLabel(/^UUID destino 2: modo/).selectOption('value');
        await view.getByLabel('UUID destino 2: valor', { exact: true }).fill(' uuid ');
        await view.getByText('Opciones avanzadas', { exact: true }).click();
        await view.getByLabel('Incluir lifecycle', { exact: true }).check();
        await view.getByRole('button', { name: 'Añadir comando pre_backup', exact: true }).click();
        await view.getByLabel('Comando pre_backup 1', { exact: true }).fill(' pre ');
        await view.getByLabel(/^Parámetros pre_backup 1: modo/).selectOption('value');
        await view
          .getByLabel('Parámetros pre_backup 1: valor', { exact: true })
          .fill('{"a":[1,true,null]}');
        await view.getByRole('button', { name: 'Añadir comando post_backup', exact: true }).click();
        await view.getByLabel('Comando post_backup 1', { exact: true }).fill('post');
        await view.getByLabel(/^Parámetros post_backup 1: modo/).selectOption('null');
        await view.getByLabel(/^Schedule \(JSON\): modo/).selectOption('value');
        await view.getByLabel('Schedule (JSON): valor', { exact: true }).fill('{');
        await view.getByLabel(/^Retention: modo/).selectOption('value');
        await view.getByLabel(/^max_age: modo/).selectOption('null');
        await view.getByLabel(/^keep_last: modo/).selectOption('value');
        await view.getByLabel('keep_last: valor', { exact: true }).fill('0');
        await view.getByRole('button', { name: 'Añadir punto protegido', exact: true }).click();
        await view.getByLabel('Punto protegido 1', { exact: true }).fill(' point ');
        const submit = view.getByRole('button', { name: 'Crear configuración', exact: true });
        await submit.click();
        await view.getByRole('alert').filter({ hasText: 'JSON válido' }).waitFor();
        assert.equal(writes.length, 0);
        await view.getByLabel('Schedule (JSON): valor', { exact: true }).fill('null');
        await checkOverflow();
        await submit.click();
        await waitIdle();
        await view.getByRole('status').filter({ hasText: 'Configuración creada' }).waitFor();
        assert.equal(writes.length, 1);
        assert.deepEqual(writes[0].body, {
          name: ' created ',
          sources: [' /srv/a ', '/srv/b'],
          targets: [
            { path: ' /mnt/a ', required: false, filesystem_uuid: null },
            { path: '/mnt/b', required: true, filesystem_uuid: ' uuid ' },
          ],
          compression: 'tar_zstd',
          lifecycle: {
            pre_backup: [{ command: ' pre ', params: { a: [1, true, null] } }],
            post_backup: [{ command: 'post', params: null }],
          },
          schedule: null,
          retention: { max_age: null, keep_last: 0, protected_restore_points: [' point '] },
        });
        assert.equal(await view.getByLabel('Nombre', { exact: true }).inputValue(), '');
        // Admission with a failed refresh keeps the confirmed result separate.
        failList = true;
        await run.click();
        await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
        await waitIdle();
        await view.getByRole('alert').filter({ hasText: 'Error de actualización' }).waitFor();
        assert.ok((await view.getByRole('status').innerText()).includes('execution-123'));
        assert.ok((await view.innerText()).includes('no confirma inicio ni finalización'));
        uncertain = true;
        await run.click();
        await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
        await waitIdle();
        const warning = view
          .getByRole('alert')
          .filter({ hasText: 'No se pudo confirmar el resultado' });
        await warning.waitFor();
        assert.ok((await warning.innerText()).includes(job.id));
        await refresh.click();
        await waitIdle();
        assert.ok(await warning.isVisible());
        assert.equal(writes.length, 3);
        await remove.click();
        await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
        assert.equal(writes.length, 3);
        await remove.click();
        await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
        await waitIdle();
        assert.equal(writes.length, 4);
        await remove.waitFor({ state: 'hidden' });
        assert.ok((await view.getByRole('status').innerText()).includes('archivos se conservan'));
        await page.waitForFunction(
          () => document.activeElement?.id === 'backup-configurations-heading',
        );
        // The created item disappears only after a successful fresh read.
        jobs = [];
        await refresh.click();
        await waitIdle();
        await view.getByText('No hay configuraciones de backup.', { exact: true }).waitFor();
        assert.equal(await view.getByRole('heading', { name: /^Detalles:/ }).count(), 0);
        assert.ok(await warning.isVisible());
        await view.locator('ion-content').evaluate(async (content) => {
          (await content.getScrollElement()).scrollTop = 0;
        });
        await page.screenshot({
          path: `${output}/${theme}-${mode}-${mobile ? 'mobile' : 'desktop'}-page.png`,
          fullPage: true,
        });
        const navigate = async (title) => {
          if (mobile) await page.locator('ion-menu-button').click();
          await page.locator('arca-menu-item').getByText(title, { exact: true }).click();
        };
        await navigate('Dashboard');
        await page.waitForURL('**/dashboard');
        await page.waitForFunction(
          () => document.querySelectorAll('app-backups form').length === 0,
        );
        jobs = [structuredClone(job)];
        await navigate('Backups');
        await page.waitForURL('**/backups');
        await run.waitFor();
        await waitIdle();
        assert.equal(await view.getByRole('alert').count(), 0);
        expire = true;
        await refresh.click();
        await page.waitForURL((url) => url.pathname === '/login');
        await page.waitForFunction(
          () => document.querySelectorAll('app-backups .backup-list li').length === 0,
        );
        assert.equal(await view.locator('form').count(), 0);
        assert.equal(await view.locator('.backup-list li').count(), 0);
        assert.equal(await page.evaluate(() => window.backupInjected), undefined);
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
