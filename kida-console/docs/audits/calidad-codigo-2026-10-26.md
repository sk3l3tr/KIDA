# Auditoría y refactor conservador de KIDA Console — 2026-10-26

## Alcance y resultado

Se han aplicado exclusivamente las tres extracciones acordadas en Console: soporte
Python, foco de los diálogos Docker/Scheduler y presentación de errores. Se mantienen
API, textos, seguridad, transporte y comportamiento. No se han añadido dependencias,
controladores genéricos ni clases base de páginas. No se ha modificado CORE/CLI.

| Evidencia inicial | Cambio realizado y beneficio | Riesgo y límite de la abstracción |
| --- | --- | --- |
| `setUp` y `handle` idénticos en System, Docker, Scheduler y Backup | `backend/core_api_test_support.py`: `CoreApiTestCase`, sin métodos de prueba; una sola preparación autenticada y transporte CORE simulado | Recursos y estado nuevos en cada prueba. `addCleanup` conserva el orden inverso: HTTP simulado → TestClient/lifespan → directorio temporal. Fixtures y aserciones específicas siguen en sus suites. |
| Docker y Scheduler repetían los límites de Tab/Shift+Tab y el retorno tras render | `services/dialog-focus.ts`: `trapDialogFocus` y `restoreDialogFocus` | Se conservan la selección de botones y el disparador conectado/habilitado o encabezado alternativo. Cada página retiene apertura, cierre, snapshot, busy y comprobaciones de sesión/generación. El fallback se resuelve después del render. System mantiene su diálogo Ionic. |
| Tres adaptadores repetían el switch alrededor de `classifyCoreFailure` | `services/core-failure.ts`: `formatCoreFailure`, con `CoreFailureMessages` explícito en cada adaptador | No cambia el clasificador. Se conservan literalmente incertidumbre y validación por página. System sigue mostrando `Error: detalle` o el mensaje genérico en rechazos; Docker/Scheduler conservan `CORE rechazó la operación: ...`, incluido `sin detalles`. |

Las rutas y servicios existentes ya comparten `CoreClient` y `ArcaRequestService`.
No se justifica ampliar la abstracción a ejecución, rutas o ciclo de vida de páginas.

## Validación realizada

- Backend completo: **56 pruebas aprobadas**, con configuración CORS explícita:
  desde `kida-console/backend`,
  `KIDA_ALLOWED_ORIGINS=http://localhost:4200,http://127.0.0.1:4200 .venv/bin/python -m unittest discover -v`.
- Frontend completo con Node **24.15.0**: `ng test --watch=false`,
  **228 pruebas aprobadas en 12 archivos**. La referencia del plan era 216;
  se añaden 12 casos (9 de foco y 3 de mensajes por página).
- Los casos nuevos cubren límites de Tab/Shift+Tab, teclas ajenas y diálogos
  vacíos/ausentes; render Angular real con trigger conectado, removido,
  deshabilitado o nulo; guardas obsoletas y ausencia de fallback. Los mensajes
  exactos incluyen busy, incertidumbre, conexión, sesión, validación, errores
  genéricos y rechazos con detalle ausente, vacío o con marcado literal.
- `ng build` de producción aprobado. Aviso del presupuesto inicial: **986,38 kB**
  frente al umbral de aviso de 500 kB, por debajo del máximo de error de 1 MB.
  No se han cambiado presupuestos ni configuración.
- Playwright/Chromium: escenarios existentes `docker.browser.cjs` y
  `scheduler.browser.cjs` contra Angular aislado en `127.0.0.1:4230`, con todas
  las respuestas API simuladas: **14 combinaciones por suite, 28 aprobadas,
  cero errores**. Incluyen escritorio/móvil, temas, teclado, cancelación,
  doble confirmación, retorno de foco y cambio/caducidad de sesión.
- Revisión independiente del diff y comparación AST contra HEAD: todos los
  métodos originales Python, incluidas sus aserciones, son idénticos. Los
  cuerpos extraídos `setUp`/`handle` también son idénticos. System conserva
  9 tests; Docker 9; Scheduler 11; Backup 9. La base no añade tests descubribles.
  Las suites Auth, CORS y CoreSettings conservan los otros 18 casos.
- `git diff --check` aprobado; los archivos nuevos se comprueban también por
  separado. Revisión independiente final aprobada, sin hallazgos pendientes.

Evidencia local de esta ejecución (fuera del repositorio):
`/tmp/kida-backend-verified.log`, `/tmp/kida-angular-after.log`,
`/tmp/kida-build-after.log`, `/tmp/kida-refactor-docker/results.json` y
`/tmp/kida-refactor-scheduler/results.json`.

## Dependencias ambientales y límites

**CORS:** el plan de referencia registró dos fallos por orígenes configurados.
`test_cors.py` importa la aplicación global, cuyos Settings se obtienen del
entorno; no utiliza la configuración aislada del soporte nuevo. La suite completa
actual pasa con los dos orígenes de desarrollo documentados explícitos. Este lote
no modifica configuración, `.env`, middleware ni tests CORS.

**TestClient:** la suite emite `StarletteDeprecationWarning` por el uso de `httpx`
con `starlette.testclient`, recomendando `httpx2`. Se registra por separado;
no se cambian dependencias ni se oculta el aviso.

**Sandbox:** TestClient quedó bloqueado al iniciar bajo el sandbox de ejecución;
la validación Python se completó fuera de él. El servidor Angular y Chromium
se ejecutaron también con permisos para los recursos locales necesarios.

Las pruebas de navegador usan API simulada: no acreditan operaciones reales de
Docker, scheduler ni energía. No hubo commits, push ni despliegue.
