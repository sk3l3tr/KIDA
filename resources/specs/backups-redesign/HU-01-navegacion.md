# HU-01 · Navegar por Backups sin perder la sesión de trabajo

**Estado:** completada (2026-11-06). **Dependencia:** ninguna.

Como administrador, quiero acceder a Configuraciones, Backup Health e Informes mediante pestañas y enlaces directos, conservando mi trabajo mientras permanezco en Backups.

## Contexto para el agente

Leer [spec general](../backups-redesign.md), `app.routes.ts`, Backups y sus cuatro servicios; comparar rutas/contenedores e hijas de Docker/System. Aplicar el contrato de sesiones de la spec. Esta historia establece la base para todas las siguientes.

## Alcance

- Añadir `backups.routes.ts`, redirect a `configurations` e hijas lazy `configurations`, `health`, `reports`; mantener guard y enlace del menú.
- Reutilizar las tres secciones como páginas movidas a `tabs/backup-configurations/`, `tabs/backup-health/`, `tabs/backup-reports/`. Conservar clases y funcionalidad, adaptar imports e inyección y añadir `ion-content`; no crear wrappers vacíos.
- Mantener los cuatro providers en `Backups`; tab bar superior y mixin compartido de tres pestañas.
- Entrada idempotente y reset global solo al salir del módulo/cambiar identidad/destruir. Conservar carga inicial de las tres listas. Cada hija reactiva una sesión cacheada al entrar, sin resetear una activa.
- Establecer búsqueda y modo de panel tipado en la fachada, con las seis variantes de la spec. Todavía no añadir paneles o botones nuevos para variantes sin implementar.
- Preparar el cierre de UI de pestaña: cancelar confirmaciones no enviadas y limpiar selección/detalle sin borrar borradores, listas, resultados o incertidumbres, ni cancelar escrituras ya enviadas. Invalidar continuaciones de detalle sin dejar loading bloqueado. Mantener limpieza del DOM cacheado ante cambio de sesión.

## Criterios de aceptación

1. `/backups` abre Configuraciones; las tres URLs hijas funcionan directamente y están protegidas; atrás/adelante conserva la pestaña correcta.
2. Cambiar de pestaña no duplica cargas iniciales ni instancias de servicios; conserva los formularios y mensajes existentes. Sus funciones actuales siguen accesibles.
3. Una confirmación de la pestaña anterior no puede enviar una operación después del cambio. Una escritura enviada termina sin reabrir UI ni aplicar selección a otra pestaña.
4. Salir/cambiar sesión limpia datos, formularios y DOM oculto; reentrar reactiva la fachada. Respuestas tardías no contaminan la sesión nueva.

## Archivos y comprobación

Ámbito: `app.routes.ts`, `pages/backups/{backups.*,backups.routes.ts,backups-tabs.scss,tabs/,services/}` y sus importadores/pruebas afectadas. Trasladar los componentes existentes sin duplicarlos. Preservar el contenido todavía sin rediseñar.

Desde `kida-console/frontend`:

```sh
pnpm exec ng test --watch=false --include='src/app/pages/backups/tests/*.spec.ts' --include='src/app/app.routes.spec.ts'
pnpm exec ng build --configuration development
```

Cubrir redirect/acceso protegido, identidad compartida de providers, borradores entre pestañas, cancelación de confirmación, escrituras en vuelo y reentrada/DOM cacheados. No hace falta Playwright por defecto.

## Entrega de sesión

Implementada y revisada de forma independiente. Criterios 1–4 cubiertos por pruebas automatizadas; queda sin comprobar el comportamiento visual y de transiciones en un navegador real.

Cambios realizados:

- `app.routes.ts`, `backups.routes.ts`, `backups.ts`, `backups.html` y `backups-tabs.scss`: entrada protegida, redirección a Configuraciones y tres hijas lazy; mismo `ion-tabs`/tab bar superior y mixin de Docker. Contadores reales; listas desconocidas se presentan como `—`.
- Trasladadas las tres vistas existentes de `components/` a `tabs/backup-configurations/`, `tabs/backup-health/` y `tabs/backup-reports/`, conservando clases, formularios, operaciones y contenido. Cada hija compone su `ion-content`, inyecta los providers del padre y reactiva una sesión cacheada al entrar. `backups.scss` mantiene una columna de ancho completo.
- Fachada y estados: entrada idempotente, limpieza de selección/detalle/confirmaciones al cambiar de tab y reset completo al salir o cambiar identidad. Se mantienen borradores, listas, resultados, incertidumbres y escrituras enviadas dentro del módulo. Revisiones locales invalidan respuestas de detalle y restauraciones de foco antiguas; el reset notifica a las páginas para limpiar incluso su DOM desacoplado.
- Ajuste necesario en `BackupsService`: serialización por cada canal ARCA existente. La prueba de cerrar/reabrir el mismo detalle antes de recibir su respuesta detectó que el transporte compartido entregaba la respuesta antigua al lector nuevo. La solución deja terminar peticiones enviadas, descarta trabajo en espera si su consumidor se invalida y mantiene canales distintos independientes. Conserva los catorce métodos, acciones, cuerpos y transporte; no reintenta escrituras. Una nueva petición del mismo canal espera la respuesta o error de la anterior.
- Adaptadas las pruebas existentes de Backups y `app.routes.spec.ts`; añadidas regresiones y `tests/navigation.spec.ts` para rutas, historial, providers, borradores, aislamiento entre sesiones y reentrada cacheada. No se han eliminado ni debilitado comprobaciones.

Contrato público para las siguientes historias:

- Se conservan `configurations`, `health`, `reports`, `active`, `operationsBlocked` y los hooks de `BackupsFacade`. Los cuatro providers siguen exclusivamente en `Backups`.
- `BackupsFacade.search`: signal de texto; se conserva entre pestañas y se vacía en el reset del módulo. La búsqueda visible corresponde a HU-02.
- `BackupsFacade.panel`: signal `BackupPanel | null`, con `configuration-create`, `configuration-detail`, `health-create`, `health-run`, `health-detail` y `report-detail`. No hay paneles nuevos en HU-01.
- `BackupsFacade.leaveTab()` limpia la UI transitoria de los tres estados y el modo de panel, sin reiniciar sesión ni cancelar escrituras. `uiClosed` es un observable de notificación tras esa limpieza o el reset global; las páginas cierran sus diálogos y actualizan explícitamente el DOM cacheado.
- Cada estado ofrece `leaveTab()` para invalidar selección/continuaciones y cancelar confirmaciones pendientes. Los hooks de salida de las hijas usan la limpieza de tab; el reset global sigue en el contenedor.
- Health e Informes reciben su estado por inyección, sin input `state`.

Verificación (Node 24.15.0):

- Pruebas enfocadas de Backups y rutas: **189/189**.
- Suite frontend completa sobre el código final: **625/625**, 29 archivos. La última ejecución invocó directamente el CLI Angular local con Node para evitar el bloqueo del almacén de pnpm del sandbox.
- `pnpm exec ng build --configuration development`: correcto.
- Whitespace revisado en cambios y archivos nuevos.
- Revisión independiente: corregidos el foco de Configuraciones durante el refresco posterior a escritura y los callbacks de foco ya programados de Health/Informes. Regresiones añadidas; revisión final sin hallazgos pendientes.

Límites: sin Playwright ni inspección visual manual, sin build de producción y sin operaciones contra CORE real. Las pruebas de navegación montan las hijas reales con el outlet Angular y llaman a los hooks Ionic explícitamente: JSDOM no reproduce las transiciones/cache del outlet Ionic. No se han adelantado HU-02–HU-07 ni modificado CORE/backend, dependencias o temas. Sin commit, push ni deploy.
