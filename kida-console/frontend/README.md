# Frontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.2.3.

## Development server

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
