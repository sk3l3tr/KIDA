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
