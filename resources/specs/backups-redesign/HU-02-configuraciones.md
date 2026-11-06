# HU-02 · Consultar configuraciones y solicitar backups

**Estado:** completada (2026-11-06). **Dependencia:** HU-01 aceptada e integrada.

Como administrador, quiero identificar qué se copia y a dónde, consultar la configuración completa y solicitar una copia o eliminar su configuración con seguridad.

## Contexto para el agente

Leer [spec general](../backups-redesign.md) y entrega de [HU-01](HU-01-navegacion.md). Examinar `tabs/backup-configurations/`, `BackupConfigurationsState`, `SidePanel` y el inspector Docker como patrón de foco/confirmación. No repetir la migración de rutas.

## Alcance

- Cabecera con Nueva configuración (mantener su formulario actual accesible hasta HU-03), Actualizar, fecha de lectura y búsqueda local por nombre/rutas.
- Tarjetas CSS Grid 1/2/3 columnas: nombre, primer origen y contador adicional, hasta dos destinos con obligatoriedad y contador adicional. No alterar datos ni orden del servidor.
- Acciones Ver detalles, Solicitar backup y Eliminar configuración mediante los métodos actuales. Abrir detalle en `SidePanel` y conservar confirmaciones ARCA.
- Inspector con ID, todas las rutas, obligatoriedad/UUID, compresión, lifecycle, schedule, retention, precisión limitada y JSON. Reutilizar el detalle existente; mantener omitido/null/valor.
- Resultado de escritura e incertidumbres fuera del panel; cierres y foco conforme a la spec general. El formulario de creación conserva su ubicación/función anterior hasta HU-03.

## Criterios de aceptación

1. Una configuración con múltiples orígenes/destinos se resume sin perder acceso a ninguna ruta. Distinguir lista vacía, filtro sin resultados, carga y error con datos anteriores.
2. Buscar no envía peticiones ni modifica entradas; limpiar el filtro restaura el orden original.
3. Solicitar/eliminar conserva ID y nombre congelados, bloqueos cruzados y protección de doble envío tanto desde tarjeta como desde panel. Cancelar no envía.
4. La UI aclara que admisión no es finalización y que eliminar configuración conserva los archivos. Los avisos de incertidumbre persisten sin reenvío automático ni bloqueo permanente añadido.
5. Cerrar/abrir otro detalle no muestra datos ajenos; la desaparición del elemento seleccionado cierra el detalle y devuelve foco a un destino válido.
6. Tarjetas y panel consumen tokens e iconos existentes; no copiar la paleta ni estilos de botones del mockup.

## Archivos y comprobación

Ámbito: `tabs/backup-configurations/`, fachada/estado de configuraciones solo para presentación y cierre, SCSS local y `tests/backups.spec.ts`. Conservar transporte, modelos y validadores.

Desde `kida-console/frontend`:

```sh
pnpm exec ng test --watch=false --include='src/app/pages/backups/tests/*.spec.ts'
pnpm exec ng build --configuration development
```

Comprobar filtros, múltiples rutas, detalle íntegro, confirmación/cancelación, doble envío, incertidumbre y selección desaparecida. Revisar tokens y adaptación sin ampliar a otros módulos.

## Entrega de sesión

Implementada y revisada de forma independiente. Criterios funcionales cubiertos por pruebas automatizadas y revisión estática de estilos/tokens; apariencia, adaptación y foco real de Ionic pendientes de inspección en navegador.

Cambios realizados:

- `tabs/backup-configurations/backup-configurations.{ts,html,scss}`: búsqueda local por nombre y todas las rutas, sin peticiones ni cambios de orden/datos; tarjetas CSS Grid de una/dos/tres columnas según el ancho útil. Resumen de primer origen y hasta dos destinos, obligatoriedad y contadores adicionales; estados de inventario vacío y búsqueda sin coincidencias separados.
- Inspector con `SidePanel`: conserva ID, todas las rutas, UUID omitido/null/valor, compresión, lifecycle, schedule, retention, campos futuros, JSON y avisos de precisión. Acciones solicitar/eliminar tanto en tarjetas como en `[panel-actions]`, con las confirmaciones y bloqueos existentes. El focus trap se suspende durante la confirmación y se reactiva al cancelarla.
- `BackupsFacade`: apertura/cierre del inspector y cierre al desaparecer la selección. Se reutiliza `BackupConfigurationsState.leaveTab()` para invalidar confirmaciones y continuaciones de vista; no se cancela una escritura enviada ni se borran borradores, búsqueda, resultados o incertidumbres. El panel no se reabre al terminar la escritura.
- “Nueva configuración” desplaza y enfoca el nombre del formulario existente sin alterar su borrador; resultados y avisos permanecen fuera del inspector. Health e Informes conservan sus interfaces. Sin cambios en modelos, validadores, transporte, dependencias, backend o CORE.
- `tests/backups.spec.ts`: ocho casos nuevos y adaptación del montaje de `SidePanel`, sin eliminar ni debilitar comprobaciones anteriores. Se prueban filtro/orden, múltiples rutas y detalle íntegro, confirmación/cancelación desde panel, doble envío, foco, cierre con confirmación/escritura, selección desaparecida, cambio de detalle y acceso al borrador existente.

Contrato público y continuidad para HU-03:

- `BackupsFacade.openConfigurationDetail(id)` abre únicamente una configuración existente en una sesión activa y sin bloqueos; `closeConfigurationDetail()` limpia su UI transitoria y conserva el trabajo del módulo. El modo sigue siendo `configuration-detail`; selección y operaciones permanecen en `BackupConfigurationsState`.
- `BackupConfigurations.filteredEntries` deriva el listado de `entries` y `BackupsFacade.search`, con coincidencia parcial sin distinguir mayúsculas y sin normalizar los datos originales. La búsqueda mantiene el ciclo de sesión definido en HU-01.
- HU-03 reutilizará el modo `configuration-create` ya declarado en `BackupsFacade.panel`, sustituyendo la acción actual `focusCreateForm()` y trasladando el mismo `BackupCreateForm` al panel. No se añade todavía una segunda vía de creación ni se modifica su contrato.

Verificación (Node 24.15.0):

- Pruebas nuevas escritas y ejecutadas antes de la implementación: **7 fallos esperados y 52 pruebas anteriores correctas**. Tras implementar: **196/196** pruebas de Backups y rutas. Añadida después la regresión de retorno de foco, ajustando su montaje al patrón existente de vista estabilizada.
- Suite frontend completa sobre el código final: **633/633**, 29 archivos. Ejecutada mediante el CLI Angular local con Node, sin usar el almacén pnpm.
- Build de desarrollo: correcto. Whitespace revisado en cambios y SCSS nuevo; estilos locales usan tokens e iconos existentes.
- Revisión independiente: sin hallazgos que requieran cambios; revisados los contratos conectados de cierre, confirmación, foco y escrituras en vuelo.

Límites: sin Playwright, inspección visual manual, build de producción ni operaciones contra CORE real. Las pruebas sustituyen el template modal de `SidePanel` y simulan su cierre: no certifican transiciones ni foco del overlay Ionic real, ni adaptación a 360 px y siete temas. No se han adelantado HU-03–HU-07. Sin commit, push ni deploy.
