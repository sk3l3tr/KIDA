# KIDA CORE

[English](README.md) · [Documentación](../resources/docs/index.md)

CORE ejecuta operaciones en el servidor. Los usuarios acceden mediante [CLI](../resources/docs/es/cli/README.md),
[API directa HTTP/Unix socket](../resources/docs/es/api/README.md) o la futura
[interfaz web CONSOLE](../resources/docs/es/console/README.md), aún no implementada.

Consulta la [documentación en castellano](../resources/docs/es/000-index.md) para instalación, configuración y uso.
Este README conserva contratos internos y notas de aceptación; los métodos siguientes no son comandos públicos adicionales.

## Reserva del socket

El listener Unix rechaza sockets activos y entradas que no sean sockets. Solo recupera sockets obsoletos tras
`ConnectionRefused`; los errores de permisos/inspección impiden arrancar sin borrar la entrada. CORE mantiene el bloqueo
`<socket_path>.lock` durante la vida del listener. El archivo permanece después; no lo borres con instancias activas.
El directorio debe permitir crear socket/bloqueo y estar protegido de modificaciones ajenas. Esto coordina instancias
CORE que respetan el mecanismo, no procesos externos que ignoran el bloqueo o cambian la ruta.

## Contratos internos de Backup Health

Las [guías públicas](../resources/docs/es/004-backups-management.md) describen comandos, configuración y definiciones.
Health coordina ejecución, admisión, TTL, mantenimiento y comandos públicos.

`features::backup::health::definition::load` lee el TOML local de CORE y devuelve definición, rutas canónicas del TOML/Compose
y `BackupJob` resuelto. Compose se resuelve respecto al TOML, nunca al cliente. Cargar no ejecuta Compose ni crea recursos.
Los IDs de definición son estables y únicos; no existe un registro global independiente de definiciones.

El extractor interno `features::backup::health::restore::restore` recibe un
artefacto resuelto y un destino nuevo cuyo padre debe existir. Verifica tamaño y
SHA-256 antes de crear el directorio y lee el mismo descriptor durante la
extracción. Conserva la estructura relativa y permisos ordinarios, sin restaurar
propietarios ni bits especiales. Solo acepta archivos regulares y directorios;
rechaza enlaces, entradas especiales y rutas que puedan escapar. El productor
actual de backup desreferencia los enlaces al crear la copia.

Si falla, conserva los datos parciales y devuelve la ruta y procedencia del
directorio creado para su recuperación posterior; nunca borra el origen ni un
destino preexistente. El servicio Health coordina el ciclo de vida y la limpieza.

El adaptador interno `health::compose::HealthCompose` prepara un proyecto exclusivo
`kida-bh-<run_id>` y pasa `KIDA_RESTORE_DIR` solo a sus procesos Docker. Obtiene el
inventario mediante Compose y exige políticas sin autoarranque antes de crear o
iniciar. Excluye perfiles opcionales y conserva réplicas, ruta/hash e imágenes
configuradas. Para servicios con build sin imagen declarada, el informe deberá
completar la imagen desde la inspección real del contenedor.

La creación conserva la identidad reservada y los recursos registrados incluso
si falla parcialmente. Start/Stop comprueban esa identidad; Remove reutiliza la
eliminación selectiva existente, sin parar por la fuerza ni borrar recursos
externos o compartidos. El coordinador persiste la evidencia y comprueba los errores del informe de limpieza.

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

## Resolución interna de artefactos

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
de la orquestación Health. La restauración volverá a verificar el archivo
que lea; la resolución no conserva un descriptor abierto ni impide cambios externos.

`ComposeVersion`, `ComposeProject` y `ComposeService` se exportan desde `features::docker`, junto con los modelos de contenedores.
Sus consultas públicas se documentan en la [guía API](../resources/docs/es/api/docker-management.md).

## Diagnóstico Docker interno

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
al arrancar. Backup Health utiliza el adaptador interno y se coordina con Worker y Scheduler.

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
