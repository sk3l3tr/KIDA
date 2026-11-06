# Backups: implementación del rediseño

Estado: HU-01 a HU-07 completadas. Validación integrada, revisión independiente y comprobación visual breve registradas en HU-07, con límites y fallo de presupuesto preexistente documentados.
Referencia visual: [`../mockups/backups-mockup.html`](../mockups/backups-mockup.html).
Decisiones confirmadas: tres rutas hijas, Configuraciones inicial y borradores conservados dentro del módulo.

## Objetivo y alcance

Trasladar la composición del mockup a KIDA Console, conservando todas las operaciones, validaciones y datos actuales. El tema activo determina la apariencia; el HTML del mockup no es código de producción.

Solo frontend. Sin cambios en CORE, backend, protocolo, dependencias, autenticación ni motor de temas. No incorporar datos ficticios, controles de escenarios, cabecera/footer propios del mockup, polling ni métricas no disponibles.

## Arquitectura y reutilización

Base de rutas, contenedor e Ionic: `pages/docker/` y `pages/system/`. Mantener sus convenciones sin importar componentes específicos de esos dominios.

| Elemento existente | Uso previsto |
| --- | --- |
| `BackupsFacade` | Coordinación del módulo, ciclo de vida, bloqueos y modo del panel abierto. |
| `BackupConfigurationsState`, `BackupHealthState`, `BackupReportsState` | Conservar lecturas, formularios, resultados y operaciones en sus propietarios actuales. |
| `BackupsService`, modelos y acciones | Conservar las 14 operaciones ARCA y sus contratos. |
| `BackupConfigurations`, `BackupHealth`, `BackupReports` | Reutilizarlos como páginas de pestaña, moviéndolos a `tabs/`; sin páginas envoltorio vacías ni copias de componentes. |
| `BackupCreateForm`, `BackupOptionalField`, `BackupHealthDetail` | Reutilizar y adaptar su presentación, sin sustituir sus formularios o datos por los ejemplos simplificados del mockup. |
| `SidePanel` | Formularios, inspectores y lector de informes; acciones mediante `[panel-actions]`. |
| `AppDialog` y utilidades de foco | Mantener las confirmaciones ARCA existentes, sus canales y contextos correlacionados. |
| `theme/_tabs.scss`, `_buttons.scss`, `.console-control`, `.panel`, iconos `i-*` | Pestañas, botones, controles y superficies existentes. |

`Backups` conserva los cuatro providers en el contenedor padre. Las páginas hijas inyectan esas mismas instancias; Health e Informes dejan de depender de un input para recibir su estado. Cada página compone su `ion-content` y sus paneles. No crear otra fachada, servicio de transporte, sistema de diálogos ni componente genérico de estados.

Añadir únicamente estado de presentación: búsqueda de configuraciones y un modo de panel nullable y tipado en la fachada, con seis variantes: creación/detalle de configuración, creación/ejecución automática/detalle de Health y detalle de informe. Las selecciones siguen en los estados actuales. Usar signals/computed y templates declarativos según las convenciones existentes.

## Navegación y ciclo de vida

- Crear `backups.routes.ts`: `/backups` redirige a `/backups/configurations`; hijas lazy `configurations`, `health` y `reports`. Conservar `authGuard` en la entrada y el enlace del menú a `/backups`.
- Contenedor con `ion-tabs` y `ion-tab-bar` superior, igual que Docker/System. Aplicar `@include shared.tabs(3)` desde un SCSS local. Etiquetas: Configuraciones, Backup Health e Informes.
- Hacer idempotente la entrada de `BackupsFacade`: contenedor e hijas llaman a `ionViewWillEnter()` sin reiniciar una sesión activa. Conservar la carga inicial actual de las tres listas; cambiar de pestaña no vuelve a cargarlas. Los contadores usan las listas reales; `null` se presenta como desconocido, nunca como cero.
- Cambio de pestaña: cerrar paneles, cancelar confirmaciones no enviadas y limpiar selecciones/detalles. Conservar listas, búsqueda, borradores, resultados, incertidumbres y operaciones ya enviadas. El hook de salida de una hija no ejecuta el reset global.
- Cerrar un panel tiene el mismo alcance sobre su selección y confirmación; no borra el borrador ni cancela una escritura. Cerrar/cambiar selección invalida sus continuaciones de detalle; no puede dejar `detailLoading` atascado, reabrir un panel ni mostrar el detalle anterior al abrir otro.
- Salir del módulo, cambiar de identidad o destruir el contenedor: reset completo de estados, borradores, búsqueda, paneles y confirmaciones; invalidar suscripciones y respuestas tardías. Conservar la limpieza explícita del DOM cacheado/desacoplado mediante `detectChanges()`, adaptada a las nuevas páginas.
- Una respuesta de una escritura enviada puede actualizar su estado aunque se haya cerrado el panel; no reabre UI ni aplica efectos a otra selección. Al volver al módulo desde una página cacheada, la hija reactiva la fachada y obtiene una sesión limpia.

## Presentación e interacciones

### Configuraciones

Cabecera con Nueva configuración, Actualizar, búsqueda local por nombre/rutas y fecha de lectura. Búsqueda derivada de `entries`, sin modificar el array ni el orden del servidor. Diferenciar lista vacía y búsqueda sin coincidencias.

Tarjetas compactas en CSS Grid de 1/2/3 columnas según el ancho útil, manteniendo orden de lectura y acciones alineadas. No se necesita la medición de Masonry para estas tarjetas. Cada tarjeta muestra nombre, primer origen y contador adicional, hasta dos destinos con obligatoriedad y contador adicional cuando corresponda. Acciones: Ver detalles, Solicitar backup y Eliminar configuración; iconos con etiqueta accesible.

- Detalle en panel: ID completo, todos los orígenes y destinos, obligatoriedad/UUID, compresión, lifecycle, schedule, retention y JSON completo. Los avisos de precisión limitada permanecen disponibles.
- Nueva configuración en panel: reutilizar `BackupCreateForm`; nombre, orígenes/destinos y UUID por destino; compresión fija `tar_zstd`. Avanzados plegados con los controles actuales de lifecycle, schedule y retention, incluidos `max_age`, `keep_last` y puntos protegidos. Mantener omitido/valor/null, Unicode, precisión JSON, valores `false`/`0`, límites y cadenas exactas; no añadir recortes o normalizaciones del mockup.
- Crear utiliza la operación actual; una respuesta confirmada permite cerrar el formulario, restablece el borrador según el comportamiento existente y muestra el resultado en la pestaña. Validación, rechazo o incertidumbre conservan el borrador y su mensaje; nunca cerrar por una simple finalización del observable. Un error de refresco posterior no oculta el éxito de creación.
- Solicitar y eliminar conservan su confirmación. Eliminar configuración conserva los archivos. Admitir una solicitud no confirma su inicio ni finalización.

### Backup Health

Historial tabular: definición/referencia de backup, modo, estado, diagnóstico/completitud, fecha de creación y acceso al detalle. Tabla desplazable dentro de su contenedor en móvil, sin desbordar la página. Fechas en la zona local del navegador, identificada en la vista.

Acciones superiores separadas: Crear Health y Ejecutar Health automático. Abrir sus formularios actuales en panel, conservando rutas y modo en `BackupHealthState`. La definición existe en CORE; Console no la sube ni la edita. Crear no inicia la ejecución, ni siquiera en AUTOMATIC; ejecutar automático conserva su confirmación y semántica de admisión.

Reutilizar `BackupHealthDetail` dentro del inspector: identificación, fechas, definición/backup, diagnóstico, servicios, anomalías, evidencias/logs, artefacto, restauración/Compose, recursos, limpieza, procedencia del historial, informe y JSON completos. Resumir primero y plegar datos técnicos extensos; no eliminar información para imitar el ejemplo reducido. Mantener iniciar/detener/eliminar y sus confirmaciones; CORE decide su validez y limpieza.

Mostrar estado y diagnóstico como conceptos separados. Estados conocidos: CREATED/STARTING/RUNNING/STOPPED/ERROR; resultados: FAILED/UNHEALTHY/UNKNOWN/DEGRADED/HEALTHY; limpieza: PENDING/COMPLETED/ERROR. Preservar valores futuros con presentación neutra y texto original. No inferir éxito de backup, recuperación funcional ni eliminación de recursos a partir de un estado técnico.

### Informes

Lista por `run_id` exacto, con Actualizar, Ver informe y Eliminar informe. Panel lector con Markdown como texto literal mediante interpolación en `pre`, conservando espacios, JSON y avisos de precisión. Mantener confirmación de borrado y actualización cruzada de Health tras eliminar el informe. No derivar fechas del ID ni añadir datos no proporcionados por la lista.

### Feedback y foco comunes

- Conservar estados de carga, vacío, error inicial, datos/detalles anteriores desactualizados, fecha de lectura, resultado de escritura e incertidumbre. Un fallo de lectura no se convierte en lista vacía ni borra datos anteriores.
- Resultados e incertidumbres se muestran fuera de los paneles y permanecen accesibles en su pestaña al cerrarlos. No desaparecen al cambiar de pestaña o al refrescar; se limpian con el ciclo del módulo según las reglas actuales.
- Reutilizar exactamente los bloqueos cruzados actuales en listas, formularios y paneles; impedir doble envío. El escenario del mockup que impide toda escritura tras incertidumbre no redefine el contrato actual: conservar avisos persistentes y ausencia de reenvío automático, sin introducir un bloqueo permanente nuevo.
- `SidePanel` mantiene cierre, foco inicial, retorno al disparador y fallback al encabezado de la lista si el elemento desaparece. Con una confirmación ARCA encima, desactivar temporalmente el focus trap del panel como hace `DockerInspector`; al cancelarla, devolver el foco al panel. Un cierre o cambio de pestaña invalida su confirmación correlacionada.

## Tema y adaptación

Reutilizar `console-content`/`console-layout`, con ajustes locales para que las secciones de cada pestaña ocupen el ancho completo. Colores mediante `--ion-*` y `--kida-muted`; fuentes, radios, bordes, espaciado, sombras y efectos mediante los tokens `--kida-*` disponibles. Usar estados semánticos primary/success/warning/danger sin depender solo del color.

Nada de paleta turquesa fija, fuentes externas ni CSS/SVG/JavaScript copiado del mockup. Botones nativos con variantes existentes; selects/textareas con `.console-control`; checkbox con presentación local tematizada y dimensiones explícitas si la base de inputs no encaja. SCSS nuevo solo para composición y necesidades locales. No modificar estilos de Docker/System ni extraer una abstracción compartida para evitar unas pocas reglas repetidas.

Debe responder al cambio de tema sin recrear páginas, perder borradores o cerrar paneles. Cubrir las siete combinaciones actuales, foco visible, movimiento reducido, rutas largas y anchos de 360 px y escritorio. `SidePanel` ya ocupa el ancho completo en móvil; conservarlo.

## Historias de usuario y orden de ejecución

Cada archivo es la unidad de trabajo de una sesión CODEX. HU-01 a HU-07 constan como **completadas** en sus entregas. HU-07 registra las comprobaciones integradas y visuales, el resultado de revisión y los límites actuales.

| Orden | Historia | Dependencia |
| --- | --- | --- |
| HU-01 | [Navegación y sesión del módulo](backups-redesign/HU-01-navegacion.md) | Ninguna |
| HU-02 | [Consultar configuraciones y solicitar backups](backups-redesign/HU-02-configuraciones.md) | HU-01 |
| HU-03 | [Crear configuraciones en panel](backups-redesign/HU-03-crear-configuracion.md) | HU-02 |
| HU-04 | [Consultar comprobaciones de recuperación](backups-redesign/HU-04-historial-health.md) | HU-03 |
| HU-05 | [Crear y ejecutar comprobaciones](backups-redesign/HU-05-crear-ejecutar-health.md) | HU-04 |
| HU-06 | [Consultar y eliminar informes](backups-redesign/HU-06-informes.md) | HU-05 |
| HU-07 | [Validar la experiencia integrada](backups-redesign/HU-07-validacion.md) | HU-06 |

### Contrato para las sesiones CODEX

- Leer `AGENTS.md`, esta spec y la historia asignada; contrastar siempre con el código actual. La spec general manda sobre el mockup; una contradicción entre documentos requiere aclaración, no una reinterpretación silenciosa.
- Ejecutar las historias **en orden, una por sesión**. Independencia de contexto no significa ejecución paralela: comparten archivos. La sesión empieza sobre el resultado integrado y verificado de la anterior; no necesita el historial del chat.
- Limitar cambios a la historia. Los archivos indicados son orientativos, no permiso para refactorizar otros módulos. Conservar las funciones aún pendientes de rediseño mediante su interfaz actual; no dejarlas inaccesibles ni sustituirlas por placeholders.
- Reutilizar los estados y componentes definidos arriba. HU-01 establece la estructura; las siguientes la amplían sin crear providers, transportes ni modelos alternativos. No adelantar historias ni cambiar decisiones de producto.
- Mantener pruebas y cobertura. Si las instrucciones aplicables protegen un archivo o exigen autorización para modificarlo, solicitarla antes de ese cambio; no sustituirla por la existencia de esta spec. Nunca debilitar comprobaciones.
- Cerrar cada sesión con alcance realizado, archivos cambiados, verificaciones y resultado, límites pendientes y contrato público añadido a fachada/estados. Registrar ese resumen y el estado de aceptación al final de la propia historia para el siguiente agente. Si hay un bloqueo, no marcarla completada ni arrancar la dependiente.
- Revisión independiente al cerrar cada historia; HU-07 añade la revisión del conjunto. No hacer commit, push ni deploy sin petición explícita. Playwright solo ante una duda concreta que lo justifique.

Archivos afectados en conjunto: `app.routes.ts`; `pages/backups/{backups.*,backups.routes.ts,backups-tabs.scss,tabs/,components/,services/}`; pruebas de rutas y `pages/backups/tests/`. Mantener modelos, acciones, transporte y utilidades de validación salvo un ajuste estrictamente necesario y justificado. HU-07 revisa la documentación de navegación de Console.

## Verificación para la futura implementación

Usar Node de `.nvmrc`. Desde `kida-console/frontend`:

```sh
pnpm exec ng test --watch=false --include='src/app/pages/backups/tests/*.spec.ts' --include='src/app/app.routes.spec.ts'
pnpm exec ng test --watch=false
pnpm exec ng build --configuration production
```

Conservar toda la cobertura actual; adaptar únicamente montajes/selectores afectados y añadir casos de rutas, paneles, borradores, sesión cacheada y confirmación sobre panel. No borrar, debilitar ni saltar pruebas. No aumentar budgets para conseguir un build verde; contrastar cualquier exceso con la base y reportarlo.

Inspección visual manual breve de escritorio/móvil y temas claro/oscuro, más comprobación de tokens para el resto. No ejecutar una matriz Playwright por defecto: usarlo solo si hace falta resolver una duda real de Ionic/foco/adaptación que las pruebas disponibles no cubran, indicando qué se ha comprobado y qué queda sin verificar. Revisar whitespace también en archivos nuevos.
