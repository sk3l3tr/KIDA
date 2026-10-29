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
