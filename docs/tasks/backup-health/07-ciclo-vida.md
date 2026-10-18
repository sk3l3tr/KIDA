# 07 · Ciclo de vida y admisión

**Objetivo:** coordinar ejecuciones automáticas/manuales con estados y límites coherentes.

## Trabajo

- Implementar el servicio de `create/start/run/get/list/stop/delete`, separando estado operativo y resultado técnico. `run` reutiliza creación/arranque automático.
- Poseer admisión, exclusión por definición, cupo global de entornos y rollback ante fallo de cola/persistencia. Devolver `run_id` sin esperar restauración/diagnóstico.
- Coordinar artefacto, restauración, Compose, diagnóstico y persistencia por sus contratos. No implementar esas capacidades dentro de esta tarea.
- Automático: capturar antes de limpiar y cerrar informe después del intento. Manual: permitir consulta, TTL desde admisión, parada con datos conservados y eliminación posterior; impedir reinicio de `STOPPED`.
- Serializar conflictos del mismo run, cancelar trabajo pendiente tras stop/delete y conservar errores/evidencias. Fallos de parada no liberan capacidad mientras haya recursos activos o inciertos.

## Frontera

Posee coordinación de dominio y reserva de capacidad, no handlers ni el runner del worker. 09 conecta su admisión con la cola; el trabajo admitido tiene una vía de ejecución que no readmite ni reencola. Validar con dobles locales de los componentes documentados en [contratos](contratos.md).

## Pruebas y cierre

Probar dos definiciones simultáneas, dos arranques de la misma definición, cupo ocupado por manuales y liberación confirmada. Cubrir cola llena/cerrada, persistencia fallida, fallos de cada fase, cancelación, stop/delete durante STARTING y delete repetido. Comprobar que una ejecución detenida no bloquea otra y que get no renueva TTL.

Cierra cuando la máquina de estados y los límites se sostienen bajo concurrencia sin locks globales alrededor de I/O. Actualizar el índice.

## Implementación y revisión

Estado: **Completa**. Commit de implementación: `2a93f35`. Implementación en [service.rs](../../../kida-core/src/features/backup/health/service.rs) y limpieza de restauraciones con procedencia en [restore.rs](../../../kida-core/src/features/backup/health/restore.rs). La reserva se libera solo tras parada confirmada o eliminación Docker completada. Las operaciones se serializan por run; las consultas ofrecen el último snapshot parcial sin esperar al trabajo en curso.

`stop` conserva los datos y deja el informe pendiente del intento de eliminación; `delete` conserva el historial y cierra el informe. Un manual detenido conserva sus datos hasta eliminación explícita, TTL o el siguiente arranque. La limpieza distingue recursos Docker propios de bind mounts y recursos externos preservados.

Validación: pruebas de admisión concurrente, definición/cupo, cola llena/cerrada, persistencia fallida, cancelación, consultas parciales y limpieza por dispositivo/inodo en [service_tests.rs](../../../kida-core/src/features/backup/health/service_tests.rs). El [ciclo con Docker simulado](../../../kida-core/src/features/backup/health/service_lifecycle_tests.rs) cubre éxito automático/manual, fallos de cada fase, parada fallida y reintento tras eliminar Docker y sustituir temporalmente el directorio.

Revisor independiente: agente `reviewer`. Corregidos sus hallazgos sobre recursos externos preservados y reintentos después de completar la eliminación Docker. No se ha usado un daemon real.

Validación integrada del 18/10/2026: `CARGO_TARGET_DIR=/tmp/kida-target cargo test --workspace --locked` (262 tests aprobados; 16 fixtures hijos ignorados e invocados por sus pruebas padre), `cargo fmt --all -- --check`, `CARGO_TARGET_DIR=/tmp/kida-target cargo clippy --workspace --all-targets --locked -- -D warnings` y `git diff --check`. Suite ejecutada fuera del sandbox para permitir los sockets Unix temporales de las pruebas existentes; `Cargo.lock` sin cambios.
