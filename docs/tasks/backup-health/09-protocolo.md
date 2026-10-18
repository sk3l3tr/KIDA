# 09 · Protocolo y ejecución asíncrona

**Objetivo:** exponer Health mediante los transportes existentes y conectar su trabajo con la cola actual.

## Trabajo

- Registrar las operaciones y parámetros de [contratos](contratos.md), incluido `backup.health.run`, respetando `CommandRequest/CommandResponse`.
- Implementar handlers finos de validación/adaptación hacia 07 y 06; devolver errores y datos coherentes con el protocolo actual, distinguiendo `run_id` e identificador de cola.
- Conectar admisión/reserva de 07 con encolado y ejecución por worker. El consumidor ejecuta el trabajo admitido sin volver al encolado público. Una ejecución programada no espera un segundo permiso ocupado por sí misma.
- Conectar las dos acciones internas de 08 con origen/dispatch protegido; impedir su invocación pública y su creación como jobs de usuario. No debilitar la protección administrativa del Scheduler.
- Añadir al sobre privado de cola el contexto fiable mínimo de una entrada `INTERNAL`, establecido por el servicio Scheduler y conservado por el worker. Hoy ese origen no viaja en la cola; no confiar en campos de `CommandRequest` ni parámetros enviados por clientes.
- Mantener HTTP y socket sobre la misma lógica, sin introducir transportes ni rediseñar cola/worker.

## Frontera

Posee catálogo, handlers y cableado de ejecución. 07 mantiene exclusión, cupo y transiciones; 08 mantiene políticas de mantenimiento. Los tests pueden usar un servicio de prueba con el mismo contrato, sin crear capas de producción adicionales.

## Pruebas y cierre

Probar todos los comandos, parámetros inválidos, run inexistente, admisión rechazada, cola llena/cerrada y respuesta inmediata con `run_id`. Verificar ejecución única, ausencia de reencolado recursivo, ejecución programada con worker de capacidad uno y rechazo de acciones internas por canales públicos, incluso con un origen interno falsificado en parámetros.

Cierra cuando handlers y rutas pueden conectar los componentes reales sin lógica de restauración en el transporte. Actualizar el índice.

## Implementación y revisión

Estado: **Verificada**. [Handlers](../../../kida-core/src/exec/commands/backup/health.rs) finos para las diez operaciones públicas; [cola](../../../kida-core/src/exec/queue.rs), [worker](../../../kida-core/src/exec/worker.rs) y [executor](../../../kida-core/src/exec/executor.rs) conservan el contexto privado de trabajo admitido y del Scheduler interno. No cambia el sobre público ni los transportes.

El consumidor ejecuta el run reservado; `backup.health.run` programado crea/admite y ejecuta directamente con el permiso del worker que ya posee. El identificador de cola corresponde a la entrada real y se distingue de `run_id` y del ID de petición. Expiración/retención no son operaciones públicas ni schedules de usuario.

Validación en [exec/tests.rs](../../../kida-core/src/exec/tests.rs): todos los comandos y sus parámetros, run inexistente, reserva duplicada, cola llena/cerrada y respuesta inmediata. La integración aislada usa servicio real y worker de capacidad uno con cola pública cerrada, probando que no reencola. También cubre rechazo de origen falsificado y propagación del contexto privado; las pruebas Scheduler verifican protección administrativa.

Revisor independiente: agente `reviewer`. Corregido su hallazgo sobre el ID real de cola en ejecuciones programadas.

Validación integrada del 18/10/2026: `CARGO_TARGET_DIR=/tmp/kida-target cargo test --workspace --locked` (262 tests aprobados; 16 fixtures hijos ignorados e invocados por sus pruebas padre), `cargo fmt --all -- --check`, `CARGO_TARGET_DIR=/tmp/kida-target cargo clippy --workspace --all-targets --locked -- -D warnings` y `git diff --check`. Suite ejecutada fuera del sandbox para permitir los sockets Unix temporales de las pruebas existentes; `Cargo.lock` sin cambios.
