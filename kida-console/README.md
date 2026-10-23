# KIDA Console

Consola Angular con API FastAPI. La autenticación y sus datos pertenecen a la
consola; CORE y CLI permanecen fuera de su contenedor y no cambian.

## Cuentas y sesiones

Solo existen administradores, todos con los mismos privilegios. No hay registro
público, roles, recuperación por correo ni contraseña predeterminada.

En una base de datos sin administradores, el primer arranque crea exactamente
`admin` con `KIDA_ADMIN_PASSWORD`. Si falta, está vacía o no tiene entre 12 y 128
caracteres, el arranque falla explícitamente. En siguientes arranques la variable
no recrea `admin`, no modifica cuentas ni restablece contraseñas; puede retirarse.

Desde Angular, un administrador puede:

- Listar cuentas y crear administradores indicando sus nuevas credenciales y
  confirmando su propia identidad con username y contraseña.
- Modificar exclusivamente su propio username y contraseña. Cambiar contraseña
  requiere la actual y cierra todas sus sesiones, incluida la que está usando.
- Eliminar cualquier cuenta, incluida la propia, si queda otro administrador.
  Se revocan todas las sesiones de la cuenta eliminada.
- Cerrar la sesión actual sin afectar a las demás. La interfaz espera la
  confirmación del servidor; si falla, muestra el error y permite reintentar
  conservando la sesión, salvo que el servidor indique que ya ha caducado.

No hay endpoints para editar credenciales ajenas. Esta regla prevalece sobre la
formulación original de REQ-ADM que permitía restablecer contraseñas de terceros.
Los usernames tienen 3–64 caracteres ASCII: letras, números, punto, guion o guion
bajo; son únicos sin distinguir mayúsculas. Las contraseñas tienen 12–128
caracteres y se conservan exactamente como se introducen, protegidas con Argon2id.

Las sesiones se guardan en SQLite mediante un hash SHA-256 de un identificador
aleatorio de 256 bits. La cookie es HttpOnly, SameSite=Lax y Secure por defecto,
sin dominio compartido. Las sesiones sobreviven al reinicio del backend y caducan
tras ocho horas sin peticiones autenticadas; no hay sondeos de mantenimiento.
Cerrar el navegador no sustituye al logout ni garantiza el fin de sesión.

Las escrituras, incluido login, requieren un origen permitido y un token CSRF en
`X-CSRF-Token`. Antes del login se obtiene una sesión anónima de diez minutos para
CSRF; al autenticarse se sustituye por una sesión nueva. Las respuestas API usan
`Cache-Control: no-store`. Los identificadores de sesión no se guardan en
localStorage ni sessionStorage.

Login, confirmación de creación y cambio de contraseña comparten el límite de
cinco fallos por username o treinta por dirección cliente en quince minutos.
Los contadores persisten entre reinicios. Se responde `429` con `Retry-After`
hasta que expire la ventana de quince minutos. Los intentos correctos no cuentan.

## Configuración

Copiar `kida-console/.env.example` a `kida-console/.env`, introducir una contraseña
inicial única y configurar el origen público real. No subir `.env` al repositorio.
No introducir secretos en comandos que queden guardados en el historial.

| Variable               | Uso y valor predeterminado                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KIDA_ADMIN_PASSWORD`  | Obligatoria únicamente al inicializar una base sin administradores.                                                                                       |
| `KIDA_DATABASE_PATH`   | SQLite local en `backend/data/auth.sqlite3`; Compose fija `/app/data/auth.sqlite3`.                                                                       |
| `KIDA_ALLOWED_ORIGINS` | Orígenes exactos separados por comas, sin rutas. Predeterminados: `http://localhost:4200,http://127.0.0.1:4200`. Producción debe definir su origen HTTPS. |
| `KIDA_COOKIE_SECURE`   | `true` por defecto. `false` exclusivamente para desarrollo local mediante HTTP.                                                                           |

El backend local carga `kida-console/.env` sin sustituir variables ya exportadas;
Compose inyecta el mismo fichero. La contraseña nunca se copia a la imagen ni se
incluye en el frontal. SQLite y sus copias contienen información sensible;
conservar el volumen y proteger sus copias de seguridad.

## Desarrollo

Con Python 3.14, `uv`, Node 24.15.0 compatible y pnpm, configurar `.env` con
`KIDA_COOKIE_SECURE=false` y `KIDA_ALLOWED_ORIGINS=http://127.0.0.1:4200`.
Ejecutar en terminales separadas:

```bash
cd kida-console/backend
uv sync --locked
uv run uvicorn main:app --host 127.0.0.1 --port 8000 --no-proxy-headers
```

```bash
cd kida-console/frontend
pnpm install --frozen-lockfile
pnpm start --host 127.0.0.1
```

Abrir `http://127.0.0.1:4200`. Angular usa directamente
`http://127.0.0.1:8000/api`, con CORS y credenciales. Usar el mismo hostname en
ambos servicios; no mezclar `localhost` y `127.0.0.1` por las cookies SameSite.

## Docker y LynxEngine

El contenedor incluye solo FastAPI y Angular compilado; no incluye CORE, CLI,
sockets ni servicios auxiliares. Compose utiliza red host en Linux para llegar a
servicios del host y un volumen `console-data` para las cuentas y sesiones.
El proceso se ejecuta como `10001:10001`; el directorio del volumen es escribible
por ese usuario y el fichero SQLite se crea con permisos `0600`.

Ejecutar desde la raíz, después de preparar `.env`:

```bash
docker compose -f kida-console/compose.yaml config --quiet
docker compose -f kida-console/compose.yaml build
docker compose -f kida-console/compose.yaml up -d
docker compose -f kida-console/compose.yaml ps
docker compose -f kida-console/compose.yaml logs -f kida-console
```

LynxEngine debe servir Angular y `/api` en el mismo origen HTTPS, reenviando
cookies, cabeceras Origin y `X-CSRF-Token` a FastAPI en el puerto 8000. Mantener
`KIDA_COOKIE_SECURE=true` y definir ese origen en `KIDA_ALLOWED_ORIGINS`. Restringir
el acceso directo al puerto 8000 mediante la configuración de red del servidor.
El acceso HTTP directo no admite login con cookies Secure en producción.

Uvicorn ignora por defecto las cabeceras de proxy para evitar direcciones cliente
falsificadas. Si LynxEngine está en el mismo host, las peticiones a través del
proxy comparten inicialmente el límite por dirección. Para distinguir clientes,
sustituir el comando de Compose por Uvicorn con `--proxy-headers` y
`--forwarded-allow-ips` restringido a las direcciones reales del proxy; nunca usar
`*`. El proxy debe reemplazar las cabeceras reenviadas recibidas del exterior.
La configuración de cookies y orígenes no depende de esas cabeceras.

Para detener y retirar el contenedor conservando las cuentas:

```bash
docker compose -f kida-console/compose.yaml down
```

No usar `down -v` si se desea conservar la base de datos. Reiniciar o reconstruir
la imagen conserva cuentas y sesiones mientras se conserve el volumen.

La construcción requiere el paquete local `frontend/vendor/arca-3.2.7.tgz`,
ya declarado en `package.json`; debe estar disponible en el contexto de build.
La construcción instala con `pnpm install --frozen-lockfile` y
`uv sync --locked --no-dev`. El contexto Docker excluye secretos, dependencias
locales, bases de datos, pruebas y artefactos generados. `/api/health` permanece
público y devuelve únicamente `{"status":"OK"}` para el healthcheck.

## Contrato API

Todas las rutas llevan prefijo `/api`. Excepto health, CSRF y login, exigen una
sesión autenticada. Todas las operaciones de escritura exigen CSRF y Origin.

| Método y ruta             | Contrato                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /auth/csrf`          | Devuelve `{csrf_token}` y prepara la cookie si es necesario.                                  |
| `POST /auth/login`        | Recibe `{username,password}`; devuelve `{user:{id,username},csrf_token}` y rota la cookie.    |
| `GET /auth/session`       | Devuelve `{user:{id,username},csrf_token}`.                                                   |
| `POST /auth/logout`       | Revoca sesión y elimina cookie; `204`.                                                        |
| `GET /admins`             | Devuelve lista de `{id,username}`.                                                            |
| `POST /admins`            | Recibe `{username,password,admin_username,admin_password}`; devuelve la cuenta creada; `201`. |
| `PATCH /admins/me`        | Recibe `{username}`; devuelve la cuenta propia actualizada.                                   |
| `PUT /admins/me/password` | Recibe `{current_password,password}`; revoca todas las sesiones propias; `204`.               |
| `DELETE /admins/{id}`     | Elimina cuenta y sesiones; `204`.                                                             |

Errores: `401` para sesión o credenciales inválidas, `403` para CSRF/origen,
`404` para cuenta/ruta inexistente, `409` para username duplicado o intento de
eliminar el último administrador, `422` para datos inválidos, `429` para límite
de intentos. `X-Kida-Session-Expired: true` distingue una sesión inválida de una
confirmación de credenciales fallida, para que Angular no cierre una sesión válida.

## Validación

```bash
cd kida-console/backend
uv run python -m unittest discover -v
```

```bash
cd kida-console/frontend
pnpm exec ng test --watch=false
pnpm build
```

Las pruebas usan bases temporales y cubren inicialización, reinicios, sesiones,
CSRF, límites de intentos, unicidad, cambios propios, revocación y eliminación
concurrente. La aceptación en contenedor debe usar recursos desechables y
comprobar también persistencia al recrearlo. No requiere operar sobre CORE.
