FROM node:24.15.0-bookworm-slim AS frontend

RUN npm install --global pnpm@12.14.0
WORKDIR /build/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
COPY frontend/vendor/arca-3.2.7.tgz ./vendor/arca-3.2.7.tgz
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM python:3.14-slim-bookworm AS backend

COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /usr/local/bin/uv
ENV UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev

FROM python:3.14-slim-bookworm AS runtime

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
RUN groupadd --gid 10001 kida && useradd --uid 10001 --gid kida --no-create-home kida
WORKDIR /app
RUN mkdir -p /app/data && chown 10001:10001 /app/data
COPY --from=backend /app/.venv /app/.venv
COPY backend/*.py ./
COPY backend/core ./core
COPY backend/system ./system
COPY backend/docker ./docker
COPY backend/scheduler ./scheduler
COPY --from=frontend /build/backend/static ./static
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; import json; response = urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3); assert json.load(response) == {'status': 'OK'}"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]
