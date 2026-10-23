from contextlib import asynccontextmanager
from importlib.resources import files
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from auth import check_request, router
from config import Settings
from core.client import CoreClient
from docker.routes import router as docker_router
from storage import Store
from system.routes import router as system_router

STATIC_DIR = Path(__file__).resolve().parent / "static"
SWAGGER_DIR = files("swagger_ui") / "static"


def create_app(settings=None):
    settings = settings or Settings.from_env()
    store = Store(settings.database)

    @asynccontextmanager
    async def lifespan(app):
        await run_in_threadpool(store.initialize, settings.admin_password)
        async with httpx.AsyncClient(
            base_url=settings.core_url.rstrip("/") + "/",
            timeout=settings.core_timeout_seconds,
            follow_redirects=False,
            trust_env=False,
        ) as http:
            app.state.core_client = CoreClient(http)
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
    app.include_router(system_router)
    app.include_router(docker_router)

    @app.get("/api/openapi.json", include_in_schema=False)
    def openapi():
        return app.openapi()

    @app.get("/api/docs", include_in_schema=False)
    def docs():
        return get_swagger_ui_html(
            openapi_url="/api/openapi.json",
            title=app.title,
            swagger_js_url="/api/docs-assets/swagger-ui-bundle.js",
            swagger_css_url="/api/docs-assets/swagger-ui.css",
            swagger_favicon_url="/api/docs-assets/favicon-32x32.png",
            swagger_ui_parameters={"supportedSubmitMethods": [], "validatorUrl": None},
        )

    @app.get("/api/docs-assets/{filename}", include_in_schema=False)
    def docs_asset(filename: str):
        from fastapi.responses import FileResponse

        if filename not in (
            "swagger-ui-bundle.js",
            "swagger-ui.css",
            "favicon-32x32.png",
        ):
            raise HTTPException(404, "Recurso no encontrado.")
        return FileResponse(SWAGGER_DIR / filename)

    @app.api_route(
        "/api",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
        include_in_schema=False,
    )
    @app.api_route(
        "/api/{path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
        include_in_schema=False,
    )
    def unknown_api(path: str = ""):
        raise HTTPException(404, "Ruta API no encontrada.")

    app.frontend("/", directory=STATIC_DIR, fallback="index.html")
    return app


app = create_app()
