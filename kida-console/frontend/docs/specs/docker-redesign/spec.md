# Spec: rediseño frontend de Docker

## 1. Objetivo, alcance y autoridad

Reorganizar Docker para que el administrador consulte proyectos y contenedores,
inspeccione sus datos y ejecute las operaciones existentes con la experiencia del
mockup. Entrega de esta fase: esta spec y 16 historias; no incluye implementar UI.

**Solo frontend y documentación. Prohibido modificar CORE, CLI, backend o API:
endpoints, métodos, cuerpos, respuestas, modelos de servidor y autenticación.**
No añadir dependencias ni editar vendor. Si la API no aporta un dato, mostrar su
ausencia; nunca ampliar el contrato para completar el diseño. El componente
lateral compartido y los estilos comunes de tabs sí forman parte del frontend.

Esta spec sustituye las decisiones de presentación de
[operaciones Docker](../docker-frontend.md): dos secciones simultáneas, detalles
en página, acciones solo en el listado y ausencia de bloqueos por actividad.
Conserva sus contratos y protecciones salvo los cambios explícitos de este texto.
La implementación aún está pendiente; no confundir criterios con resultados.

## 2. Flujo obligatorio para todos los agentes implementadores

**explore -> ask -> plan -> ask -> implement -> review**

1. **explore:** leer esta spec, la historia, sus dependencias, código y pruebas
   actuales; comprobar ARCA, componentes y temas antes de proponer cambios.
2. **ask:** plantear dudas materiales y confirmar la interpretación de la historia
   con el usuario. No preguntar hechos que puedan resolverse explorando.
3. **plan:** presentar un plan corto, archivos afectados y comprobaciones.
4. **ask:** pedir validación del plan antes de modificar código. Esperar respuesta;
   ni el silencio ni una autorización de otra historia sustituyen esta validación.
5. **implement:** implementar solo la historia autorizada y ejecutar sus pruebas.
6. **review:** solicitar revisión de un agente independiente; corregir hallazgos y
   repetir las comprobaciones afectadas antes de entregar.

Este flujo también figura en cada historia. Un agente no puede saltarse pasos,
implementar historias posteriores ni modificar CORE/API para resolver bloqueos.
Si necesita alterar la spec o un contrato del componente compartido, plantearlo
antes de implementar. No hacer commit, push ni despliegue sin permiso explícito.

## 3. Referencias y stack

- [Mockup HTML navegable](../../../../docs/mockups/kida-docker-mockup.html):
  fuente de layout, jerarquía e interacciones. Sus datos y escrituras son simulados.
- Imagen #1 de la conversación: vista anterior. Imagen #2: objetivo Proyectos;
  imagen #3: objetivo Contenedores. El HTML es la referencia local persistente.
- [System: tabs](../../../src/app/pages/system/system.html),
  [estilos](../../../src/app/pages/system/system-tabs.scss) y
  [rutas](../../../src/app/pages/system/system.routes.ts): patrón acordado.
- [Equipo](../../../src/app/pages/settings/equipment/system-equipment.ts):
  referencia de modal, foco e integración con temas; no trasladar su dominio.
- Stack existente: Angular 22.2.x, TypeScript, Ionic 8.8.19, ARCA 3.2.7, RxJS,
  signals, SCSS, Vitest y Playwright. Node según `.nvmrc`, sin actualizar versiones.
- Fuentes funcionales: `src/app/pages/docker/`, `services/arca-request.service.ts`
  y `src/theme/`, dentro de frontend. Pruebas junto al código y script
  `src/app/pages/docker/docker.browser.cjs`; no crear otro arnés paralelo.

No copiar la paleta, fuentes ni CSS global del HTML. Reutilizar tokens Ionic/KIDA,
cabecera, menú, iconos y componentes de la app. ARCA se reutiliza para transporte
y componentes adecuados disponibles; Ionic cubre tabs, acordeones y modal cuando
ARCA no ofrece un equivalente. No crear sustitutos de infraestructura existente.

## 4. Contratos de datos inalterables

Base actual: `environment.apiBaseUrl + '/docker'`.

| Operación              | Método y ruta                                     | Entrada                       |
| ---------------------- | ------------------------------------------------- | ----------------------------- |
| Contenedores           | GET `/containers`                                 | Ninguna                       |
| Versión                | GET `/compose/version`                            | Ninguna                       |
| Proyectos              | GET `/compose/projects`                           | Ninguna                       |
| Inspección de proyecto | GET `/compose/projects/inspect?project={project}` | `encodeURIComponent(project)` |
| Arrancar               | POST `/containers/start`                          | `{container: idCompleto}`     |
| Parar                  | POST `/containers/stop`                           | `{container: idCompleto}`     |
| Reiniciar              | POST `/containers/restart`                        | `{container: idCompleto}`     |
| Eliminar               | POST `/containers/delete`                         | `{container: idCompleto}`     |

Conservar `DockerService`, los ocho canales ARCA y `useLoader: false`, cookies,
CSRF, codificación, clasificación de fallos y drenaje de canales retenidos.
No introducir llamadas HTTP directas ni nuevas peticiones para inspeccionar un
contenedor: su detalle usa el objeto recibido en inventario o Compose.

- Inventario: `{total, running, containers, ...}`. Indicadores de total y ejecución
  usan los valores de API, aunque no coincidan con la longitud de la lista.
- Proyectos: array raíz de `{name, services, ...}`; cada servicio tiene
  `name: string | null` y `containers`. Contar servicios por proyecto, sin deduplicar
  nombres entre proyectos; null se presenta como «Sin nombre».
- Asociar por ID completo del contenedor en la lista de proyectos. No parsear
  nombres ni añadir campos al DTO de transporte. Relaciones derivadas pertenecen
  a presentación. Si hay varias relaciones distintas para un ID, mostrar
  «Asociación ambigua» y no elegir una arbitrariamente.
- Con proyectos cargados y sin relación: «Sin asociación Compose observada»;
  sin lectura correcta: «Asociación no disponible»; con lectura anterior:
  identificarla como desactualizada. Buscar solo sobre asociaciones conocidas.
- El listado principal usa los datos de inventario; las tarjetas y detalle de
  proyecto usan su propia respuesta. No mezclar estados para fabricar una lectura
  atómica: las fuentes son instantáneas independientes.
- Preservar campos adicionales, ceros, nulos y estados futuros. Actividad deriva
  de `online`; mostrar también el estado Docker literal en el inspector. Salud
  null y salida null son no disponibles; salida 0 es visible. No atribuir una causa
  a salida 137.
- No quitar prefijos del nombre del contenedor por heurística. Permitir elipsis
  visual; nombre e ID completos disponibles en inspector y confirmación.
- JSON interpretado de cada respuesta, sin campos derivados. Conservar aviso de
  precisión limitada de enteros JavaScript. Datos remotos siempre como texto.

## 5. Layout y experiencia común

Orden de la vista: tabs superiores como System; dentro del área desplazable,
cabecera «Docker & Compose», descripción, cuatro indicadores, franja Compose,
cabecera de sección y contenido de la tab. Cabecera, indicadores y franja se
renderizan con un componente común, compartiendo estado; no duplicar peticiones.
El cambio respecto a la posición del selector del mockup es deliberado: se adopta
la navegación existente de System. No duplicar el logo/cabecera global.

| Zona               | Aceptación visual e interacción                                                                                                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Indicadores        | Cuatro tarjetas: total, en ejecución con total de referencia, proyectos y servicios. Cuatro columnas desde 1100 px, dos por debajo; no inventar «2 por proyecto» para datos variables.                                                                                             |
| Franja Compose     | Icono, versión detectada y aviso de propiedad a la izquierda; «Datos de versión» y «Actualizar versión» a la derecha. Permitir apilado y salto de textos.                                                                                                                          |
| Proyectos          | «Proyectos observados», descripción y «Actualizar proyectos». Grid de dos columnas desde 1100 px y una por debajo.                                                                                                                                                                 |
| Tarjeta            | Identidad completa o elipsis, distintivo «Observado», activos/total, servicios, contenedores y barra de actividad. Proporción por `online`; 0 contenedores = barra vacía, sin división por cero.                                                                                   |
| Servicios          | Cabecera de sección; cada servicio muestra nombre, cantidad y activos/total. Su cuerpo contiene nombre, imagen, estado e icono Inspeccionar por contenedor. Primer servicio abierto al cargar cada proyecto; demás cerrados; conservar expansión al refrescar si sigue existiendo. |
| Pie de tarjeta     | Aviso «Datos de Compose · solo lectura» e «Inspeccionar proyecto». «Observado» nunca acredita propiedad o permiso.                                                                                                                                                                 |
| Contenedores       | «Contenedores Docker», descripción y «Actualizar contenedores». Panel con título del inventario y cantidad de objetos recibidos.                                                                                                                                                   |
| Herramientas       | Búsqueda, filtro Todos / En ejecución / Fuera de línea y número de resultados; se apilan cuando falte espacio.                                                                                                                                                                     |
| Filas              | Contenedor, Estado, Imagen, Servicio/Proyecto, Salud, Salida y Operaciones; alinear acciones compactas a la derecha en escritorio.                                                                                                                                                 |
| Móvil/tablet       | Por debajo de 1100 px, filas como tarjetas con campos etiquetados y acciones accesibles. Una sola representación interactiva por contenedor; sin controles duplicados en el árbol accesible.                                                                                       |
| Pie del inventario | Aviso sobre salida 137 y «Ver JSON del inventario». Este JSON contiene toda la respuesta, no solo resultados filtrados.                                                                                                                                                            |

Búsqueda inmediata local, con espacios externos eliminados y sin distinguir
mayúsculas, sobre nombre, ID, imagen, proyecto y servicio. Se combina mediante AND
con filtro de actividad (`online`). Mantener orden de API. No agregar ordenación,
paginación, selección múltiple, sondeo ni acciones Compose. Los filtros solo
afectan al inventario visible, no a indicadores, proyectos ni JSON.

Vacío de inventario, cero coincidencias, carga y fallo inicial son estados
distintos. Sin lectura, indicadores desconocidos; cero únicamente tras lectura
correcta. Servicios/proyectos provienen de proyectos y conservan sus propios
estados de carga/error/desactualización.

## 6. Panel lateral reutilizable y sus contenidos

### #1. Contenedor compartido

Crear `src/app/components/side-panel/`, independiente de Docker, basado en
`ion-modal`. Contrato mínimo: entradas `open: boolean`, `title: string`,
`subtitle: string` opcional, `focusTrap: boolean = true` y
`fallbackFocus: HTMLElement | null = null`; salida `closed` tras `didDismiss`
para que el consumidor sincronice apertura; proyección de contenido por defecto
y slot de acciones `[panel-actions]`. Pasar `focusTrap` al ion-modal interno;
el consumidor no accede a sus miembros privados.
El consumidor mantiene la selección y lógica de negocio. No admitir HTML como
cadena, tipos de recurso, endpoints ni servicios Docker en este componente.

A partir de 768 px: panel a la derecha, alto del viewport, ancho
`min(36rem, 100vw)`. Por debajo: pantalla completa. Usar tokens de temas, fondo
superpuesto y scroll interno. Movimiento lateral sujeto a tokens y movimiento
reducido; no copiar la animación centrada de Equipo si contradice el lateral.

Cerrar mediante botón etiquetado, Escape o fondo. Foco inicial en Cerrar, teclado
confinado al modal activo y retorno al disparador; si desaparece, a la cabecera de
la vista. El consumidor proporciona esa cabecera mediante `fallbackFocus`;
restaurar foco solo si el destino sigue conectado y la vista continúa activa.
Cerrar o salir no envía operaciones. Cambiar de tab cierra el panel.
Solo un panel; sin historial interno ni paneles anidados. Sustituir proyecto por
contenedor mantiene como origen el control de la página, no un nodo eliminado
del panel. Una respuesta tardía no reabre el panel ni reemplaza otro contenido.

Los estados de carga/error, datos y acciones se proyectan desde cada módulo.
Verificar reutilización con un host de prueba de contenido ajeno a Docker, sin
migrar otros módulos ni crear un framework de inspectores.

### #4. Versión

«Datos de versión» abre el panel con versión y JSON desplegable de su respuesta,
sin nueva petición. «Actualizar versión» mantiene su operación y estados locales.

### #10. Contenedor

Abrir desde fila, servicio o inspector de proyecto. Agrupar en identificación y
estado; ejecución (fechas, salida, reinicios y política); puertos; redes; operaciones;
JSON desplegable. Reutilizar/adaptar `ContainerDetails`, sin perder campos.
Fechas legibles en UTC, null como no disponible y valor inválido conservado como
texto. Colecciones vacías: «Sin puertos» / «Sin redes».

Seguir ID y origen de lectura. Tras refrescar esa fuente, actualizar el objeto;
si desaparece, mostrar «Contenedor no disponible en esta lectura» y desactivar
acciones. Un objeto solo observado en Compose puede inspeccionarse, pero no
operarse sin el mismo ID en el inventario principal. Las acciones toman el objeto
actual de ese inventario y sus bloqueos, nunca una copia anterior de Compose.

### #11. Proyecto

«Inspeccionar proyecto» abre el panel e invoca la inspección existente. Mostrar
carga, error o última lectura desactualizada de ese proyecto, nunca el detalle de
otro. Contenido: nombre completo, totales, aviso de observado, servicios,
contenedores con acceso a #10 y JSON de inspección. Mantener acceso al JSON de la
lista completa de proyectos mediante un desplegable en la vista Proyectos.
No lanzar inspecciones simultáneas por el mismo canal. Al desaparecer el proyecto
tras lectura correcta, limpiar selección y mostrar que ya no está disponible.

### #12. Inventario JSON

Abrir el panel con la respuesta completa y un desplegable JSON. Sin nuevas
peticiones, campos derivados ni JSON reconstruido. Etiquetar «JSON interpretado»,
igual que versión, proyecto y contenedor.

## 7. Estado, navegación y acciones

### #2. Navegación y composición

Rutas hijas lazy: `/docker/projects` y `/docker/containers`; `/docker` redirige
a projects. Mantener guard y enlace actual del menú. Tabs superiores nativos Ionic,
URLs enlazables, selección e historial coherentes. Extraer un mixin SCSS para tabs
parametrizado por número/orden, sin nombres System ni supuestos de tres tabs;
usarlo en ambos módulos y conservar System visualmente intacto.

Mover la coordinación existente a una fachada provista por el contenedor Docker,
no global. Conservar `DockerService`, helpers de fallos y lógica de escritura;
componentes pequeños para cabecera común, tarjeta y controles de acciones.
No extraer componentes solo por envolver unas pocas líneas.

Entrada al módulo carga inventario, proyectos y versión una vez. Cambiar de tab
conserva lecturas, filtros y expansión sin repetir cargas; atender reactivación de
hijos cacheados por Ionic. Salir y reentrar carga de nuevo. Cambio de tab cierra
inspector y confirmación sin enviar; conserva una escritura ya enviada, sus
bloqueos y resultado compartido. Salir/cambiar sesión limpia estado, cancela
suscripciones e invalida generaciones; no promete cancelar una escritura remota.

### #3, #5–#9. Lecturas y presentación

Indicadores según §4. Tarjetas/servicios según §5. Cada actualización conserva
última lectura ante fallo y la marca desactualizada. Actualizar proyectos no
reemplaza inventario ni viceversa. La interfaz indica que son lecturas puntuales.
Búsqueda y filtro persisten entre tabs, se reinician al salir o cambiar de sesión.

### #13–#16. Operaciones compartidas

Un único componente de controles y una única ruta de preparación/ejecución,
reutilizados en fila e inspector. Bloqueo común actual: inventario, proyectos o
inspección cargando; confirmación; escritura o actualización posterior; resultado
incierto; ausencia de inventario o del ID destino. Añadir:
Arrancar desactivado si `online=true`, Parar si `online=false`. Comprobar estas
reglas también al preparar la acción, no solo en el atributo disabled.
No deducir otras restricciones por estado, salud, asociación o propiedad.

| Historia | Operación | Confirmación y aceptación específica                                                      |
| -------- | --------- | ----------------------------------------------------------------------------------------- |
| #13      | Arrancar  | Directa; un clic envía un POST con ID completo si está habilitada.                        |
| #14      | Parar     | Nombre e ID completos, advertencia de interrupción y botones Cancelar/Confirmar.          |
| #15      | Reiniciar | Misma confirmación, con advertencia de interrupción temporal.                             |
| #16      | Eliminar  | Confirmación con advertencia irreversible; no añadir force, volúmenes ni opciones de API. |

Instantánea inmutable de acción/nombre/ID; Cancelar o Escape no envían. Doble clic
no duplica POST. Mantener `.console-dialog` y helpers existentes de foco; mientras
esté abierto sobre el inspector, suspender la captura de foco del modal inferior
y restaurarla al cerrar mediante la entrada compartida `focusTrap`; solo la
confirmación activa puede deshabilitarla. Cancelar devuelve foco al control del inspector.
Si cambia la selección/ruta/sesión, invalidar confirmación; no ejecutar otro destino.

No cambios optimistas. Tras éxito mostrar acción y respuesta de CORE; actualizar
inventario y proyectos, y luego inspección seleccionada si sigue existiendo.
Separar resultado de escritura del fallo de refresco. Si cambia el contenido del
panel durante la petición, el resultado no debe sustituirlo ni reabrirlo.
Mensaje de resultado compartido, visible desde ambas tabs, persistente hasta la
siguiente operación o salida; el toast no será su único soporte.

Resultado incierto: conservar aviso, marcar lecturas desactualizadas y bloquear
escrituras hasta refresco correcto de inventario. No reenviar automáticamente.
Respetar sesión, identidad, generación, proyecto y canal en respuestas tardías.

## 8. Temas, accesibilidad y aceptación transversal

Usar `--ion-*` y `--kida-*` para superficies, textos, acentos, dimensiones
temáticas, bordes, radios, sombras, fuentes y movimiento. Sin paleta Docker fija.
Professional, Neobrutalism y Sakura en claro/oscuro; Tokyo oscuro. Cambio de tema
con panel y confirmación abiertos debe aplicarse también a overlays.

Etiquetas completas para iconos, controles operables por teclado, foco visible,
aria-expanded en servicios, títulos accesibles en overlays y anuncios de carga,
error y resultado. Color acompañado de texto; no rebajar contraste por copiar el
mockup. A 390 px no habrá desplazamiento horizontal del documento ni del scroll
principal de Ionic. Textos largos, IDs y JSON deben ajustarse o desplazarse dentro
de su área, sin ensanchar la página.

Ejemplo de convención existente que debe conservarse:

```ts
private readonly requests = inject(ArcaRequestService);
list() {
  return this.requests.request<DockerContainers>('DOCKER_CONTAINERS_LIST');
}
```

Usar servicios tipados, signals y plantillas Angular, interpolación segura y
funciones sencillas de presentación; evitar nuevos buses, registries o gestores
genéricos de estado.

## 9. Backlog, pruebas y entrega

Los números son globales: el número de cada ítem Backlog y `Requires: #N`
identifican historias de esta tabla, aunque estén en archivos distintos.
Cada agente debe leer también los apartados transversales §1–§8.

| Historia | Archivo                                              | Aceptación adicional a las reglas transversales                         |
| -------- | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| #1       | [Panel compartido](01-shared-side-panel.md)          | §6 #1; host ajeno a Docker, cierre/foco, móvil y temas.                 |
| #2       | [Tabs](02-docker-tabs.md)                            | §7 #2; URLs directas, reentrada, estado, mixin y regresión System.      |
| #3       | [Indicadores](03-inventory-indicators.md)            | §4–§5; total API distinto de longitud, cero y lectura ausente.          |
| #4       | [Versión](04-compose-version.md)                     | §5–§6 #4; refresco independiente, fallo y JSON sin nueva petición.      |
| #5       | [Proyectos](05-project-cards.md)                     | §4–§5; cero proyectos, vacío de servicios, totales y barra con cero.    |
| #6       | [Servicios](06-service-accordion.md)                 | §5; abrir/cerrar, primer servicio, null y expansión tras refresco.      |
| #7       | [Inventario](07-container-inventory.md)              | §4–§5; asociaciones ausentes/ambiguas, columnas y móvil.                |
| #8       | [Búsqueda](08-container-search.md)                   | §5; campos, trim, mayúsculas, combinación y cero coincidencias.         |
| #9       | [Filtro](09-activity-filter.md)                      | §5; online independiente del status, contador y combinación.            |
| #10      | [Inspector de contenedor](10-container-inspector.md) | §6 #10; todos los orígenes, sin endpoint, desaparición y copia antigua. |
| #11      | [Inspector de proyecto](11-project-inspector.md)     | §6 #11; canal ocupado, cambio de contenido y respuesta tardía.          |
| #12      | [JSON](12-inventory-json.md)                         | §6 #12; respuesta completa, campos extra, cero y precisión limitada.    |
| #13      | [Arrancar](13-container-start.md)                    | §7; online, guard de preparación, ID y doble clic.                      |
| #14      | [Parar](14-container-stop.md)                        | §7; online, instantánea, cancelación, foco y fallo de refresco.         |
| #15      | [Reiniciar](15-container-restart.md)                 | §7; confirmación e incertidumbre sin reenvío.                           |
| #16      | [Eliminar](16-container-delete.md)                   | §7; advertencia, desaparición, foco fallback y resultados tardíos.      |

Implementar en orden numérico, una historia autorizada por vez. Ninguna entrega
intermedia puede retirar operaciones existentes: #2 distribuye las secciones
actuales entre tabs conservando sus controles y detalles hasta reemplazarlos.
#7 conserva los cuatro controles de escritura y su lógica actual en el inventario;
#10 añade inspección sin retirar esa superficie operativa. #13 extrae los controles
compartidos conservando las cuatro operaciones existentes e incorpora Arrancar al
inspector; #14–#16 migran las restantes al inspector, una por historia. No dejar
botones sin funcionalidad ni eliminar pruebas para permitir una transición parcial.

Pruebas unitarias e integración junto al código; ampliar las existentes sin
debilitar verificaciones. Conservar los ocho contratos ARCA, CSRF, codificación,
null/futuros, precisión, error inicial, datos anteriores, canal ocupado,
confirmaciones, incertidumbre y respuestas de sesión antigua.

Playwright con toda API interceptada antes de navegar: las dos tabs, acceso
directo, atrás/adelante, recarga, reentrada Ionic, filtros combinados, servicios,
cuatro contenidos del panel, sustitución proyecto -> contenedor, Escape/fondo,
foco, confirmación sobre panel, estado tras operaciones y caducidad de sesión.
Matriz de siete temas en 1440×1000 y 390×844; comprobar además transiciones de
layout en 767/768 y 1099/1100 px. Probar cambio de tema y movimiento reducido.
Registrar errores de consola y comprobar overflow también dentro de ion-content.
Los fixtures deben incluir estados distintos de exited, servicios sin nombre,
contenedores sin Compose, fuentes discordantes y valores adicionales.

Comandos desde `kida-console/frontend`, con Node de `.nvmrc`:

```bash
pnpm exec ng test --watch=false
pnpm exec ng build --configuration production
pnpm exec ng serve --port 4227
```

En otra terminal, con instalaciones existentes de Playwright y Chrome:

```bash
PLAYWRIGHT_MODULE=/ruta/existente/node_modules/playwright \
CHROMIUM_PATH=/ruta/existente/chrome \
node src/app/pages/docker/docker.browser.cjs
```

Mantener presupuestos existentes, no aumentarlos para conseguir build verde.
Evidencias en /tmp; no versionar artefactos. La prueba simulada no acredita Docker
real. No ejecutar daemon, backend ni operaciones reales para esta aceptación.

Para esta entrega exclusivamente documental: comprobar enlaces relativos,
numeración, dependencias, template, trazabilidad y whitespace (también archivos
nuevos). No es necesario ejecutar tests/build de la app sin cambios de código.
Revisión independiente de spec e historias antes de entregar; la futura revisión
de cada implementación no queda sustituida por esta revisión documental.
