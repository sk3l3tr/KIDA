# Verificación de Backups: bloque 4, Operaciones Health

Fecha: 26 de octubre de 2026. Node 24.15.0 (`.nvmrc`), Playwright 1.59.1
con Chromium existente. Validación exclusivamente con API simulada; aceptación
humana pendiente y operaciones reales sin verificar.

## Entrega y contratos

Se amplía Health básico con cuatro operaciones, sin cambios de backend, CORE,
CLI, dependencias ni presupuestos. Informes quedan para el bloque 5.

| Canal ARCA | POST relativo a `/api/backup` | Cuerpo | Respuesta |
| --- | --- | --- | --- |
| `BACKUP_HEALTH_START` | `/health/start` | `{run_id}` | `{run_id,state,execution_id}` |
| `BACKUP_HEALTH_RUN` | `/health/run` | `{definition_path}` | `{run_id,state,execution_id}` |
| `BACKUP_HEALTH_STOP` | `/health/stop` | `{run_id}` | Ejecución completa |
| `BACKUP_HEALTH_DELETE` | `/health/delete` | `{run_id}` | Ejecución completa |

Cada canal mantiene `REQUEST/RESPONSE/ERROR`, `useLoader: false` y el transporte
`ArcaRequestService` con cookie/CSRF. Se conservan respuestas abiertas, estados
futuros, nulos y rutas sin normalización. La admisión distingue `run_id` de
`execution_id` y no confirma inicio ni finalización.

El detalle permite iniciar, detener y eliminar sin filtrar por estados conocidos;
CORE decide su validez. El formulario separado «Ejecutar Health automático» tiene
su propia ruta y no envía modo. «Crear Health» conserva ruta/modo y comportamiento:
crear no inicia la ejecución, tampoco en modo AUTOMATIC.

## Confirmaciones, resultados y sesión

El diálogo local usa `.console-dialog` y los helpers compartidos de foco/teclado.
Antes de abrirlo se congela acción, nombre/`run_id` o ruta exacta. El destino se
muestra en texto con espacios conservados. Confirmar consume la instantánea una
vez; cancelar/Escape y un fallo al abrir no despachan peticiones.

Confirmación, lecturas y escrituras bloquean operaciones entre paneles. Creación
y las cuatro operaciones comparten el flujo de escritura Health. Tras éxito se
actualizan historial y detalle. Iniciar/ejecutar seleccionan el `run_id` devuelto;
detener/eliminar conservan el destino hasta que una lectura correcta confirme
su desaparición. La respuesta de escritura permanece independiente del detalle:
eliminar puede mostrar `cleanup`, errores, recursos y JSON completo aunque ya
no exista la selección. Esto no demuestra limpieza efectiva.

Los avisos inciertos incluyen acción y destino; persisten tras actualizaciones y
escrituras posteriores y no producen reenvíos automáticos. La ruta automática se
conserva al cancelar o fallar y solo se limpia tras respuesta de éxito. Al salir o
cambiar sesión se limpian formularios, datos y confirmaciones, incluido el DOM
cacheado; se ignoran respuestas obsoletas y se conserva el drenaje de canales ARCA.

La presentación y el diálogo permanecen en el componente Health diferido.

## Comprobaciones

- Suite Angular: **361 tests aprobados en 14 archivos**, 53 añadidos para el bloque 4. Se conservan las pruebas
  anteriores de Configuraciones y Health básico. Se amplían contratos/cuerpos,
  cookie/CSRF, canales independientes, respuestas abiertas, estados futuros,
  instantáneas, cancelación, doble envío, fallo de apertura, bloqueo, rechazo,
  incertidumbre persistente, canal ocupado, respuestas tardías, identidad/sesión,
  teclado/foco y limpieza de DOM cacheado con confirmación abierta.
- Build de producción: aprobado, **995,45 kB iniciales**, por debajo del límite
  de error de 1 MB. Se mantiene el aviso existente de 500 kB; presupuestos intactos.
- Playwright Health: **14 casos aprobados**, sin errores JavaScript de página. Toda API se intercepta
  antes de navegar, incluida autenticación. Se verifican los siete contratos Health,
  ambos modos de creación y las cuatro operaciones nuevas. Once POST simulados por
  caso: cinco creaciones, inicio, ejecución, ejecución rechazada, ejecución incierta,
  parada y eliminación. Se revisan destinos exactos/CSRF, dos identificadores,
  estados futuros, foco/teclado, cancelar/Escape, bloqueo entre paneles, cleanup tras
  desaparición, avisos persistentes, navegación, sesión caducada, texto seguro y
  ausencia de desbordamiento. Capturas de detalle, formularios y ambos diálogos.
- Regresión Playwright de Configuraciones: **14 casos aprobados**, sin errores
  JavaScript de página; cuatro POST simulados por caso. Se conservan sus cuatro
  operaciones y las regresiones existentes.

Ambas matrices cubren escritorio 1440×1000 y móvil 390×844, Professional,
Neobrutalism y Sakura claro/oscuro y Tokyo oscuro: 14 casos por script.
Las capturas reflejan viewport y scroll Ionic, no una exportación completa.

## Repetir la validación simulada

Desde `kida-console/frontend`, con Node de `.nvmrc`:

```bash
pnpm exec ng test --watch=false
pnpm exec ng build --configuration production
pnpm exec ng serve --host 127.0.0.1 --port 4228

PLAYWRIGHT_MODULE=/ruta/existente/node_modules/playwright \
CHROMIUM_PATH=/ruta/existente/chrome \
BACKUPS_TEST_URL=http://127.0.0.1:4228 \
HEALTH_TEST_OUTPUT=/tmp/kida-health-block4-evidence \
node src/app/pages/backups/health.browser.cjs

PLAYWRIGHT_MODULE=/ruta/existente/node_modules/playwright \
CHROMIUM_PATH=/ruta/existente/chrome \
BACKUPS_TEST_URL=http://127.0.0.1:4228 \
BACKUPS_TEST_OUTPUT=/tmp/kida-health-block4-config-regression \
node src/app/pages/backups/backups.browser.cjs
```

Las evidencias se guardan en los directorios indicados: `results.json` con
peticiones/cuerpos y PNG por tema/modo/viewport. No se versionan. pnpm y Chromium
requieren ejecución fuera del sandbox por restricciones del entorno. El puerto
4228 se utilizó porque 4227 ya estaba ocupado.

## Revisión y aceptación humana

La revisión independiente detectó dos casos corregidos: discriminar las respuestas
abiertas por operación, evitando interpretar `cleanup: null` adicional en una
admisión como ejecución completa; y mostrar rutas con espacios conservados en el
diálogo. Las pruebas incluyen admisión con `cleanup: null` y ruta exacta visible.
Revisión independiente final de correcciones, documentación y evidencias cerrada
sin hallazgos materiales pendientes. Se revisaron también capturas de diálogo en
escritorio y móvil; foco visible, controles legibles y destino sin desbordamiento.

Para validación humana, repetir los scripts y revisar capturas y peticiones.
Comprobar las cuatro confirmaciones, ruta separada sin modo, admisión con dos IDs,
recursos/errores tras eliminación y avisos inciertos persistentes. Las operaciones
se simulan: no se han ejecutado backups, Health, Docker, restauraciones ni limpieza
reales. Esa aceptación permanece sin verificar. Sin commit, push ni despliegue.

El siguiente bloque es **5. Informes** y no se ha iniciado.
