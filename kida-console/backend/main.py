from contextlib import asynccontextmanager
from pathlib import Path

from auth import check_request, router
from config import Settings
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from storage import Store

STATIC_DIR = Path(__file__).resolve().parent / "static"


def create_app(settings=None):
    settings = settings or Settings.from_env()
    store = Store(settings.database)

    @asynccontextmanager
    async def lifespan(app):
        await run_in_threadpool(store.initialize, settings.admin_password)
        yield

    app = FastAPI(
        title="KIDA Console API",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # FastAPI normally includes rejected input, which can contain passwords.
        return JSONResponse(
            {
                "detail": [
                    {"loc": error["loc"], "msg": error["msg"], "type": error["type"]}
                    for error in exc.errors()
                ]
            },
            status_code=422,
        )

    app.state.settings = settings
    app.state.store = store

    @app.middleware("http")
    async def authentication(request: Request, call_next):
        if request.url.path == "/api" or request.url.path.startswith("/api/"):
            try:
                if request.method != "OPTIONS" and not (
                    request.url.path == "/api/health" and request.method == "GET"
                ):
                    await run_in_threadpool(check_request, request)
            except HTTPException as exc:
                response = JSONResponse(
                    {"detail": exc.detail},
                    status_code=exc.status_code,
                    headers=exc.headers,
                )
            else:
                response = await call_next(request)
            response.headers["Cache-Control"] = "no-store"
            return response
        return await call_next(request)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.origins),
        allow_credentials=True,
        expose_headers=["X-Kida-Session-Expired"],
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token"],
    )

    @app.get("/api/health")
    def health():
        return {"status": "OK"}

    app.include_router(router)

    @app.api_route("/api", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
    @app.api_route(
        "/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]
    )
    def unknown_api(path: str = ""):
        raise HTTPException(404, "Ruta API no encontrada.")

    app.frontend("/", directory=STATIC_DIR, fallback="index.html")
    return app


app = create_app()
