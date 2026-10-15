```
888    d8P  8888888 8888888b.        d8888  v0.0.4
888   d8P     888   888  "Y88b      d88888  CORE
888  d8P      888   888    888     d88P888
888d88K       888   888    888    d88P 888
8888888b      888   888    888   d88P  888
888  Y88b     888   888    888  d88P   888
888   Y88b    888   888  .d88P d8888888888
888    Y88b 8888888 8888888P" d88P     888
```

> KIDA is the intelligent agent at the core of your server, quietly watching over the place, automating operations, and keeping everything under control.

# What is KIDA CORE

KIDA CORE ejecuta las operaciones del servidor y permite programar comandos persistentes con SCHEDULER. Puedes acceder a sus comandos mediante HTTP o Unix socket.

# Using KIDA CORE

KIDA tiene 2 formas de comunicación: HTTP y Unix socket. En ambos casos, el formato de entrada es JSON. Algunos ejemplos son:

```bash
curl -X POST http://127.0.0.1:8989/command -H 'Content-Type: application/json' -d '{"id": "1", "command": "system.health", "params": {}}'

echo '{"id": "1", "command": "system.health", "params": {}}' | socat - UNIX-CONNECT:/tmp/kida.sock
```

## Configurar la capacidad de la cola

En `/etc/kida/kida.toml`, puedes ajustar cuántos comandos pendientes admite la cola compartida por los backups manuales y SCHEDULER:

```toml
[queue]
capacity = 16
max_concurrent_jobs = 2
```

El valor predeterminado es 16 si se omite la sección o el campo. La capacidad debe ser mayor que cero; con cero, CORE devuelve un error al arrancar. El worker permite hasta `queue.max_concurrent_jobs` ejecuciones simultáneas (2 por defecto); este valor también debe ser positivo y respetar los límites de concurrencia y admisión. Los `backup.run` se ejecutan de uno en uno. Reinicia CORE para aplicar los cambios.

## Crear configuraciones de backup

`backup.config.create` recibe la configuración directamente en `params`.
CORE es independiente del modo de entrada: CLI puede leer un TOML local,
componer parámetros o usar su asistente, y envía el mismo contrato JSON.
El payload antiguo `{"file":"ruta.toml"}` se rechaza.

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{
    "id": "create-backup",
    "command": "backup.config.create",
    "params": {
      "name": "daily",
      "sources": ["/etc/hosts"],
      "targets": [
        {"path": "../primary", "filesystem_uuid": "volume-id"},
        {"path": "./secondary", "required": false}
      ],
      "compression": "tar_zstd",
      "lifecycle": {
        "pre_backup": [{"command": "system.health", "params": null}],
        "post_backup": []
      },
      "schedule": {"custom": [null, 1]},
      "retention": {
        "max_age": "7d",
        "keep_last": 7,
        "protected_restore_points": ["point-a"]
      }
    }
  }'
```

`name`, `sources` y `targets` son obligatorios. Cada target exige `path`;
`required` tiene default `true` y `filesystem_uuid` es opcional. La compresión
actual es `tar_zstd` y se aplica si se omite. `lifecycle` es opcional y sus listas
`pre_backup` y `post_backup` tienen default vacío. Cada comando exige `command`;
`params` acepta JSON arbitrario y tiene default `null`.

`schedule` y `retention` son opcionales. En retention, `max_age` es una cadena
opcional, `keep_last` es un entero opcional de 0 a 4294967295 y
`protected_restore_points` es una lista de cadenas con default vacío. Los valores
JSON libres se guardan como cadenas JSON en la representación TOML persistida;
los jobs TOML antiguos siguen siendo legibles. Los tipos JSON de la API se conservan.

Una respuesta `OK` devuelve el job completo en `data`, con un UUID nuevo en
`data.id`. Las rutas de sources y targets se conservan literalmente; su existencia
se comprueba al ejecutar el backup. `schedule` solo guarda metadata: no crea una
programación. Usa `scheduler.add` para programar `backup.run` con el ID o nombre del job.

Los tres modos de CLI son:

```bash
kida backup config create -f ./backup-job.toml
kida backup config create --name daily --source /etc/hosts --target ../backups
kida backup config create
```

Consulta las [opciones y defaults de CLI](../kida-cli/README.md#create-a-backup-job).

## Consultar Docker Compose

CORE ofrece tres comandos de solo lectura, mediante HTTP o Unix socket:

```json
{"id":"compose-version","command":"docker.compose.version","params":{}}
{"id":"compose-list","command":"docker.compose.projects.list","params":{}}
{"id":"compose-inspect","command":"docker.compose.project.inspect","params":{"project":"my-project"}}
```

`docker.compose.version` ejecuta `docker compose version --short`. Devuelve
`data: {"version":"2.40.0"}` si el plugin puede ejecutarse, o `ERROR` con el
diagnóstico. Esto no comprueba la disponibilidad del daemon. Se utiliza el plugin
`docker compose`, sin fallback al ejecutable antiguo `docker-compose`.

Las consultas de inventario solo necesitan acceso al daemon mediante `docker`;
funcionan aunque el plugin Compose no esté instalado. Descubren los contenedores
mediante `com.docker.compose.project`, incluidos los detenidos, y los inspeccionan.
No leen archivos Compose: un proyecto sin contenedores presentes y los servicios
sin contenedores no aparecen.

`docker.compose.projects.list` devuelve en `data` un array (vacío si no hay
proyectos). `docker.compose.project.inspect` devuelve un único proyecto:

```json
{
  "name": "my-project",
  "services": [
    {"name": "web", "containers": []}
  ]
}
```

El esquema anterior abrevia la lista de contenedores: cada entrada real conserva
los campos de `docker.containers.list`, incluidos `id`, `name`, `image`, `online`,
`status`, `health`, fechas, código de salida, reinicios, puertos y redes. Las
réplicas se agrupan por servicio; los contenedores sin etiqueta de servicio se
agrupan bajo `name: null`. Proyectos y servicios se ordenan por nombre, y los
contenedores por ID. No se sintetiza un estado agregado del proyecto.

`params.project` debe ser una cadena no vacía; se recortan espacios exteriores.
Un proyecto inexistente o un fallo de Docker devuelve `ERROR`, sin resultado
parcial. El nombre identifica el proyecto únicamente dentro del daemon/contexto
Docker consultado: no es un identificador global ni acredita propiedad de KIDA.
Los modelos `ComposeVersion`, `ComposeProject` y `ComposeService` se exportan desde
`features::docker`, junto con los modelos existentes de contenedores, para su
reutilización interna. El protocolo y la CLI mantienen únicamente estas consultas
Compose; el lifecycle siguiente es interno.

### Diagnóstico Docker interno

Estos métodos asíncronos de `DockerService` son internos y no registran comandos
ni cambian el protocolo o las respuestas de las consultas existentes:

```rust
let timeout = std::time::Duration::from_secs(10);
let container = DockerService::inspect_container("my-container", timeout).await?;
let project = DockerService::diagnose_compose_project("my-project", timeout).await?;
let logs = DockerService::container_logs("my-container", 100, timeout).await?;
```

`ContainerDiagnostics` contiene `container: DockerContainer`, `oom_killed:
Option<bool>` y `docker_error: Option<String>`. Valida identidad y datos técnicos
antes del mapeo; datos incompletos o mal tipados son errores. El healthcheck es
opcional; si está presente, su estado debe ser `healthy`, `unhealthy` o `starting`.
Conserva fechas y valores reportados: son observaciones actuales, sin reconstruir
historiales ni inferir OOM a partir del código de salida. OOM y error técnico
ausentes son `None`; una cadena de error vacía se conserva.

`ComposeDiagnostics` contiene `project`, `containers` (cada elemento con `service:
Option<String>` y `diagnostics`) y `errors` (cada elemento con `id` y `error`).
Valida el identificador de proyecto y enumera todos los contenedores presentes,
incluidos los detenidos, mediante etiquetas Compose e IDs completos. Inspecciona
cada ID y comprueba identidad y proyecto. Conserva los éxitos ante desapariciones,
fallos o datos incompletos individuales. Un fallo o respuesta inválida al enumerar
es global; una enumeración vacía válida produce un diagnóstico vacío. No permite
inferir servicios declarados sin contenedores ni acredita propiedad de KIDA.
Un único plazo cubre toda la operación; al agotarse, conserva resultados y marca
los IDs pendientes sin iniciar más comandos.

`ContainerLogs` contiene `container`, `tail: u32`, `stdout: Vec<u8>`, `stderr:
Vec<u8>` y `warning`. Ejecuta `docker container logs --tail N` sin seguimiento;
acepta de 1 a 10.000 líneas y requiere un timeout positivo, como las demás
consultas. Limita cada canal a 1 MiB: exceder cualquiera devuelve un error,
sin entregar contenido parcial. No interpreta, imprime ni persiste el contenido,
y los errores de ejecución de logs tampoco lo incluyen. **Los logs pueden contener
credenciales y datos personales**; el resultado incorpora esta advertencia para
que el consumidor gestione su exposición. Docker puede no proporcionar logs con
algunos drivers; stdout/stderr conservan exactamente los canales del proceso CLI.
Las consultas reutilizan la terminación y recolección de procesos del lifecycle.

Las pruebas automáticas usan Docker simulado con PATH aislado. La aceptación real
requiere un daemon accesible y la imagen local `busybox:1.37`; no descarga imágenes
ni utiliza red, y elimina únicamente su contenedor temporal de prueba:

```bash
KIDA_DOCKER_DIAGNOSTICS_REAL=1 cargo test -p kida-core features::docker::diagnostics_tests::diagnostics_real -- --exact --ignored --nocapture
```

Esta aceptación no provoca OOM ni altera contenedores de producción; OOM se
verifica con evidencia explícita en las respuestas del Docker simulado.

### Lifecycle Compose interno

`features::docker` exporta `ComposeOptions` y estos métodos de `DockerService`:

```rust
let mut options = ComposeOptions::new("my-project", "/srv/my-project/compose.yaml");
options.variables.insert("APP_TAG".into(), "stable".into());
// options.timeout = std::time::Duration::from_secs(300); // valor predeterminado
DockerService::compose_create(&options).await?; // Result<(), String>
DockerService::compose_start(&options).await?;
let project = DockerService::compose_project(&options.project)?; // inspección existente
DockerService::compose_stop(&options).await?;
```

`ComposeOptions` contiene `project: String`, `file: PathBuf`,
`variables: BTreeMap<String, String>` y `timeout: Duration`. El proyecto explícito
cumple `[a-z0-9][a-z0-9_-]*`, sin normalización. Se canonicaliza un único archivo
local regular; su directorio se pasa como `--project-directory`. Las rutas deben
ser UTF-8 y no contener comas, porque la etiqueta nativa de archivos usa comas
sin escape. Las variables deben tener nombres de entorno portables y valores sin
NUL. Se rechazan `DOCKER_*`, `COMPOSE_*`, `PATH`, `HOME`, `XDG_CONFIG_HOME`,
`LD_*` y `DYLD_*` antes de ejecutar Docker.

Todos los argumentos se pasan separados, sin shell. Las variables se inyectan
solo en los hijos; se conserva el destino/contexto Docker heredado. Se fuerzan
los perfiles predeterminados (`COMPOSE_PROFILES` vacío) y se desactiva la
eliminación automática de huérfanos del entorno. No se ofrecen selección de
servicios ni perfiles. La única combinación adicional es el archivo de propiedad generado por KIDA. Compose resuelve y valida el
documento con `compose config --format json`, incluidas su interpolación y rutas;
CORE solo lee el modelo JSON resultante para Create y Start. Stop comprueba la
procedencia y ejecuta directamente `compose stop`, sin resolver `env_file` ni
comprobar la existencia de redes o volúmenes externos. El archivo Compose
principal debe seguir existiendo y ser válido para el comando nativo.

Create rechaza contenedores, redes o volúmenes etiquetados con el proyecto,
nombres explícitos de contenedores ocupados y nombres resueltos de redes y
volúmenes no externos ya existentes. Ejecuta
[`compose create --no-recreate`](https://docs.docker.com/reference/cli/docker/compose/create/)
sin arrancar contenedores ni cambiar las políticas nativas de build/pull.
Para Create y Start, los recursos `external: true` deben existir y los gestiona
Compose.

Start y Stop requieren contenedores presentes. En cada uno se exige coincidencia
exacta de las etiquetas nativas `com.docker.compose.project`,
`com.docker.compose.project.config_files` (archivo canonicalizado y, si está gestionado, archivo adicional de propiedad) y
`com.docker.compose.project.working_dir`. Se rechaza procedencia ausente, mixta,
ambigua o con archivos distintos de los registrados. Se admiten proyectos creados fuera de KIDA con un único archivo coincidente; Start/Stop no los incorporan al registro. Se usan las
[etiquetas oficiales de Compose](https://github.com/docker/compose/blob/main/pkg/api/labels.go).
[`compose start`](https://docs.docker.com/reference/cli/docker/compose/start/)
no espera salud; [`compose stop`](https://docs.docker.com/reference/cli/docker/compose/stop/)
conserva IDs, contenedores, redes y volúmenes. Ambos actúan sobre todos los
servicios habilitados por defecto, sin selección explícita.

Las operaciones del mismo proyecto se serializan dentro del proceso KIDA.
El timeout cubre la espera de ese bloqueo, las comprobaciones y el comando final,
con captura concurrente mediante `tokio::process`. Las consultas admiten hasta
8 MiB de stdout; superar ese límite termina el proceso y devuelve un error sin
analizar datos truncados. Create, Start y Stop descartan stdout. De stderr se
conservan los primeros 64 KiB y se drena el resto; los errores indican si el
diagnóstico fue truncado. Al vencer el timeout se mata y recoge el proceso; en
Unix también se termina su grupo, incluido el
plugin. Los errores distinguen entrada, conflicto, Docker/plugin ausente, daemon
inaccesible, salida inválida, fallo del comando y timeout. Un fallo puede dejar
recursos parciales: no hay rollback ni limpieza automática. No se garantiza
exclusión frente a clientes Docker externos ni cambios del archivo durante una
operación. No se usan `down` ni operaciones globales.

### Propiedad y eliminación selectiva de Docker

La configuración global admite una sección opcional, compatible con configuraciones anteriores:

```toml
[docker]
ownership_dir = "/etc/kida/docker.d"
```

El registro se abre al invocar el lifecycle, nunca durante el arranque. CORE requiere
permisos de escritura para Create y Remove. Cada creación reserva un UUID y un JSON
versionado mediante `JsonStorage` antes de ejecutar Create. Registra daemon, proyecto,
procedencia, hashes de archivos, recursos externos e identidades verificadas. Los
contenedores y redes usan IDs completos; los volúmenes se identifican por nombre,
fecha de creación, driver, ámbito, opciones, punto de montaje y etiquetas.

KIDA conserva el Compose original y genera un archivo adicional persistente con
`io.kida.owner=<uuid>` en servicios, redes y volúmenes no externos. Compose combina
ambos según sus [reglas de merge](https://docs.docker.com/reference/compose-file/merge/).
Create rechaza etiquetas de usuario `io.kida.*`, colisiones y proyectos con registro
activo o pendiente. Start/Stop reutilizan ambos archivos y exigen que sus hashes,
procedencia, daemon, identidades y etiquetas concuerden. Los proyectos ajenos conservan
su contrato anterior y nunca se adoptan por nombre ni por etiquetas.

Contratos internos, sin comandos CLI ni cambios de protocolo:

```rust
let reference = DockerService::compose_managed_project("my-project").await?;
let report = DockerService::compose_remove(&reference, Duration::from_secs(60)).await?;
// reference: ManagedProject { owner, project }
// report: removed, absent, preserved, failed; cada entrada incluye kind, identity, reason
// report.errors: errores generales de persistencia o timeout; comprobar failed y errors.
```

La referencia corresponde a una creación concreta. Los registros completados se
conservan para reconocer repeticiones; una referencia antigua no puede borrar una
creación posterior con el mismo proyecto. Remove no lee el Compose ni necesita su
plugin. Antes de cualquier mutación exige inventario válido, daemon e identidades
concordantes y todos los contenedores gestionados detenidos. Recursos adicionales
con etiquetas coincidentes son ambiguos: bloquean la operación sin adopción.

Remove elimina individualmente contenedores por ID, redes por ID y finalmente
volúmenes verificados. Reinspecciona antes de borrar, sin `--force`, `rm -v`,
`compose down`, desconexiones ajenas ni limpieza global. Examina todos los
contenedores, incluidos los detenidos, y las conexiones de red. Conserva redes y
volúmenes que sigan en uso; continúa con los exclusivos. Conserva recursos externos,
bind mounts y volúmenes anónimos sin propiedad acreditada. Solo elimina volúmenes
con driver `local`, ámbito `local` y opciones nulas o vacías; los demás aparecen
como conservados con un motivo explícito.

Cada identidad se persiste en cuanto se verifica tras Create; un fallo conserva el
registro pendiente, sin rollback. Tras un reinicio solo se recuperan identidades ya
persistidas: no se descubre propiedad a partir de etiquetas. Un registro pendiente
bloquea Create/Start/Stop; Remove puede retirar sus recursos acreditados si el inventario
no contiene ambigüedades. La pérdida del registro impide autorizar la eliminación.
Un registro corrupto bloquea las operaciones y no se sobrescribe. Los avances de
Remove se guardan tras cada recurso y los registros parciales permiten reintentos.
Solo una consulta válida confirma ausencia; un error Docker se informa como fallo.
Los errores previos se devuelven sin mutaciones; los posteriores quedan en el informe,
con los recursos no intentados señalados como conservados.

Se presupone un único proceso KIDA escritor por directorio y un registro confiable.
No existe exclusión frente a clientes Docker externos. Las reinspecciones reducen la
ventana de carrera; Docker rechaza eliminar redes conectadas y volúmenes utilizados.
La protección evita adopciones accidentales y copias simples de etiquetas, pero no
protege frente a un administrador que controle Docker y el registro. No hay limpieza
al arrancar ni integración con Backup Health, Worker o Scheduler.

El lifecycle mantiene exclusión por proyecto, incluida la consulta de referencia y la
persistencia; proyectos distintos pueden avanzar simultáneamente. El registro
presupone un único proceso escritor y sustitución atómica de cada JSON mediante
`JsonStorage`; se sigue leyendo y validando el registro completo.

El timeout es un presupuesto para iniciar y continuar trabajo. La E/S de disco ya
iniciada se espera hasta terminar, incluso si vence el plazo; no se garantiza un
límite estricto de respuesta con disco bloqueado. Una cancelación conserva el
bloqueo del proyecto hasta terminar esa E/S. Tras vencer el plazo no se inician
nuevos comandos ni guardados. Durante la eliminación, los fallos de persistencia
y timeout se devuelven en `RemovalReport.errors`, conservando los resultados
confirmados y preservando los recursos restantes por interrupción. El consumidor
debe comprobar tanto `failed` como `errors`. Los errores anteriores al recorrido
siguen siendo `Err(String)`.

Verificación simulada (sin daemon; el Docker simulado en Unix usa Python 3):

```sh
cargo test -p kida-core features::docker
```

Aceptación real optativa (requiere daemon, plugin Compose e imagen descargable):

```sh
KIDA_COMPOSE_REAL=1 cargo test -p kida-core compose_lifecycle_real -- --ignored --nocapture
```

Esta prueba usa los métodos internos, crea dos proyectos únicos y un archivo en
`/tmp/kida-accept-.../compose.yaml`, con dos servicios, tres contenedores, una red
y un volumen por proyecto. Comprueba Create → Start → Inspect → Stop, conserva
las identidades de los recursos y compara el estado del proyecto de control
antes y después. Imprime proyectos y recursos y deja ambos detenidos sin borrar
contenedores, redes, volúmenes ni archivos. Las pruebas normales no ejecutan esta
aceptación; sus resultados simulados no acreditan el comportamiento de un daemon
real.

Aceptación real de eliminación, con autorización **independiente** y desactivada por defecto:

```sh
KIDA_DOCKER_REMOVE_REAL=1 cargo test -p kida-core features::docker::lifecycle_tests::compose_remove_real -- --exact --ignored --nocapture
```

Crea recursos nuevos bajo un proyecto único y otro de control; elimina únicamente
la creación de prueba con los contenedores detenidos y el Compose original ausente,
verifica idempotencia y compara el control. Deja el control detenido, sus recursos y
el registro para inspección. No ejecutar sin autorización expresa para crear y borrar
estos recursos. Las pruebas simuladas cubren estado persistente, reinicio del consumidor,
interrupciones, reintentos, conflictos, uso compartido y prohibición de comandos forzados.

## Programar comandos con SCHEDULER

SCHEDULER permite programar cualquier comando registrado en KIDA CORE, incluidos `scheduler.add`, `scheduler.list` y `scheduler.delete`. Los ejemplos usan HTTP; los mismos mensajes JSON se pueden enviar por Unix socket.

La ruta del archivo de programaciones se configura en `/etc/kida/kida.toml`:

```toml
[scheduler]
path = "/etc/kida/scheduler.toml"
```

Si omites la sección o el campo, se usa `/etc/kida/scheduler.toml`. Reinicia CORE para aplicar los cambios de ruta. CORE necesita permisos para escribir en el directorio configurado. Si el archivo no existe, empieza sin programaciones; si está corrupto, CORE no arranca y no lo sobrescribe.

### Crear una programación

Envía la definición directamente en `params`, con `command`, `params` y `schedule`. Los parámetros del comando programado son obligatorios y pueden contener cualquier valor JSON, incluido `null`.

Para intentar ejecutar `health` cada 60 segundos:

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{
    "id": "schedule-health",
    "command": "scheduler.add",
    "params": {
      "command": "health",
      "params": {},
      "schedule": {"type": "interval", "seconds": 60}
    }
  }'
```

Una respuesta `OK` devuelve en `data` la definición con su UUID en `data.id`. Guarda ese UUID para eliminarla. El `id` exterior identifica la petición, no la programación.

`interval.seconds` debe ser un entero positivo. El primer intento ocurre un intervalo después del alta; los siguientes mantienen el anclaje original incluso después de reiniciar CORE.

Para un único intento, usa `once` con una fecha futura RFC3339 y desplazamiento horario explícito (`Z` o, por ejemplo, `+02:00`). Sustituye la fecha del ejemplo por la que necesites:

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{
    "id": "schedule-once",
    "command": "scheduler.add",
    "params": {
      "command": "health",
      "params": null,
      "schedule": {"type": "once", "at": "2027-01-15T10:00:00+01:00"}
    }
  }'
```

Para un intento diario a las 02:30 en Madrid:

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{
    "id": "schedule-cron",
    "command": "scheduler.add",
    "params": {
      "command": "health",
      "params": {},
      "schedule": {
        "type": "cron",
        "expression": "30 2 * * *",
        "timezone": "Europe/Madrid"
      }
    }
  }'
```

CRON acepta cinco campos: minuto, hora, día del mes, mes y día de la semana. La zona debe ser IANA; si omites `timezone`, se usa `UTC`. Cuando el día del mes y el día de la semana están restringidos, basta que coincida uno de ellos. En cambios horarios, las horas locales inexistentes se omiten y cada coincidencia de una hora repetida se intenta una sola vez, en su primera aparición.

El alta valida el comando registrado y la regla temporal. Los parámetros específicos del comando y los recursos referenciados se validan al ejecutar, no al crear la programación.

### Listar y eliminar

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{"id":"list-schedules","command":"scheduler.list","params":{}}'
```

Sin filtro, `scheduler.list` devuelve solo programaciones `USER`. También acepta `params: null` con ese mismo resultado. Para consultar las internas o todas, envía `{"origin":"INTERNAL"}` o `{"origin":"ALL"}` en `params`; los valores del protocolo son `USER`, `INTERNAL` y `ALL`, en mayúsculas.

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{"id":"list-all-schedules","command":"scheduler.list","params":{"origin":"ALL"}}'
```

Una respuesta `OK` contiene en `data` un array con `id`, `origin`, `command`, `params`, `schedule` y `next_enqueue_at` para cada programación, en su orden almacenado. Si no hay coincidencias, devuelve `[]`. El origen de una entrada es `USER` o `INTERNAL`; `ALL` solo es un filtro. `next_enqueue_at` está en UTC e indica el vencimiento pendiente de admisión, no un inicio de ejecución garantizado. Si la cola está llena, esa fecha puede quedar en el pasado mientras se espera un reintento.

`scheduler.add` crea siempre entradas `USER`. Las entradas `INTERNAL` las gestiona CORE mediante su API interna. Los comandos públicos de alta y borrado no aceptan un campo de origen para cambiar sus permisos.

Para eliminar una programación, sustituye `UUID_DEVUELTO` por su UUID:

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{
    "id": "delete-schedule",
    "command": "scheduler.delete",
    "params": {"id": "UUID_DEVUELTO"}
  }'
```

La respuesta `OK` devuelve la definición eliminada y garantiza que esa programación no producirá nuevos encolados. No elimina peticiones ya encoladas ni interrumpe ejecuciones. Un UUID inválido, inexistente o perteneciente a una entrada `INTERNAL` devuelve `ERROR`. El borrado público solo permite eliminar entradas `USER`. No existe `scheduler.modify`: para sustituir una programación, elimínala y crea otra mediante operaciones independientes.

### Qué ocurre al vencer o reiniciar

- Los comandos programados comparten la cola FIFO y el worker con los backups manuales. El worker limita las ejecuciones simultáneas mediante `queue.max_concurrent_jobs` (2 por defecto); los `backup.run` se ejecutan de uno en uno. Se pueden encolar nuevos vencimientos aunque una ejecución anterior siga pendiente o ejecutándose. El orden de admisión no garantiza el orden de inicio o finalización.
- Se intenta admitir primero el vencimiento más antiguo, tanto para entradas `USER` como `INTERNAL`. En caso de empate se conserva el orden almacenado. Así, las recurrencias recién vencidas no adelantan a entradas que llevan más tiempo pendientes.
- Si la cola está llena, se conserva el vencimiento pendiente y se vuelve a intentar su admisión al cabo de un segundo, medido con reloj monotónico. El temporizador comprueba periódicamente el plazo; no se garantiza un instante exacto de admisión.
- Una `once` se elimina después de admitirse en la cola. Si aún está pendiente cuando CORE se detiene y su fecha ya pasó al reiniciar, se elimina al arrancar sin ejecutarse.
- Las recurrencias conservan un único vencimiento pendiente durante la saturación. Tras admitirlo, avanzan directamente a una fecha futura manteniendo su regla y anclaje, sin ráfagas para recuperar cada repetición omitida. No se recuperan peticiones encoladas ni ejecuciones interrumpidas tras reiniciar. Admitir una petición no garantiza su ejecución ni ofrece ejecución exactamente una vez.
- Al encolar se conserva únicamente el comando y sus parámetros. Los recursos referenciados se resuelven al ejecutar; borrar una programación no cambia las peticiones ya encoladas.
- Un fallo de persistencia durante el procesamiento de vencimientos o una cola cerrada termina CORE con error; no se reintenta automáticamente desde SCHEDULER.
- SCHEDULER no ofrece historial, consulta de ejecuciones ni cancelación. El campo `schedule` de una configuración de backup no activa automáticamente una programación.

### Compatibilidad al actualizar

Actualiza CORE antes que CLI. La CLI actual exige `origin` en las respuestas del scheduler y rechaza las respuestas del CORE anterior que no lo incluyen, incluso si el alta o borrado se completó. No repitas automáticamente un alta por un error de presentación: consulta primero las programaciones existentes.

CORE lee archivos anteriores sin `origin` y trata esas entradas como `USER`. Al guardar, escribe el campo en cada entrada. El CORE anterior rechaza ese formato: conserva un respaldo antes de actualizar si necesitas poder volver a esa versión. No elimines el campo de entradas `INTERNAL` para forzar compatibilidad, porque perderían su protección de origen.

# License and trademarks
