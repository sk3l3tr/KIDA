# HU-06 · Consultar y eliminar informes

**Estado:** pendiente. **Dependencia:** HU-05 aceptada e integrada.

Como administrador, quiero localizar un informe por run_id, leerlo completo y eliminarlo con confirmación sin confundirlo con la ejecución de Health.

## Contexto para el agente

Leer [spec general](../backups-redesign.md) y entrega de [HU-05](HU-05-crear-ejecutar-health.md). Examinar `tabs/backup-reports/`, `BackupReportsState`, callback de actualización de Health en la fachada y `SidePanel`.

## Alcance

- Lista compacta por ID exacto con Actualizar, Ver informe y Eliminar informe; fecha de lectura y estados existentes.
- Lector en `SidePanel`: Markdown literal mediante interpolación en `pre`, espacios y saltos intactos, JSON y precisión limitada. Retirar el detalle inline anterior.
- Confirmación ARCA con snapshot del run_id; borrar informe conserva su operación propia y refresco cruzado del historial/detalle de Health.
- Reutilizar modo de panel, cierre/selección, bloqueos y coordinación de foco establecidos. Mantener resultados e incertidumbres fuera del panel.

## Criterios de aceptación

1. No se derivan fechas del identificador ni se inventan nombres/estados. Se distingue lista vacía de fallo y datos anteriores.
2. Markdown e identificadores remotos se muestran como texto seguro, sin HTML interpretado y sin alterar whitespace ni ID usado en la operación.
3. Cambiar/cerrar informe durante la lectura no permite mostrar contenido de otro ID, reabrir panel o dejar detalle cargando indefinidamente.
4. Cancelar no borra; confirmar usa el destino congelado una vez. La respuesta `deleted` determina el mensaje real, no el simple éxito HTTP.
5. Tras borrar se actualiza la información asociada de Health; un fallo de refresco no transforma una eliminación confirmada en fallo. Foco válido si desaparece el informe.
6. Incertidumbres sobreviven a navegación interna y refresco sin reenvío automático ni bloqueo nuevo permanente.

## Archivos y comprobación

Ámbito: `tabs/backup-reports/`, `services/reports-state.ts`, fachada/Health solo si el cierre o refresco existente lo requiere, estilos y `tests/reports.spec.ts`.

Desde `kida-console/frontend`:

```sh
pnpm exec ng test --watch=false --include='src/app/pages/backups/tests/*.spec.ts'
pnpm exec ng build --configuration development
```

Cubrir texto remoto seguro, espacios/Unicode, destino congelado, lectura tardía, borrado con `deleted: false`, refresco cruzado y foco al desaparecer el disparador.

## Entrega de sesión

Pendiente: registrar cambios, verificaciones y revisión independiente. Las tres pestañas deben quedar funcionalmente completas para HU-07.
