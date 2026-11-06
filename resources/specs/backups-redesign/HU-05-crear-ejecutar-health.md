# HU-05 · Crear y ejecutar comprobaciones de Backup Health

**Estado:** pendiente. **Dependencia:** HU-04 aceptada e integrada.

Como administrador, quiero crear una comprobación o solicitar el flujo automático desde una definición existente en CORE, entendiendo qué inicia cada acción.

## Contexto para el agente

Leer [spec general](../backups-redesign.md) y entrega de [HU-04](HU-04-historial-health.md). Examinar formularios de `tabs/backup-health/`, `BackupHealthState` y helpers de validación. Mantener propietario y operaciones existentes.

## Alcance

- Acciones superiores diferenciadas Crear Health y Ejecutar Health automático; abrir sus formularios en los modos correspondientes del panel existente.
- Crear conserva ruta de definición y MANUAL/AUTOMATIC; automático conserva su ruta independiente y confirmación ARCA. Retirar los formularios permanentes anteriores.
- Borradores en `definitionPath`, `mode` y `automaticPath` actuales. Cerrar/cambiar pestaña los conserva; salida/identidad los limpia. Respetar el restablecimiento de campos que ya hace cada operación tras respuesta confirmada.
- Crear no inicia ninguna ejecución, tampoco en AUTOMATIC. Solicitar automático confirma admisión, no finalización. Mostrar run_id y execution_id con su significado propio.
- Conservar errores, resultados, incertidumbres, refrescos y bloqueos cruzados actuales; ningún cambio visual implica subida o edición del fichero en CORE.

## Criterios de aceptación

1. Los dos flujos permanecen separados y conservan sus payloads/validación. Cancelar la confirmación automática no envía.
2. Reabrir cada formulario recupera su propio borrador; cambiar de modo no mezcla rutas entre flujos.
3. Un error o resultado incierto no elimina el borrador ni reenvía. Solo una respuesta confirmada permite cerrar el formulario; efectos tardíos no cierran otro panel ni seleccionan otro run.
4. El resultado queda consultable fuera del panel, distinguiendo Health creado de solicitud admitida y de resultado operativo.
5. No se añade una confirmación nueva al flujo de creación ni se elimina la existente del automático; tema y foco siguen el contrato general.

## Archivos y comprobación

Ámbito: `tabs/backup-health/`, `services/health-state.ts`, fachada para modo/cierre, SCSS local y `tests/health.spec.ts`. No crear otro estado/formulario de dominio ni tocar transporte.

Desde `kida-console/frontend`:

```sh
pnpm exec ng test --watch=false --include='src/app/pages/backups/tests/*.spec.ts'
pnpm exec ng build --configuration development
```

Cubrir borradores independientes, crear sin ejecutar, admisión automática, cancelación, fallo/resultado incierto y respuesta tardía con otro panel activo.

## Entrega de sesión

Pendiente: registrar cambios, verificaciones y revisión independiente. Health debe quedar completo; Informes conserva su interfaz operativa hasta HU-06.
