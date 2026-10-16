# Tareas pendientes de calidad de código de KIDA

Revisión del listado: 2026-10-16, sobre el código de `44d9aac`.

## Criterio y depuración

Este documento contiene únicamente trabajo pendiente con un beneficio concreto. Las tareas implementadas y sus verificaciones se consultan en el historial Git. Esta revisión modifica solo documentación; no continúa la limpieza del código ni vuelve a ejecutar la suite.

Se han eliminado Q01–Q08 por estar completadas. Q10 y Q11 se agrupan en una sola tarea sobre el contrato de datos CORE/CLI. Q12 se actualiza porque la fábrica de almacenamiento sí tiene consumidores en pruebas desde Q06. Q13 se acota a separar grupos de pruebas existentes. Se mantienen los identificadores originales para conservar las referencias de las conversaciones y commits.

Se retira Q09 como tarea independiente: el registro de comandos ya está centralizado en el catálogo de Q01 y la recuperación del lifecycle está cubierta por Q03. Persisten llamadas desde features al ejecutor, pero no se ha identificado un defecto adicional que justifique introducir otra operación compartida o mecanismo de inyección. La dirección de una dependencia, por sí sola, no justifica ampliar esta limpieza.

## Resumen

| ID | Prioridad | Trabajo pendiente | Beneficio |
| --- | --- | --- | --- |
| Q10 | Media | Verificar el contrato CORE/CLI y ubicar el modelo compartido del scheduler | Detectar divergencias sin compartir servicios ni políticas de entrada |
| Q12 | Baja | Retirar la fábrica de almacenamiento sin uso en producción y el accessor de socket sin llamadas | Reducir interfaces y supresiones innecesarias |
| Q13 | Media | Separar los grupos existentes de pruebas Docker | Ejecutar y diagnosticar grupos sin depender de los anteriores |
| Q14 | Baja | Explicitar el resolver actual del workspace | Eliminar el aviso sin cambiar la resolución de dependencias |

## Q10. Contrato de datos CORE/CLI y modelo compartido del scheduler

**Agrupa las anteriores Q10 y Q11.** Ambas tratan la propiedad y validación de los datos que cruzan la frontera CORE/CLI; no requieren proyectos separados de reorganización de tipos.

**Evidencia actual.** [protocol.rs de CORE](../../kida-core/src/infrastructure/comm/protocol.rs) y [protocol.rs de CLI](../../kida-cli/src/protocol.rs) definen por separado los sobres y estados del protocolo. El [renderer del scheduler](../../kida-cli/src/renderer/scheduler.rs) deserializa `ScheduleRule` desde [input/scheduler.rs](../../kida-cli/src/input/scheduler.rs) y exige explícitamente `timezone` en respuestas cron, mientras la entrada admite el default UTC. Hay fixtures compartidos de backup, pero no una comprobación conjunta de estos sobres y reglas del scheduler. No se ha demostrado una incompatibilidad actual.

**Cambio acotado.** Añadir fixtures compartidos y pruebas en ambos paquetes para los sobres y datos del scheduler; reutilizar los fixtures de backup existentes. Mover únicamente el tipo del scheduler utilizado por entrada y renderer a un módulo neutral dentro de CLI, conservando por separado el default de entrada y las comprobaciones de respuesta. No extraer una crate de protocolo, duplicar enums, reorganizar todos los DTO ni añadir una capa de servicios.

**Aceptación.** Verificar `OK`/`ERROR`, omisión de campos opcionales, default de `params`, `null` explícito y payloads anidados. Cubrir once/interval/cron y respuestas malformadas, incluida la ausencia de `timezone` en cron. Conservar los textos y `RenderError` de la CLI, los modos de entrada, los adaptadores de persistencia y `ResponseResult` como responsabilidad de presentación. Las pruebas deben ejercitar los tipos reales de ambos paquetes.

## Q12. Interfaces sin uso en producción

**Evidencia actual.** [StorageFactory y StorageFormat](../../kida-core/src/infrastructure/storage/factory.rs) solo tienen consumidores en [las pruebas de almacenamiento](../../kida-core/src/infrastructure/storage/tests.rs). Los servicios construyen los almacenamientos concretos directamente. [storage/mod.rs](../../kida-core/src/infrastructure/storage/mod.rs) mantiene supresiones para conservar esa fábrica. El accessor `KidaClient::socket_path` de [client.rs](../../kida-cli/src/client.rs) sigue sin llamadas y tiene su propia supresión.

**Cambio acotado.** Retirar fábrica, selector de formato, reexports y supresiones asociados; adaptar las pruebas para construir `JsonStorage` y `TomlStorage` directamente con preparación local mínima. Retirar el accessor sin eliminar el campo que usa el transporte. No crear otra fábrica para sustituirlos ni extender esta tarea a una eliminación general de `allow(dead_code)`.

**Aceptación.** Mantener íntegros los escenarios y aserciones de almacenamiento de Q06, incluidas las pruebas de errores y conservación de datos. Comprobar referencias, todos los targets y Clippy estricto. Conservar las capacidades Docker de lifecycle/ownership, la API de actualización de configuración y cualquier otra funcionalidad con pruebas o consumidores concretos.

## Q13. Grupos independientes de pruebas Docker

**Evidencia actual.** En [lifecycle_tests.rs](../../kida-core/src/features/docker/lifecycle_tests.rs), un único padre ejecuta `lifecycle_child`. El hijo agrupa escenarios de lifecycle y llama a `ownership_checks`, `persistence_checks` y `concurrency_checks`. Un fallo en un grupo impide ejecutar los posteriores y el runner solo identifica la prueba agregada.

**Cambio acotado.** Separar esos cuatro grupos en pruebas con nombre propio, cada una con su directorio y subproceso. Reutilizar la preparación del fake y el lanzamiento del hijo mediante un helper local. Mantener inicialmente juntos los escenarios de cada grupo; no crear un framework ni convertir cada aserción en una prueba independiente. Conservar también el caso de ejecutable ausente y la comprobación de persistencia entre procesos.

**Aceptación.** Cada grupo debe poder ejecutarse por filtro y el fallo de uno no debe impedir que el runner ejecute los demás. Mantener todas las aserciones, barreras, fallos inyectados, deadlines y comprobaciones de procesos. Cada padre debe verificar que su hijo ejecutó pruebas. No cambiar globalmente PATH, retirar aceptaciones ignoradas de Docker real ni presentar el fake como aceptación contra un daemon.

## Q14. Resolver explícito sin migración

**Evidencia actual.** El [manifiesto raíz](../../Cargo.toml) no declara resolver. Cargo avisa de que el workspace virtual usa `resolver = "1"`, aunque ambos paquetes declaran Rust 2024. El aviso no demuestra un defecto funcional.

**Cambio acotado.** Declarar `resolver = "1"` para expresar la conducta existente. Migrar al resolver 3 o actualizar dependencias queda fuera de esta tarea: no es necesario para eliminar el aviso.

**Aceptación.** Ejecutar tests y build del workspace con `--locked`, comprobar que desaparece el aviso y que `Cargo.lock` no cambia. No modificar versiones, features ni el toolchain del workflow.

## Reglas para las siguientes iteraciones

- Trabajar una tarea cada vez, con sus pruebas relevantes y revisión independiente antes del commit. El orden del resumen mantiene la continuidad del flujo; las tareas no dependen unas de otras.
- Conservar CLI → input → mapper → client → renderer, renderers sin impresión y configuración global inicializada una sola vez.
- Conservar las políticas de cola, exclusión de backups y admisión/persistencia del scheduler, así como los controles de ownership, deadlines y limpieza de procesos Docker.
- Mantener la representación de JSON libre en TOML; no añadir migraciones ni gestionar archivos heredados del administrador.
- No añadir funcionalidades ni abstracciones para satisfacer una preferencia arquitectónica sin un problema concreto. Tras cada cambio aprobado, retirar su tarea de este listado; el historial Git conserva la evidencia.
