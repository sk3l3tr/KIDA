# Verificación de Scheduler

Fecha: 26 de octubre de 2026. Entorno: Node 24.15.0, Angular 22.2.3,
ARCA 3.2.7, Ionic 8.8.19, Vitest 5.0.5 y Chromium local con Playwright.

## Resultados

- `pnpm exec ng test --watch=false`: 10 archivos, 186 tests aprobados;
  57 tests de Scheduler y 14 de clasificación compartida de errores, incluidos contratos HTTP/ARCA, CSRF, JSON, límites,
  modalidades, UTC, hueco y repetición DST en Europe/Madrid, datos futuros,
  filtros, contenido HTML como texto, confirmación congelada, cancelación,
  doble clic, sesiones, respuestas tardías, canales ocupados, incertidumbre
  y éxito de escritura con error separado de actualización.
- `pnpm exec ng build --configuration production`: aprobado. Advertencia del
  bundle inicial: 985,18 kB frente a 500 kB; por debajo del límite de error de 1 MB.
- `scheduler.browser.cjs`: 14 combinaciones aprobadas, sin errores de página:
  escritorio 1440×1000 y móvil 390×844 para Professional, Neobrutalism y Sakura
  en claro/oscuro, más Tokyo oscuro. Cubre crear, filtrar, borrar, HTML como texto,
  teclado, ciclo/restauración de foco al cancelar, Escape, ambas transiciones DST,
  conservación de datos desactualizados, éxito seguido de fallo de actualización,
  incertidumbre sin reintento y ausencia de desbordamiento horizontal. Tras el
  repaso de calidad también comprueba igualdad de estilos de input/select/textarea,
  recuperación si falla la apertura del diálogo en crear y borrar, foco tras crear
  y actualizar, y foco en la cabecera del listado tras borrar el botón original.
- Evidencia local: `/tmp/kida-scheduler-evidence/results.json` y 14 capturas PNG.
  El README del frontend explica cómo repetir el script usando instalaciones
  existentes de Playwright y Chromium, sin nuevas dependencias del proyecto.
- Revisión independiente final: sin defectos identificados. Se corrigieron la
  conversión del equivalente UTC para fechas existentes con offset y el ciclo
  de foco del diálogo; ambos quedaron verificados.
- `git diff --check` y comprobación equivalente de archivos nuevos: aprobados.

## Repaso de calidad

La revisión acordada separó tipos (`scheduler.models.ts`), preparación de cuerpos
y snapshots (`scheduler-form.ts`) y presentación (`scheduler-presentation.ts`).
System y Scheduler reutilizan `services/core-failure.ts` para clasificar fallos,
conservando sus mensajes particulares. No cambian sus peticiones ARCA ni el
adaptador compartido.

Los controles nativos reutilizan `theme/_controls.scss`; las clases optativas de
`theme/_components.scss` aportan estilos de controles y superficie del diálogo.
El layout queda local; el motor portable de temas permanece intacto. El fondo del
diálogo consume el token `--kida-overlay-backdrop`.

Se corrigió el bloqueo tras un error al abrir la confirmación. El foco tras una
escritura espera al resultado de la actualización del listado y tiene un destino
alternativo si desaparece el botón original. Las comprobaciones nuevas de jsdom
esperan la hidratación de Ionic y el renderizado de Angular, manteniendo los asserts
sobre el elemento enfocado. El comportamiento se verificó también con Chromium.
La revisión independiente final no identificó defectos pendientes.

## Validación del contenido preparado para commit

Se preparó únicamente Scheduler, sus extracciones compartidas y dependencias de
transporte. La implementación previa de la página System, su migración de Auth y
`.gitignore` quedaron fuera del commit. Se incluye el modelo de System que usa la
clasificación común de errores.

Una copia aislada del índice, usando las dependencias locales existentes, aprobó
159 tests en 9 archivos y la compilación de producción (bundle inicial: 981,46 kB,
con la misma advertencia de 500 kB). Los 186 tests anteriores corresponden al árbol
de trabajo completo, incluidas las pruebas de System todavía no incorporadas.
En esa copia pnpm avisó de que su instalación automática previa no podía sustituir
el enlace a node_modules; las pruebas y la compilación sí terminaron con código 0.
No se modificaron dependencias ni lockfiles.

## Límites

Todas las peticiones del navegador se interceptaron con respuestas simuladas
antes de navegar. No se crearon programaciones ni se ejecutaron comandos en
CORE real. Estos resultados no acreditan aceptación contra CORE real.

jsdom requiere una simulación local de `showModal`/`close`; Playwright verificó
el comportamiento del diálogo nativo. El conector de navegador no encontró su
Chrome configurado, por lo que se usó Playwright con Chromium ya instalado.
No se probaron Firefox, Safari ni dispositivos físicos. Los comandos de pnpm,
el servidor local y Chromium necesitaron ejecución fuera del sandbox por sus
restricciones de almacén y sockets.

Se conservaron los cambios locales previos al incorporar las extracciones
acordadas en estilos y documentación, y adaptar únicamente el clasificador de
System. No se cambió CORE, backend, vendor, autenticación, transporte ni dependencias.
No se hicieron commits, push ni despliegues.
