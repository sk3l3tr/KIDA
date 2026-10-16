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

El servidor Unix conserva los sockets activos y rechaza archivos, directorios y enlaces en la ruta configurada. Solo recupera un socket obsoleto cuando la conexión devuelve `ConnectionRefused`; los errores de permisos y de comprobación impiden el arranque sin borrar esa entrada.

Para excluir arranques simultáneos de KIDA, mantiene un bloqueo en `<ruta-del-socket>.lock` durante la vida del listener. Este archivo permanece tras detener el servidor; no debe borrarse mientras haya instancias activas. El directorio debe permitir crear el socket y su archivo de bloqueo y estar protegido frente a modificaciones ajenas. La reserva coordina instancias de KIDA que usan este mecanismo; no ofrece exclusión frente a procesos externos que cambien la ruta sin respetarlo.

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

## Configuración y definiciones de Backup Health

En `/etc/kida/kida.toml`, los parámetros globales de Health son:

```toml
[backup_health]
restore_root = "/tmp/kida/restored"
data_root = "/var/lib/kida/backup-health"
manual_ttl_hours = 4
health_timeout_seconds = 180
report_retention_days = 90
max_active_runs = 2
```

Estos son los defaults, también si se omite la sección. Los tiempos y el cupo
deben ser positivos y caber en sus límites. Las raíces deben ser absolutas,
distintas y no contenerse entre sí; la validación resuelve los antecesores
existentes y sus enlaces simbólicos, sin crear directorios. La configuración se
publica una sola vez al arrancar; los cambios requieren reiniciar CORE.

`max_active_runs` limita entornos Health, incluidos manuales que sigan activos;
es independiente del límite de trabajos `queue.max_concurrent_jobs`. El TTL
contará desde el arranque de la ejecución, sin renovarse al consultar.

Cada prueba tiene su propio TOML, separado del `BackupJob`:

```toml
id = "nextcloud-health"
name = "Nextcloud Backup Health"

[backup]
reference = "nextcloud-daily"
version = "latest"

[docker]
compose = "./docker-compose.health.yml"
```

Todos los campos son obligatorios y no admiten valores vacíos. `reference`
identifica un backup existente por ID o nombre, sin coincidencias ambiguas.
`version` acepta `latest` o un UUID de artefacto registrado. No se incorporarán
copias históricas sin registro. Cada definición debe tener un ID único y estable;
no se crea un registro global de definiciones en esta fase.

El cargador interno `features::backup::health::definition::load` lee un TOML
local de CORE y devuelve la definición, la ruta absoluta del TOML y del Compose,
y el `BackupJob` resuelto. Resuelve el Compose respecto al directorio del TOML
canónico, nunca respecto al cliente. No ejecuta Compose ni crea recursos.

El [ejemplo TOML](examples/backup-health/nextcloud-health.toml) y su
[Compose](examples/backup-health/docker-compose.health.yml) ilustran el bind:

```yaml
services:
  app:
    image: example/app:stable
    restart: "no"
    volumes:
      - type: bind
        source: ${KIDA_RESTORE_DIR}/app-data
        target: /app/data
        bind:
          create_host_path: false
```

Adapta imagen y healthcheck a la aplicación. La ruta `app-data` es ilustrativa:
debe coincidir con la estructura relativa del tar, que el backup actual conserva
desde sus sources sin el `/` inicial. Health inyectará `KIDA_RESTORE_DIR` con el
directorio exclusivo del run; no añadas rutas de producción a esos binds. El
Compose es configuración confiable del administrador, no un sandbox: un bind
incorrecto puede afectar a datos reales. La validación funcional de los datos
restaurados corresponde al administrador.

El extractor interno `features::backup::health::restore::restore` recibe un
artefacto resuelto y un destino nuevo cuyo padre debe existir. Verifica tamaño y
SHA-256 antes de crear el directorio y lee el mismo descriptor durante la
extracción. Conserva la estructura relativa y permisos ordinarios, sin restaurar
propietarios ni bits especiales. Solo acepta archivos regulares y directorios;
rechaza enlaces, entradas especiales y rutas que puedan escapar. El productor
actual de backup desreferencia los enlaces al crear la copia.

Si falla, conserva los datos parciales y devuelve la ruta y procedencia del
directorio creado para su recuperación posterior; nunca borra el origen ni un
destino preexistente. La integración con el ciclo de vida y la limpieza Health
permanece pendiente.

El adaptador interno `health::compose::HealthCompose` prepara un proyecto exclusivo
`kida-bh-<run_id>` y pasa `KIDA_RESTORE_DIR` solo a sus procesos Docker. Obtiene el
inventario mediante Compose y exige políticas sin autoarranque antes de crear o
iniciar. Excluye perfiles opcionales y conserva réplicas, ruta/hash e imágenes
configuradas. Para servicios con build sin imagen declarada, el informe deberá
completar la imagen desde la inspección real del contenedor.

La creación conserva la identidad reservada y los recursos registrados incluso
si falla parcialmente. Start/Stop comprueban esa identidad; Remove reutiliza la
eliminación selectiva existente, sin parar por la fuerza ni borrar recursos
externos o compartidos. El coordinador aún pendiente debe persistir la evidencia
y comprobar los errores del informe de limpieza.

El evaluador interno `health::diagnosis::DiagnosticSession` compara las réplicas
esperadas con las observaciones Docker. Solo declara `HEALTHY` con healthchecks
satisfactorios; conserva reinicios/OOM y distingue fallos, unhealthy y evidencia
insuficiente. Observa hasta el timeout o un resultado concluyente. Los logs no
influyen en el resultado: se omiten por defecto y su publicación autorizada
filtra valores sensibles conocidos con límites de tamaño.

El repositorio interno `health::history::ExecutionRepository` guarda historial
JSON en `executions/<run_id>.json` e informes Markdown en `reports/<run_id>.md`,
bajo `backup_health.data_root`. El informe definitivo se escribe tras conocer
el intento de limpieza; errores de limpieza también quedan documentados.
Guarda primero el JSON para reconstruir un Markdown perdido si falla el cierre.
Eliminar un informe conserva el historial y deja una marca que impide recrearlo
durante la conciliación. Los registros corruptos se informan y no se sobrescriben.
El repositorio conserva la procedencia del directorio restaurado, redacta los
valores sensibles conocidos y omite logs por defecto.

Esta fase incorpora configuración, cargador, tipos compartidos, catálogo de copias,
restauración segura, adaptación Compose, diagnóstico e historial/informes. La ejecución,
límites activos, TTL y comandos
Health siguen pendientes; consulta el [índice de tareas](../docs/tasks/backup-health/README.md).

### Catálogo de copias

Cada `backup.run` nuevo incorpora un UUID al nombre:
`<nombre>-<fecha-UTC>-<artifact_id>.tar.zst`. El nombre del backup no puede
contener componentes de ruta. Los campos de su respuesta se conservan.

Tras replicar, CORE registra la copia en
`<backup_health.data_root>/artifacts/<backup-job-id>/<artifact-id>.json`, con
identidad, fecha UTC, SHA-256, tamaño y rutas absolutas de los destinos
verificados. El usuario de CORE necesita poder escribir en `data_root`.
El catálogo no incorpora copias anteriores ni está sujeto a la retención de
historial e informes Health.

La publicación usa archivos temporales en el mismo directorio y enlaces duros
para no sobrescribir destinos ni registros existentes, incluso ante colisiones.
Los sistemas de archivos de los targets y del catálogo deben permitir enlaces
duros. Un fallo conserva los destinos anteriores; no se usa una alternativa
que pueda sobrescribirlos. Los temporales propios se retiran al terminar.

Un destino requerido fallido mantiene el resultado de error de `backup.run`,
aunque otra copia verificada quede registrada. Si falla la escritura del catálogo,
el comando devuelve error y conserva los archivos ya copiados; esas copias no
están disponibles para Health sin un registro válido. Un backup sin destinos
verificados no publica metadatos; los fallos opcionales mantienen su tratamiento
actual en la respuesta.

La API interna síncrona `BackupService::resolve_artifact(reference, version)`
devuelve `ResolvedBackupArtifact` y comprueba tamaño y SHA-256. Resuelve el job
por ID/nombre sin ambigüedad. `latest` elige la fecha más reciente y, en empate,
el UUID mayor. Prueba los destinos registrados en orden, sin cambiar a una
versión anterior cuando la elegida falla. Una selección explícita consulta solo
su registro; `latest` falla ante registros corruptos en el catálogo del job.
Esta operación hace I/O bloqueante y debe llamarse desde el trabajo bloqueante
de la futura orquestación Health. La restauración volverá a verificar el archivo
que lea; la resolución no conserva un descriptor abierto ni impide cambios externos.

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
        "pre_backup": [{"command": "docker.container.stop", "params": {"container": "backup-source"}}],
        "post_backup": [{"command": "docker.container.start", "params": {"container": "backup-source"}}]
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

Al ejecutar el backup, el lifecycle permite exclusivamente `docker.container.stop`,
`docker.container.start` y `docker.container.restart`. Pre se detiene al primer
fallo; post intenta todos sus pasos secuencialmente y en orden, también si falla
pre o la creación del artefacto. Los errores de post indican posición (desde 1),
comando y causa. Si también hubo un fallo previo, este permanece como causa
principal y el diagnóstico incluye todos los fallos de recuperación. Un fallo de
post impide calcular el checksum y replicar el artefacto. Si post termina bien,
un fallo previo conserva su error original.

Esta recuperación cubre errores devueltos y errores de la tarea bloqueante de
creación. Cancelar la tarea de backup o terminar el proceso no garantiza ejecutar
post. El temporal sigue perteneciendo al trabajo bloqueante que lo esté utilizando.

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
al arrancar. Backup Health dispone de un adaptador interno; su coordinación con
Worker y Scheduler sigue pendiente.

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

Para intentar ejecutar `scheduler.list` cada 60 segundos:

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{
    "id": "schedule-list",
    "command": "scheduler.add",
    "params": {
      "command": "scheduler.list",
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
      "command": "scheduler.list",
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
      "command": "scheduler.list",
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

El comando histórico `health` está retirado; `system.health` sigue siendo una consulta de sensores independiente. Una programación pendiente guardada con `health` impide cargar el scheduler: el error identifica su UUID y comando, y el archivo se conserva intacto. Antes de arrancar CORE, retira esa programación o cambia su comando y parámetros por los que realmente necesites.

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
