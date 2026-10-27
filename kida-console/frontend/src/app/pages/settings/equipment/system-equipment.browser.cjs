/* UI verification only: every API request is intercepted; no CORE or power operation is run. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SYSTEM_TEST_URL || 'http://127.0.0.1:4230';
const output = process.env.SYSTEM_TEST_OUTPUT || '/tmp/kida-system-equipment-evidence';
const combinations = [
  ['professional', 'light'],
  ['professional', 'dark'],
  ['neobrutalism', 'light'],
  ['neobrutalism', 'dark'],
  ['sakura', 'light'],
  ['sakura', 'dark'],
  ['tokyo', 'dark'],
];
const info = {
  hostname: 'core-server',
  os: { name: 'Linux', version: '13', long_version: 'Debian GNU/Linux 13', future: false },
  kernel: { version: '6.12', long_version: 'Linux 6.12 x86_64' },
  architecture: 'x86_64',
  hardware: { model: 'Server', vendor: null },
  cpu: { brand: 'CPU de prueba', logical_cores: 8, physical_cores: 4 },
  memory: { total_bytes: 17179869184, available_bytes: 0, used_bytes: 17179869184 },
  graphics: ['GPU única'],
  disks: [
    {
      name: '<img src=x onerror="window.equipmentInjected=true">',
      mount_point: '/' + 'long-path/'.repeat(25),
      file_system: 'ext4',
      total_bytes: 1099511627776,
      available_bytes: 0,
      removable: false,
      future: 'kept',
    },
    { name: 'sdb', mount_point: '/backup', removable: true },
  ],
  future: { extra: 'visible' },
};

// A synthetic menu selection starts from a closed mobile drawer; wait for ARCA's
// toggle to finish before closing it, just as a normal selection would do.
async function prepareMenuNavigation(page, mobile) {
  if (mobile)
    await page.evaluate(() => {
      window.equipmentDrawerReady = false;
      document.addEventListener(
        'ionDidOpen',
        () => {
          window.equipmentDrawerReady = true;
        },
        { once: true },
      );
    });
}
async function finishMenuNavigation(page, mobile) {
  await page.waitForURL('**/system/overview');
  if (mobile) {
    await page.waitForFunction(() => window.equipmentDrawerReady);
    await page
      .locator('ion-menu')
      .evaluateAll((menus) => Promise.all(menus.map((menu) => menu.close())));
  }
}

async function assertClosedDetails(modal) {
  const state = await modal.locator('ion-accordion-group').evaluate((group) => ({
    expanded: group.value ?? [],
    types: [...group.children].map((el) => el.tagName),
  }));
  assert.deepEqual(state.expanded, [], 'All accordions must start closed');
  const firstAccordion = state.types.indexOf('ION-ACCORDION');
  if (firstAccordion !== -1)
    assert.ok(
      state.types.slice(firstAccordion).every((type) => type === 'ION-ACCORDION'),
      'Direct values must precede accordions',
    );
}

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
          reducedMotion: 'no-preference',
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
        let current = structuredClone(info),
          fail = false,
          expire = false,
          reads = 0;
        const errors = [],
          writes = [];
        await context.route('**/api/**', async (route) => {
          const request = route.request(),
            path = new URL(request.url()).pathname;
          if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
          if (path.startsWith('/api/auth/'))
            return route.fulfill({
              json: { user: { id: 991, username: 'equipment-test' }, csrf_token: 'test-token' },
            });
          if (request.method() !== 'GET') {
            writes.push(path);
            return route.abort();
          }
          if (path === '/api/system/info') {
            reads++;
            if (expire) return route.fulfill({ status: 401, json: { detail: 'expired' } });
            if (fail)
              return route.fulfill({ status: 503, json: { detail: { code: 'core_unavailable' } } });
            return route.fulfill({ json: current });
          }
          if (path === '/api/system/health')
            return route.fulfill({ json: { overall: 'OK', sensors: [] } });
          if (path === '/api/system/wake-capabilities')
            return route.fulfill({
              json: {
                rtc_device: null,
                rtcwake_available: null,
                rtc_alarm_available: null,
                s5_wake_status: 'unverified',
                warnings: [],
              },
            });
          throw Error(`Unexpected request: ${path}`);
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on('pageerror', (e) => errors.push(e.message));
        const name = `${theme}-${mode}-${mobile ? 'mobile' : 'desktop'}`;
        console.log(`${name} starting`);
        await page.goto(`${base}/settings`);
        const card = page.locator('app-system-equipment');
        await card.getByText('core-server', { exact: true }).waitFor();
        assert.equal(await card.locator('.equipment-list ion-item').count(), 3);
        const appearance = page.getByRole('region', { name: 'Apariencia', exact: true });
        assert.equal(await page.locator('.theme-option').count(), 4);
        assert.ok(
          (await appearance.boundingBox()).y + (await appearance.boundingBox()).height <=
            (await card.boundingBox()).y,
          'Equipment must follow Appearance',
        );
        await card.scrollIntoViewIfNeeded();
        assert.equal(await card.locator('.hostname-row').getAttribute('button'), null);
        assert.equal(
          await card.locator('section').evaluate((el) => {
            const style = getComputedStyle(el);
            return (
              style.backgroundColor === 'rgba(0, 0, 0, 0)' &&
              style.borderTopWidth === '0px' &&
              style.boxShadow === 'none'
            );
          }),
          true,
          'Equipment still has an outer card',
        );
        const hostnameLayout = await card.locator('.hostname-row .value-row').evaluate((el) => {
          const title = el.querySelector('span').getBoundingClientRect();
          const value = el.querySelector('app-system-data').getBoundingClientRect();
          return {
            sameLine: Math.abs(title.top - value.top) < 3,
            stacked: value.top >= title.bottom,
          };
        });
        assert.ok(mobile ? hostnameLayout.stacked : hostnameLayout.sameLine, 'Value row layout');
        const operatingSystem = card.locator('.equipment-list ion-item[button]').nth(0);
        const hardware = card.locator('.equipment-list ion-item[button]').nth(1);
        await page.screenshot({ path: `${output}/${name}-card.png` });
        const initialReads = reads;
        await operatingSystem.click();
        const modal = page.locator('ion-modal.equipment-modal');
        await page.getByRole('dialog', { name: 'Sistema operativo', exact: true }).waitFor();
        await modal.locator('.equipment-close').waitFor();
        await page.waitForFunction(() =>
          document.activeElement?.classList.contains('equipment-close'),
        );
        assert.equal(reads, initialReads, 'Opening details must not fetch');
        await assertClosedDetails(modal);
        const box = await modal.evaluate((el) =>
          el.shadowRoot.querySelector('[part="content"]').getBoundingClientRect().toJSON(),
        );
        assert.ok(
          mobile ? box.width <= 391 && box.width >= 389 : box.width <= 762,
          `Modal width ${box.width}`,
        );
        if (mobile) assert.ok(box.height >= 843 && box.height <= 845, `Modal height ${box.height}`);
        for (const title of ['Sistema operativo', 'Kernel'])
          await modal
            .locator('ion-accordion > ion-item[slot="header"]')
            .filter({ hasText: title })
            .click();
        await page.waitForFunction(() => {
          const group = document.querySelector('ion-modal ion-accordion-group');
          return group.value.includes('os') && group.value.includes('kernel');
        });
        for (let i = 0; i < 6; i++) {
          await page.keyboard.press('Tab');
          assert.equal(
            await modal.evaluate((el) => el.contains(document.activeElement)),
            true,
            'Focus escaped modal',
          );
        }
        await page.keyboard.press('Escape');
        await page.waitForFunction(
          () => !document.querySelector('ion-modal')?.classList.contains('show-modal'),
        );
        assert.equal(
          await operatingSystem.evaluate((el) => document.activeElement === el),
          true,
          'Focus not restored',
        );
        await hardware.click();
        await page.getByRole('dialog', { name: 'Hardware', exact: true }).waitFor();
        await page.waitForFunction(() =>
          document.activeElement?.classList.contains('equipment-close'),
        );
        await modal.getByText('GPU única', { exact: true }).waitFor();
        await assertClosedDetails(modal);
        assert.equal(
          await modal.locator('ion-accordion-group').evaluate((el) => {
            const style = getComputedStyle(el);
            return (
              style.borderTopWidth === '0px' &&
              style.borderRadius === '0px' &&
              style.boxShadow === 'none'
            );
          }),
          true,
          'Modal still has an inner card',
        );
        const rowStyles = await modal.locator('ion-item').evaluateAll((items) =>
          items.map((el) => {
            const style = getComputedStyle(el);
            const label = getComputedStyle(el.querySelector('ion-label'));
            return [
              style.getPropertyValue('--background').trim(),
              style.getPropertyValue('--min-height').trim(),
              label.fontSize,
              label.fontWeight,
              label.color,
            ];
          }),
        );
        assert.ok(
          rowStyles.every((style) => JSON.stringify(style) === JSON.stringify(rowStyles[0])),
          'Scalar and expandable rows differ visually',
        );
        await page.screenshot({ path: `${output}/${name}-hardware-initial.png` });
        current.graphics = [
          'GPU única — ' + 'Intel Corporation Arrow Lake-P Arc Pro 130T/140T '.repeat(4),
        ];
        await card.locator('.equipment-header button').evaluate((el) => el.click());
        await modal.getByText(current.graphics[0], { exact: true }).waitFor();
        assert.equal(
          await modal.locator('.detail-value .value-row').evaluate((el) => {
            const title = el.querySelector('span').getBoundingClientRect();
            const value = el.querySelector('app-system-data');
            return (
              value.getBoundingClientRect().top >= title.bottom &&
              value.scrollWidth <= value.clientWidth + 1
            );
          }),
          true,
          'Long value must wrap below its title without overflow',
        );
        assert.equal(
          await modal
            .locator('ion-accordion > ion-item[slot="header"]')
            .filter({ hasText: 'Gráficos' })
            .count(),
          0,
        );
        for (const title of ['Equipo', 'CPU', 'Memoria', 'Discos'])
          await modal
            .locator('ion-accordion > ion-item[slot="header"]')
            .filter({ hasText: title })
            .click();
        await modal.getByText('16 GiB (17179869184 bytes)', { exact: true }).first().waitFor();
        assert.equal(await page.evaluate(() => !!window.equipmentInjected), false);
        assert.equal(await modal.locator('img').count(), 0);
        assert.equal(
          await modal.evaluate((el) =>
            [...el.querySelectorAll('.detail-content')].every(
              (content) => content.scrollWidth <= content.clientWidth + 1,
            ),
          ),
          true,
          'Horizontal overflow',
        );
        await page.screenshot({ path: `${output}/${name}-hardware.png` });
        // Refresh while details remain open, without bypassing the page's real request/state path.
        current.cpu.brand = 'CPU actualizada';
        await card.locator('.equipment-header button').evaluate((el) => el.click());
        await modal.getByText('CPU actualizada', { exact: true }).waitFor();
        const expanded = await modal.locator('ion-accordion-group').evaluate((el) => el.value);
        assert.ok(
          ['hardware', 'cpu', 'memory', 'disks'].every((key) => expanded.includes(key)),
          'Refresh collapsed groups',
        );
        fail = true;
        await card.locator('.equipment-header button').evaluate((el) => el.click());
        await modal
          .getByText('Datos anteriores; pendientes de actualizar.', { exact: true })
          .waitFor();
        await modal.getByText('CPU actualizada', { exact: true }).waitFor();
        fail = false;
        await modal.locator('.equipment-close').click();
        await page.waitForFunction(
          () => !document.querySelector('ion-modal')?.classList.contains('show-modal'),
        );
        // A scalar missing value and an empty collection keep distinct representations.
        current.graphics = [];
        current.hardware = null;
        await card.locator('.equipment-header button').click();
        await page.waitForFunction(
          () =>
            !document
              .querySelector('app-system-equipment section')
              .getAttribute('aria-busy')
              .includes('true'),
        );
        await hardware.click();
        await modal.getByText('Sin elementos', { exact: true }).waitFor();
        await modal.getByText('Desconocido', { exact: true }).first().waitFor();
        await assertClosedDetails(modal);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await modal.locator('.equipment-close').click();
        await page.waitForFunction(
          () => !document.querySelector('ion-modal')?.classList.contains('show-modal'),
        );
        await hardware.click();
        await page.getByRole('dialog', { name: 'Hardware', exact: true }).waitFor();
        // didPresent moves focus to Close; a visible dialog can still be in its
        // final 1ms compatibility frame before Ionic finishes presentation.
        await page.waitForFunction(() =>
          document.activeElement?.classList.contains('equipment-close'),
        );
        assert.equal(
          await modal.evaluate((el) =>
            el.shadowRoot
              .querySelector('[part="content"]')
              .getAnimations()
              .some((a) => a.playState === 'running'),
          ),
          false,
          'Reduced motion still animating',
        );
        // Trigger the real router through ARCA while the overlay is open.
        let infoReadsBeforeLeaving = reads;
        await prepareMenuNavigation(page, mobile);
        await page
          .locator('arca-menu-item')
          .filter({ hasText: 'System' })
          .first()
          .locator('[tabindex]')
          .evaluate((el) => el.click());
        await finishMenuNavigation(page, mobile);
        assert.equal(await page.locator('app-system app-system-equipment').count(), 0);
        assert.equal(
          reads,
          infoReadsBeforeLeaving,
          'System must not request equipment information',
        );
        await page.waitForFunction(
          () => !document.querySelector('ion-modal')?.classList.contains('show-modal'),
        );
        // Re-enter through Angular routing, then force session expiry while detail is open.
        await page.goBack();
        await page.waitForURL('**/settings');
        await page.locator('app-system-equipment .hostname-row').waitFor();
        // Leave through the real router during Ionic's presentation transition.
        infoReadsBeforeLeaving = reads;
        await prepareMenuNavigation(page, mobile);
        await page.evaluate(() => {
          document.addEventListener(
            'ionModalWillPresent',
            () => {
              const item = [...document.querySelectorAll('arca-menu-item')].find(
                (el) => el.textContent.trim() === 'System',
              );
              item.querySelector('[tabindex]').click();
            },
            { once: true },
          );
        });
        await page.locator('app-system-equipment .equipment-list ion-item[button]').last().click();
        await finishMenuNavigation(page, mobile);
        assert.equal(await page.locator('app-system app-system-equipment').count(), 0);
        assert.equal(
          reads,
          infoReadsBeforeLeaving,
          'System must not request equipment information',
        );
        await page.waitForFunction(() => !document.querySelector('.equipment-modal.show-modal'));
        await page.goBack();
        await page.waitForURL('**/settings');
        await page.locator('app-system-equipment .hostname-row').waitFor();
        await page.locator('app-system-equipment .equipment-list ion-item[button]').last().click();
        await page.getByRole('dialog', { name: 'Hardware', exact: true }).waitFor();
        expire = true;
        await page
          .locator('app-system-equipment .equipment-header button')
          .evaluate((el) => el.click());
        await page.waitForURL('**/login**');
        await page.waitForFunction(
          () => !document.querySelector('ion-modal')?.classList.contains('show-modal'),
        );
        assert.deepEqual(errors, [], `Page errors: ${errors.join('; ')}`);
        assert.deepEqual(writes, [], 'Unexpected operation');
        results.push({ theme, mode, mobile, passed: true });
        await context.close();
        console.log(`${name} passed`);
      }
    await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
    console.log(`${results.length}/14 combinations passed; all APIs simulated.`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
