# 10 · Comandos CLI

**Objetivo:** permitir usar todas las operaciones Health desde la CLI actual.

## Trabajo

- Añadir la jerarquía `backup health` de [contratos](contratos.md), incluido `run` y gestión de informes.
- Mantener `cli → input → mapper → client → renderer`; validar flags localmente antes de conectar. `--file` representa una ruta de CORE: no leerla ni resolverla en el cliente.
- Mapear a los parámetros pactados y renderizar respuestas humanas (sin opción `--json`), estados, diagnóstico, informes y errores. Renderers devuelven texto; el entrypoint imprime y controla exit codes.
- Documentar ejemplos de manual/automático, programación con `backup.health.run`, ruta en servidor, TTL, no reinicio, limpieza e integridad funcional a cargo del administrador. No añadir wizard.

## Frontera

Posee flags, preparación/mapeo, renderers y documentación CLI. Consume fixtures del protocolo para desarrollarse sin CORE Health implementado. No carga TOML remoto, restaura ni añade lógica Docker o de estados al cliente.

## Pruebas y cierre

Cubrir parsing de todos los comandos; flags incompletos, UUID/modo inválidos y fallos locales sin transporte. Comprobar mapeos exactos y salidas humanas (sin opción `--json`), respuesta malformada y errores de transporte. La prueba de ruta de servidor debe funcionar aunque ese archivo no exista en el cliente.

Cierra cuando todos los comandos tienen contrato y salida comprobados manteniendo el comportamiento de comandos existentes. Actualizar el índice.

## Implementación y revisión

Estado: **Completa**. Commit de implementación: `ccb720b` (`0.0.4 > feat(cli): add backup health commands`). Cierre validado el 18/10/2026.

- [Jerarquía CLI](../../../kida-cli/src/cli/backup.rs), [preparación](../../../kida-cli/src/input/health.rs) y [mapper](../../../kida-cli/src/mapper/backup.rs): diez operaciones públicas; flags obligatorios; modos `automatic/manual` a `AUTOMATIC/MANUAL`; UUID validado y canónico; ruta de CORE intacta sin lectura local. Acceso directo al mapper rechazado antes de preparar; sin wizard.
- [Renderers](../../../kida-cli/src/renderer/backup/health.rs): confirmaciones con Run ID y Queue execution ID diferenciados; lista con definición/modo/estado/resultado/limpieza; detalles del diagnóstico, artefacto, timestamps, anomalías, evidencias, limpieza e informe; gestión de Markdown. Respuestas incompletas o incompatibles producen `RenderError`; sin opción `--json` ni fallback JSON para Health. El estado operativo y el resultado técnico se muestran por separado.
- [Guía CLI](../../../kida-cli/README.md#backup-health): manual/automático, Scheduler con `backup.health.run`, rutas de CORE, TTL desde `started_at`, parada, eliminación, retención y ausencia de reinicio. La ruta registrada de informe no acredita su disponibilidad después de borrarlo: se consulta `report list`.
- [Pruebas](../../../kida-cli/src/health_tests.rs), [errores del binario](../../../kida-cli/tests/local_input.rs) y [fixtures](../../../tests/fixtures/backup-health.json), contrastados con los handlers y modelos reales de CORE. Cubren los diez mapeos, entradas inválidas sin prompts/conexión, UUID canónico, rutas inexistentes transmitidas por socket temporal, parciales, los cinco resultados técnicos, listas vacías, informes y errores de protocolo/renderizado/transporte. Los tests existentes permanecen intactos.

Revisión independiente: agente `review_health_cli`, solo lectura, aprobada sin hallazgos funcionales bloqueantes. Verificó arquitectura, las diez operaciones contra CORE, validación local, renderers y cobertura. Se corrigió su observación menor: ubicar Backup Health antes de la cabecera de licencia en la guía CLI. Revisión propia del diff: sin lógica de dominio duplicada, cambios CORE ni ampliación a la tarea 11.

## Validación realizada

- `cargo test --workspace --locked`: **270 aprobadas** (69 unitarias CLI, 3 de binario CLI, 198 CORE), 0 fallos; 16 pruebas CORE ignoradas según su configuración previa: 13 auxiliares invocadas por wrappers aislados y 3 de aceptación Docker real opt-in.
- `cargo test -p kida-cli --locked`: **72 aprobadas** tras el ajuste final del fixture de historial y su caso malformado.
- `cargo fmt --all -- --check`: correcto.
- `cargo clippy --workspace --all-targets --locked -- -D warnings`: correcto, también tras el ajuste final.
- `git diff --check` y `git diff --cached --check`: correctos, incluyendo los archivos nuevos al preparar el commit.

La primera ejecución dentro del sandbox bloqueó sockets Unix (`Operation not permitted`), también en pruebas previas. Las suites aprobadas se ejecutaron fuera del sandbox con sockets temporales. Los dobles Docker de la suite prueban lógica, no aceptación contra un daemon real. La tarea 11 continúa **Pendiente**; no se ha realizado E2E Docker real en este cierre.
