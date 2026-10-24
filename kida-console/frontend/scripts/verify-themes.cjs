/* Run against ng serve. Uses an existing Playwright installation, no app dependency. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.THEME_TEST_URL || 'http://127.0.0.1:4217';
const output = process.env.THEME_TEST_OUTPUT || '/tmp/kida-theme-evidence';
const combinations = [
  ['professional', 'light'],
  ['professional', 'dark'],
  ['neobrutalism', 'light'],
  ['neobrutalism', 'dark'],
  ['sakura', 'light'],
  ['sakura', 'dark'],
  ['tokyo', 'dark'],
];
async function theme(page, id, mode) {
  await page
    .locator('.theme-option')
    .filter({ has: page.locator(`[data-theme="${id}"]`) })
    .click();
  if (id !== 'tokyo') await page.locator(`input[value="${mode}"]`).check();
  await page.waitForFunction(
    ([id, mode]) =>
      document.documentElement.dataset.theme === id &&
      document.documentElement.dataset.mode === mode &&
      document.documentElement.classList.contains('ion-palette-dark') === (mode === 'dark'),
    [id, mode],
  );
}
async function appearance(page) {
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    mode: document.documentElement.dataset.mode,
  }));
}
async function service(page, operation, value) {
  return page.evaluate(
    ({ operation, value }) => {
      const themes = window.ng.getComponent(document.querySelector('app-settings')).themes;
      return themes[operation](value);
    },
    { operation, value },
  );
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const errors = [];
  const evidence = [];
  try {
    for (const mode of ['md', 'ios']) {
      for (const mobile of [false, true]) {
        const context = await browser.newContext({
          viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
          reducedMotion: 'reduce',
        });
        await context.addInitScript((mode) => {
          window.Ionic = { config: { mode } };
        }, mode);
        // Only session/account responses are fixtures. No real account or authentication is modified.
        await context.route('**/api/**', async (route) => {
          const endpoint = new URL(route.request().url()).pathname;
          await route.fulfill({
            json: endpoint.endsWith('/admins')
              ? [{ id: 1, username: 'admin' }]
              : { user: { id: 1, username: 'admin' }, csrf_token: 'test-only' },
          });
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`${base}/settings`);
        await page.locator('.theme-option').first().waitFor();
        assert.equal(await page.locator('html').getAttribute('mode'), mode);
        for (const [id, colorMode] of combinations) {
          await theme(page, id, colorMode);
          const result = await page.evaluate(() => {
            const css = getComputedStyle(document.documentElement);
            const value = (name) => css.getPropertyValue(name).trim();
            const rgb = (hex) => {
              let h = hex.replace('#', '');
              if (h.length === 3) h = [...h].map((c) => c + c).join('');
              return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
            };
            const luminance = (hex) =>
              rgb(hex)
                .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
                .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
            const ratio = (a, b) => {
              const x = luminance(a),
                y = luminance(b);
              return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
            };
            const pairs = [];
            for (const bg of ['--ion-background-color', '--ion-item-background']) {
              for (const fg of [
                '--ion-text-color',
                '--kida-muted',
                '--ion-color-primary',
                '--ion-color-danger',
                '--ion-color-success',
                '--ion-color-warning',
              ]) {
                pairs.push({ fg, bg, ratio: ratio(value(fg), value(bg)), minimum: 4.5 });
              }
              pairs.push({
                fg: '--ion-border-color',
                bg,
                ratio: ratio(value('--ion-border-color'), value(bg)),
                minimum: 3,
              });
            }
            for (const name of ['primary', 'danger', 'success', 'warning']) {
              pairs.push({
                fg: `${name} contrast`,
                ratio: ratio(value(`--ion-color-${name}`), value(`--ion-color-${name}-contrast`)),
                minimum: 4.5,
              });
            }
            return {
              pairs,
              panelShadow: getComputedStyle(document.querySelector('.panel')).boxShadow,
              font: css.getPropertyValue('--ion-font-family'),
              noOverflow: document.documentElement.scrollWidth <= innerWidth,
              reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
            };
          });
          for (const pair of result.pairs)
            assert.ok(
              pair.ratio >= pair.minimum,
              `${id}/${colorMode} ${pair.fg} on ${pair.bg}: ${pair.ratio}`,
            );
          assert.notEqual(result.panelShadow, 'none', `${id}/${colorMode}/${mode} panel shadow`);
          if (id === 'neobrutalism')
            assert.ok(result.panelShadow.includes('5px 5px'), 'offset shadow');
          assert.ok(result.noOverflow);
          assert.ok(result.reducedMotion);
          await page.evaluate(async () => {
            window.themePage = document.querySelector('app-settings');
            window.themeScroll = await window.themePage
              .querySelector('ion-content')
              .getScrollElement();
            window.themeScroll.scrollTop = 80;
            window.savedScroll = window.themeScroll.scrollTop;
          });
          await service(page, 'selectTheme', id === 'tokyo' ? 'sakura' : 'tokyo');
          await service(page, 'selectTheme', id);
          if (id !== 'tokyo') await service(page, 'selectMode', colorMode);
          assert.ok(
            await page.evaluate(
              () =>
                window.themePage === document.querySelector('app-settings') &&
                window.themeScroll.scrollTop === window.savedScroll,
            ),
          );
          // Exercise the actual Ionic custom elements, using only public properties/methods.
          for (const type of ['modal', 'alert', 'popover', 'toast', 'loading']) {
            const overlay = await page.evaluateHandle(async (type) => {
              const element = document.createElement(`ion-${type}`);
              element.animated = false;
              if (type === 'alert') {
                element.header = 'Confirmación';
                element.subHeader = 'Subtítulo de prueba';
                element.message = 'Mensaje de prueba';
                element.buttons = ['Aceptar'];
              }
              if (type === 'toast') {
                element.message = 'Mensaje de prueba';
                element.buttons = [{ text: 'Aceptar' }];
              }
              if (type === 'loading') element.message = 'Cargando';
              if (type === 'modal' || type === 'popover') {
                const div = document.createElement('div');
                div.textContent = 'Contenido de prueba';
                div.style.padding = '24px';
                element.component = div;
              }
              document.body.append(element);
              await customElements.whenDefined(`ion-${type}`);
              await element.present();
              return element;
            }, type);
            const palette = await overlay.evaluate((el) => ({
              background: getComputedStyle(el).getPropertyValue('--background').trim(),
              expected: getComputedStyle(document.documentElement)
                .getPropertyValue('--ion-overlay-background-color')
                .trim(),
              color: getComputedStyle(el).getPropertyValue('--color').trim(),
            }));
            assert.equal(palette.background, palette.expected, `${mode} ${type} background`);
            const textContrasts = await overlay.evaluate((el) => {
              const linear = (c) =>
                (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
              const luminance = (c) =>
                c
                  .slice(0, 3)
                  .map(linear)
                  .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
              const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
              const result = [];
              const root = el.shadowRoot || el;
              for (const node of [
                ...root.querySelectorAll('*'),
                ...(el.shadowRoot ? el.querySelectorAll('*') : []),
              ]) {
                if (
                  ![...node.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) ||
                  !node.getBoundingClientRect().width
                )
                  continue;
                const style = getComputedStyle(node);
                let parent = node,
                  bg;
                while (parent) {
                  const color = parse(getComputedStyle(parent).backgroundColor);
                  if (color.length === 3 || color[3] === 1) {
                    bg = color;
                    break;
                  }
                  parent = parent.assignedSlot || parent.parentElement || parent.getRootNode().host;
                }
                if (!bg) continue;
                const fg = parse(style.color),
                  x = luminance(fg),
                  y = luminance(bg);
                const minimum =
                  parseFloat(style.fontSize) >= 24 ||
                  (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700)
                    ? 3
                    : 4.5;
                result.push({
                  text: node.textContent.trim(),
                  ratio: (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05),
                  minimum,
                });
              }
              return result;
            });
            assert.ok(textContrasts.length, `${type} actual text measured`);
            for (const text of textContrasts)
              assert.ok(
                text.ratio >= text.minimum,
                `${id}/${colorMode}/${mode}/${type}: ${text.text} contrast ${text.ratio}`,
              );

            if (!mobile && mode === 'md')
              await page.screenshot({ path: path.join(output, `${id}-${colorMode}-${type}.png`) });
            // Change appearance with the overlay still open; verify it inherits the new palette.
            await service(page, 'selectTheme', id === 'tokyo' ? 'professional' : 'tokyo');
            const changed = await overlay.evaluate((el) => [
              getComputedStyle(el).getPropertyValue('--background').trim(),
              getComputedStyle(document.documentElement)
                .getPropertyValue('--ion-overlay-background-color')
                .trim(),
            ]);
            assert.equal(changed[0], changed[1]);
            await service(page, 'selectTheme', id);
            if (id !== 'tokyo') await service(page, 'selectMode', colorMode);
            await overlay.evaluate((el) => el.dismiss());
            await overlay.dispose();
          }
          await page.locator('.theme-option').first().focus();
          await page.keyboard.press('Tab');
          const focus = await page.evaluate(
            () => getComputedStyle(document.activeElement).outlineStyle,
          );
          assert.notEqual(focus, 'none');
          await page.screenshot({
            path: path.join(
              output,
              `${mode}-${mobile ? 'mobile' : 'desktop'}-${id}-${colorMode}.png`,
            ),
          });
          evidence.push({
            mode,
            mobile,
            theme: id,
            colorMode,
            minimumTextContrast: Math.min(
              ...result.pairs.filter((p) => p.minimum === 4.5).map((p) => p.ratio),
            ),
          });
        }
        // Reload retains account preference; anonymous login starts from the latest global selection.
        await page.reload();
        await page.locator('.theme-option').first().waitFor();
        assert.deepEqual(await appearance(page), { theme: 'tokyo', mode: 'dark' });
        const other = await context.newPage();
        await other.goto(`${base}/settings`);
        await other.locator('.theme-option').first().waitFor();
        await theme(page, 'sakura', 'light');
        await other.waitForFunction(
          () =>
            document.documentElement.dataset.theme === 'sakura' &&
            document.documentElement.dataset.mode === 'light',
        );
        // Different scopes in one cookie session are deliberately controlled through the theme service.
        await service(other, 'setScope', '2');
        await theme(page, 'tokyo', 'dark');
        assert.deepEqual(await appearance(other), { theme: 'professional', mode: 'light' });
        await service(other, 'selectTheme', 'neobrutalism');
        assert.deepEqual(await appearance(page), { theme: 'tokyo', mode: 'dark' });
        await other.evaluate(() => localStorage.removeItem('kida:appearance:account:1'));
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'professional');
        await other.evaluate(() => localStorage.clear());
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'professional');
        await other.goto(`${base}/login`);
        await other.locator('#username').waitFor();
        assert.notEqual(
          await other.locator('.login-card').evaluate((el) => getComputedStyle(el).boxShadow),
          'none',
          'login card shadow',
        );
        await other.locator('#username').fill('preserved');
        for (const width of [390, 1100, 390]) {
          await other.setViewportSize({ width, height: 844 });
          await other.waitForTimeout(150);
          assert.equal(
            await other
              .locator(
                'arca-fixed-menu:visible, arca-side-menu ion-menu.show-menu:visible, app-header:visible',
              )
              .count(),
            0,
          );
          assert.equal(await other.locator('#username').inputValue(), 'preserved');
        }
        await page.goto(`${base}/administrators`);
        await page.locator('#own-username').waitFor();
        await page.locator('#own-username').fill('unsaved-name');
        await page.evaluate(async () => {
          window.accountPage = document.querySelector('app-administrators');
          window.accountView = window.ng.getComponent(window.accountPage);
          window.accountScroll = await window.accountPage
            .querySelector('ion-content')
            .getScrollElement();
          window.accountScroll.scrollTop = 150;
          window.accountScrollTop = window.accountScroll.scrollTop;
        });
        for (const [id, colorMode] of combinations) {
          await page.evaluate(
            ({ id, colorMode }) => {
              const themes = window.accountView.auth.themeIdentity.themes;
              themes.selectTheme(id);
              if (id !== 'tokyo') themes.selectMode(colorMode);
            },
            { id, colorMode },
          );
          assert.equal(await page.locator('#own-username').inputValue(), 'unsaved-name');
          const preserved = await page.evaluate(() => ({
            sameComponent:
              window.accountView ===
              window.ng.getComponent(document.querySelector('app-administrators')),
            scroll: window.accountScroll.scrollTop,
            expected: window.accountScrollTop,
          }));
          assert.equal(preserved.sameComponent, true);
          assert.equal(preserved.scroll, preserved.expected, `${mode}/${mobile}/${id} form scroll`);
        }
        await context.close();
      }
    }
    // Hold identity restoration to observe the protected first paint.
    const startup = await browser.newContext();
    await startup.addInitScript(() => {
      localStorage.setItem(
        'kida:appearance:global',
        JSON.stringify({ version: 1, theme: 'tokyo', mode: 'dark' }),
      );
      localStorage.setItem(
        'kida:appearance:account:1',
        JSON.stringify({ version: 1, theme: 'sakura', mode: 'light' }),
      );
    });
    let releaseIdentity;
    const identityGate = new Promise((resolve) => {
      releaseIdentity = resolve;
    });
    await startup.route('**/api/auth/session', async (route) => {
      await identityGate;
      await route.fulfill({
        json: { user: { id: 1, username: 'admin' }, csrf_token: 'test-only' },
      });
    });
    const boot = await startup.newPage();
    await boot.goto(`${base}/settings`, { waitUntil: 'domcontentloaded' });
    await boot.waitForFunction(() =>
      document.documentElement.hasAttribute('data-identity-pending'),
    );
    assert.deepEqual(await appearance(boot), { theme: 'tokyo', mode: 'dark' });
    assert.equal(
      await boot.locator('app-root').evaluate((el) => getComputedStyle(el).visibility),
      'hidden',
    );
    releaseIdentity();
    await boot.locator('.theme-option').first().waitFor();
    assert.deepEqual(await appearance(boot), { theme: 'sakura', mode: 'light' });
    assert.equal(
      await boot.locator('app-root').evaluate((el) => getComputedStyle(el).visibility),
      'visible',
    );
    await startup.close();
    const unavailable = await browser.newContext();
    await unavailable.route('**/api/auth/session', (route) =>
      route.fulfill({ status: 503, json: { detail: 'Unavailable' } }),
    );
    const failure = await unavailable.newPage();
    await failure.goto(`${base}/settings`);
    await failure.locator('.startup-error').waitFor();
    assert.equal(await failure.locator('html').getAttribute('data-identity-pending'), '');
    assert.equal(
      await failure.locator('ion-app').evaluate((el) => getComputedStyle(el).visibility),
      'hidden',
    );
    assert.equal(
      await failure.locator('.startup-error').evaluate((el) => getComputedStyle(el).visibility),
      'visible',
    );
    await unavailable.close();
    const blocked = await browser.newContext();
    await blocked.addInitScript(() =>
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      }),
    );
    const denied = await blocked.newPage();
    await denied.goto(`${base}/login`);
    await denied.locator('#username').waitFor();
    assert.deepEqual(await appearance(denied), { theme: 'professional', mode: 'light' });
    assert.equal(await denied.locator('html').getAttribute('data-theme-pending'), null);
    await blocked.close();
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(output, 'results.json'),
      JSON.stringify({ combinations: evidence, errors }, null, 2),
    );
    console.log(
      `PASS: ${evidence.length} theme/device/Ionic combinations, overlays, contrast, persistence, tabs, login menus. Evidence: ${output}`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
