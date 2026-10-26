# Verificación de Backups: bloque 3, Health básico

Registro histórico del bloque 3. La entrega actual del bloque 4 está en
[health-operations.verification.md](health-operations.verification.md).

Fecha: 26 de octubre de 2026. Node 24.15.0 (`.nvmrc`), Playwright 1.59.1
con Chromium existente. Validación humana pendiente.

## Entrega y contratos

La sección Backup Health de `/backups` incorpora historial, selección y detalle,
y creación desde una ruta del host CORE con modo `MANUAL` o `AUTOMATIC`.
**Crear no inicia la ejecución, tampoco en modo automático.** Este bloque no
incorpora start/run/stop/delete de Health ni operaciones de informes.

| Canal ARCA             | Método y ruta relativa a `environment.apiBaseUrl` | Entrada y respuesta                              |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------ |
| `BACKUP_HEALTH_LIST`   | GET `/backup/health`                              | Sin entrada; array raíz de `HealthHistoryRecord` |
| `BACKUP_HEALTH_GET`    | GET `/backup/health/get?run_id={run_id}`          | ID con `encodeURIComponent`; `HealthExecution`   |
| `BACKUP_HEALTH_CREATE` | POST `/backup/health/create`                      | `{definition_path,mode}`; `HealthExecution`      |

Se añaden exclusivamente esos contratos a las cuatro operaciones del bloque 2,
con `REQUEST/RESPONSE/ERROR`, `useLoader: false` y `ArcaRequestService`. Cookie y
CSRF siguen usando los interceptores existentes. La ruta se transmite intacta;
Console no abre, comprueba ni sube el fichero. Se valida modo y Unicode; CORE
valida las reglas de dominio.

`health.models.ts` refleja `backend/backup/health_models.py`. Se conservan campos
adicionales, estados futuros y null. `run_id` identifica Health y no una ejecución
de cola. El historial contiene la ejecución aplanada más `record_version`,
`restore_provenance` y `report_status`; esa procedencia se muestra separada del
resultado del endpoint de detalle. La UI muestra diagnóstico, anomalías,
evidencias/logs, artefacto, servicios, recursos registrados, proyecto, restauración
y cleanup. No se presupone que los recursos hayan sido eliminados. El diagnóstico
requiere validación funcional del administrador.

El componente `health.ts/html` consume un estado tipado local a la página en
`health-state.ts`. Backups controla entrada/salida, invalidación por sesión y el
bloqueo entre paneles. La presentación se carga mediante `@defer (on immediate)`
para respetar el presupuesto de producción; hay estados de carga/error del módulo.
Se reutilizan estilos, temas, errores y helpers de foco. El helper existente de
precisión se comparte en `backups-presentation.ts`, sin cambiar su comportamiento.

## Garantías comprobadas

- Carga al entrar y actualización manual, sin polling. Carga, vacío, error y
  última lectura se distinguen. Un fallo conserva historial y detalle previos,
  con su aviso de desactualización y fechas de lectura independientes.
- Selección por `run_id`; al cambiar selección se retira el detalle anterior.
  Una lectura correcta refresca su detalle o limpia una selección desaparecida.
- Creación sin confirmación adicional. Una escritura a la vez, coordinada con
  Configuraciones, también mientras hay una confirmación abierta. Los controles
  se bloquean durante lecturas/escrituras y no solapan canales ARCA.
- Tras crear correctamente, se limpia el formulario, se conserva la respuesta y
  se actualizan historial y detalle seleccionado. El éxito de creación se muestra
  separado de fallos posteriores de lectura. No se envía Health start/run.
- Ante rechazo o incertidumbre se conserva el formulario. Los avisos inciertos
  incluyen ruta y modo, persisten tras refrescar y tras escrituras posteriores,
  y no causan reenvíos automáticos. Listar no resuelve una creación incierta.
- Se limpian estado, selección y formularios al salir o cambiar de sesión,
  incluido DOM de páginas cacheadas y desconectadas de Ionic. Se ignoran
  respuestas tardías y se conserva el drenaje de canales del transporte existente.
- Textos remotos, logs y JSON se interpolan como texto seguro. Se advierte de
  precisión limitada para enteros inseguros, también en procedencia del historial.
- Foco restaurado después de creación exitosa, rechazada o incierta y sus lecturas
  dependientes; cancelación/Escape y teclado del diálogo existente se conservan.

## Resultados

- Suite Angular: **308 tests aprobados en 14 archivos**, incluidos 31 nuevos de
  Health. Se mantienen las pruebas anteriores, actualizando las expectativas de
  registro de siete canales y la carga inicial del historial.
- Build de producción: **995,28 kB iniciales**, por debajo del límite de error
  de 1 MB. Mantiene el aviso existente de 500 kB; presupuestos intactos.
- Playwright Health: **14 casos aprobados**, escritorio 1440×1000 y móvil 390×844,
  Professional, Neobrutalism y Sakura claro/oscuro, Tokyo oscuro. API completa
  interceptada antes de navegar, incluida autenticación; cinco POST de creación
  simulados por caso. Verifica tres contratos, ambos modos, ruta exacta, CSRF,
  selección/codificación, texto seguro, estados futuros, limpieza/procedencia,
  desbordamiento con nombres largos, foco/teclado, bloqueo entre paneles,
  diálogo cancelado y cambio de tema con diálogo abierto, errores y datos
  anteriores, incertidumbre persistente, selección desaparecida, navegación y 401.
- Regresión Playwright Configuraciones: **14 casos aprobados** con API
  simulada; el historial Health se responde vacío para aislar las operaciones
  del bloque 2. Ambas matrices pasan con el código final, con cero errores
  JavaScript de página y 14 combinaciones únicas cada una.

La revisión independiente detectó que los nombres largos en `h4` necesitaban la
misma regla de wrapping que los demás textos; se amplió a `h4/h5`. También se
comprobó y añadió restauración de foco tras creación y el aviso de detalle antiguo
mientras se actualiza el historial. Se probaron las correcciones. La revisión
independiente final de código, pruebas, documentación y evidencias se cerró sin
hallazgos materiales pendientes. La validación humana sigue pendiente.

## Repetir las comprobaciones

Desde `kida-console/frontend`, con Node de `.nvmrc`:

```bash
pnpm exec ng test --watch=false
pnpm exec ng build --configuration production
pnpm exec ng serve --host 127.0.0.1 --port 4227
```

En otra terminal, con instalaciones existentes y sin añadir dependencias:

```bash
PLAYWRIGHT_MODULE=/ruta/existente/node_modules/playwright \
CHROMIUM_PATH=/ruta/existente/chrome \
node src/app/pages/backups/health.browser.cjs

PLAYWRIGHT_MODULE=/ruta/existente/node_modules/playwright \
CHROMIUM_PATH=/ruta/existente/chrome \
node src/app/pages/backups/backups.browser.cjs
```

`BACKUPS_TEST_URL` cambia la URL base. `HEALTH_TEST_OUTPUT` cambia el directorio
Health, por defecto `/tmp/kida-backups-health-evidence`. `BACKUPS_TEST_OUTPUT`
cambia el de Configuraciones, por defecto `/tmp/kida-backups-config-evidence`.
Ambos scripts guardan `results.json` y capturas por tema/modo/viewport. Las de
Health muestran detalle, formulario y diálogo; representan el viewport y scroll
Ionic elegidos, no una exportación completa del contenido. Las evidencias no se
versionan. pnpm y Chromium requirieron ejecución fuera del sandbox por restricciones
del entorno.

## Validación humana y siguiente bloque

Ejecutar los scripts y revisar sus capturas para validar sin operar contra CORE.
Comprobar historial y detalle, evidencias, recursos, procedencia, cleanup, formulario,
legibilidad móvil y temas. Revisar que crear en ambos modos solo envía
`/health/create` y que la UI no interpreta la creación como inicio.

Las acciones están simuladas: no enviar formularios ni confirmar operaciones
contra un CORE habitual para esta validación. La aceptación de CORE, Docker,
restauración y limpieza reales queda sin verificar.

Validación humana pendiente. Sin push ni despliegue de esta entrega.
El siguiente bloque, una vez validado este, es **4. Operaciones Health**:
start/run/stop/delete con confirmaciones. No se ha iniciado.
