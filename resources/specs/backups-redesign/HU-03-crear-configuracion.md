# HU-03 · Crear una configuración sin abandonar el inventario

**Estado:** completada (2026-11-06). **Dependencia:** HU-02 aceptada e integrada.

Como administrador, quiero crear una configuración desde un panel, con sus opciones avanzadas disponibles y sin perder el borrador al cerrar o cambiar de pestaña.

## Contexto para el agente

Leer [spec general](../backups-redesign.md) y entrega de [HU-02](HU-02-configuraciones.md). Examinar `BackupCreateForm`, `BackupOptionalField`, `backups-form.ts` y la operación `create()` de configuraciones. Reutilizar el panel y modo definidos anteriormente.

## Alcance

- Nueva configuración abre `SidePanel` con `BackupCreateForm`; retirar su presentación permanente anterior.
- Nombre, orígenes y destinos repetibles; obligatoriedad y UUID por destino; compresión fija `tar_zstd`. Opciones avanzadas plegadas: lifecycle, schedule y retention con sus controles actuales, no el JSON simplificado del mockup.
- Conservar exactamente serialización y validación actuales: omisión/valor/null, strings sin normalizar, Unicode, JSON seguro, `false`, cero, límites de `keep_last` y puntos protegidos.
- Acciones de formulario integradas con `[panel-actions]` sin duplicar submit. Borrador propiedad de `BackupConfigurationsState`, no del DOM del modal.
- Cierre/restablecimiento solo ante respuesta confirmada de creación; errores de validación, rechazo e incertidumbre dejan datos y mensaje. Mantener visibles éxito y fallo independiente del refresco posterior.

## Criterios de aceptación

1. Cerrar y reabrir o cambiar de pestaña conserva todos los campos, incluidos los avanzados; salir de Backups/cambiar identidad los borra.
2. Una creación confirmada usa el resultado actual, restablece el formulario y permite cerrar el panel sin afectar otra selección/pestaña si la respuesta llega tarde.
3. Finalizar el observable, fallar la escritura o fallar su refresco no se confunden con éxito ni ocasionan pérdida del borrador. No hay doble envío.
4. Payloads y validaciones siguen siendo equivalentes a los del formulario anterior. Schedule/retention se explican como metadatos, sin programación o limpieza implícita.
5. Inputs, selects, textareas y checkbox respetan el tema; labels, foco y botones siguen las convenciones compartidas.

## Archivos y comprobación

Ámbito: `tabs/backup-configurations/`, `components/backup-create-form/`, `components/backup-optional-field/` si requiere presentación, estado/fachada y pruebas afectadas. No reescribir validadores ni añadir un formulario alternativo.

Desde `kida-console/frontend`:

```sh
pnpm exec ng test --watch=false --include='src/app/pages/backups/tests/*.spec.ts'
pnpm exec ng build --configuration development
```

Mantener cobertura de payload completo y añadir ciclo de borrador, cierre confirmado, respuesta tardía y error de refresco separado. Revisión estática del formulario dentro de `SidePanel`; navegador solo ante una duda real.

## Entrega de sesión

Implementada y revisada de forma independiente sobre HU-02 integrada en el commit `0c7d5d9`. Criterios funcionales cubiertos por pruebas automatizadas; tema y controles revisados estáticamente. Sin comprobación visual ni del overlay Ionic real.

Decisión confirmada: cerrar automáticamente el panel al recibir una respuesta confirmada de creación; el resultado permanece en la pestaña. No esperar al refresco ni interpretar la finalización del observable como confirmación.

Cambios realizados:

- `tabs/backup-configurations/`: Nueva configuración abre el modo `configuration-create` del mismo `SidePanel`. Se retira el formulario permanente; Cancelar y el único submit se proyectan en `[panel-actions]`. El submit se asocia al formulario mediante `form="backup-configuration-form"`, sin duplicar el envío.
- `components/backup-create-form/`: se reutilizan todos los campos y controles existentes, con avanzados inicialmente plegados, compresión `tar_zstd` y borrador en `BackupConfigurationsState`. Estilos locales tematizan fieldsets y checkbox con dimensiones explícitas. Validación, rechazo e incertidumbre tienen feedback accesible dentro del panel y se conservan también en la pestaña al cerrarlo.
- `services/configurations-state.ts` y `backups.facade.ts`: notificación de creación confirmada ligada a la revisión de vista vigente; cierre invalida selección y continuaciones sin cancelar escrituras enviadas. Una respuesta tardía conserva resultado y restablecimiento actuales, pero no cierra otro panel, selecciona otra configuración ni restaura foco a la pestaña abandonada.
- `components/side-panel/side-panel.ts`: ajuste mínimo del retorno de foco para descartar un disparador deshabilitado y usar el fallback existente. Necesario cuando la creación ya está confirmada y cierra el panel, pero el refresco mantiene bloqueada la cabecera; regresión específica en `side-panel.spec.ts`.
- `tests/backups.spec.ts`: siete casos nuevos y adaptación de los montajes al formulario en panel, conservando las comprobaciones anteriores. Se cubren borrador completo y payload, cierre/reapertura/pestañas, submit único, cierre confirmado, refresco fallido, errores HTTP/red, validación local, observable sin resultado y respuesta tardía con otro panel activo. La prueba de sesión cacheada sigue verificando limpieza del DOM y reentrada con borrador vacío.

Contrato público para las siguientes historias:

- `BackupsFacade.openConfigurationCreate()` abre el formulario en sesión activa y sin bloqueos; limpia la selección transitoria sin modificar el borrador. `closeConfigurationPanel()` cierra creación o detalle mediante la limpieza local de configuraciones. Se conserva `closeConfigurationDetail()` y el resto de contratos de HU-01/HU-02.
- `BackupConfigurationsState.create(onCreated?)` conserva compatibilidad con las llamadas sin argumentos. El callback opcional solo se invoca tras respuesta confirmada y en la misma revisión de vista; no ante error, finalización sin resultado, cambio de pestaña, cierre o reset de sesión.
- `BackupCreateForm.created` emite esa confirmación vigente para que la pestaña cierre el panel. Formulario, validadores, modelos, payloads y transporte siguen siendo los mismos; el borrador permanece propiedad del estado.

Verificación (Node 24.15.0):

- Pruebas nuevas y adaptaciones ejecutadas antes de cambiar producción: **9 fallos esperados y 63 pruebas correctas**. Tras implementar: **209/209** pruebas de Backups, rutas y SidePanel.
- Suite frontend completa: **641/641**, 29 archivos; build de desarrollo correcto. Ejecutados mediante el CLI Angular local con Node.
- Whitespace revisado en cambios y SCSS nuevo; sin modificaciones de validadores, modelos, transporte, dependencias, CORE, backend ni temas compartidos.
- Revisión independiente: sin hallazgos que requieran cambios; comprobados callback/output, submit externo, cierre/invalidación, borradores y retorno de foco.

Límites: sin Playwright, inspección visual manual, build de producción ni operaciones contra CORE real. Las pruebas simulan el overlay de `SidePanel`: no certifican su presentación, transiciones, foco real ni adaptación visual. Configuraciones queda funcionalmente completa; Health e Informes conservan sus interfaces operativas para HU-04 y siguientes. Esta entrega HU-03 queda sin commit, push ni deploy.
