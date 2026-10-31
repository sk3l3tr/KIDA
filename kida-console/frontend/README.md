# Frontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.2.3.

## Development server

Use Node.js 24.15.0 (pinned in `.nvmrc`) or a version supported by `package.json`.
With nvm, run `nvm use` from this directory before installing or starting:

```bash
nvm use
pnpm install --frozen-lockfile
pnpm run start
```

ARCA 3.2.7 uses Ionic 8 APIs; keep `@ionic/angular` on 8.8.19. Its Angular peer
range predates Angular 22, so the explicit pnpm peer exceptions are covered by
the application configuration integration tests and build validation.

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Backend connection

Start FastAPI in a separate terminal from `kida-console/backend`:

```bash
uv run uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Then run `pnpm start` from `kida-console/frontend`. Angular calls FastAPI directly
at `http://127.0.0.1:8000/api`. FastAPI allows CORS requests from
`http://localhost:4200` and `http://127.0.0.1:4200`.

API configuration lives in `src/environments/environment.ts` (production) and
`src/environments/environment.development.ts` (development). Production uses `/api`
as `apiBaseUrl`; development uses `http://127.0.0.1:8000/api`. Change the development
base URL if the backend address changes. Keep the base URL without a trailing `/`.
Authentication paths live in the `endpoints` catalog; System defines its paths
in `src/app/pages/system/system.actions.ts`, registered in the central ARCA action list.
Services import `environment` from `environment.ts`; Angular replaces it for development.

`HealthService.getHealth()` returns an observable for `GET /api/health` with a
`{ status: string }` response. Subscribe to it from a consumer when needed; HTTP
errors reach the subscriber. No request is made automatically.

In production, `pnpm build` compiles Angular and copies it to `backend/static`.
FastAPI serves these files and the API from the same origin inside the container.
Requests use `/api` on that origin, so no fixed hostname or cross-origin access
is needed in production.

## Pages and navigation

ARCA provides a fixed left menu on desktop and a left drawer below 900 px,
opened with the header menu button. Each entry loads its standalone page lazily:
`/dashboard`, `/system`, `/docker`, `/backups`, `/scheduler`, `/settings` and
`/administrators`. These routes require a session; `/login` remains public.
The root URL and unknown paths redirect to `/dashboard`.

`/settings` contains the appearance gallery followed by equipment information.
`/administrators` retains account management. `/system` provides health/sensors, RTC
diagnostics and confirmed power actions. `/scheduler` manages CORE schedules;
dashboard and backups retain their placeholders. `/docker` provides container listing
and actions, Compose version, project listing and inspection. See
[theme registration and validation](src/theme/README.md) and the portable
[theming engine](src/lib/theming/README.md). Menu entries live in `src/app/arca-config/app.menu.config.ts`;
route definitions live in `src/app/app.routes.ts`.

## Docker

`/docker` has two sections: containers and Compose. It loads on each Ionic entry;
refresh buttons update each reading independently, without polling. Failed reads
retain the last data and mark it stale; an initial failure is distinct from an empty
inventory. Expand container details for dates, exit code, restarts, policy, ports,
networks and interpreted JSON, including future fields. Null values remain unknown;
unsafe JavaScript integers carry a precision warning.

Start sends the full container ID directly. Stop, restart and delete require a
keyboard-accessible confirmation with a frozen action/name/ID snapshot. Delete is
irreversible. CORE decides whether an operation is valid regardless of online state
or Compose membership. Observed Compose projects do not prove KIDA ownership.

Only one write can run at a time. Successful writes show the requested action and
CORE response separately from refresh failures, then reload containers and projects
and reinspect the selected project if it still exists. Uncertain writes are never
retried automatically: actions stay blocked until a container refresh succeeds.
Leaving the page or changing session closes confirmations, clears state and ignores
late responses. This does not cancel an operation already sent to CORE.

The eight ARCA actions and typed service live in `src/app/pages/docker`, using the
shared cookie/CSRF transport. See the [specification](docs/specs/docker-frontend.md)
and [verification instructions](src/app/pages/docker/docker.verification.md).

## System and equipment settings

`/system` redirects to `/system/overview`. System has three routed top tabs:
Overview, RTC / Energy (`/system/energy`) and the searchable sensor inspector
(`/system/sensors`). A container-scoped facade loads the two queries on entry,
shares the snapshots across tabs and refreshes sections individually on demand. Each section keeps its own loading, error and last-update
state. Values are snapshots; failed refreshes retain visibly stale data. Nulls,
empty lists and future CORE fields remain visible. RTC diagnostics do not prove
physical S5 wake support. Known sensors are grouped dynamically; duplicate labels,
unknown types and future fields remain inspectable. Core temperature statistics are
snapshot-derived and separated by device and compatible unit. Proportions use only
finite readings and positive reported critical thresholds; `max` is never capacity.
Zero RPM does not imply a fault. Leaving Energy invalidates pending confirmations;
a request already sent remains blocked until its response, and can keep executing.

Run `node src/app/pages/system/system.browser.cjs` against the development server
on port 4230 for the intercepted API matrix (seven theme modes, 360/768/1440 px).
See [System verification](src/app/pages/system/system.verification.md) for scope and
connected-read evidence.

Settings loads equipment information on entry and supports manual refresh.
It shows the equipment section after Appearance, using a separate presentation
component: hostname is shown inline;
operating system and hardware open responsive Ionic dialogs with multiple expandable
groups, initially collapsed. Direct values precede expandable groups, preserving
the relative order within each set. A single GPU is shown directly, disks retain
their individual details, and additional CORE fields remain available under
“Otros datos”. Dialogs reuse theme
styles and theme-specific enter/leave motion, respect reduced motion, and close on
page exit or session changes. Settings owns equipment requests and refresh state;
System keeps health, RTC and power operations.
The component uses the Ionic module already loaded by ARCA to preserve lazy loading.

Browser verification (all APIs simulated, no real power operations): with the
frontend running at `http://127.0.0.1:4230`, run
`node src/app/pages/settings/equipment/system-equipment.browser.cjs`. Set `SYSTEM_TEST_URL`,
`PLAYWRIGHT_MODULE`, `CHROMIUM_PATH` or `SYSTEM_TEST_OUTPUT` if needed. It checks
desktop/mobile across all seven theme/mode combinations, keyboard/focus, stale
refreshes, navigation/session cleanup and reduced motion.

Shutdown and reboot start at `+1` and accept `now`, `+N` minutes or a valid 24-hour
time. Power cycle selects exactly one wake mode: `HH:MM` or an integer of at least
120 seconds, plus optional shutdown `HH:MM`. The browser accepts only safe integer
seconds (up to `9007199254740991`); FastAPI supports the wider u64 range. CORE
validates server-local dates, margins and the relationship between shutdown and wake.

An Ionic dialog freezes and summarizes the parameters before sending one action.
Cancellation sends nothing. Lost responses/timeouts are shown as uncertain
execution and never retried automatically. Check the machine before repeating.
Leaving the page or changing session clears local results and confirmations;
it does not cancel an action already sent to CORE.

`SystemService` owns typed System calls; the page never handles ARCA channels.
The shared `ArcaRequestService` also serves authentication, cleans retained
payloads (including credentials), preserves null HTTP results and rejects
simultaneous requests on one channel/session. Abandoned exchanges keep draining
until their result arrives so a late response cannot satisfy a newer request.
If reentry finds a pending channel, wait for completion and refresh manually.
An HTTP exchange that never completes keeps that channel busy until session change.

## Scheduler

`/scheduler` lets every authenticated administrator list, create and delete CORE
schedules through three ARCA channels and `SchedulerService`. It loads on entry,
refreshes manually and starts with the User origin filter. Failed refreshes keep
stale entries and their original filter label. Unknown origins and future fields
remain visible in text details; only `USER` entries offer deletion.
`next_enqueue_at` means the next queue admission attempt, not execution or completion.

Creation accepts an unmodified command and any JSON value, including null, arrays
and scalars. Choose a browser-local date/time (seconds supported), positive integer
interval, or cron expression plus IANA zone (initially UTC). Once dates are sent
as RFC3339 UTC; nonexistent DST times are rejected, and repeated times use the
first occurrence. Confirmation shows the local offset and UTC equivalent.
CORE validates command eligibility, execution parameters, cron, zones and timing.

Intervals are limited to `1..9007199254740991`, the JavaScript safe integer range,
whereas the backend supports u64. JSON parameters use JavaScript numbers: non-finite
values and unsafe integers are rejected; fractional values can round. No arbitrary
precision library is used. Inputs are not silently trimmed or normalized.

A native modal dialog renders a frozen independent snapshot through text bindings.
Cancel sends nothing; confirm sends once. Writes are blocked during confirmation
or another write, and while the list is loading. Deleting does not cancel already
queued commands. A successful write remains successful if its refresh fails.
Timeouts or lost write responses require refreshing the list before repeating;
there are no automatic retries. Leaving or changing session clears form, data and
confirmation. Already sent requests can continue; the shared adapter drains them.
Forms and parameters are never persisted.

The feature keeps API types in `scheduler.models.ts`, form validation and request
snapshots in `scheduler-form.ts`, and labels, date formatting and error wording in
`scheduler-presentation.ts`. The component consumes only `SchedulerService` for
transport. `services/core-failure.ts` classifies the shared HTTP/CORE envelope for
Scheduler and System while each page retains its own messages. ARCA channel
registration and late-response draining are unchanged.

Native controls and the modal surface reuse the app theme's `.console-control`
and `.console-dialog` styles; layout stays in the page. Opening failures clear the
confirmation lock without sending a write. After a write, focus is restored after
the list refresh; if deletion removed the original button, focus moves to the list
heading. Leaving or changing session invalidates scheduled focus restoration.

Validation: `pnpm exec ng test --watch=false` and
`pnpm exec ng build --configuration production`. Browser verification must use
isolated mocked responses, never schedules against the regular CORE. The repeatable
Playwright script is `src/app/pages/scheduler/scheduler.browser.cjs`. With a dev server
on `http://127.0.0.1:4226`, run:

```bash
PLAYWRIGHT_MODULE=/path/to/existing/playwright CHROMIUM_PATH=/path/to/chromium \
  node src/app/pages/scheduler/scheduler.browser.cjs
```

Both paths refer to existing installations; this adds no frontend dependencies.
`SCHEDULER_TEST_URL` overrides the dev URL, and `SCHEDULER_TEST_OUTPUT` overrides
`/tmp/kida-scheduler-evidence`. The script mocks every API request before navigation.
See [recorded validation](src/app/pages/scheduler/scheduler.verification.md).

## Facade conventions

Use `SystemFacade` as a reference for readable coordination. A facade owns page
state, lifecycle, operation guards and the sequence of each use case. Keep those
sequences short and move substantial steps into named private methods. Preserve
session and selection checks in asynchronous callbacks, frozen confirmations,
write locks and uncertain outcomes when refactoring.

Feature services own typed transport calls; presentation utilities own pure
filtering, grouping and formatting. Reuse shared services for common interface
mechanics: `NativeDialogService` opens and closes native dialogs and delegates
keyboard wrapping and deferred focus restoration to the existing focus helpers.
It holds no per-page state. Callers supply their own dialog, injector, focus
fallback and callback validity guard; they also decide when opening must wait for
rendering and how errors are displayed. Ionic confirmations keep their existing
service. Extract concrete shared behavior without base facades or generic
operation frameworks.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
