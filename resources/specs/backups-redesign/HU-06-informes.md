# HU-06 · Consultar y eliminar informes

**Estado:** completada (2026-11-06). **Dependencia:** HU-05 aceptada e integrada.

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

Implementada y revisada de forma independiente sobre HU-05 integrada en `5355341`. Criterios funcionales cubiertos por pruebas automatizadas y revisión estática de estilos/tokens. Presentación, adaptación y foco del overlay Ionic real pendientes de inspección en navegador.

Cambios realizados:

- `tabs/backup-reports/reports.{ts,html,scss}`: lista compacta y adaptable por run_id exacto, sin derivar nombres, estados o fechas. Se conservan Actualizar, Ver informe, Eliminar informe, fecha de lectura y estados previos de carga/vacío/error/datos desactualizados. Iconos y botones usan el sistema existente; estilos nuevos solo locales.
- El lector anterior pasa al único `SidePanel`, conservando Markdown mediante interpolación literal en `pre`, espacios/saltos, JSON completo y avisos de precisión. El Markdown ocupa el flujo del lector sin el límite de altura del bloque JSON compartido. Cerrar y eliminar se proyectan en `[panel-actions]`; no se crea otro componente ni se interpreta HTML remoto.
- Confirmación ARCA, snapshot congelado y bloqueos existentes; focus trap suspendido mientras hay confirmación y retorno al disparador del panel o encabezado al cancelarla. Se aclara que borrar el informe es distinto de eliminar la ejecución de Health. Resultados completos, errores e incertidumbres permanecen fuera del panel; el lector también muestra errores/incertidumbres y un resumen del resultado asociado a su ID para mantener feedback accesible mientras está abierto.
- `services/backups.facade.ts`: apertura/cierre del modo `report-detail` ya declarado y cierre al desaparecer la selección tras una lectura confirmada de la lista. Se reutilizan `BackupReportsState.leaveTab()` y `uiClosed` para invalidar detalle/confirmación/foco pendientes, sin cancelar escrituras ni borrar resultados, listas o incertidumbres.
- La lista usa `track id` para mantener identidad real de las filas. Una prueba detectó que seguirlas por posición reutilizaba el botón del informe eliminado para otro ID, devolviendo el foco a la fila equivocada. CORE lista registros por sus IDs de fichero y valida su identidad; no se deduplican ni modifican las entradas recibidas.
- `tests/reports.spec.ts`: diez casos adicionales y adaptación del montaje/selectores al panel, conservando comprobaciones existentes. Se cubren ID exacto/Unicode/vacío, texto seguro con whitespace, JSON/precisión, apertura en carga, trap/cancelación, deleted true/false, foco al desaparecer el disparador, lecturas antiguas con la misma/otra selección, cierre con confirmación correlacionada, escritura tardía con otro panel, incertidumbres tras pestaña/refresco y detalle previo desactualizado.
- `tests/health.spec.ts`: adaptación mínima de dos montajes que simulaban `report-detail` sin seleccionar informe. Ahora establecen una selección válida y verifican adicionalmente que la respuesta tardía de Health no la cambia. Se conservan todas las comprobaciones anteriores.
- Sin cambios en `BackupReportsState`, `BackupHealthState`, payloads, modelos, validadores, canales/transporte, dependencias, providers, CORE, backend ni estilos compartidos. Se mantienen `deleted: false`, resultados separados de errores de refresco y actualización cruzada del historial/detalle de Health tras borrar.

Contrato público y continuidad:

- `BackupsFacade.openReportDetail(id)` abre solo IDs presentes en la lista, con sesión activa y sin bloqueos. Conserva el ID recibido sin recortar o normalizar; admite cualquier string que ya admita el contrato de lectura. Selección, detalle y operaciones siguen siendo propiedad de `BackupReportsState`.
- `BackupsFacade.closeReportDetail()` cierra únicamente ese modo, usa la limpieza local de Informes y notifica `uiClosed`. Cerrar/cambiar pestaña invalida respuestas de detalle y confirmaciones no enviadas, libera loading y descarta restauraciones de foco antiguas. Una eliminación enviada sigue registrando su resultado y refrescando Health/Informes sin reabrir el lector ni cambiar otro panel.
- `BackupReports.panelHeading` sirve de fallback de foco dentro del lector; `listHeading` es el destino al cerrar si desaparece el disparador. Una respuesta `deleted: false` mantiene el mensaje real y el lector mientras el ID siga disponible; no se cierra por éxito HTTP ni se retira la fila optimistamente.
- Las tres pestañas quedan funcionalmente completas para HU-07. HU-07 debe revisar integración, navegación/documentación, producción y las comprobaciones visuales pendientes; esta sesión no la adelanta.

Verificación (Node 24.15.0):

- Backups y rutas sobre el código final: **243/243**. Suite frontend completa: **680/680**, 29 archivos, incluidas **43** pruebas de Informes. Ejecutadas mediante el CLI Angular local con Node.
- Build de desarrollo: correcto. Whitespace revisado en diff y SCSS nuevo. No se han alterado budgets ni comprobaciones.
- Revisión independiente: corregida la identidad/foco de filas eliminadas; revisión final sin hallazgos pendientes.

Límites: sin Playwright, inspección visual manual, build de producción ni operaciones contra CORE real. Los tests sustituyen el template modal de `SidePanel`; no certifican presentación, adaptación a 360 px/siete temas, transiciones ni foco del overlay Ionic real. Sin commit, push ni deploy.
