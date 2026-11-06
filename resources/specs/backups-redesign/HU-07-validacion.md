# HU-07 · Usar el rediseño integrado con cualquier tema

**Estado:** completada (2026-11-06). **Dependencia:** HU-06 aceptada e integrada.

Como administrador, quiero una experiencia consistente en las tres pestañas, con mi tema y dispositivo, sin perder operaciones, borradores o claridad sobre su resultado.

## Contexto para el agente

Leer [spec general](../backups-redesign.md), las entregas HU-01 a HU-06 y el mockup. Revisar implementación final y estilos compartidos. Esta historia integra y verifica; no recupera trabajo omitido marcándolo como validado ni amplía funciones.

## Alcance

- Revisar composición global, tokens, siete combinaciones de tema, 360 px/escritorio, rutas largas, teclado/foco y movimiento reducido. El cambio de tema no recrea páginas, borra formularios ni cierra paneles.
- Confirmar la conservación de las 14 operaciones, validadores, contenido técnico, JSON y comportamiento de incertidumbre. Revisar juntos navegación interna, formularios, confirmaciones y respuestas tardías.
- Ejecutar la validación integrada, corregir defectos dentro del alcance y actualizar documentación de navegación ES/EN cuando resulte afectada.
- Revisar diff para detectar duplicación, wrappers/servicios innecesarios, estilos copiados, controles de demo o cambios ajenos. Revisión independiente del conjunto tras las correcciones.

## Criterios de aceptación

1. HU-01 a HU-06 están aceptadas; todo criterio de la spec general tiene implementación y comprobación identificable. Lo no comprobado se declara expresamente.
2. Una sesión completa permite navegar, crear configuración, solicitar backup, consultar/operar Health y leer/borrar informes con las salvaguardas definidas, usando dobles de prueba y sin operar CORE real.
3. Tema y adaptación usan componentes/tokens existentes; no hay desbordamiento horizontal de página ni información dependiente solo del color. El scroll de la tabla es interno.
4. Pruebas relevantes y suite frontend pasan sin debilitar comprobaciones. Build de producción pasa, o se documenta un fallo comparado con la base y su causa; no marcar completa con una regresión sin resolver ni subir budgets.
5. No se han añadido dependencias, infraestructura paralela, cambios de backend ni commits/push/deploy sin autorización.

## Archivos y comprobación

Ámbito: implementación Backups y pruebas ya afectadas; documentación `resources/docs/{es,en}/console/README.md` si corresponde. Cambios compartidos solo si un defecto real lo exige y está dentro del alcance autorizado; no rediseñar el tema global.

Desde `kida-console/frontend`:

```sh
pnpm exec ng test --watch=false --include='src/app/pages/backups/tests/*.spec.ts' --include='src/app/app.routes.spec.ts'
pnpm exec ng test --watch=false
pnpm exec ng build --configuration production
```

Inspección visual manual breve en móvil/escritorio y claro/oscuro; comprobar tokens para las demás combinaciones, sin afirmar una matriz visual no ejecutada. Playwright solo ante una duda concreta de Ionic/foco/adaptación sin otra cobertura suficiente; no ejecutar pruebas con operaciones reales. Revisar whitespace de archivos tracked y nuevos.

## Entrega de sesión

La implementación funcional HU-01–HU-06 está integrada. Esta sesión añade la comprobación conjunta, corrige el feedback oculto de dos inspectores y cierra la verificación visual breve autorizada posteriormente con Playwright. **HU-07 completada**, con los límites de cobertura y el fallo de presupuesto preexistente documentados abajo.

Cambios realizados:

- `tabs/backup-configurations/backup-configurations.{ts,html}` y `tabs/backup-health/health.{ts,html}`: resultados, errores e incertidumbres de operaciones también son accesibles dentro del inspector abierto. Cada pestaña declara una plantilla local de feedback y la reutiliza mediante `NgTemplateOutlet`, patrón ya presente en Scheduler. Se identifican como resultados/avisos de la pestaña que pueden corresponder a otra configuración/ejecución, sin atribuirlos a la selección actual. Se mantiene el bloque persistente fuera del panel, el JSON completo, los avisos de precisión, las admisiones y los datos de limpieza; sin estado ni componente adicional. Configuraciones también muestra fecha de lectura, carga, error de refresco y aviso de datos desactualizados dentro del detalle.
- `tests/backups.spec.ts` y `tests/health.spec.ts`: seis regresiones de panel abierto cubren rechazo HTTP 409, incertidumbre HTTP 504 y resultado confirmado con refresco fallido. Comprueban feedback dentro del panel, persistencia tras cerrarlo y su distinción al abrir otra selección. La regresión de Configuraciones comprueba además carga, fecha de lectura, error y detalle anterior desactualizado. Antes de la corrección fallaban las seis; después pasan.
- `tests/navigation.spec.ts`: sesión integrada con rutas e hijas reales, providers compartidos y HTTP simulado. Crea configuración conservando strings exactos, solicita backup mediante confirmación ARCA, crea Health sin iniciarlo, confirma su inicio, lee Markdown literal y elimina su informe con actualización cruzada del historial. Comprueba CSRF/credenciales del cliente, resultados y borradores entre pestañas y limpieza al salir. Se completa el doble de autenticación con su signal CSRF; no se modifica autenticación de producción.
- La misma prueba de navegación añade cambio de las siete combinaciones de tema en las tres pestañas con panel abierto: verifica atributos del documento, adaptación Ionic oscuro, mismas instancias/elementos del panel, borradores, búsqueda, incertidumbres e identidad. Es comprobación de estado/DOM, no de apariencia renderizada.
- `resources/docs/{es,en}/console/README.md`: sustituye el aviso obsoleto de interfaz no disponible por navegación protegida, tres URLs de Backups, paneles/borradores y semántica de operaciones. `kida-console/frontend/README.md` deja de describir Backups como placeholder. La spec general refleja el estado real de las historias.

Evidencia de cobertura del conjunto:

| Contrato de la spec | Implementación y comprobación |
| --- | --- |
| Redirect, hijas lazy, guard, contadores reales y providers únicos | `backups.routes.ts`, `backups.html`, `app.routes.spec.ts` y `tests/navigation.spec.ts`; entregas HU-01/HU-02. |
| Sesión idempotente, cierre de UI, borradores, confirmaciones correlacionadas, escrituras enviadas, detalles tardíos y DOM cacheado | Fachada y tres estados; regresiones de `backups.spec.ts`, `health.spec.ts`, `reports.spec.ts` y navegación. La navegación simula explícitamente los hooks Ionic. |
| Búsqueda local, orden, tarjetas, rutas completas y JSON | Configuraciones y `backups.spec.ts`; HU-02. Grid 1/2/3 por container queries; inspección de escritorio y una columna a 360 px sin overflow horizontal. |
| Crear configuración, avanzados, omitido/valor/null, Unicode, precisión, false/0 y límites | Formulario/validador originales y `backups.spec.ts`; HU-03. Se mantienen payload completo, errores y cierre solo confirmado. |
| Historial, fechas locales, valores futuros, detalle técnico completo y operaciones Health | Health y `health.spec.ts`; HU-04/HU-05. Tabla con región de scroll interna, ancho mínimo y contenedor limitado; comprobado a 360 px: región de 278 px y tabla de 832 px, scroll interno y página de 360 px. |
| Informes por ID exacto, Markdown literal, borrado correlacionado y refresco cruzado | Informes y `reports.spec.ts`; HU-06, más sesión integrada HU-07. |
| Feedback, incertidumbre persistente, sin reintento automático y bloqueos cruzados | Los tres estados y sus pruebas; seis regresiones nuevas cubren feedback en inspectores. No se cambia la política de bloqueo. |
| Foco inicial/retorno/fallback, confirmación sobre panel y movimiento reducido | `SidePanel`, utilidades/dialogs existentes y pruebas de SidePanel/Backups. Mixin de pestañas y animación compartida contemplan movimiento reducido. Playwright confirma foco inicial, Tab/Shift+Tab, cancelación/Escape, retorno y suspensión/restauración del trap con Ionic real; también apertura con movimiento reducido. |
| Siete combinaciones de tema sin perder trabajo | Catálogo y servicio de temas existentes; prueba conjunta nueva. Estilos locales usan tokens definidos, sin colores literales ni fuentes/JS/SVG del mockup. Inspección visual breve de Professional claro/oscuro; sin certificación completa de contraste ni matriz visual de siete combinaciones. |

Se contrastan los catorce métodos de `BackupsService` y sus acciones, sin cambios: configuraciones listar/crear/eliminar, solicitar backup; Health listar/consultar/crear/iniciar/ejecutar automático/detener/eliminar; informes listar/consultar/eliminar. `backups.spec.ts` conserva el registro de catorce canales y contratos de formularios; `health.spec.ts` cubre todos sus tipos de operación y `reports.spec.ts` sus tres canales. La sesión conjunta recorre el flujo principal; no pretende sustituir esa cobertura específica.

Verificación (Node 24.15.0):

- Base limpia de esta sesión: **680/680** pruebas frontend. Producción ya falla por presupuesto inicial: **1,01 MB**, exceso **13,73 kB** sobre el máximo de **1,00 MB**. También avisa del SCSS de Docker Containers (**4,51 kB**, exceso **513 bytes** sobre aviso de **4 kB**).
- Suite frontend final: **689/689**, 29 archivos, incluidas las nueve pruebas nuevas; ejecutada mediante el CLI Angular local con Node, sin acceder al almacén pnpm. Producción mantiene exactamente el mismo fallo de presupuesto (**13,73 kB** de exceso) y el mismo aviso de SCSS de Docker que la base; sin nuevos errores de compilación ni cambios de budgets.
- Backups y rutas: **251/251**, incluidos también en la suite completa final.
- `git diff --check`: correcto. No hay archivos nuevos sin seguimiento ni artefactos generados en el diff. Enlaces nuevos de documentación correctos. Un barrido de enlaces locales del README frontend detecta dos enlaces rotos ya presentes en `HEAD`: `docs/specs/docker-frontend.md` y `src/app/pages/system/system.verification.md`; se conservan fuera de este alcance.
- Revisión independiente del conjunto y diff final: **sin hallazgos pendientes** tras corregir feedback oculto, distinguir avisos de otra selección y presentar los datos desactualizados dentro del inspector de Configuraciones. El revisor contrastó código conectado, pruebas y documentación; no ejecutó navegador ni duplicó suite/build.
- Detector estático Impeccable sobre Backups: **sin hallazgos**. Todos los tokens `--kida-*` usados por los estilos locales y SidePanel tienen definición; sin colores literales en esos estilos. Revisión de composición contra el mockup y patrones de System/Docker, sin copiar su código de dominio ni la paleta del ejemplo.

Contrato público: **sin incorporaciones ni cambios** en fachada, estados, formularios, validadores, modelos, acciones o transporte. Se reutiliza feedback en dos templates, se corrige el foco interno de `AppDialog` y se amplían pruebas/documentación.

Límites y aceptación:

- Criterios 1 y 3: comprobados mediante cobertura automatizada, revisión estática y el recorrido Chromium descrito abajo. El acceso inicial mediante Computer Use falló; la autorización posterior de Playwright permitió cerrar la comprobación pendiente.
- Criterios 2, 4 y 5: comprobados mediante la sesión integrada, suite completa y contraste del build con la base. El fallo de producción se registra como limitación preexistente; no se modifica ningún budget para ocultarlo.
- Sin operaciones contra CORE real. Chromium usa Ionic y navegación reales con API interceptada; no equivale a hardware móvil, todos los navegadores, una certificación de accesibilidad ni una matriz visual de siete combinaciones. Las otras combinaciones mantienen comprobación estática y de conservación de estado/DOM. Los casos exhaustivos de escrituras, datos tardíos y sesiones siguen cubiertos por las pruebas automatizadas.
- Sin dependencias nuevas ni cambios en CORE, backend, estilos compartidos o infraestructura. El único ajuste compartido de comportamiento es el foco de `AppDialog`, justificado por el defecto observado y revisado independientemente. Sin commit, push ni deploy. No se modifica la aceptación registrada de HU-01–HU-06.


Verificación breve con Playwright (autorización posterior del usuario):

- Chromium, servidor Angular de desarrollo temporal en `127.0.0.1:4277`; todas las peticiones `/api/**` interceptadas antes de navegar, incluidas sesión y CSRF de prueba. Sin backend ni CORE real; las confirmaciones se cancelan, sin ejecutar operaciones de servidor.
- Inspección de cuatro capturas: Configuraciones e inventario a **1440 × 1000 / Professional claro**; formulario en panel de escritorio; inspector Health e informe literal a **360 × 800 / Professional oscuro**. Las rutas largas se ajustan. Mediciones adicionales de Configuraciones y tabla Health en móvil, y cambio claro/oscuro con formulario abierto. No se ejecuta una matriz de temas ni una batería E2E adicional.
- A 360 px: página de **360 px**, grid de **278 px** sin overflow propio; tabla Health de **832 px** dentro de región desplazable de **278 px**. Inspector de **360 px**, acciones visibles y sin desbordamiento de página. Informe: Markdown/espacios literales, ningún elemento `script` interpretado, ancho de contenido **302 px** sin overflow.
- Borrador conservado al cerrar/reabrir, navegar por pestañas y recibir un cambio de apariencia mediante el evento `storage` real del servicio de temas. Comprobados foco inicial en Cerrar, retorno al botón que abre el panel y apertura con `prefers-reduced-motion: reduce`.
- La confirmación real reveló que el foco quedaba en el host del modal tras presentarse: `AppDialog.ngAfterViewChecked` no garantizaba foco después de la entrega ARCA. `components/app-dialog/app-dialog.ts` reutiliza la selección de Cancelar y programa el foco tras recibir configuración o `ionModalDidPresent`, dejando terminar presentación/renderizado. Cancela el temporizador previo, respeta cierre/configuración/conexión y limpia temporizador/listeners al destruirse. `app-dialog.spec.ts` añade una regresión que falla antes del ajuste y pasa después.
- Repetición enfocada tras la corrección: **Cancelar recibe foco**, Tab pasa a Confirmar y Shift+Tab vuelve a Cancelar; el trap del panel se suspende durante la confirmación y se restaura al cancelar; Escape devuelve foco a Detener Health sin cerrar el inspector. Cerrar el inspector devuelve foco a Ver Health; cerrar creación devuelve foco a Nueva configuración. Consola: **0 errores y 0 warnings**.
- Revisión independiente adicional de `AppDialog`: **sin hallazgos pendientes**. Navegador y servidor temporal cerrados; capturas/log temporal trasladados a `/tmp/kida-hu7-browser-evidence`, fuera del repositorio.
