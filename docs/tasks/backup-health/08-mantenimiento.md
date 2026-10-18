# 08 · TTL, retención y arranque

**Objetivo:** cerrar ejecuciones abandonadas y mantener el almacenamiento sin perder prueba de propiedad.

## Trabajo

- Registrar/controlar exactamente dos jobs internos mediante las APIs actuales del Scheduler: expiración y retención, con cadencias y parámetros de [contratos](contratos.md). Evitar duplicados tras arranques sucesivos.
- Expirar manuales desde su inicio, y reintentar limpiezas pendientes en la misma pasada. Consumir las operaciones del servicio, sin otro scheduler ni lógica Docker duplicada.
- Al arrancar KIDA, conciliar registros/informes, cerrar ejecuciones previas e intentar limpiar sus recursos propios antes de admitir Health. No recuperar manuales aunque conserven TTL.
- Mantener los demás servicios disponibles si Docker falla; conservar anomalías y reservas por recursos inciertos para reintentar sin adoptar recursos ajenos.
- Eliminar historial e informes vencidos desde `finished_at`; preservar evidencias necesarias para recursos aún pendientes de limpieza.

## Frontera

Posee políticas temporales, registro de jobs e integración de arranque. Consume servicio de 07 y repositorios/conciliación de 06 mediante contratos y reloj controlado en tests. 09 conecta las acciones internas con ejecución protegida. No modifica el algoritmo del Scheduler, añade hooks del SO ni interpreta resultados técnicos.

## Pruebas y cierre

Probar borde exacto del TTL/retención, consultas sin renovación, informe ya borrado, ejecuciones interrumpidas, Docker caído y segundo arranque idempotente. Verificar dos jobs, parámetros de conf y rechazo administrativo real en el servicio, además de reintentos sin eliminar registros de propiedad pendientes.

Cierra cuando una ejecución anterior no se reanuda y todas las limpiezas fallidas quedan trazables y reintentables. Actualizar el índice.

## Implementación y revisión

Estado: **Verificada**. Políticas en [maintenance.rs](../../../kida-core/src/features/backup/health/maintenance.rs), retención/lectura tolerante en [history.rs](../../../kida-core/src/features/backup/health/history.rs) y registro de dos jobs mediante el runtime Scheduler existente. La inicialización Health concilia y cierra ejecuciones anteriores antes de publicar el servicio; los demás servicios arrancan sin esperar a Docker.

Las consultas no renuevan el TTL. Una parada manual voluntaria conserva datos hasta el TTL; los intentos de limpieza fallidos se reintentan. La retención usa `finished_at` y conserva registros con recursos pendientes. Un historial corrupto no impide limpiar los registros válidos; bloquea nuevas admisiones para no perder reservas desconocidas. Repararlo requiere reiniciar para volver a cargar el historial.

Validación en [maintenance_tests.rs](../../../kida-core/src/features/backup/health/maintenance_tests.rs) y pruebas de retención del repositorio: bordes exactos, informe borrado, dos jobs idempotentes y protegidos, arranque repetido, registro corrupto y conservación de datos detenidos. La prueba del servicio con Docker simulado cubre parada fallida y reintento.

Revisor independiente: agente `reviewer`. Corregidos sus hallazgos sobre historial corrupto y eliminación prematura de datos conservados por `stop`.

Validación integrada del 18/10/2026: `CARGO_TARGET_DIR=/tmp/kida-target cargo test --workspace --locked` (262 tests aprobados; 16 fixtures hijos ignorados e invocados por sus pruebas padre), `cargo fmt --all -- --check`, `CARGO_TARGET_DIR=/tmp/kida-target cargo clippy --workspace --all-targets --locked -- -D warnings` y `git diff --check`. Suite ejecutada fuera del sandbox para permitir los sockets Unix temporales de las pruebas existentes; `Cargo.lock` sin cambios.
