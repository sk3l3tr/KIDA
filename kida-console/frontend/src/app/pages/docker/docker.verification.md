# Verificación de Docker

Fecha: 26 de octubre de 2026. Node 24.15.0 (`.nvmrc`), Angular 22,
ARCA 3.2.7, Ionic 8.8.19, Vitest 5.0.5 y Playwright 1.59.1 con Chromium existente.

## Resultados

- `pnpm exec ng test --watch=false`: 216 tests aprobados en 11 archivos;
  30 tests Docker. Incluyen los ocho contratos HTTP/ARCA, cuerpos exactos,
  cookie/CSRF, codificación de proyectos, nulos/futuros, errores iniciales y
  lecturas desactualizadas, precisión numérica, instantánea congelada,
  cancelación, doble clic, fallo al abrir diálogo, desaparición del proyecto,
  sesión, lecturas/escrituras tardías, canal ocupado e incertidumbre sin reenvío.
- `pnpm exec ng build --configuration production`: aprobado con los presupuestos
  existentes. Bundle inicial: 986,38 kB; mantiene el aviso de 500 kB y queda por
  debajo del límite de error de 1 MB. No se cambiaron límites ni dependencias.
- `docker.browser.cjs`: matriz de 14 casos, escritorio 1440×1000 y móvil 390×844,
  Professional, Neobrutalism y Sakura claro/oscuro, Tokyo oscuro. Comprueba ocho
  operaciones, cuerpos/CSRF/ID completo, codificación, contenido remoto como
  texto, cero/nulos/estado futuro, precisión limitada, confirmaciones,
  cancelación/Escape, teclado/foco y restauración tras eliminar el disparador,
  cambio de tema con diálogo abierto, éxito con fallo de actualización separado,
  incertidumbre sin reenvío, desaparición del proyecto, navegación con reentrada
  Ionic y expiración de sesión. Comprueba desbordamiento del documento,
  layout, scroll interno de Ionic y diálogo.
- Evidencias: `/tmp/kida-docker-evidence/results.json` y capturas por tema,
  modo y viewport, de página y diálogo. Ningún error JavaScript de página.
- Revisión independiente completada: se corrigió la distribución del encabezado
  en el grid y se añadieron pruebas de escrituras tardías; sin otros hallazgos
  materiales. Se amplió la comprobación de desbordamiento al scroll de Ionic.
- Revisión del diff y espacios en archivos modificados y nuevos completada.

## Historia #2: navegación por tabs (28 de octubre de 2026)

- Docker usa tabs Ionic y rutas hijas `/docker/projects` y `/docker/containers`;
  `/docker` redirige a proyectos. Las lecturas y el resultado se comparten entre
  tabs y se reinician al salir o cambiar de sesión.
- Pruebas Docker: 32 aprobadas. Playwright con API simulada: 14 combinaciones de
  tema y viewport aprobadas, sin eventos `pageerror`; incluye historial, acceso
  directo, recarga, reentrada y cancelación de confirmación al cambiar de tab.
- Corregidos los imports desactualizados de pruebas de System: la suite completa
  pasa con 479 pruebas. La compilación de producción conserva el aviso de presupuesto.
  El servidor registró errores de consola en Backups durante la reentrada con
  respuestas simuladas genéricas; el script solo recopila eventos `pageerror`.
- La regresión visual de las tabs System se comparó en Professional claro a
  360 px: las tres capturas coinciden píxel a píxel con el SCSS anterior. Se
  verificó además el indicador y movimiento reducido en 21 combinaciones de tema
  y ancho con API simulada. El recorrido completo de System en Playwright queda
  pendiente: falla una aserción del segmento de energía.
- La revisión independiente detectó y permitió corregir la restauración tardía
  del foco y los estilos del diálogo; sin otros hallazgos concretos.

## Repetir

Desde `kida-console/frontend`, con Node de `.nvmrc`:

```bash
pnpm exec ng test --watch=false
pnpm exec ng build --configuration production
pnpm exec ng serve --port 4227
```

En otra terminal, usar instalaciones existentes, sin añadir dependencias:

```bash
PLAYWRIGHT_MODULE=/ruta/existente/node_modules/playwright \
CHROMIUM_PATH=/ruta/existente/chrome \
node src/app/pages/docker/docker.browser.cjs
```

`DOCKER_TEST_URL` permite cambiar `http://localhost:4227`;
`DOCKER_TEST_OUTPUT` permite cambiar `/tmp/kida-docker-evidence`.
Todas las rutas `**/api/**` se interceptan antes de navegar, incluidas sesión y
CSRF. Los contenedores/proyectos son fixtures locales del script.

## Límites

Validación exclusivamente simulada: no se contactó con backend/CORE/Docker real
ni se ejecutaron acciones reales. Estos resultados no acreditan aceptación con
Docker real. jsdom simula `showModal`/`close`; Chromium comprueba el diálogo nativo.
No se verificaron otros navegadores ni dispositivos físicos. El almacén de pnpm,
el servidor y Chromium requirieron ejecución fuera del sandbox por restricciones
de archivos y sockets.

Solo cambian el frontal y su documentación; sin cambios de backend, CORE, CLI,
vendor, autenticación, transporte compartido ni dependencias. Sin commit, push o
despliegue.

## Historia #9: filtro de actividad (29 de octubre de 2026)

- Selector local Todos / En ejecución / Fuera de línea, basado en `online` y
  combinado mediante AND con la búsqueda. Conserva orden, indicadores, JSON y
  operaciones; persiste entre tabs/refrescos y se reinicia al salir/cambiar sesión.
- Node 24.15.0: suite Docker 44/44 aprobadas; suite global 488/490. Fallan
  la cabecera de Auth (` / Console`) y el texto de límite crítico de System
  (`100  C` frente a `100 C`), fuera de los archivos modificados. Ambos
  fallos se reproducen en la copia temporal sin los cambios de esta historia.
- Build de producción: falla el presupuesto inicial de 1 MB (exceso 22.28 kB).
  Una copia temporal sin los cambios de esta historia reproduce el mismo exceso;
  no se modifican presupuestos ni se amplía el alcance para corregirlo.
- Revisión independiente sin hallazgos; `git diff --check` correcto.
- Sin Playwright por instrucción expresa. Pendientes comprobaciones visuales,
  temas, responsive y accesibilidad real en navegador. Sin backend/Docker real.

## Historia #10: inspector de contenedor (29 de octubre de 2026)

- Inventario, servicios y la inspección existente de proyecto abren el mismo panel
  lateral que versión, sin peticiones nuevas. Selección por ID completo y origen;
  el contenido se resuelve desde la lectura actual, con carga/error/desactualización
  y aviso de desaparición. Cambiar tab, salir o cambiar sesión limpia la selección.
- Identificación/estado, ejecución, puertos, redes, operaciones y JSON interpretado;
  fechas UTC, null no disponible y fechas inválidas conservadas, incluyendo fechas
  imposibles que JavaScript normalizaría. Sin perder campos ni datos adicionales.
- Las cuatro operaciones siguen en inventario; el inspector informa disponibilidad
  según el mismo ID en inventario y bloqueos actuales. Su incorporación al panel
  corresponde a #13–#16. No se amplían contratos ni se inspecciona por HTTP.
- Node 24.15.0: 48/48 pruebas Docker aprobadas tras las correcciones. Suite global:
  492/494; persisten los mismos dos fallos preexistentes de Auth/System descritos
  en #9. Build de producción bloqueado por el mismo presupuesto inicial de 1 MB
  (exceso 22.28 kB); no se modifican presupuestos.
- Revisión independiente detectó normalización de fechas imposibles y orden
  JSON/operaciones: corregidos, con pruebas de regresión y suite Docker repetida.
- Sin Playwright por instrucción expresa. Foco real, overlays, temas y responsive
  en navegador pendientes; las pruebas de página proyectan contenido del panel
  mediante un host simulado. No se verifica Docker real.

## Historia #11: inspector de proyecto (29 de octubre de 2026)

- La inspección existente abre el panel compartido con nombre completo, totales
  de servicios/contenedores/actividad, aviso de observado, servicios, contenedores
  y JSON interpretado. El JSON de la lista completa sigue en la vista Proyectos.
- La lectura anterior solo se muestra para el mismo proyecto; se conservan
  carga, error y desactualización. Una lista correcta que elimina el proyecto
  limpia la selección de lectura y deja el aviso de indisponibilidad en el panel.
- Proyecto → contenedor sustituye contenido sin cerrar el panel ni añadir
  historial; conserva el origen de página para restaurar foco. El canal ocupado
  impide otra inspección y las respuestas tardías no reabren ni sustituyen el
  contenido visible. El refresco posterior a escritura tampoco abre el panel.
- Node 24.15.0: 57/57 pruebas Docker aprobadas. Suite global: 501/503, con los
  mismos dos fallos preexistentes de Auth/System documentados en #9. Producción
  sigue bloqueada por presupuesto inicial de 1 MB (exceso 22.28 kB), sin cambios
  de presupuestos, dependencias ni contratos. `git diff --check` correcto.
- Revisión independiente sin defectos pendientes. Se aplicó su recomendación
  de restaurar los spies de foco en finally. La prueba de sustitución simula
  activeElement y comprueba la petición de foco al disparador original: jsdom
  no enfocaba el botón dentro del fixture Ionic ni antes de abrir el panel.
- Sin Playwright por instrucción expresa. Validación real de foco, Escape/fondo,
  overlays, temas y responsive pendiente en navegador. Sin backend/Docker real.

## Historia #12: JSON del inventario (29 de octubre de 2026)

- «Ver JSON del inventario» sustituye el desplegable del pie y abre el panel
  compartido. Muestra directamente la respuesta completa con JsonPipe dentro
  de «JSON interpretado», sin peticiones, campos derivados ni filtros locales.
- Conserva campos adicionales, null, ceros y el aviso de precisión limitada.
  El panel sigue la lectura actual, muestra carga/error/desactualización y
  conserva la respuesta anterior cuando falla el refresco. Cerrar, cambiar
  contenido/tab, salir o cambiar sesión impide su reapertura por respuestas tardías.
- Node 24.15.0: 66/66 pruebas Docker aprobadas; suite global 510/512. Persisten
  los dos fallos preexistentes de Auth/System descritos en #9. Build de producción
  bloqueado por el mismo presupuesto inicial de 1 MB (exceso 22.28 kB).
  No se modificaron presupuestos, contratos, dependencias ni operaciones.
- Revisión independiente del código y pruebas sin hallazgos. Comprobación de
  whitespace correcta. Sin Playwright por instrucción expresa; foco real,
  Escape/fondo, overlays, temas y responsive pendientes en navegador. Las pruebas
  de página proyectan el contenido del panel mediante el host simulado existente.
  Sin backend ni Docker real.

## Historia #13: arrancar contenedor (29 de octubre de 2026)

- Controles compartidos en ContainerActions: las cuatro operaciones siguen en
  las filas, y el inspector incorpora únicamente Arrancar. Se conservan estilos
  compactos/adaptables y temas existentes, sin dependencias ni cambios de API.
- Botón y preparación comprueban los bloqueos comunes y el ID completo en el
  inventario actual. Arrancar se bloquea con online=true; estado, nombre y actividad
  de una copia Compose no autorizan la escritura. Sin confirmación para Arrancar,
  cambios optimistas ni reenvíos; se mantienen los refrescos y resultado compartido.
- El inspector muestra espera, error y resultado, incluso si el refresco elimina
  el destino. Cerrar o sustituir el panel durante la escritura no lo reabre ni
  reemplaza la selección. Las demás operaciones conservan sus confirmaciones.
- Node 24.15.0: 86/86 pruebas Docker aprobadas. Suite global: 529/532; persisten
  Auth (cabecera) y System (espaciado de temperatura), y aparece SystemFanRow
  (espera «Alarma: Desconocido»), coincidiendo con la eliminación de ese texto
  en la modificación ajena de system-fan-row.html presente durante esta historia.
  Ese archivo y sus pruebas no se modificaron como parte de #13.
- Producción sigue bloqueada por presupuesto inicial de 1 MB, exceso 22.28 kB;
  presupuesto intacto. Whitespace comprobado también en los archivos nuevos.
- Revisión independiente detectó pérdida del resultado al desaparecer el destino:
  corregida manteniendo los mensajes fuera de los controles condicionales, con
  regresiones de desaparición desde inventario y Compose. Segunda revisión sin
  hallazgos pendientes; pruebas Docker repetidas tras la corrección.
- Sin Playwright por instrucción expresa. Foco real, overlays, temas y responsive
  pendientes en navegador; pruebas de página con proyección simulada existente.
  Sin backend ni Docker real. Cambio ajeno de System preservado.
