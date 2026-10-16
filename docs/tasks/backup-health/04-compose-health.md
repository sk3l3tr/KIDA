# 04 · Integración Compose para Health

**Objetivo:** operar un proyecto exclusivo del run mediante las capacidades Docker actuales.

## Trabajo

- Consumir `ComposeOptions.variables` para inyectar `KIDA_RESTORE_DIR`, con proyecto `kida-bh-<run_id>` y timeout acotado.
- Reutilizar `compose_create/start/stop`, `compose_managed_project` y `compose_remove`; conservar identidad gestionada desde la creación, incluso en fallos parciales.
- Validar antes del inicio políticas efectivas sin autoarranque. Obtener inventario de servicios habilitados y réplicas esperadas para diagnóstico, ruta/hash del Compose e imágenes.
- Exponer solo los datos internos adicionales imprescindibles desde `features/docker`; mantener comandos, runner, locks y prueba de propiedad existentes.

## Frontera

Posee la adaptación Health/Docker y el inventario esperado. Consume definición y ruta restaurada; devuelve recursos y resultados de operaciones/limpieza. 07 decide cuándo invocarla y 05 evalúa sus observaciones. No añade otro mecanismo de ownership ni usa borrados globales. Ver [contratos](contratos.md).

## Pruebas y cierre

Usar el fake Docker existente para variables por proceso, perfiles excluidos, réplicas, restart inválido, errores parciales y limpieza repetida. Comprobar preservación de volúmenes externos/compartidos y recursos sin propiedad demostrada. No afirmar E2E real mediante estos tests.

Cierra cuando se puede preparar/iniciar/parar/eliminar el proyecto con identidad conservada y sin ampliar el ámbito de limpieza. Actualizar el índice.

## Implementación

`health::compose::HealthCompose` prepara el proyecto `kida-bh-<run_id>` con un directorio restaurado existente y un timeout explícito. Expone ruta/hash del Compose, servicios habilitados, imágenes configuradas y réplicas (`scale`/`deploy.replicas`, por defecto 1). Un servicio que solo declara build conserva imagen vacía hasta inspeccionar el contenedor; no se inventa una identidad de imagen.

El modelo se obtiene mediante `DockerService::compose_configuration`, usando el runner y bloqueo actuales. Antes de crear/iniciar se rechazan políticas `restart` con autoarranque y `deploy.restart_policy` distinta de `condition = "none"`; la política omitida de servicio sigue siendo válida. Los perfiles no habilitados no forman parte del inventario. La configuración preparada (ruta/hash e inventario) se comprueba de nuevo al crear/iniciar; no se guarda el entorno ni el Compose completo.

La creación usa el lifecycle existente con una salida adicional de identidad reservada. La referencia se conserva incluso si falla la persistencia o la captura; no acredita propiedad por sí sola: eliminación sigue exigiendo el registro Docker válido y las comprobaciones vigentes. Los recursos devueltos son evidencias registradas, no un inventario Docker actualizado. Iniciar/parar fija el owner esperado, para no adoptar otra creación que reutilice el nombre. Eliminar devuelve el `RemovalReport` existente y no fuerza la parada de contenedores.

El coordinador 07 decidirá cuándo llamar cada operación y conservará sus resultados para 06/08. Esta tarea no añade comandos públicos, diagnóstico, mantenimiento ni otro mecanismo de ownership.

## Validación y revisión

Prueba con el fake Docker existente en un subproceso aislado: variables por proceso, perfiles excluidos, réplicas, políticas inválidas y cambiadas, inventario modificado antes de crear, fallo de inicio, creación parcial, conflictos de owner, timeout y eliminación repetida. Recursos compartidos, un contenedor de producción y un volumen externo permanecen intactos. No acredita E2E contra un daemon real; corresponde a 11.

- `CARGO_TARGET_DIR=/tmp/kida-health-target cargo test -p kida-core --locked compose_health_with_isolated_fake_docker -- --nocapture`: correcto, incluida la fixture hija. También valida entradas inválidas, ausencia de servicios habilitados, cambios de hash y recursos con etiquetas copiadas sin procedencia.
- `CARGO_TARGET_DIR=/tmp/kida-health-target cargo test --workspace --locked --quiet`: 223 correctas, 14 ignoradas (incluye la nueva fixture hija, ejecutada desde su prueba padre); fuera del sandbox para permitir sockets.
- `CARGO_TARGET_DIR=/tmp/kida-health-target cargo clippy --workspace --all-targets --locked -- -D warnings`, `cargo fmt --all -- --check` y comprobaciones de diff: correctos. Sin dependencias nuevas ni cambios en `Cargo.lock`.
- Revisión independiente de `review_task04`: sin defectos accionables de seguridad, compatibilidad o alcance; OK explícito del código para commit. El revisor confirmó la prueba fake Health y `git diff --check`.

Estado: **Verificada**; pendiente del commit para marcarla **Completa**.
