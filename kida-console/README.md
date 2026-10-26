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

## Página System

`/system` consulta equipo, memoria, discos, gráficos, salud/sensores y capacidades
RTC al entrar. Cada sección tiene actualización manual, error y fecha propios;
no hay sondeo periódico. Los datos anteriores se conservan al fallar una
actualización y se identifican como desactualizados. Se muestran nulos, listas
vacías y campos nuevos; el diagnóstico RTC no demuestra encendido físico desde S5.

Apagado y reinicio admiten `now`, `+N` minutos u hora válida, con `+1` inicial.
El ciclo de energía permite elegir hora `HH:MM` o segundos desde la ejecución
(mínimo 120), y hora de apagado opcional. El frontal limita los segundos a enteros
seguros de JavaScript; CORE valida fechas, zona horaria y márgenes del servidor.
Cada acción exige un diálogo con parámetros congelados. Cancelar no envía nada;
confirmar envía una sola petición. No se reintentan automáticamente las acciones.
Ante ejecución incierta, comprobar el equipo antes de repetir.

Salir descarta consumidores/resultados locales y cambiar de sesión invalida
también las confirmaciones; una acción enviada puede seguir ejecutándose en CORE.
Si al volver queda una consulta anterior pendiente, esperar y actualizar la sección.

## API SYSTEM

El backend actúa como puente HTTP a un único CORE por despliegue. No ejecuta el
CLI ni acciones locales. Todos los administradores pueden consultar y ejecutar
SYSTEM. `KIDA_CORE_URL` vale `http://127.0.0.1:8989` por defecto y admite una URL
HTTP(S) absoluta sin credenciales, query ni fragmento. Se añade `/command` a esa
base. `KIDA_CORE_TIMEOUT_SECONDS` vale `10` y debe ser un número finito positivo;
es el timeout de cada fase HTTP (conexión, lectura, escritura y espera del pool).
La configuración se valida al arrancar, sin comprobar disponibilidad de CORE.
Reiniciar Console para aplicar cambios. Compose inyecta estas variables desde
`.env`; con red host el valor predeterminado alcanza CORE en el host Linux.

| Método y ruta | Entrada JSON |
| --- | --- |
| `GET /api/system/info` | Sin cuerpo |
| `GET /api/system/health` | Sin cuerpo |
| `GET /api/system/wake-capabilities` | Sin cuerpo |
| `POST /api/system/shutdown` | `{"when":"+1"}` |
| `POST /api/system/reboot` | `{"when":"23:30"}` |
| `POST /api/system/power-cycle` | `{"wake_time":"06:00","shutdown_time":"23:00"}` o `{"wake_after_seconds":3600}` |

`when` es obligatorio: `now`, `+N` (minutos, dígitos ASCII) o una hora válida de
24 horas (`HH:MM`, también se admiten componentes de una cifra como CORE).
Power cycle exige exactamente uno de `wake_time` o `wake_after_seconds`;
`shutdown_time` es opcional. Sus horas requieren exactamente `HH:MM` y sus
segundos un entero entre `120` y `18446744073709551615`. No se admiten campos
extra, valores nulos explícitos ni conversiones de cadenas, booleanos o decimales
a enteros. CORE resuelve fechas, zona horaria, márgenes y ejecución, y puede
rechazar entradas válidas sintácticamente (por ejemplo, una hora ya pasada).

Todas estas rutas requieren sesión; los POST conservan Origin y CSRF. Ejemplo
en el navegador tras iniciar sesión, con el token vigente obtenido de
`GET /api/auth/session` (este POST programa una acción real en CORE):

```javascript
const response = await fetch('/api/system/power-cycle', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
  body: JSON.stringify({ wake_after_seconds: 3600 })
});
const result = await response.json();
```

Un `200` devuelve directamente los datos tipados de CORE, sin sobre ni conversión
de unidades, estados, advertencias o valores desconocidos. Por ejemplo, health
puede devolver `{"overall":"OK","sensors":[]}`. Se conservan valores `null`
legítimos de las consultas y campos futuros del agente. Se genera un UUID para
cada comando y se verifica el identificador, estado y estructura de la respuesta.
No hay reintentos ni seguimiento de redirecciones.

Los errores del puente tienen forma
`{"detail":{"code":"core_timeout","message":"..."}}`:

| HTTP | Código | Significado |
| --- | --- | --- |
| `503` | `core_unavailable` | No se pudo conectar con CORE. |
| `504` | `core_timeout` | Timeout HTTP. |
| `502` | `core_transport_error` | Se perdió la respuesta. |
| `502` | `core_http_error` | CORE devolvió HTTP no satisfactorio, incluidas redirecciones. |
| `502` | `core_invalid_response` | JSON, sobre o datos incompatibles. |
| `502` | `core_error` | Error del agente; se conserva su motivo en `message`. |

Durante una acción, timeout o pérdida de respuesta indican que **no se pudo
confirmar su ejecución**. No equivalen a cancelación: comprobar el estado del
host antes de volver a solicitarla. Las entradas inválidas devuelven `422` con
el formato de validación existente (`detail` como lista sin repetir el input).
Autenticación y CSRF mantienen sus contratos `401`/`403`.

`/api/docs` y `/api/openapi.json` requieren sesión. Swagger sirve JS, CSS y favicon
desde rutas locales también protegidas, sin CDN. La documentación es de consulta;
las acciones se realizan desde el cliente con las protecciones habituales.
`GET /api/health` sigue siendo público y comprueba Console, no CORE.

Las pruebas SYSTEM usan `unittest`, TestClient y `httpx.MockTransport`, sin
contactar con el agente real. Si `.env` cambia los orígenes de desarrollo, ejecutar
la suite con su configuración explícita:

```bash
cd kida-console/backend
KIDA_ALLOWED_ORIGINS=http://localhost:4200,http://127.0.0.1:4200 uv run python -m unittest discover -v
```

## API DOCKER

Las ocho operaciones Docker de CORE están disponibles para todos los
administradores mediante el mismo puente HTTP, configuración y cliente compartido
que SYSTEM. Console no ejecuta Docker ni el CLI. Todas requieren sesión; los POST
requieren además Origin permitido y el token CSRF vigente.

| Método y ruta | Entrada | Comando CORE |
| --- | --- | --- |
| `GET /api/docker/containers` | Ninguna | `docker.containers.list` |
| `GET /api/docker/compose/version` | Ninguna | `docker.compose.version` |
| `GET /api/docker/compose/projects` | Ninguna | `docker.compose.projects.list` |
| `GET /api/docker/compose/projects/inspect?project=demo` | Query `project` obligatoria | `docker.compose.project.inspect` |
| `POST /api/docker/containers/start` | `{"container":"id-o-nombre"}` | `docker.container.start` |
| `POST /api/docker/containers/stop` | Igual | `docker.container.stop` |
| `POST /api/docker/containers/restart` | Igual | `docker.container.restart` |
| `POST /api/docker/containers/delete` | Igual | `docker.container.delete` |

Los identificadores deben ser cadenas: se recortan los espacios exteriores y se
rechazan valores vacíos, caracteres de control (incluso en los extremos) y
surrogates Unicode aislados. Los
contenedores tampoco pueden comenzar por `-`. Los cuerpos rechazan campos extra,
valores nulos y tipos incompatibles; no hay despacho de comandos arbitrarios.

Un `200` devuelve directamente los datos de CORE: contenedores como
`{total,running,containers}`, versión como `{version}`, proyectos como array
(incluido `[]`), inspección como `{name,services}` y acciones como
`{container,status}`. Se conservan los detalles de puertos y redes, servicios sin
nombre (`null`), fechas como cadenas, valores nulos legítimos, estados desconocidos
y campos futuros. Los proyectos son observaciones del daemon: **no acreditan
propiedad de KIDA**. La eliminación ejecuta exactamente la operación de CORE,
`docker rm`, sin fuerza ni eliminación de volúmenes.

Ejemplo de consulta desde el navegador tras iniciar sesión:

```javascript
const response = await fetch('/api/docker/compose/projects', {
  credentials: 'include'
});
const projects = await response.json();
```

Ejemplo de acción con el token vigente de `GET /api/auth/session`
(este POST solicita una acción real en CORE):

```javascript
const response = await fetch('/api/docker/containers/start', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
  body: JSON.stringify({ container: 'mi-contenedor' })
});
const result = await response.json();
```

Se mantienen los errores de SYSTEM: `422` de validación local, `401` de sesión,
`403` de Origin/CSRF y los errores `core_*` descritos arriba. Un error comunicado
por el agente devuelve `502 core_error` con su motivo, incluso si indica que un
contenedor o proyecto no existe; no se convierte en `404`. No hay reintentos ni
redirecciones. Ante timeout o pérdida de respuesta de una acción, **no se pudo
confirmar su ejecución**: comprobar el estado antes de repetirla.

Estas rutas aparecen en `/api/docs` y `/api/openapi.json`, ambos protegidos por
sesión. Las pruebas Docker usan TestClient, sesiones temporales y
`httpx.MockTransport`, sin acciones contra el daemon habitual.

## API SCHEDULER

La página `/scheduler` permite a cualquier administrador autenticado listar, crear
y eliminar programaciones con estas tres rutas. Carga al entrar y ofrece
actualización manual; empieza por «Usuario», con filtros «Interno» y «Todos».
Los fallos de actualización conservan los datos anteriores, marcados como
desactualizados y con su filtro original. Solo `origin === 'USER'` ofrece borrado;
los orígenes desconocidos y campos futuros se conservan en detalles de texto.

La creación usa comando y editor JSON genéricos. Admite modalidad puntual con
fecha local del navegador y segundos, intervalo positivo, o cron con zona IANA
inicial `UTC`. La fecha puntual se convierte a RFC3339 UTC: se rechazan horas
inexistentes por cambio horario y se usa la primera ocurrencia de horas repetidas.
El diálogo muestra hora local, offset y UTC antes de confirmar. CORE conserva
la validación de comandos programables, parámetros, cron, zonas y fechas.

La UI limita intervalos a `1..9007199254740991`, frente al u64 del backend. Los
parámetros aceptan cualquier JSON con números JavaScript: rechaza no finitos y
enteros no seguros; los decimales pueden redondearse. No recorta ni normaliza
comando, parámetros o cron. Crear y borrar requieren confirmación de una copia
independiente e inmutable, renderizada como texto seguro. Cancelar no envía nada;
confirmar envía una sola petición. No hay reintentos automáticos.

Al salir o cambiar de sesión se descartan formulario, datos y confirmaciones,
sin persistir parámetros; una petición enviada puede continuar. Un timeout o
pérdida de respuesta indica «No se pudo confirmar el resultado. Actualiza el
listado antes de repetir». El éxito de una escritura se conserva aunque falle
su actualización posterior. No hay edición, ejecución inmediata, historial,
formularios por comando ni sondeo periódico.

El backend mapea los tres comandos públicos del scheduler al mismo CORE HTTP
configurado para SYSTEM y DOCKER. Todos los administradores pueden utilizarlos;
los POST requieren Origin permitido y el token CSRF vigente. Console no ejecuta
el CLI ni mantiene un scheduler propio.

| Método y ruta | Entrada | Comando CORE |
| --- | --- | --- |
| `GET /api/scheduler` | Query opcional `origin=USER`, `INTERNAL` o `ALL` | `scheduler.list` |
| `POST /api/scheduler/add` | `{command,params,schedule}` | `scheduler.add` |
| `POST /api/scheduler/delete` | `{"id":"UUID"}` | `scheduler.delete` |

Sin filtro se envían parámetros vacíos y CORE lista `USER` por defecto. El filtro
es sensible a mayúsculas. La creación pública siempre genera tareas `USER`;
consultar `INTERNAL` o `ALL` no concede permisos para crear, modificar ni borrar
tareas internas. CORE rechaza su borrado mediante el comando público. No hay
rutas de actualización o ejecución inmediata.

La creación requiere `command`, `params` y exactamente una regla `schedule`.
`params` admite cualquier valor JSON, incluido `null`, objetos, arrays y escalares.
Ejemplos de cuerpos para `POST /api/scheduler/add`:

```json
{"command":"system.info","params":{},"schedule":{"type":"once","at":"2030-01-01T12:00:00Z"}}
```

```json
{"command":"docker.containers.list","params":{},"schedule":{"type":"interval","seconds":60}}
```

```json
{"command":"system.health","params":{},"schedule":{"type":"cron","expression":"0 2 * * *","timezone":"Europe/Madrid"}}
```

`once.at` es una cadena RFC3339 con zona explícita y debe indicar una fecha futura
para CORE. `interval.seconds` debe ser positivo y compatible con los límites de
fecha y duración de CORE. Cron usa cinco campos y una zona IANA; si `timezone`
se omite, Console no la envía y CORE aplica `UTC`.

Console valida únicamente la estructura y los tipos: rechaza campos extra,
conversiones de tipos, nulos fuera de `params`, números no finitos y surrogates
Unicode aislados, también en claves o valores anidados. `seconds` debe ser un
entero entre `0` y `18446744073709551615`, sin booleanos. El valor `0`, las fechas,
cron, zonas, UUID y comandos se someten a la validación de dominio de CORE.
Las cadenas no se recortan ni normalizan; se conservan los caracteres de control
legítimos dentro de `params`. Console no duplica el catálogo de comandos ni
valida sus parámetros como si fueran peticiones a las rutas SYSTEM o DOCKER:
CORE decide qué comandos públicos pueden programarse.

Ejemplo desde el navegador tras iniciar sesión, usando el token vigente de
`GET /api/auth/session` (este POST crea una programación real en CORE):

```javascript
const response = await fetch('/api/scheduler/add', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
  body: JSON.stringify({
    command: 'system.info',
    params: {},
    schedule: { type: 'interval', seconds: 60 }
  })
});
const schedule = await response.json();
```

Las tres rutas devuelven `200` con los datos de CORE directamente. Crear y borrar
devuelven `{id,origin,command,params,schedule}`. Listar devuelve un array, incluido
`[]`, cuyas entradas añaden `next_enqueue_at`: es el próximo intento de admisión
a la cola, no una garantía de inicio o finalización. Se conservan fechas como
cadenas, valores JSON de `params`, orígenes desconocidos y campos futuros.
Borrar una programación **no cancela comandos ya encolados**, ni revierte acciones
que estos hayan programado.

Se mantienen `401` de sesión, `403` de Origin/CSRF, `422` de validación local y los
errores `core_*` descritos en SYSTEM. Los rechazos de dominio del agente devuelven
`502 core_error` con su motivo, incluido ID inexistente o borrado de una tarea
`INTERNAL`; no se convierten en `404` o `403`. No hay reintentos ni redirecciones.
Si crear o borrar termina en timeout o pérdida de respuesta, **no se pudo
confirmar su ejecución**: consultar el listado antes de repetir la petición para
evitar, por ejemplo, programaciones duplicadas.

Las rutas aparecen en Swagger y OpenAPI protegidos. Las pruebas usan sesiones
temporales, TestClient, `httpx.MockTransport` y los casos compartidos de
`tests/fixtures/scheduler.json`; no crean programaciones en el CORE habitual.

## API BACKUPS

### Configuraciones en la interfaz

La vista `/backups` permite consultar configuraciones, seleccionar sus detalles,
crear una configuración, eliminarla y solicitar su ejecución por ID. Carga al
entrar y permite actualizar manualmente, sin sondeo periódico. También incluye
Health con creación, inicio, ejecución automática, parada y eliminación; los informes siguen pendientes.

El formulario incluye orígenes y destinos con `required` y `filesystem_uuid`.
Las opciones avanzadas permiten incluir lifecycle pre/post, parámetros y schedule
en JSON y retention. Los campos anulables distinguen **Omitir**, **Valor** y
**null explícito**. No se recortan las cadenas; CORE valida las reglas de dominio.
Los JSON de entrada rechazan números no finitos y enteros fuera del rango seguro
de JavaScript. Los detalles conservan campos futuros y nulos; si una respuesta
contiene enteros fuera de ese rango, se avisa de precisión limitada.

Solicitar un backup y eliminar una configuración requieren confirmación con
nombre e ID. Eliminar una configuración no elimina archivos. `QUEUED` indica
admisión y muestra `execution_id`; no confirma el inicio ni la finalización.
Schedule y retention son metadatos: no crean programaciones ni ejecutan limpieza.

Ante una actualización fallida se conserva la última lectura y se marca como
desactualizada. Un éxito de escritura se muestra separado de un fallo posterior
de actualización. Un resultado incierto se conserva al refrescar y no se reenvía
automáticamente: volver a listar configuraciones no confirma si se admitió un
backup. Los datos se limpian al salir o cambiar de sesión.

La verificación automatizada usa exclusivamente API simulada. Resultados,
comandos reproducibles y pasos de validación humana en
[`backups.verification.md`](frontend/src/app/pages/backups/backups.verification.md).

### Health en la interfaz

Backup Health permite listar el historial, seleccionar una ejecución por `run_id`
y consultar su detalle. El historial aporta además procedencia de restauración,
versión del registro y estado del informe; se muestran separados del detalle.
La vista expone diagnóstico, evidencias y logs como texto seguro, artefacto,
servicios, recursos registrados, proyecto, restauración y limpieza. CORE decide
la limpieza y el diagnóstico técnico requiere validación funcional del administrador.
Los estados futuros, campos adicionales y nulos permanecen disponibles en JSON;
se avisa de enteros fuera del rango seguro de JavaScript.

Para crear Health, indicar una ruta de definición existente en el host CORE y
seleccionar `MANUAL` o `AUTOMATIC`. Console transmite la ruta intacta y no abre
ese fichero. **Crear no inicia la ejecución, tampoco en modo automático.**
La respuesta identifica Health mediante `run_id`; no es un `execution_id` de cola.
El detalle permite **Iniciar Health**, **Detener Health** y **Eliminar Health**,
sin restringirlos por estados conocidos: CORE decide su validez. El formulario
separado **Ejecutar Health automático** envía únicamente `definition_path`, sin
modo. Ambos formularios usan su propia ruta en CORE y conservan espacios y
componentes de la ruta sin normalizarlos.

Las cuatro operaciones requieren confirmación local de una instantánea de
acción y destino: nombre/`run_id` o ruta exacta. Cancelar o Escape no envía nada.
Iniciar y ejecutar devuelven admisión `{run_id,state,execution_id}`; se distinguen
los identificadores y no se afirma inicio ni finalización. Tras éxito se refrescan
historial y detalle, seleccionando el `run_id` devuelto para inicio/ejecución.
Una lectura correcta limpia la selección si ya no existe. Detener/eliminar
conservan su respuesta completa, `cleanup`, errores y recursos registrados aunque
la ejecución desaparezca del historial; la respuesta no prueba limpieza efectiva.

La carga es al entrar y bajo actualización manual, sin sondeo. Se conserva la
última lectura ante errores; el éxito de creación se muestra separado de los
fallos de actualización. Las escrituras inciertas conservan avisos con acción y
destino incluso tras refrescar o escribir después; no se repiten automáticamente.
Actualizar el historial no resuelve la incertidumbre. El formulario automático
conserva su ruta al cancelar o fallar y solo la limpia tras éxito confirmado.
Configuraciones y Health comparten el bloqueo de operaciones para evitar
escrituras simultáneas, también mientras hay confirmación pendiente. Al salir o cambiar de sesión se descartan consumidores
y se limpian datos y formularios, también en páginas cacheadas de Ionic.

Pruebas y pasos de validación humana, exclusivamente con API simulada, en
[`health-operations.verification.md`](frontend/src/app/pages/backups/health-operations.verification.md).

### Contratos del backend

Las 14 operaciones públicas de Backups utilizan el mismo puente HTTP y CORE
configurado para SYSTEM. Todos los administradores pueden utilizarlas con sesión;
los POST requieren Origin permitido y CSRF. Console no ejecuta el CLI ni abre,
resuelve o comprueba los ficheros referenciados: las rutas corresponden al host de
CORE. No hay subida/edición de ficheros, descarga de artefactos, seguimiento nuevo
de ejecuciones ni tareas de fondo en Console.

| Método y ruta | Entrada | Comando CORE |
| --- | --- | --- |
| `GET /api/backup/config` | Ninguna | `backup.config.list` |
| `POST /api/backup/config/create` | Configuración descrita debajo | `backup.config.create` |
| `POST /api/backup/config/delete` | Exactamente uno de `{id}` o `{name}` | `backup.config.delete` |
| `POST /api/backup/run` | Exactamente uno de `{id}` o `{name}` | `backup.run` |
| `GET /api/backup/health` | Ninguna | `backup.health.list` |
| `GET /api/backup/health/get?run_id=UUID` | Query `run_id` obligatoria | `backup.health.get` |
| `POST /api/backup/health/create` | `{definition_path,mode}` | `backup.health.create` |
| `POST /api/backup/health/start` | `{run_id}` | `backup.health.start` |
| `POST /api/backup/health/run` | `{definition_path}` | `backup.health.run` |
| `POST /api/backup/health/stop` | `{run_id}` | `backup.health.stop` |
| `POST /api/backup/health/delete` | `{run_id}` | `backup.health.delete` |
| `GET /api/backup/health/reports` | Ninguna | `backup.health.report.list` |
| `GET /api/backup/health/reports/get?run_id=UUID` | Query `run_id` obligatoria | `backup.health.report.get` |
| `POST /api/backup/health/reports/delete` | `{run_id}` | `backup.health.report.delete` |

Crear configuración requiere `name` (cadena), `sources` (array de rutas) y
`targets` (array de objetos con `path`, `required` booleano opcional y
`filesystem_uuid` cadena o null opcional). También admite `compression`
(`tar_zstd`), `lifecycle` con arrays `pre_backup` y `post_backup` de
`{command,params}`, `schedule` con cualquier JSON y `retention` con `max_age`
(cadena o null), `keep_last` (entero u32 o null) y `protected_restore_points`
(array de cadenas). `params` admite cualquier JSON, incluido null. Los campos
omitidos no se envían: CORE aplica sus predeterminados (`tar_zstd`, lifecycle
vacío, target requerido, params null y puntos protegidos vacíos). `schedule` y
`retention` admiten null; compression, lifecycle y arrays no. Los selectores
requieren exactamente una cadena, sin null explícito. Health create requiere
modo `AUTOMATIC` o `MANUAL`; Health run realiza el flujo automático de CORE.

Ejemplo mínimo de cuerpo para `POST /api/backup/config/create`:

```json
{"name":"daily","sources":["/srv/data"],"targets":[{"path":"/mnt/backups"}]}
```

Ejemplo completo (los comandos lifecycle también se validan en CORE):

```json
{
  "name": "daily",
  "sources": ["/srv/data"],
  "targets": [{"path":"/mnt/backups","required":true,"filesystem_uuid":null}],
  "compression": "tar_zstd",
  "lifecycle": {
    "pre_backup": [{"command":"system.info","params":{}}],
    "post_backup": []
  },
  "schedule": {"note":"metadata"},
  "retention": {"max_age":"7d","keep_last":3,"protected_restore_points":[]}
}
```

Los tipos son estrictos, sin conversiones, recortes ni normalización de cadenas.
Se rechazan campos extra, números no finitos y surrogates aislados, también en
claves y valores JSON anidados. `keep_last` admite `0..4294967295`, sin booleanos.
CORE valida UUID, referencias, rutas, definiciones, lifecycle y estados operativos.
`schedule` y `retention` son **metadatos**: no programan ejecuciones ni podan
archivos por sí solos. Eliminar una configuración no borra sus archivos de backup.

Todas las rutas devuelven `200` con los datos de CORE directamente. Config list
responde `{backups:[...]}` y create/delete devuelven el `BackupJob` completo.
Backup run devuelve `{state,execution_id}`; Health start/run añaden `run_id`.
`QUEUED` confirma admisión, no finalización. `run_id` identifica la ejecución de
Health y `execution_id` la ejecución en la cola; son identificadores distintos.
Health create/get/stop/delete devuelven la ejecución completa, con definición,
diagnóstico, evidencias, artefacto, proyecto gestionado, servicios, recursos y
limpieza. Health list devuelve un array de registros con esa ejecución aplanada
y `record_version`, `restore_provenance` y `report_status`.

Los informes se listan como array de IDs; consultar devuelve `{run_id,markdown}`
y eliminar `{run_id,deleted}`. Markdown viaja como cadena JSON, sin renderizar
HTML. Se conservan arrays vacíos, nulos legítimos, fechas como cadenas, campos
futuros y estados/modos/resultados de respuesta desconocidos. Los resultados
técnicos de Health **no garantizan integridad funcional**: requieren validación
del administrador. Stop/delete conservan las reglas de limpieza y procedencia de
CORE; revisar `cleanup` y los recursos conservados.

Ejemplo tras iniciar sesión, con el token vigente de `GET /api/auth/session`
(este POST solicita una acción real en CORE):

```javascript
const response = await fetch('/api/backup/health/create', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
  body: JSON.stringify({ definition_path: '/srv/health/app.toml', mode: 'MANUAL' })
});
const execution = await response.json();
```

Se mantienen `401`, `403`, `422` y los errores `core_*` descritos en SYSTEM.
Los errores del agente siguen siendo `502 core_error`, aunque indiquen ausencia
o conflicto; no se deduce un código HTTP de su texto. Todos los POST son acciones.
Ante timeout o pérdida de respuesta, **no se pudo confirmar su ejecución**:
consultar el estado antes de repetir. No hay reintentos ni redirecciones.
Los contratos tipados aparecen en Swagger y OpenAPI protegidos. Las pruebas
usan las fixtures compartidas de backup y Health, sesiones temporales y CORE
simulado; no ejecutan backups ni Health contra el entorno habitual.
