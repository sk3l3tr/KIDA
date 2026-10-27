# System verification

Use Node 24.15.0 or the version required by `package.json`:

```sh
pnpm exec ng test --watch=false
pnpm run build
```

The production budget stays at 1 MB (initial) and 8 kB (component styles).
The existing initial-size warning at 500 kB remains. No budget is increased.

For the browser matrix, start the development server on port 4230 and run:

```sh
node src/app/pages/system/system.browser.cjs
```

The script requires Playwright and its Chromium installation outside the product's
runtime dependencies. Optional variables: `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`,
`SYSTEM_TEST_URL`, `SYSTEM_TEST_OUTPUT` (default `/tmp/kida-system-redesign-evidence`).
It intercepts **every API request**, including authentication and all power writes;
no test power request reaches CORE.

The matrix covers seven theme/mode combinations at 360, 768 and 1440 px, routed
tabs, direct entry, redirect/history (including cached reentry from Settings),
keyboard/focus and dialog cancellation,
confirmation against an intercepted API, uncertainty, shared snapshots, duplicate
and future sensors, search, stale refreshes and empty readings. Screenshots and
`results.json` are written outside the repository. Unit tests additionally cover
late session responses, tab confirmation invalidation (including asynchronous
creation), in-flight operation exclusion, immutable parameters, thresholds,
unknown data and per-device compatible core statistics.

## Connected readings, 2026-10-27

A temporary Console backend used its normal authenticated System bridge against
local CORE, with a separate temporary account/database. The frontend's API calls
were forwarded to that backend on port 8010. Health and RTC returned HTTP 200;
24 real sensors were rendered. All three power dialogs were opened and cancelled;
**zero power requests** were sent. The browser and temporary backend both blocked
System writes during this check. No product backend or protocol changes were made.

Evidence for this run: `connected-results.json`, `connected-energy.png` and
`connected-overview.png` in `/tmp/kida-system-redesign-evidence`.
These checks do not verify physical S5 wake or real shutdown/reboot/power-cycle
execution; those operations were intentionally not performed.
