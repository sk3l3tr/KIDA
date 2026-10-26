# Verificación de Backups: bloque 5, Informes

Fecha: 26 de octubre de 2026. Node 24.15.0 (`.nvmrc`), Playwright 1.59.1 y
Chromium existente. Toda la API, incluida autenticación, se simula antes de navegar.
La validación humana está pendiente; no se verifican operaciones reales de CORE.

## Contratos y comportamiento

| Canal ARCA | Método y ruta relativa a `/api/backup` | Entrada | Respuesta |
| --- | --- | --- | --- |
| `BACKUP_HEALTH_REPORT_LIST` | GET `/health/reports` | Ninguna | Array raíz de IDs |
| `BACKUP_HEALTH_REPORT_GET` | GET `/health/reports/get?run_id=…` | ID con `encodeURIComponent` | `{run_id,markdown}` |
| `BACKUP_HEALTH_REPORT_DELETE` | POST `/health/reports/delete` | `{run_id}` | `{run_id,deleted}` |

Canales `REQUEST/RESPONSE/ERROR` independientes, `useLoader: false`, transporte
`ArcaRequestService` cookie/CSRF existente y respuestas abiertas. No hay cambios
de backend, CORE, CLI, dependencias, vendor ni presupuestos de compilación.

La sección carga al entrar y permite actualizar manualmente, sin sondeo.
Consulta y Markdown usan interpolación de texto seguro en `<pre>`, sin renderizar
HTML, conservando espacios y saltos. El JSON completo permite consultar campos
adicionales y nulos; conserva el aviso existente de precisión numérica limitada.
La presentación y su diálogo se cargan de forma diferida.

La confirmación congela el `run_id` antes de abrir. Cancelar/Escape no envía nada;
confirmar consume la instantánea una sola vez. Un fallo de apertura no despacha.
Se usan `.console-dialog` y los helpers existentes de foco y teclado. Confirmación,
lecturas y escritura participan en el bloqueo compartido de los tres paneles.

El resultado del borrado permanece independiente del detalle. Se expone
`deleted: false` sin afirmar eliminación; no hay cambios optimistas. Tras una
respuesta correcta se actualizan Informes y el historial/detalle seleccionado de
Health, incluido `report_status` y `report_path`. Los errores de actualización se
muestran separados de la escritura. Una lectura correcta limpia la selección si
el informe desapareció; una fallida conserva los datos marcados como antiguos.

Los avisos inciertos identifican acción y destino y persisten tras lecturas y
escrituras posteriores; no hay reenvío automático. Al salir o cambiar sesión se
limpian datos y confirmaciones, incluido el DOM cacheado, y se ignoran respuestas
obsoletas. El transporte conserva el drenaje de canales ocupados.

## Comprobaciones

- Suite Angular: **398 tests aprobados en 15 archivos**, incluidos 37 nuevos para
  Informes. Se conservan las pruebas anteriores. Cobertura de contratos exactos,
  cookie/CSRF, respuestas abiertas, texto literal, instantáneas, cancelación,
  duplicados, fallo de diálogo, foco/teclado, bloqueos cruzados, rechazo,
  incertidumbre persistente, canales ocupados y drenaje, respuestas tardías,
  limpieza de DOM cacheado y actualización del Health seleccionado.
- Build de producción: aprobado, **995,73 kB iniciales**, bajo el límite de error
  de 1 MB. Permanece el aviso existente de 500 kB; presupuestos intactos.
- Playwright Informes: **14/14 casos**, cinco POST por caso (70 simulados):
  `deleted: false` con fallo de actualización, rechazo CORE, timeout incierto,
  eliminación con fallo de actualización Health y segunda eliminación hasta vacío.
  Se comprueban texto remoto seguro, ID codificado/exacto, Cancelar/Escape,
  foco/teclado, bloqueos, persistencia de incertidumbre, navegación, sesión y
  ausencia de desbordamientos. Cero errores JavaScript de página.
- Regresiones Playwright: **Health 14/14**, once POST por caso (154 simulados);
  **Configuraciones 14/14**, cuatro POST por caso (56 simulados). Cero errores de
  página en ambas matrices. Las tres suites cubren escritorio 1440×1000 y móvil
  390×844, Professional/Neobrutalism/Sakura claro y oscuro, y Tokyo oscuro.
- Inspección visual de diálogos en escritorio claro y móvil oscuro: foco visible,
  texto remoto literal legible y controles sin desbordamiento. Las capturas
  reflejan el viewport y scroll Ionic, no una exportación completa de la página.

Logs: `/tmp/kida-reports-block5-tests.log`, `-build.log`, `-browser.log`,
`-health-browser.log` y `-config-browser.log`, con el mismo prefijo.
Resultados y capturas en `/tmp/kida-reports-block5-evidence`,
`/tmp/kida-reports-block5-health-regression` y
`/tmp/kida-reports-block5-config-regression`.

Revisión independiente cerrada sin hallazgos materiales pendientes, incluida la
comprobación final del diff, documentación y evidencias automatizadas y visuales.
Se reforzó la cobertura solicitada por el revisor con una prueba que selecciona
Health y comprueba la actualización de `report_status` y `report_path` tras borrar
un informe, manteniendo independiente la respuesta de eliminación.

## Repetir la validación simulada

Desde `kida-console/frontend`, con Node de `.nvmrc`:

```bash
pnpm exec ng test --watch=false
pnpm exec ng build --configuration production
pnpm exec ng serve --host 127.0.0.1 --port 4228

PLAYWRIGHT_MODULE=/ruta/existente/node_modules/playwright \
CHROMIUM_PATH=/ruta/existente/chrome \
BACKUPS_TEST_URL=http://127.0.0.1:4228 \
REPORTS_TEST_OUTPUT=/tmp/kida-reports-block5-evidence \
node src/app/pages/backups/reports.browser.cjs

PLAYWRIGHT_MODULE=/ruta/existente/node_modules/playwright \
CHROMIUM_PATH=/ruta/existente/chrome \
BACKUPS_TEST_URL=http://127.0.0.1:4228 \
HEALTH_TEST_OUTPUT=/tmp/kida-reports-block5-health-regression \
node src/app/pages/backups/health.browser.cjs

PLAYWRIGHT_MODULE=/ruta/existente/node_modules/playwright \
CHROMIUM_PATH=/ruta/existente/chrome \
BACKUPS_TEST_URL=http://127.0.0.1:4228 \
BACKUPS_TEST_OUTPUT=/tmp/kida-reports-block5-config-regression \
node src/app/pages/backups/backups.browser.cjs
```

Cada script guarda `results.json` con peticiones y PNG por tema/modo/viewport.
Las evidencias se mantienen en `/tmp`, sin versionar. pnpm y Chromium requieren
ejecución fuera del sandbox por las restricciones del entorno.

## Validación humana

Repetir los scripts y revisar capturas/peticiones: listado vacío, consulta de
Markdown como texto literal, ID exacto con caracteres especiales, diálogo abierto,
Cancelar/Escape, foco y teclado, eliminación confirmada, `deleted: false`, fallos de
actualización y aviso incierto persistente. Comprobar bloqueo de los tres paneles,
actualización de Health, navegación y caducidad de sesión en escritorio y móvil.

No se han ejecutado backups, Health, Docker ni eliminaciones reales de informes.
La revisión automatizada e independiente no sustituye esta validación humana.
Sin commit, push ni despliegue. El siguiente bloque es **6. Integración final**.
