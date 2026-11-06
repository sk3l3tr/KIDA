# HU-04 · Consultar comprobaciones de recuperación

**Estado:** completada (2026-11-06). **Dependencia:** HU-03 aceptada e integrada.

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

Implementada y revisada de forma independiente. Criterios funcionales cubiertos por pruebas automatizadas y revisión estática de contenido, estilos y tokens; adaptación visual y foco del overlay Ionic real pendientes de inspección en navegador.

Cambios realizados:

- `tabs/backup-health/health.{ts,html,scss}`: historial en tabla con definición, referencia/versión del backup, run_id exacto, modo, estado, diagnóstico/completitud y creación en hora local del navegador. Región de scroll etiquetada y enfocable; tabla de ancho mínimo con rutas largas ajustables, sin sustituir estados futuros. Se mantienen carga, vacío, error, datos anteriores, fecha de lectura y resultados/incertidumbres fuera del inspector. Los formularios de crear y ejecutar automático siguen accesibles en su ubicación actual hasta HU-05.
- `components/backup-health-detail/backup-health-detail.{ts,html}`: mismo contenido dentro de `SidePanel`, con resumen de diagnóstico y limpieza antes de los bloques técnicos plegados. Se conservan identificación, fechas, definición/backup, servicios, anomalías, evidencias/logs, artefacto, restauración/Compose, recursos, procedencia, informe, JSON completos y avisos de precisión. Iniciar/detener/eliminar se proyectan una sola vez en `[panel-actions]`; se retira el output de acciones del detalle, cuyo único consumidor era esta página.
- `services/backups.facade.ts`: apertura/cierre del modo `health-detail`, cierre si desaparece la selección y reutilización de `BackupHealthState.leaveTab()` para invalidar detalle/confirmación sin borrar borradores, resultados o escrituras enviadas. El cierre notifica `uiClosed`, invalidando también restauraciones de foco programadas y cancelando el diálogo correlacionado.
- `services/health-state.ts`: callback opcional de creación confirmada, limitado a la revisión vigente de la vista. Conserva el acceso al detalle recién creado aunque falle el refresco del historial, como antes del rediseño; no abre el inspector tras cambiar de pestaña o cerrar. Sin cambios en payloads, validación, bloqueos o transporte.
- `utils/backups-presentation.ts`: `healthDate()` formatea fechas remotas válidas en hora local con el patrón de plataforma existente; conserva null como texto literal y fechas desconocidas sin lanzar errores. Ajuste necesario porque el contrato admite strings sin exigir que sean fechas interpretables. Los valores originales permanecen en los JSON completos.
- `tests/health.spec.ts`: doce pruebas adicionales y adaptación de los montajes/selectores al panel y sus acciones, conservando las comprobaciones existentes. Cubren tabla/fechas, valores futuros, trap y retorno de foco tras cancelar, cierre con confirmación correlacionada, lectura tardía con otra selección, selección desaparecida, las cuatro escrituras después del cierre, fechas no interpretables, creación con refresco fallido y creación tardía tras cambio de pestaña. Se mantiene la cobertura previa de contenido íntegro, bloqueos cruzados, limpieza, precisión, doble envío, incertidumbre y sesión cacheada.

Contrato público y continuidad para HU-05:

- `BackupsFacade.openHealthDetail(id)` abre una entrada existente durante una sesión activa sin bloqueos; el estado sigue siendo propietario de selección/detalle y operaciones. `closeHealthDetail()` cierra solo ese modo, invalida selección/lecturas y confirmaciones, conserva trabajo del módulo y notifica la limpieza de UI.
- `BackupHealthState.create(onCreated?)` mantiene compatibilidad con llamadas sin argumentos. El callback solo se invoca tras confirmación y en la misma revisión de vista, después de seleccionar su detalle; no ante rechazo, incertidumbre, finalización vacía, cierre o cambio de pestaña. La página lo usa para abrir el inspector confirmado, descartando el disparador del formulario del fondo para restaurar foco dentro del panel.
- Las confirmaciones siguen en `BackupHealth.prepare()`, con contexto ARCA y snapshot congelado. `[focusTrap]="state.pending() === null"` suspende el trap del inspector mientras se confirma; cancelar restaura el disparador dentro del panel o su encabezado. Cerrar usa `uiClosed` para cancelar el contexto pendiente y descartar callbacks de foco antiguos. Una escritura ya enviada conserva su resultado fuera del panel, sin reabrirlo ni seleccionar otra ejecución.
- HU-05 debe reutilizar estas confirmaciones, estados y modos `health-create`/`health-run`; todavía no se han trasladado sus formularios ni alterado su comportamiento.

Verificación (Node 24.15.0):

- Suite frontend completa sobre el código final: **653/653**, 29 archivos, incluidas **87** pruebas de Health. Ejecutada con el CLI Angular local mediante Node.
- Build de desarrollo: correcto. Whitespace revisado en diff y SCSS nuevo. Sin dependencias, providers, modelos, transporte, CORE, backend ni estilos compartidos nuevos o modificados.
- Revisión independiente: corregidas las fechas remotas no interpretables, el acceso al detalle creado si falla el refresco y el foco hacia el formulario del fondo. Revisión final sin hallazgos pendientes.

Límites: sin Playwright, inspección visual manual, build de producción ni operaciones contra CORE real. Las pruebas sustituyen el template modal de `SidePanel`; no certifican adaptación a 360 px/siete temas, transiciones ni foco del overlay Ionic real. No se han adelantado HU-05–HU-07. Sin commit, push ni deploy.
