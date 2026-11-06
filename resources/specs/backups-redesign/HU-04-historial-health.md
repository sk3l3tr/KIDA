# HU-04 · Consultar comprobaciones de recuperación

**Estado:** pendiente. **Dependencia:** HU-03 aceptada e integrada.

Como administrador, quiero comparar las comprobaciones de Backup Health y revisar sus diagnósticos, evidencias y limpieza sin confundirlos con el resultado de un backup.

## Contexto para el agente

Leer [spec general](../backups-redesign.md) y entrega de [HU-03](HU-03-crear-configuracion.md). Examinar `tabs/backup-health/`, `BackupHealthState`, `BackupHealthDetail`, modelos Health y `SidePanel`.

## Alcance

- Sustituir el listado por tabla: definición/referencia, modo, estado, diagnóstico/completitud, creación y acceso al inspector. Mantener actualización y estados de lectura.
- Abrir `BackupHealthDetail` en panel reutilizando todo su contenido: fechas, definición/backup, servicios, anomalías, evidencias/logs, artefacto, Compose/restauración, recursos, limpieza, procedencia del historial, informe y JSON. Resumen primero; plegar técnicos extensos sin eliminarlos.
- Mantener iniciar/detener/eliminar con sus confirmaciones y bloqueos actuales. Coordinar focus trap del panel y diálogo ARCA como Docker, sin crear otro diálogo.
- Fechas en zona local identificada; estado, diagnóstico y limpieza separados, con valores desconocidos visibles y neutros. Tabla móvil desplazable dentro de su contenedor.
- Mantener los formularios actuales de crear/ejecutar Health accesibles hasta HU-05. Los resultados e incertidumbres permanecen fuera del inspector.

## Criterios de aceptación

1. Tabla fiel al historial, sin datos inventados; vacío, carga, error y datos desactualizados siguen diferenciados.
2. Todos los campos antes disponibles siguen consultables. Nulos, precisión limitada y campos futuros no se convierten en datos supuestos.
3. Cambiar selección/cerrar/cambiar pestaña durante la lectura invalida su detalle y libera loading; la respuesta no reabre el inspector ni muestra otro run.
4. Confirmaciones conservan run_id congelado y ejecutan una sola vez. CORE decide validez y limpieza; ningún badge implica recuperación funcional o eliminación de recursos.
5. Cancelar confirmación devuelve foco al panel; cerrar devuelve al disparador o fallback válido. Las escrituras iniciadas no se cancelan por cerrar.

## Archivos y comprobación

Ámbito: `tabs/backup-health/`, `components/backup-health-detail/`, `services/health-state.ts`, fachada solo para cierre/modo, estilos y `tests/health.spec.ts`.

Desde `kida-console/frontend`:

```sh
pnpm exec ng test --watch=false --include='src/app/pages/backups/tests/*.spec.ts'
pnpm exec ng build --configuration development
```

Cubrir respuesta tardía de detalle, estados desconocidos, contenido íntegro, confirmación sobre inspector y semántica de limpieza. No hacer una matriz Playwright.

## Entrega de sesión

Pendiente: registrar cambios, verificaciones y revisión independiente. Explicar la integración de confirmaciones para reutilizarla en HU-05.
