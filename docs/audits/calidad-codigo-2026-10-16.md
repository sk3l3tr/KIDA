# Análisis de calidad de código de KIDA

Fecha: 2026-10-16. Revisión: `254b0e939782d4797a4eb62f5f36559ab62cffa5`.

## Alcance y criterio

Revisión de CORE y CLI: ejecución, cola y worker, backup, Docker, scheduler, sistema, configuración, almacenamiento, transportes, preparación de entradas, mapeo, presentación y pruebas. También se inspeccionaron los manifiestos, los workflows y el instalador. El árbol de trabajo estaba limpio al comenzar. El único archivo añadido por esta revisión es este informe.

Los hallazgos se basan en el código actual y sus llamadas; no se trasladan conclusiones de auditorías anteriores. Se priorizan cambios pequeños que conserven contratos, persistencia y funcionalidad. No se ha modificado código ni ejecutado el instalador o pruebas de aceptación contra un Docker real.

**Prioridades:** alta = defecto o riesgo operativo concreto; media = deuda con efecto claro en mantenimiento o ejecución; baja = simplificación localizada. **Naturaleza:** refactorización = debe preservar comportamiento; corrección = modifica una ruta defectuosa; decisión de contrato = requiere definir expresamente la conducta antes de implementar. Los defectos deducidos del flujo se identifican como evidencia estática, sin presentarlos como incidentes reproducidos.

Las evidencias y la validación originales corresponden a la revisión indicada en el encabezado. Los estados siguientes registran las correcciones posteriores sin sustituir ese análisis histórico.

## Resumen de propuestas

| ID | Prioridad | Propuesta | Naturaleza |
| --- | --- | --- | --- |
| Q01 | Alta | **Completada.** Sincronizar comandos registrados y ejecutables | Corrección + refactorización |
| Q02 | Alta | **Completada.** Dar un único propietario a la limpieza del temporal de backup | Corrección |
| Q03 | Alta | **Completada.** Hacer explícita la recuperación y sus errores en el lifecycle | Decisión de contrato + corrección |
| Q04 | Media | **Completada.** Sacar operaciones bloqueantes de los handlers asíncronos | Refactorización |
| Q05 | Alta | **Completada.** Evitar borrar indiscriminadamente la ruta del socket al arrancar | Corrección |
| Q06 | Media | **Completada.** Compartir la escritura atómica de JSON y TOML | Refactorización |
| Q07 | Media | **Completada.** Reducir la duplicación de handlers de acciones Docker | Refactorización |
| Q08 | Media | **Completada.** Unificar búsqueda y construcción del repositorio de backups | Refactorización |
| Q09 | Media | Reducir el acoplamiento de features al ejecutor del protocolo | Refactorización gradual |
| Q10 | Media | Verificar el contrato duplicado entre CORE y CLI | Mantenimiento de contrato |
| Q11 | Baja | Desacoplar el renderer del modelo de entrada del scheduler | Refactorización |
| Q12 | Baja | Revisar interfaces sin consumidores y sus supresiones | Simplificación condicionada |
| Q13 | Media | Dividir escenarios de pruebas Docker conservando el aislamiento | Refactorización de pruebas |
| Q14 | Baja | Explicitar el resolver del workspace | Configuración |

---

## Q01. Registro y despacho de comandos incoherentes

**Estado: completada (2026-10-16), commit `75cc720`.** Catálogo único y despacho exhaustivo; se retiró el comando histórico `health`, conservando `system.health`. Las tareas pendientes antiguas con `health` impiden cargar el scheduler con UUID y comando en el error, sin modificar el archivo. Validación: 131 tests superados y 7 ignorados en el workspace, formato y Clippy estricto correctos; revisión independiente aprobada.

**Evidencia.** [executor.rs](../../kida-core/src/exec/executor.rs), `is_registered` (líneas 41–72) acepta `health`. `execute_now` (líneas 76–144) no tiene una rama para él y devuelve `Unknown command: health`. [service.rs del scheduler](../../kida-core/src/features/scheduler/service.rs), `load` y `prepare`, usan ese registro para validar tareas persistidas y nuevas. Numerosas pruebas del scheduler emplean `health`, pero comprueban su admisión en cola, lo cual no demuestra que tenga un handler.

**Consecuencia.** Por inspección del flujo, una tarea puede aceptarse, persistirse y encolarse para acabar fallando al ejecutarse. Además, mantener dos listas manuales permite repetir esta divergencia.

**Propuesta.** Usar una única resolución de comandos para validar y despachar; mantener explícita la política que decide qué comandos se encolan. Resolver `health` según el contrato que se quiera conservar: implementar su semántica si debe seguir admitiéndose, o tratar expresamente la compatibilidad de tareas ya guardadas antes de retirarlo. No asumir que equivale a `system.health`.

**Preservación y verificación.** Conservar identificadores públicos, errores de comandos desconocidos y la ejecución directa de `backup.run` dentro del worker. Incorporar una comprobación que relacione registro y handler, sin ejecutar comandos destructivos. Cubrir la ejecución de una tarea segura hasta su respuesta, además de su admisión.

---

## Q02. Limpieza del temporal de backup dependiente de llegar al final

**Estado: completada (2026-10-16).** Un guard privado posee el temporal durante creación, post y finalización, incluida la cancelación de la espera de trabajo bloqueante. Los errores de limpieza se avisan en stderr sin sustituir el resultado principal; `NotFound` no genera aviso. Las pruebas específicas cubren éxito/restauración, creación parcial, post, checksum, destinos requeridos/opcionales, cancelación y aviso de limpieza. El contrato de recuperación de Q03 se conserva. Validación: 139 tests superados (58 unitarios y 2 de integración CLI, 79 CORE) y 8 ignorados en el workspace; los escenarios ejecutan expresamente el nuevo test hijo ignorado. Formato y Clippy estricto correctos; revisión independiente aprobada. La prueba de cancelación usa trabajo bloqueante controlado para comprobar la propiedad del guard, sin cancelar directamente `BackupService::run`. La suite completa se ejecutó fuera de la sandbox tras reproducir las restricciones de sockets dentro de ella; sin Docker real ni fallos físicos de disco.

**Evidencia.** [service.rs de backup](../../kida-core/src/features/backup/service.rs), `run`: el temporal se define en las líneas 121–124 y solo se elimina en la 213. Los retornos por `artifact_result?`, `post_result?`, `sha256?` y `metadata?` pueden producirse antes. `create_artifact` abre el archivo antes de recorrer las fuentes y puede dejar contenido parcial.

**Consecuencia.** El flujo permite que queden temporales completos o parciales tras errores. Es una conclusión estática; no se han provocado fallos de disco durante esta revisión.

**Propuesta.** Centralizar la propiedad y la limpieza del temporal, incluidas las salidas con error. Puede hacerse mediante una finalización común o un guard pequeño; no hace falta crear un subsistema de temporales. Separar la replicación/verificación en una función enfocada facilitaría revisar los puntos de salida de `run`.

**Preservación y verificación.** Mantener el orden pre → artefacto → post → checksum → destinos y los estados de destinos opcionales/requeridos. El propietario debe sobrevivir al trabajo de `spawn_blocking`: eliminar el archivo mientras ese trabajo aún lo usa introduciría otra carrera. Cubrir éxito, creación parcial, fallo de post y fallo de finalización; conservar el error principal y hacer observable un fallo de limpieza.

---

## Q03. Recuperación del lifecycle con errores secundarios ocultos

**Estado: completada (2026-10-16).** Pre conserva la parada al primer fallo; post intenta todos los pasos en orden y reúne sus errores con posición y comando. Si hubo un error previo, permanece como causa principal, con el diagnóstico de recuperación añadido. El contrato cubre errores devueltos y errores de la tarea bloqueante de creación; cancelar la tarea o terminar el proceso no garantiza ejecutar post. Se mantienen las restricciones del lifecycle y la propiedad del temporal de Q02.

**Validación de la corrección.** 147 tests superados (58 unitarios y 2 de integración CLI, 87 CORE), 8 ignorados; los escenarios aislados ejecutan expresamente el test hijo de backup. Formato y Clippy estricto correctos; revisión independiente aprobada. Las pruebas cubren post con fallos múltiples o seguido de éxito, pre/post, artefacto/post, error original con post correcto, ausencia de replicación tras fallos, restricciones del lifecycle y diagnóstico completo del handler. La prueba de `JoinError` usa un panic en trabajo bloqueante controlado y los helpers de recuperación, sin provocarlo dentro de `BackupService::run`. Suite completa fuera de la sandbox para permitir sockets; Docker simulado, sin aceptación contra un daemon real.

**Evidencia.** [service.rs de backup](../../kida-core/src/features/backup/service.rs), líneas 115–118: si falla pre, se intenta post y se descarta su resultado. Líneas 142–148: si fallan artefacto y post, se devuelve únicamente el primero. `run_lifecycle` (líneas 238–257) devuelve error al primer comando fallido, tanto en pre como en post.

**Consecuencia.** Si post contiene varios arranques de servicios, el fallo del primero impide intentar los siguientes. El operador puede recibir solo el error original sin saber que también falló la recuperación. El comentario que afirma restaurar servicios «SIEMPRE» no refleja esta limitación ni la cancelación de la tarea.

**Propuesta.** Primero fijar el contrato de recuperación. Si post debe intentar todos los pasos, distinguir la parada temprana de pre de la recuperación de post y reunir sus errores. Conservar el fallo original como causa principal y añadir contexto del fallo de recuperación. Corregir también el comentario para describir la garantía real.

**Preservación y verificación.** Esta propuesta cambia la conducta ante fallos; no debe mezclarse con una extracción mecánica de funciones. Probar dos comandos post con fallo del primero, fallos simultáneos de artefacto/post y de pre/post. Existe cobertura de un backup correcto en [conf/tests.rs](../../kida-core/src/infrastructure/conf/tests.rs), líneas 277–315; los tests de backup dedicados cubren principalmente repositorio y serialización. No se encontró cobertura de esas combinaciones de fallos.

---

## Q04. Handlers asíncronos que realizan trabajo bloqueante

**Estado: completada (2026-10-16).** Los handlers Docker, sistema y scheduler mantienen su API asíncrona y ejecutan el trabajo completo en `spawn_blocking`. El manager del scheduler es clonable y comparte estado mediante `Arc<Mutex<ScheduleService>>`; tanto los handlers como el timer adquieren ese mutex dentro del trabajo bloqueante. El timer espera cada operación antes de su pausa de 100 ms y conserva la propagación de errores. Los fallos de tareas de comandos devuelven `ERROR` con ID y diagnóstico del comando. No se añaden timeouts ni reintentos; un trabajo bloqueante iniciado puede continuar aunque se cancele su espera. El alcance se limita a los adaptadores Docker/sistema/scheduler y al timer; no modifica los handlers de configuración de backup ni su servicio.

**Validación de la corrección.** 155 tests superados (58 unitarios y 2 de integración CLI, 95 CORE), 9 ignorados; los escenarios aislados ejecutan expresamente el nuevo test hijo. Formato y Clippy estricto correctos; revisión independiente aprobada. Las ocho pruebas nuevas cubren progreso de un runtime de un solo hilo con Docker/apagado/reinicio simulados y mutex ocupado para alta/listado/baja/timer, estado compartido entre clones, errores de mutex envenenado, conversión de panic a respuesta y continuidad del trabajo tras cancelar su espera. Los comandos de energía usan un PATH cerrado con ejecutables falsos; no se ha comprobado hardware ni Docker real. La primera suite CORE en sandbox falló en tres pruebas de sockets; la suite completa pasó fuera de ella sin modificar ni omitir pruebas.

**Evidencia.** Los handlers de [exec/commands/docker](../../kida-core/src/exec/commands/docker) llaman directamente a métodos síncronos de [DockerService](../../kida-core/src/features/docker/service.rs), que usan `std::process::Command::output`. Los handlers de sistema llaman directamente al recolector y a [SystemPower](../../kida-core/src/features/system/power.rs), con procesos y E/S síncronos. [SchedulerManager](../../kida-core/src/features/scheduler/manager.rs), líneas 26–89, toma un `std::sync::Mutex` mientras el servicio puede guardar archivos y hacer `sync_all`; el [timer](../../kida-core/src/features/scheduler/timer.rs) lo llama desde su bucle asíncrono.

**Consecuencia.** Un proceso lento o una escritura lenta ocupa un hilo del runtime. El código con firma `async` no cede durante esas operaciones. No se ha medido saturación en producción.

**Propuesta.** Mover las unidades bloqueantes completas a `spawn_blocking` desde el adaptador asíncrono, siguiendo el precedente de backup y del helper `disk` de Docker. Para scheduler, incluir adquisición del mutex y operación dentro del trabajo bloqueante. No basta con cambiar el mutex por uno asíncrono si la persistencia sigue bloqueando el runtime.

**Preservación y verificación.** Conservar respuestas, serialización y exclusión del scheduler, así como las validaciones previas a las acciones de energía. Probar con operaciones simuladas lentas que otra tarea del runtime progresa. No envolver acciones con efectos en un timeout que abandone trabajo activo; los límites y la cancelación de procesos necesitan una política explícita.

---

## Q05. Eliminación indiscriminada de la ruta del socket

**Estado: completada (2026-10-16).** El arranque inspecciona la ruta sin seguir enlaces, rechaza entradas que no sean sockets y conserva sockets activos. Solo elimina un socket obsoleto cuando la conexión devuelve `ConnectionRefused`, después de comprobar que su dispositivo e inodo no han cambiado. Propaga errores de permisos, inspección, borrado y conexión; un límite de un segundo para comprobar actividad impide borrar ante una comprobación inconclusa. Una reserva exclusiva no bloqueante en `<ruta-del-socket>.lock` permanece durante la vida del listener y coordina arranques concurrentes de KIDA. El archivo de reserva no se elimina y su apertura rechaza enlaces y entradas no regulares. El directorio debe estar protegido frente a cambios ajenos: la reserva no coordina procesos externos que no la respeten ni elimina toda carrera frente a modificaciones hostiles de la ruta. El protocolo y el endpoint configurado se conservan; el requisito del archivo de reserva está documentado en el README de CORE.

**Validación de la corrección.** 161 tests superados (58 unitarios y 2 de integración CLI, 101 CORE), 9 ignorados. Formato y Clippy estricto correctos; revisión independiente aprobada con repetición de los seis tests específicos. Las pruebas nuevas cubren ruta ausente, recuperación de socket obsoleto y liberación de la reserva, socket activo sin reserva, arranques concurrentes sobre un socket obsoleto, conservación de archivos/directorios/enlaces válidos y rotos, rechazo de enlaces en la reserva y errores reales de permisos de conexión y borrado. Verifican que el listener original siga intercambiando datos y que las entradas rechazadas conserven su inodo y contenido. El sandbox impidió crear sockets en cuatro pruebas específicas; la suite completa pasó fuera de él sin omitir pruebas. No se simularon modificaciones hostiles continuas del directorio.

**Evidencia.** [unix.rs](../../kida-core/src/infrastructure/comm/transport/unix.rs), líneas 17–20: `start` llama a `remove_file` sobre la ruta configurada, descarta cualquier error y después hace `bind`.

**Consecuencia.** Por el flujo actual, una ruta configurada que apunte a un archivo normal puede borrarlo. También se puede desvincular el socket de otra instancia activa antes de abrir uno nuevo. No se ha ejecutado una reproducción destructiva.

**Propuesta.** Distinguir ausencia, socket obsoleto, socket activo y otros tipos de archivo mediante metadatos sin seguir enlaces y una comprobación de actividad. Rechazar archivos ajenos y errores relevantes. Si se requiere exclusión entre arranques concurrentes, usar una reserva de instancia: comprobar y borrar por separado no elimina por sí solo esa carrera.

**Preservación y verificación.** Mantener la recuperación de sockets obsoletos y el endpoint configurado. Probar ruta ausente, socket obsoleto, segunda instancia, archivo normal, enlace y permisos insuficientes; verificar que los archivos ajenos y la primera instancia permanezcan utilizables.

---

## Q06. Algoritmo de escritura atómica duplicado

**Estado: completada (2026-10-16).** JSON y TOML delegan la escritura en un helper privado `atomic_write` del módulo de almacenamiento, que recibe ruta y bytes ya serializados. Comparte creación de directorios, temporal con UUID junto al destino y apertura exclusiva, escritura, `sync_all`, reemplazo mediante `rename` y limpieza del temporal propio ante errores. La apertura exclusiva ocurre antes del bloque de limpieza para no borrar una entrada ajena si falla; el handle se cierra antes de limpiar y se conserva el error principal. Cada formato mantiene la validación previa del contenido existente, su serialización y sus errores específicos. No se modifica `Storage<T>`, no se añaden dependencias, migraciones ni gestión de archivos heredados; estos quedan a cargo del administrador. El reemplazo atómico no añade garantías de durabilidad ante cortes eléctricos.

**Validación de la corrección.** 166 tests superados (58 unitarios y 2 de integración CLI, 106 CORE), 9 ignorados; suite completa ejecutada fuera del sandbox para permitir los transportes locales. Formato y Clippy estricto correctos; revisión independiente aprobada con repetición de los cinco tests específicos. Las pruebas de almacenamiento cubren ambos formatos: creación de directorios, lectura y actualización sin temporales sobrantes, protección de contenido corrupto con error y ruta específicos, lectura inexistente y fallos de serialización sin crear directorios ni modificar archivos existentes. El test del helper provoca un fallo de reemplazo contra un directorio y verifica su conservación, la limpieza del temporal propio y la preservación de un temporal ajeno. No se han inyectado fallos físicos de escritura o sincronización ni cortes eléctricos.

**Evidencia.** [json.rs](../../kida-core/src/infrastructure/storage/json.rs) y [toml.rs](../../kida-core/src/infrastructure/storage/toml.rs), `save` (líneas 48–98 aproximadamente), repiten creación de directorio, temporal con UUID, apertura exclusiva, escritura, `sync_all`, `rename` y limpieza. La validación previa y la serialización sí dependen del formato. [storage/tests.rs](../../kida-core/src/infrastructure/storage/tests.rs) contiene únicamente un comentario; hay cobertura indirecta desde repositorios y configuración, pero no una suite dedicada en ese archivo.

**Consecuencia.** Una corrección del manejo de temporales o de errores puede aplicarse solo a uno de los formatos. La duplicación afecta precisamente a una garantía de persistencia.

**Propuesta.** Extraer un helper privado que reciba ruta y bytes ya serializados y realice solo el reemplazo del archivo. Mantener en cada implementación la lectura/validación del contenido anterior y sus errores específicos. Conservar el trait `Storage<T>` y evitar jerarquías de codecs o una fábrica adicional.

**Preservación y verificación.** Probar ambos formatos: round trip, archivo corrupto que no se sobrescribe, destino inexistente, fallo de reemplazo y limpieza del temporal. Preservar el temporal en el mismo filesystem, `create_new`, la serialización antes de modificar archivos y los errores actuales. No confundir reemplazo atómico con una garantía adicional de durabilidad ante corte eléctrico.

---

## Q07. Cuatro handlers Docker casi idénticos

**Estado: completada (2026-10-16).** Un helper privado asíncrono del módulo de handlers Docker comparte extracción, recorte y validación de `container`, ejecución y construcción de respuestas. Recibe la operación como función y el estado de éxito; los cuatro wrappers conservan explícitos `start/running`, `stop/stopped`, `restart/restarted` y `delete/deleted` (el servicio ejecuta `rm`). El bloque completo continúa dentro de un único `run_blocking`, conservando Q04, las respuestas y los errores actuales. No se añaden macros ni dependencias, no se modifica el servicio Docker ni la allowlist del lifecycle y no se aborda la reorganización de pruebas de Q13.

**Validación de la corrección.** 167 tests superados (58 unitarios y 2 de integración CLI, 107 CORE), 10 ignorados; la suite completa pasó fuera del sandbox para permitir los transportes locales. Formato y Clippy estricto correctos; revisión independiente aprobada con repetición de la prueba específica. La nueva prueba padre ejecuta expresamente el test hijo aislado con PATH cerrado y Docker simulado, sin modificar el entorno del proceso principal. Cubre los cuatro comandos mediante el ejecutor y compara respuestas JSON completas, ID, estados, recorte y conservación de espacios internos, argumentos exactos, `delete` traducido a `rm` y fallos con stderr. Los casos ausente, null, tipos incorrectos, vacío y espacios verifican el mensaje exacto y la ausencia de invocaciones a Docker. Se conservan las pruebas anteriores de ejecución bloqueante y lifecycle; no se ha utilizado un daemon Docker real.

**Evidencia.** [docker_container_start.rs](../../kida-core/src/exec/commands/docker/docker_container_start.rs), [docker_container_stop.rs](../../kida-core/src/exec/commands/docker/docker_container_stop.rs), [docker_container_restart.rs](../../kida-core/src/exec/commands/docker/docker_container_restart.rs) y [docker_container_delete.rs](../../kida-core/src/exec/commands/docker/docker_container_delete.rs) repiten extracción de `container`, recorte, rechazo de vacío y construcción de `CommandResponse`. Cambian la operación y el estado de éxito. En el servicio ya se comparte `run_container_action`.

**Consecuencia.** Una modificación del contrato del parámetro exige cuatro cambios equivalentes y facilita diferencias accidentales.

**Propuesta.** Compartir un helper local de adaptación para estas cuatro acciones, conservando wrappers explícitos si ayudan al despacho. Pasar la operación y el estado de éxito de manera sencilla; no introducir macros ni un framework de handlers.

**Preservación y verificación.** Comparar respuestas exactas para cada acción: `running`, `stopped`, `restarted` y `deleted`, identificador de petición, parámetro recortado y mensaje de parámetro obligatorio. Cubrir valor ausente, tipo incorrecto, vacío y error de Docker con un ejecutable simulado. Coordinar la extracción con Q04.

---

## Q08. Búsqueda y creación del repositorio de backup repetidas

**Estado: completada (2026-10-16).** `BackupRepository::get` y `delete` comparten un helper privado que devuelve ruta y job; `delete` elimina exactamente esa ruta. La búsqueda mantiene el recorrido de `read_dir`, la primera coincidencia por ID o nombre, el filtrado de extensiones y la propagación de errores, sin usar un listado ordenado ni deducir el nombre del archivo a partir del ID. Un segundo helper privado del servicio construye el repositorio desde `conf::get().backup.backup_dir`, conservando la conversión de errores de configuración. Los constructores explícitos y `create_in` siguen disponibles para las pruebas. No se añaden migraciones ni gestión de archivos heredados.

**Validación de la corrección.** 172 tests superados (58 unitarios y 2 de integración CLI, 112 CORE), 10 ignorados; suite completa fuera del sandbox para permitir los transportes locales. Formato y Clippy estricto correctos; revisión independiente aprobada con repetición de las ocho pruebas del repositorio. Las cinco nuevas cubren directorio ausente y vacío con errores exactos, búsqueda y borrado por ID o nombre en archivos no canónicos, extensiones ignoradas, conservación de TOML corrupto y primera coincidencia ante nombres duplicados o colisiones entre ID y nombre. También verifican que la corrupción anterior a una coincidencia aborta la búsqueda y que la posterior no se lee. Se conservan las pruebas existentes de configuración no inicializada y del flujo create/list/run/delete con directorio configurado. No se han probado modificaciones concurrentes del directorio; la extracción conserva la conducta previa.

**Evidencia.** [repository.rs de backup](../../kida-core/src/features/backup/repository.rs), `get` (63–84) y `delete` (86–108), repiten recorrido, filtrado TOML, carga y comparación por ID/nombre. En [service.rs](../../kida-core/src/features/backup/service.rs), `list`, `create`, `delete` y `run` repiten la construcción del repositorio desde `conf::get().backup.backup_dir`.

**Consecuencia.** Reglas de búsqueda y traducción de errores quedan dispersas. Corregir una ruta exige recordar sus copias.

**Propuesta.** Un helper privado de búsqueda que devuelva ruta y job permitiría que `delete` elimine exactamente el archivo encontrado. Un segundo helper pequeño puede construir el repositorio configurado, manteniendo los constructores explícitos usados por pruebas.

**Preservación y verificación.** Conservar ID o nombre como selector, comportamiento ante directorio ausente, filtrado de extensiones y propagación de TOML corrupto. No sustituir la búsqueda por un `list` ordenado o por acceso directo a `<id>.toml` sin estudiar compatibilidad: cambiaría orden, errores o selección de nombres duplicados. Ampliar las pruebas actuales de repositorio con esos bordes.

---

## Q09. Dependencia circular entre features y adaptación de comandos

**Evidencia.** [service.rs de backup](../../kida-core/src/features/backup/service.rs), `run_lifecycle`, construye `CommandRequest`, llama a `executor::execute_lifecycle` y vuelve a interpretar `CommandResponse`. Ese ejecutor llama a handlers Docker que terminan en `DockerService`. A su vez, [service.rs del scheduler](../../kida-core/src/features/scheduler/service.rs) depende de `executor::is_registered`, mientras el ejecutor depende del runtime y los handlers del scheduler.

**Consecuencia.** La lógica de features conoce el sobre de comunicación y el dispatcher que también la invoca. Dificulta aislar pruebas y provoca conversiones de resultado de servicio → respuesta de protocolo → error de backup.

**Propuesta.** Extraer primero una operación interna pequeña para las acciones permitidas del lifecycle, compartida por el adaptador de comandos y backup. Resolver la consulta de comandos del scheduler conjuntamente con Q01 en un catálogo sin dependencias del runtime. Evitar un rediseño genérico de buses o plugins.

**Preservación y verificación.** La lista permitida del lifecycle debe seguir siendo exclusivamente stop/start/restart de contenedores; compartir código no autoriza a llamar al dispatcher general. Mantener mensajes y parámetros públicos, el orden de los pasos, y el control de cola. Una función de ejecución inyectable permitiría probar los fallos de Q03 sin Docker real.

---

## Q10. Contrato de protocolo copiado entre CORE y CLI

**Evidencia.** [protocol.rs de CORE](../../kida-core/src/infrastructure/comm/protocol.rs) y [protocol.rs de CLI](../../kida-cli/src/protocol.rs) definen por separado `CommandRequest`, `CommandResponse` y `CommandStatus`, con los mismos campos y atributos Serde. También hay DTO de backup y scheduler en ambos binarios. La CLI incluye además `ResponseResult`, que pertenece a presentación.

**Consecuencia.** Una modificación puede compilar en ambos proyectos y dejar de ser interoperable por diferencias en defaults, valores nulos, nombres o campos opcionales. La duplicación actual no demuestra que ya haya incompatibilidad.

**Propuesta.** Añadir primero pruebas de contrato con fixtures compartidos para los sobres y DTO públicos, aprovechando el patrón ya usado en backup. Extraer tipos a una crate de protocolo solo si la frecuencia de cambios justifica ese coste; no convertir CORE en dependencia del cliente ni compartir servicios de ejecución.

**Preservación y verificación.** Fijar `OK`/`ERROR`, omisión de campos opcionales, defaults de `params` y conservación de `null`. Mantener los adaptadores de persistencia separados de los DTO del protocolo y `ResponseResult` dentro de la CLI. Incluir respuestas erróneas y payloads anidados, no solo ejemplos válidos mínimos.

---

## Q11. Renderer del scheduler dependiente del modelo de entrada

**Evidencia.** [renderer/scheduler.rs](../../kida-cli/src/renderer/scheduler.rs), líneas 7 y 51–69, importa `input::scheduler::ScheduleRule` para interpretar respuestas. Ese enum se define junto a los modos de entrada, defaults y wizard en [input/scheduler.rs](../../kida-cli/src/input/scheduler.rs).

**Consecuencia.** Un cambio hecho por comodidad de entrada puede modificar indirectamente qué respuestas se aceptan al renderizar. La comprobación adicional de `timezone` en el renderer ya muestra que un default válido al preparar entradas no equivale al contrato exigido a una respuesta.

**Propuesta.** Mover únicamente los tipos compartidos de datos del scheduler a un módulo neutral de la CLI y mantener separadas las políticas de entrada y validación de respuesta. No duplicar el enum ni introducir una nueva capa de servicios.

**Preservación y verificación.** Mantener `RenderError` en respuestas conocidas malformadas, comprobación obligatoria de `timezone`, textos y formato actuales. Ejecutar las pruebas existentes de modos de entrada y de renderizado malformado. Prioridad baja: el renderer sigue siendo puro y devuelve texto; ese patrón funciona correctamente.

---

## Q12. Interfaces sin consumidores ocultas mediante supresiones

**Evidencia.** [storage/factory.rs](../../kida-core/src/infrastructure/storage/factory.rs) define `StorageFactory::create` y `StorageFormat`, sin llamadas encontradas en el workspace; sus consumidores construyen `JsonStorage` o `TomlStorage` directamente. [storage/mod.rs](../../kida-core/src/infrastructure/storage/mod.rs) suprime código e imports no usados para retener la interfaz. [client.rs de CLI](../../kida-cli/src/client.rs), líneas 91–94, conserva de la misma forma `socket_path`, sin llamadas encontradas.

**Consecuencia.** Se mantiene una vía de construcción alternativa y una superficie de API que no participa en el flujo real. Las supresiones impiden que el compilador vuelva a señalar su falta de uso.

**Propuesta.** Comprobar si existe un compromiso de integración concreto para esas interfaces. Si no existe, retirar la fábrica y el accessor; los dos paquetes son binarios, pero aun así conviene revisar consumidores documentados y planes vigentes. Si deben permanecer, documentar la necesidad concreta y acotar la supresión.

**Preservación y verificación.** No aplicar una eliminación masiva de `allow(dead_code)`: Docker tiene capacidades de lifecycle, ownership y diagnósticos con pruebas específicas, y configuración tiene una API `update` cubierta expresamente. La ausencia de un comando público no basta para declararlas redundantes. Compilar todos los targets y revisar referencias tras cualquier retirada futura.

---

## Q13. Demasiados escenarios bajo una sola prueba Docker

**Evidencia.** [lifecycle_tests.rs](../../kida-core/src/features/docker/lifecycle_tests.rs): `lifecycle_with_isolated_fake_docker` inicia el hijo `lifecycle_child`, que ejecuta numerosos escenarios y después agrupa comprobaciones en `ownership_checks`, `concurrency_checks` y `persistence_checks`. Los escenarios reinician archivos mediante una closure local. La prueba padre valida éxito y que el hijo haya ejecutado una prueba.

**Consecuencia.** Un fallo temprano impide ejecutar escenarios posteriores y el runner muestra un nombre agregado, lo que dificulta identificar y repetir una regresión concreta. El tamaño del archivo por sí solo no sería un problema; la dependencia secuencial entre escenarios sí lo es.

**Propuesta.** Separar por comportamiento y dar a cada escenario un nombre y fixtures propios. Mantener un helper local que prepare el ejecutable Docker simulado y lance cada escenario en un subproceso con entorno aislado. Extraer preparación repetida, sin esconder las aserciones detrás de una abstracción genérica.

**Preservación y verificación.** Conservar todos los escenarios, las barreras de concurrencia, los fallos inyectados y la comprobación de que el hijo realmente ejecutó pruebas. No sustituir el aislamiento por cambios globales de `PATH`, no quitar pruebas ignoradas de aceptación real y no presentar el fake como validación contra un daemon real.

---

## Q14. Resolver implícito del workspace

**Evidencia.** [Cargo.toml raíz](../../Cargo.toml) solo declara los miembros; ambos paquetes usan Rust 2024. Cargo avisa en tests y Clippy de que el workspace virtual usa `resolver = "1"` aunque la edición implica `resolver = "3"`.

**Consecuencia.** La política de resolución no está expresada y se genera ruido en cada comprobación. El aviso no prueba por sí mismo un error funcional ni una incompatibilidad de dependencias.

**Propuesta.** Declarar el resolver intencional. `resolver = "1"` explicita la conducta existente; migrar a `"3"` es una decisión distinta que debe comprobarse con el lockfile y el toolchain de CI. Evitar mezclar esta modificación con actualizaciones de versiones.

**Preservación y verificación.** Comparar resolución y features, ejecutar tests y build con `--locked`, y comprobar el toolchain de CI antes de migrar. La revisión local utilizó Rust/Cargo 1.96.0; los workflows declaran una imagen Rust 1.98.1, cuya ejecución no se ha verificado aquí.

## Patrones que conviene conservar

- La CLI separa preparación, mapeo, transporte y presentación. El punto de entrada controla stdout, stderr y códigos de salida; los renderers retornan valores.
- La configuración global se publica una vez con `OnceLock`; no debe convertirse en recarga automática para reducir unas pocas líneas.
- El worker limita concurrencia y admisión, y serializa backups sin ocupar capacidad de ejecución mientras esperan su exclusión. Es complejidad justificada y cubierta por pruebas.
- El scheduler preserva admisiones confirmadas aunque falle una persistencia posterior. No simplificar su copia de estado o su manejo de errores ignorando esa diferencia con las operaciones reversibles de alta/baja.
- Docker conserva bloqueos por proyecto, comprobaciones de ownership/procedencia, límites de salida, deadlines y limpieza de procesos. La longitud de ese código no justifica sustituirlo por llamadas generales de borrado.
- La conversión de JSON libre a strings en TOML conserva `null`, estructuras anidadas y valores legacy. No eliminarla como aparente redundancia.

## Validación realizada y límites

| Comprobación | Resultado |
| --- | --- |
| `cargo fmt --all -- --check` | Correcto |
| `CARGO_TARGET_DIR=/tmp/kida-quality-audit-target cargo clippy --workspace --all-targets --locked --offline -- -D warnings` | Correcto; aviso de Cargo sobre resolver implícito |
| `CARGO_TARGET_DIR=/tmp/kida-quality-audit-target cargo test --workspace --locked --offline` | Correcto fuera de la sandbox: 58 tests unitarios CLI, 2 de integración CLI y 68 CORE superados; 7 CORE ignorados |

El primer intento de tests en la sandbox terminó con 53 pruebas CLI superadas y 5 fallidas por `PermissionDenied` al crear sockets. Se repitió la suite completa con permiso fuera de ella, sin cambiar ni omitir pruebas. Algunos tests ignorados son hijos ejecutados por pruebas padre; el contador de ignorados no equivale a siete funcionalidades sin verificar. Las aceptaciones marcadas para Docker real no se ejecutaron.

Las comprobaciones proporcionan una línea base, no demuestran ausencia de los defectos señalados. Q01–Q05 se apoyan en flujos concretos; no se añadieron reproducciones ni tests nuevos porque el encargo es de exploración y documentación. No se realizaron pruebas de carga, cortes eléctricos, apagado/encendido físico o despliegue.

## Orden sugerido de mantenimiento

1. Caracterizar con pruebas las rutas de Q01, Q02, Q03 y Q05; resolver por separado las decisiones de compatibilidad y recuperación.
2. Aplicar Q06, Q07 y Q08 en cambios pequeños que conserven contratos; son las reducciones de duplicación más directas.
3. Abordar Q04 y Q09 conservando las garantías de concurrencia, cancelación y política de ejecución.
4. Completar contratos y legibilidad con Q10–Q14 según el beneficio real y las integraciones previstas.

Cada cambio futuro debe pasar sus pruebas específicas, revisar el diff y mantener la suite existente. No se propone ampliar funcionalidades de backup, alterar comandos públicos ni sustituir la arquitectura del proyecto como parte de este mantenimiento.
