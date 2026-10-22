# KIDA Console: despliegue Docker

## Contrato del despliegue

El contenedor incluye únicamente KIDA Console: FastAPI y Angular compilado en
producción. FastAPI sirve el frontal y `/api` en `0.0.0.0:8000`. CORE, CLI y las
demás piezas de KIDA permanecen en el host. No se montan sockets ni directorios
del host y no se añaden integraciones con CORE en este despliegue.

Se requiere Docker Engine y Docker Compose en Linux, acceso a los registros de
imágenes y paquetes durante la construcción, y el puerto 8000 libre. Compose usa
red `host`: el backend puede alcanzar los servicios del host en `127.0.0.1`.
No hay mapeos `ports`; la consola se abre en `http://IP_DEL_HOST:8000` desde
máquinas que tengan acceso de red al host y permiso en su firewall.

Angular usa `/api` en producción, por lo que el navegador contacta siempre con
FastAPI en el mismo origen. El environment de desarrollo y CORS se mantienen
para ejecutar Angular y FastAPI por separado fuera de Docker.

## Construcción y operación

Ejecutar desde la raíz del repositorio:

```bash
docker compose -f kida-console/compose.yaml config
docker compose -f kida-console/compose.yaml build
docker compose -f kida-console/compose.yaml up -d
docker compose -f kida-console/compose.yaml ps
docker compose -f kida-console/compose.yaml logs -f kida-console
```

Para detener y retirar únicamente este despliegue:

```bash
docker compose -f kida-console/compose.yaml down
```

Para construir la imagen sin Compose:

```bash
docker build -t kida-console:local kida-console
docker run --rm --network host kida-console:local
```

El Dockerfile usa etapas independientes para compilar Angular con Node 24.15.0
y pnpm 12.14.0 e instalar el backend con Python 3.14 y `uv.lock`. Las instalaciones
usan `pnpm install --frozen-lockfile` y `uv sync --locked --no-dev`. La imagen final
solo contiene Python, las dependencias del backend, `main.py` y los recursos del
frontal. Uvicorn se ejecuta sin recarga como usuario `10001:10001`.

`frontend/pnpm-workspace.yaml` autoriza los scripts de instalación de las cuatro
dependencias de compilación que los requieren; los demás quedan sujetos a la
validación estricta de pnpm.

Las fuentes están en `frontend/src` y `backend`; `backend/static` se genera durante
la construcción. Mantener este patrón y los lockfiles al actualizar dependencias.

## Validación

El healthcheck consulta `GET /api/health` y exige `{"status":"OK"}`. Tras arrancar:

```bash
curl --fail http://127.0.0.1:8000/
curl --fail http://127.0.0.1:8000/api/health
```

La aceptación del despliegue incluye servir HTML, JS y CSS de Angular, resolver
la navegación del frontal, pasar el healthcheck y alcanzar desde el contenedor
un servicio HTTP temporal en el loopback del host. Esa prueba de red no ejecuta
operaciones sobre las piezas reales de KIDA.

Los tests existentes se ejecutan fuera de la imagen, con Node compatible y las
dependencias locales instaladas:

```bash
cd kida-console/frontend
pnpm exec ng test --watch=false
cd ../backend
uv run python -m unittest test_cors -v
```

No incluir secretos, dependencias locales ni artefactos generados en el contexto
Docker. No modificar CORE, CLI, CI ni servicios ajenos para validar la consola.
