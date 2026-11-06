# HU-05 · Crear y ejecutar comprobaciones de Backup Health

**Estado:** completada (2026-11-06). **Dependencia:** HU-04 aceptada e integrada.

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

Implementada y revisada de forma independiente sobre HU-04 integrada en `3ea2cfb`. Criterios funcionales cubiertos por pruebas automatizadas; estilos y tokens revisados estáticamente. Sin comprobación visual ni del overlay Ionic real.

Decisión confirmada: cerrar el formulario al recibir la respuesta confirmada de creación o admisión automática. El resultado permanece en la pestaña, sin esperar al refresco del historial. Se sustituye la apertura automática del inspector tras crear que existía provisionalmente en HU-04. Un error, incertidumbre o finalización sin resultado no cierra el formulario.

Cambios realizados:

- `tabs/backup-health/health.{ts,html,scss}`: acciones superiores separadas para Crear Health y Ejecutar Health automático, con los mismos controles trasladados al único `SidePanel` existente. Se retiran los formularios permanentes. Cancelar y un solo submit externo por formulario se proyectan mediante `[panel-actions]`, conservando el envío con Enter y sin duplicar operaciones.
- Los borradores siguen en `definitionPath`, `mode` y `automaticPath` de `BackupHealthState`; crear no ejecuta ni siquiera en AUTOMATIC, automático conserva su confirmación y payload exacto. Se explican definición existente en CORE, ausencia de subida/edición y diferencia entre run_id, execution_id y admisión. Errores e incertidumbres son accesibles dentro del formulario y siguen visibles fuera al cerrarlo; los resultados permanecen en la pestaña.
- `services/backups.facade.ts`: apertura de los dos modos ya declarados y cierre común de los tres paneles de Health. Se reutiliza `leaveTab()` del estado y `uiClosed` para limpiar selección/continuaciones y confirmación/foco pendientes, conservando borradores, resultados y escrituras enviadas.
- `services/health-state.ts`: callback opcional de confirmación, limitado a respuesta confirmada en la misma revisión de vista. La página lo usa exclusivamente para cerrar el formulario automático vigente; creación reutiliza su callback anterior. El cierre confirmado invalida la selección, evitando lecturas de detalle o reaperturas implícitas. Restablecimientos, validación, operaciones y bloqueos siguen en su propietario actual.
- `tests/health.spec.ts`: diecisiete casos adicionales, conservando la cobertura previa y adaptando montajes/selectores y expectativas de cierre a la decisión aprobada. Cubren borradores separados, cierre/cambio de pestaña/salida, MANUAL y AUTOMATIC sin ejecutar, submit único, cancelación/confirmación automática con ruta congelada, cierre confirmado antes del refresco, errores HTTP/red e incertidumbre sin reenvío, finalización vacía, respuestas tardías con otro panel y Unicode inválido. La creación con refresco fallido conserva resultado/JSON; tras refrescar se comprueba el acceso posterior a su inspector y operaciones.
- `tests/navigation.spec.ts`: montaje del panel con la misma sustitución de template usada en las pruebas de Health; apertura explícita del formulario antes de comprobar su DOM. Se conserva la prueba de limpieza con la hija desacoplada, cambio de identidad, reentrada y borrador vacío.

Contrato público y continuidad:

- `BackupsFacade.openHealthForm(mode: 'health-create' | 'health-run')` abre solo en sesión activa y sin bloqueos; limpia la selección transitoria y conserva ambos borradores. `closeHealthPanel()` cierra cualquiera de los tres modos de Health, invalida lecturas y confirmaciones y notifica `uiClosed`. Se conserva `closeHealthDetail()` para sus consumidores anteriores.
- `BackupHealthState.confirm(onConfirmed?)` conserva las llamadas sin argumentos. El callback se ejecuta después de registrar una respuesta confirmada y solo en la revisión de vista que envió la operación; nunca ante rechazo, incertidumbre, finalización vacía, cierre o cambio de pestaña. `create(onCreated?)` mantiene el mismo contrato de HU-04.
- `BackupHealth.panelTitle` deriva el título del modo actual; `panelHeading` es el fallback de foco del formulario o inspector. Cancelar ARCA conserva el panel y devuelve el foco al submit/acción original o al encabezado del panel. Cerrar invalida restauraciones anteriores; `SidePanel` conserva su retorno al disparador o encabezado del historial, incluso si el refresco mantiene los botones deshabilitados.
- Una respuesta tardía conserva resultado y restablecimientos del flujo correspondiente, pero no cierra otro panel, selecciona otro run ni reabre el anterior. Las incertidumbres permanecen accesibles y no introducen un bloqueo permanente ni reenvíos.
- Health queda funcionalmente completo. Informes conserva su interfaz operativa para HU-06; no se han adelantado HU-06/HU-07.

Verificación (Node 24.15.0):

- Suite frontend completa sobre el código final: **670/670**, 29 archivos, incluidas **104** pruebas de Health. Ejecutada mediante el CLI Angular local con Node.
- Build de desarrollo: correcto. `git diff --check`: correcto. Sin cambios en modelos, validadores, transporte, dependencias, providers, CORE, backend o estilos compartidos.
- Revisión independiente: sin hallazgos pendientes; revisados contratos conectados de cierre, callbacks, foco/confirmación, borradores, payloads y pruebas adaptadas.

Límites: sin Playwright, inspección visual manual, build de producción ni operaciones contra CORE real. Los montajes automatizados sustituyen el template modal de `SidePanel`; no certifican adaptación a 360 px/siete temas, transiciones ni foco del overlay Ionic real. Sin commit, push ni deploy.
