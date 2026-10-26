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
base URL if the backend address changes. Add each new endpoint path, starting with `/`, to the `endpoints`
catalog in both files, without repeating `/api`. Keep the base URL without a trailing `/`.
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

`/settings` contains the appearance gallery. `/administrators` retains account
management. `/scheduler` manages CORE schedules; the other pages retain their
existing placeholders. See
[theme registration and validation](src/theme/README.md) and the portable
[theming engine](src/lib/theming/README.md). Menu entries live in `src/app/arca-config/app.menu.config.ts`;
route definitions live in `src/app/app.routes.ts`.

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
