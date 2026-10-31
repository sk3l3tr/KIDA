# KIDA appearance

The application has seven combinations: Professional, Neobrutalism and Sakura in
light/dark; Tokyo in dark. Settings applies selections immediately. Tokyo keeps
the previous mode preference so returning to a compatible theme restores it.
Typography uses local system font families (sans, serif and monospace), with no
font downloads. Existing icons and navigation remain in place.

## Registering a theme

1. Add its ID, display name, description, supported modes and default mode to
   `catalog.ts`. IDs are stable persisted identifiers, not translated names.
2. Add palette entries in `themes.scss` and optional structural token overrides
   beside the existing themes. Palettes generate Ionic base/RGB/contrast/shade/tint
   and stepped colours; previews use the same palette. Keep text contrast at least
   4.5:1 and applicable graphical controls/focus at least 3:1 on their surfaces.
3. Run tests, production build and the browser matrix. Include the new combinations
   in `scripts/verify-themes.cjs`. No engine changes are required.

## Integration and lifecycle

`main.ts` synchronously resolves the global appearance before bootstrap, toggles
Ionic's `.ion-palette-dark`, and protects initial protected routes until the
router resolves identity. `App` releases that protection on navigation completion.
An initial navigation error keeps the shell hidden and presents a session error
message; it does not confirm anonymity. Storage failures always release the theme bootstrap protection.

`integration.ts` owns the Ionic class adaptation and opaque `Account.id` scope.
The engine never knows this ID is an account, or knows the Ionic class. Restoration
and login begin a new identity revision and suspend account writes while pending.
Only a current successful session confirms a scope. Network errors leave identity
unconfirmed; they do not declare the account anonymous. Rename retains the ID.
Logout/expiration invalidate pending operations and retain visible appearance.

ARCA shares response channels per action. The HTTP interceptor records each
outcome's identity revision in a WeakMap (and the current primitive outcome's
revision for HTTP 204). AuthService rejects results from older requests before
using those channels and completes pending consumers on identity transitions.
No response payload is wrapped and ARCA still receives next/error outcomes, so its
loader lifecycle remains intact. An operation already delivering its result can
finish even if it triggers logout. Current HTTP expiration errors still reach
callers before expiration finalization. Cookies, CSRF and backend contracts are
unchanged.

Styles load after Ionic and `dark.class.css`. Root selectors override iOS/MD
palette specificity; public variables and `::part` style Ionic Shadow DOM and
body-level overlays. ARCA uses its existing `--app-*` properties. Complementary
`--kida-*` properties control font, spacing, border width, radius, shadow and glow.
`overflow-anchor: none` on the public Ionic scroll part prevents typography changes
from moving the scroll anchor; no route/component is recreated on selection.

The only future extraction candidate is `src/lib/theming`. Catalog, CSS, previews,
identity wiring, Ionic class adaptation and Settings remain application concerns.

## Shared native controls and dialogs

`_controls.scss` defines the native control mixin used by the application's existing
inputs and by the opt-in `.console-control` class for selects and textareas.
`_components.scss`, loaded by `themes.scss`, provides that class and the
`.console-dialog` surface. Components keep their layout, widths and scrolling
rules locally. These are application styles; the portable engine is unchanged.

`_buttons.scss`, loaded by `_components.scss`, styles native buttons with the
theme's font, radius and border width and a minimum height of 44 px. The default
(also `button.primary`) is transparent with an accent border and text; `.secondary`
is neutral and `.danger` keeps the filled destructive presentation. `.icon-only`
provides a 44 px icon button; keep its accessible label on the button. Interaction
states are shared. Component-specific layout and selection styles stay local;
Ionic's internal controls and ARCA retain their own presentation.

Both classes consume the existing Ionic/KIDA colour, typography, border, spacing
and shadow tokens. Native dialog backdrops use `--kida-overlay-backdrop`, defined
with the other structural theme tokens. Scheduler uses these classes; adding a new
theme does not require editing its page stylesheet.

## Verification

Use the Node version pinned by `.nvmrc`:

```bash
pnpm exec ng test --watch=false
pnpm exec ng build --configuration production
```

The browser scripts use an existing Playwright installation and Chromium, without
adding dependencies. Start `pnpm exec ng serve --port 4217` first. Supply paths to
installed tools as needed:

```bash
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core \
CHROMIUM_PATH=/absolute/path/to/chrome \
node scripts/verify-themes.cjs

PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core \
CHROMIUM_PATH=/absolute/path/to/chrome \
node scripts/verify-theme-session.cjs
```

Optional variables: `THEME_TEST_URL` (default `http://127.0.0.1:4217`),
`THEME_TEST_OUTPUT` (default `/tmp/kida-theme-evidence`), `BACKEND_PYTHON` (default
`../../backend/.venv/bin/python` resolved from the script), `THEME_BACKEND_PORT`
(default `0`, an available temporary port). The real-session smoke requires the existing backend environment;
it creates a temporary database and random credentials, then removes them and
stops its own backend. It never accesses the development/production database or
CORE. The backend must be free to bind the selected port.

The matrix uses fixture session responses for controlled account scopes, checks
28 combinations (7 palettes × desktop/mobile × Ionic MD/iOS), actual overlay text
contrast, open-overlay theme changes, focus, reduced motion, real account form
state/scroll, reload, storage events, different scopes, delayed identity bootstrap,
blocked localStorage and login menu visibility on resize. Screenshots and JSON
results are written outside the repository. The separate session smoke checks
real cookie sharing, same-account synchronization and logout/reload appearance.
These checks are targeted WCAG contrast/interaction evidence, not a full assistive
technology accessibility certification.
