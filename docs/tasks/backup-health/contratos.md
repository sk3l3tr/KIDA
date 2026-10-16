# Contratos comunes · Backup Health 0.0.4

Estos acuerdos permiten desarrollar cada bloque por separado. Son contratos de comportamiento; no exigen una clase, capa o archivo por concepto. Las interfaces privadas deben seguir los patrones actuales de Rust del proyecto.

## Decisiones y límites

- Ámbito funcional: `features/backup`; operaciones Docker en `features/docker`; configuración en `infrastructure/conf`.
- Reutilizar Compose, identificación persistente de recursos, Scheduler protegido, cola y worker concurrente existentes. No rehacerlos ni añadir motores, frameworks o dependencias innecesarias.
- No implementar compatibilidad hacia atrás, importación de copias anteriores, migraciones históricas ni lectura de formatos antiguos para ningún bloque.
- Fuera de alcance: Git, Dockerfile independiente, `protected_dirs`, pruebas funcionales, análisis semántico de logs, puertos automáticos y reinicio de ejecuciones detenidas.
- El Compose es configuración confiable del administrador y no está aislado por un sandbox. Un bind incorrecto puede afectar a producción; documentarlo.

## Configuración y definición · propietaria 01

`[backup_health]`: `restore_root="/tmp/kida/restored"`, `data_root="/var/lib/kida/backup-health"`, `manual_ttl_hours=4`, `health_timeout_seconds=180`, `report_retention_days=90`, `max_active_runs=2`. El último campo concreta el límite global acordado. Configuración inmutable tras el arranque; duraciones y cupo positivos, raíces absolutas y sin solapamiento entre datos persistentes y restauraciones.

Definición TOML independiente de `BackupJob`: `id`, `name`, `backup.reference`, `backup.version`, `docker.compose`. Referencia por ID o nombre mediante el repositorio actual; error ante nombre ambiguo. Compose se resuelve respecto al TOML local de CORE, no respecto al directorio del cliente. No añadir un registro global de definiciones.

La carga devuelve definición validada y rutas absolutas. La ejecución conserva una instantánea estructurada de la definición y la identidad de su archivo; no persiste el Compose completo ni valores de entorno sensibles. El mismo `definition_id` identifica la exclusión aunque cambie el contenido de su TOML.

Interfaces materializadas en la tarea 01: `features::backup::health::definition::load(path)` usa la configuración publicada y devuelve `ResolvedHealthDefinition` (definición, rutas canónicas del TOML/Compose y `BackupJob`). La carga resuelve Compose respecto al TOML canónico. Rechaza ambigüedad de ID/nombre solo en Health, conservando la búsqueda actual de backups.

`health::model` proporciona `BackupHealthDefinition`, `BackupHealthMode/State/Result`, `ResolvedBackupArtifact`, `HealthService`, `HealthResource`, `HealthEvidence`, `HealthServiceDiagnosis`, `HealthDiagnosis`, `HealthCleanupState/Cleanup` y `BackupHealthExecution`. Los snapshots usan UUID y timestamps UTC RFC 3339 como cadenas, enums en mayúsculas y rutas `PathBuf`; la representación de almacenamiento sigue perteneciendo a 06. La identidad de propiedad reutiliza `ManagedProject` de Docker. `BackupHealthExecution.diagnosis` agrupa resultado, resumen, evaluación completa/pendiente, servicios, anomalías y evidencias; no implica implementar evaluación ni transiciones en 01.

## Artefacto y restauración · propietarias 02 y 03

02 registra JSON en `<data_root>/artifacts/<backup-job-id>/<artifact-id>.json` mediante escritura atómica existente. Cada copia nueva tiene ID UUID, job de origen, nombre de archivo, fecha UTC, SHA-256, tamaño y destinos copiados/verificados. Publicar el registro al terminar la replicación con al menos un destino válido; un fallo requerido sigue produciendo el error actual de `backup.run`. Registrar las copias verificadas disponibles no convierte ese backup fallido en satisfactorio.

El UUID forma parte del nombre del artefacto nuevo: la marca temporal actual tiene resolución de segundos y no garantiza unicidad. Publicar cada destino sin sobrescribir otro archivo; una copia registrada es inmutable. Probar dos backups con la misma marca temporal y una colisión de destino. No añadir compatibilidad con nombres anteriores.

`backup.version` acepta `latest` o el ID UUID registrado. `latest` selecciona la fecha más reciente con desempate estable por ID; no retrocede silenciosamente a otra versión si la seleccionada falla. Destinos de una misma copia se prueban en el orden registrado, utilizando uno disponible cuyo checksum coincida. Sin registro, destino verificable o checksum correcto: error explícito. No descubrir copias escaneando nombres o fechas del sistema de archivos. Los registros del catálogo no se someten a la retención de ejecuciones Health.

La resolución devuelve identidad, job, fecha, ruta, checksum esperado y tamaño. 03 recibe ese artefacto y `<restore_root>/<run_id>`; verifica el contenido antes de extraer y devuelve el directorio nuevo o un error con evidencia de lo creado. Evitar que se cambie el archivo entre verificación y lectura. Conservar la estructura relativa del tar existente, sin renombrar los datos según los servicios Compose.

El destino no puede existir. Rechazar rutas absolutas, componentes `..`, enlaces que escapen o permitan escrituras fuera y tipos de entrada peligrosos. Ningún fallo autoriza borrar el origen, un destino preexistente o rutas ajenas. Registrar procedencia del directorio para permitir limpieza posterior segura.

## Ejecución compartida · tipos 01, coordinación 07

`run_id` UUID; modos `AUTOMATIC` y `MANUAL`; estados `CREATED`, `STARTING`, `RUNNING`, `STOPPED`, `ERROR`; resultados independientes `FAILED`, `UNHEALTHY`, `UNKNOWN`, `DEGRADED`, `HEALTHY`. No usar `DELETED` como estado operativo.

El registro contiene definición, modo, estado, resultado/resumen, timestamps UTC de creación/inicio/finalización, artefacto concreto, ruta/hash SHA-256 de Compose, proyecto/recursos, restauración, evidencias y anomalías, referencia al informe y limpieza pendiente/completada/con errores. 06 posee la representación persistente; 01 materializa los tipos de intercambio usados por todos.

07 posee admisión, exclusión por definición, cupo, transiciones y rollback. `start` solo admite `CREATED`; reserva una plaza y registra `STARTING` antes de ejecutar trabajo. Debe coordinar persistencia y encolado: si no se admite, no deja una reserva fantasma ni permite que dos arranques ejecuten el mismo run. Fallos de cola son explícitos, dejan el run reintentable y conservan la incidencia. No mantener un mutex global durante restauración o llamadas Docker.

Solo `STARTING/RUNNING` cuentan contra `max_active_runs`, incluidos manuales después de terminar su job. El worker mantiene además su límite actual. Liberar la plaza al confirmar parada/finalización; un cambio a `ERROR` no demuestra que los contenedores hayan parado: recursos todavía activos siguen consumiendo capacidad hasta confirmar su parada. Fallos parciales no pueden permitir una saturación ilimitada.

Automático: restaurar, iniciar, diagnosticar, capturar, intentar limpiar y cerrar informe. Manual: restaurar e iniciar; `get` puede actualizar diagnóstico mientras corre, sin renovar TTL. El inicio registrado al admitir `start` fija el TTL; no cuenta desde `create`. `stop` confirma parada y conserva datos/registro; no permite reinicio. `delete` intenta limpieza y conserva historial; es seguro repetirlo. Serializar operaciones conflictivas sobre un run y evitar que un `start` pendiente continúe tras `stop/delete`.

## Docker y diagnóstico · propietarias 04 y 05

Proyecto `kida-bh-<run_id>`, variable por proceso `KIDA_RESTORE_DIR=<restore_root>/<run_id>`. Usar `ComposeOptions.variables`, ya disponible; no modificar el entorno global. Conservar la identidad gestionada persistente de Docker desde la creación y usar `compose_managed_project`/`compose_remove`; ni nombre ni etiquetas copiadas bastan para demostrar propiedad.

04 devuelve inventario esperado de servicios habilitados y réplicas junto con identidades de recursos creados; 05 lo compara con observaciones Docker. Perfiles deshabilitados quedan fuera. Todos los servicios habilitados son requeridos, incluidos auxiliares de una sola ejecución: cualquier terminación, aunque tenga código cero, produce `FAILED`. Una réplica esperada ausente tras el arranque es fallo; una inspección fallida sin prueba de terminación es evidencia insuficiente.

Antes de iniciar, 04 exige política efectiva sin autoarranque (`no` o equivalente, incluida la política por defecto), sin sobrescribir silenciosamente el Compose. Si necesita exponer datos de Compose resuelto, extender mínimamente la API interna Docker existente; no llamar Docker directamente desde backup ni duplicar el runner. Preservar recursos externos, compartidos o de propiedad dudosa.

05 recibe inventario esperado, observaciones actuales y anomalías acumuladas; devuelve resultado global/por servicio, motivos y evaluación completa o pendiente. Prioridad: `FAILED > UNHEALTHY > UNKNOWN > DEGRADED > HEALTHY`. Solo resultados completos satisfactorios con healthchecks suficientes permiten `HEALTHY`; sin ellos o con checks pendientes, `UNKNOWN`. Reinicios/OOM recuperados no se olvidan al mejorar el estado: producen `DEGRADED` si no hay resultado de mayor prioridad.

El timeout limita la observación diagnóstica desde el inicio de esta fase, no toda la restauración. Puede terminar antes con evidencia definitiva. Paradas solicitadas y limpieza no se reinterpretan como terminaciones inesperadas. Una interrupción no evaluada concluye `UNKNOWN`; conservar fallos ya demostrados.

Capturar evidencias antes de borrar Docker, sin interpretar logs. Usar logs Docker acotados, limitar además el total persistido y eliminar valores sensibles conocidos antes de guardarlos; nunca volcar entorno ni Compose completo. No prometer detección universal de secretos arbitrarios en logs; si no se puede publicar un extracto con seguridad, omitirlo con motivo.

## Persistencia y mantenimiento · propietarias 06 y 08

06 guarda `<data_root>/executions/<run_id>.json` y `reports/<run_id>.md`, separados y con escrituras atómicas por archivo. Reutilizar `JsonStorage`; para Markdown, reutilizar o exponer mínimamente la escritura atómica técnica actual. No añadir políticas de dominio al `Storage<T>` genérico.

El informe incluye backup concreto, timestamps/duración, Compose ruta/hash, servicios/imágenes, resultados/anomalías/logs seguros, recursos y resultado de limpieza; advierte que el administrador debe validar la integridad funcional. Es definitivo después del intento de limpieza, aunque queden errores. `get` ofrece datos parciales antes de ese cierre.

06 concilia escrituras parciales; conserva en JSON datos suficientes para reconstruir un informe perdido durante su cierre. `report.delete` registra la eliminación voluntaria para no recrearlo al arrancar; no elimina historial. 08 invoca esa conciliación y no implementa otra.

08 registra exactamente dos jobs internos con API protegida existente y sin duplicarlos al reiniciar. Cadencias técnicas internas: expiración cada 60 segundos y retención cada 86400 segundos; TTL y edades proceden solo de conf. La pasada de expiración también reintenta limpiezas pendientes. No añadir un tercer job para reintentos.

Cada arranque cierra ejecuciones previas interrumpidas y limpia recursos propios antes de admitir nuevas ejecuciones Health; no reanuda manuales. Docker indisponible deja anomalías y trabajo pendiente, sin impedir los demás servicios KIDA ni ampliar borrados. Mantener capacidad reservada para recursos activos o de parada incierta. Limpiar directorios solo con procedencia comprobada y sin seguir enlaces fuera de la raíz.

Retención desde `finished_at`: eliminar historial e informe caducados; un Markdown ya borrado es válido. Si quedan recursos sin limpiar, preservar el registro necesario para demostrar propiedad/reintentar, y eliminarlo una vez resuelto. La retención nunca debe destruir la última evidencia necesaria para una limpieza segura.

## Protocolo y CLI · propietarias 09 y 10

Mantener `CommandRequest/CommandResponse` y sus errores/estados de transporte actuales. Parámetros mínimos:

| Operación | Parámetros | Salida de dominio |
| --- | --- | --- |
| `backup.health.create` | `definition_path`, `mode` | Ejecución creada con `run_id` |
| `backup.health.start` | `run_id` | `run_id`, estado `STARTING`, identificador de cola |
| `backup.health.run` | `definition_path` | Nueva ejecución automática admitida, `run_id` e identificador de cola |
| `backup.health.get` | `run_id` | Ejecución y diagnóstico disponible |
| `backup.health.list` | Sin parámetros | Historial resumido |
| `backup.health.stop/delete` | `run_id` | Estado y resultado de la operación/limpieza |
| `backup.health.report.list` | Sin parámetros | Informes disponibles por `run_id` |
| `backup.health.report.get` | `run_id` | `run_id` y Markdown |
| `backup.health.report.delete` | `run_id` | Confirmación; historial conservado |

`run` reutiliza `create/start`; permite al Scheduler de usuario crear una ejecución nueva cada vez. Los handlers solo validan/adaptan y llaman al servicio. 09 conecta la admisión de 07 con la cola existente; el worker ejecuta el trabajo ya admitido sin llamar de nuevo al `start` público. Un `run` programado que ya ocupa el worker no espera una segunda plaza del worker para ejecutarse. Distinguir el ID de cola de `run_id`.

Las acciones de mantenimiento no son nuevas operaciones administrativas públicas. Reutilizar el origen protegido del Scheduler y restringir sus parámetros; un usuario no puede crear un schedule de mantenimiento interno ni invocarlo directamente por HTTP/socket. La integración no debe debilitar la protección existente.

Actualmente la cola no transporta el origen del schedule. 09 añadirá el contexto fiable mínimo al sobre privado de trabajo: el servicio Scheduler lo establece únicamente para una entrada `INTERNAL` admitida; el worker lo conserva para autorizar el mantenimiento. No aceptar ese contexto desde `CommandRequest`, JSON/params, HTTP o socket. Mantener protegidas las operaciones administrativas actuales sin rediseñar Scheduler ni cola.

CLI: `kida backup health create --file <ruta-CORE> --mode <automatic|manual>`; `run --file <ruta-CORE>`; `start/get/stop/delete --run-id <UUID>`; `list`; `report list/get/delete`, con `--run-id` donde corresponda. `--file` identifica un archivo del servidor: el cliente no lo lee ni convierte la ruta a su propio entorno. No añadir wizard ni flags que reproduzcan el TOML. Mantener la presentación JSON y los renderers que devuelven salida sin imprimir.

## Validación común

Cada tarea prueba comportamiento y fallos propios con fixtures pequeños; no necesita que otra esté terminada para diseñar y ejecutar pruebas aisladas. No introducir implementaciones alternativas de producción para este propósito. Al integrar, sustituir los dobles por componentes reales y pasar las pruebas existentes pertinentes.

La prueba Docker real es opt-in y se ejecuta contra un daemon aislado y desechable; un fake verifica lógica, no acredita seguridad real. No ejecutar limpieza real sobre el daemon habitual del administrador.
