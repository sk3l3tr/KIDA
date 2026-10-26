# Verificación de Backups: bloque 2, Configuraciones

Este documento registra la entrega del bloque 2. La entrega actual, bloque 4,
está documentada en [health-operations.verification.md](health-operations.verification.md).

Fecha: 26 de octubre de 2026. Node 24.15.0 (`.nvmrc`), Playwright 1.59.1
con Chromium existente. Validación humana pendiente.

## Entrega y contratos

La vista `/backups` conserva su ruta, menú ARCA, `ion-content`, layout, paneles
y temas existentes. Incorpora listado, selección y detalles, formulario completo
de creación y confirmaciones para eliminar configuración y solicitar un backup.
Backup Health e Informes permanecen pendientes.

| Canal ARCA             | Método y ruta relativa a `environment.apiBaseUrl` | Entrada y respuesta                     |
| ---------------------- | ------------------------------------------------- | --------------------------------------- |
| `BACKUP_CONFIG_LIST`   | GET `/backup/config`                              | Sin entrada; `{backups:[...]}`          |
| `BACKUP_CONFIG_CREATE` | POST `/backup/config/create`                      | Configuración; devuelve `BackupJob`     |
| `BACKUP_CONFIG_DELETE` | POST `/backup/config/delete`                      | `{id}`; devuelve `BackupJob`            |
| `BACKUP_RUN`           | POST `/backup/run`                                | `{id}`; devuelve `{state,execution_id}` |

Cada operación registra `REQUEST/RESPONSE/ERROR`, con `useLoader: false`, y usa
exclusivamente `ArcaRequestService`. Los modelos de respuesta conservan campos
adicionales, nulos y estados futuros; los modelos de creación reflejan el contrato
actual del backend. No se modifican backend, CORE, CLI, dependencias ni vendor.

El formulario permite listas de orígenes/destinos, `required`, `filesystem_uuid`,
lifecycle pre/post con parámetros JSON, schedule JSON y retention con `max_age`,
`keep_last` y puntos protegidos. Compresión `tar_zstd`. Los campos anulables
ofrecen omitir/valor/null; las opciones inactivas no se envían. Los JSON rechazan
números no finitos, enteros inseguros y Unicode incompleto; `keep_last` admite
`0..4294967295`. Se conservan las cadenas sin normalización y CORE valida dominio.

Se reutilizan clasificación de errores, foco de diálogo y `ThemeIdentity`.
La página invalida consumidores por generación e identidad, conserva resultados
inciertos al refrescar, distingue éxito de escritura de error de actualización
y vacía señales y DOM de páginas cacheadas al salir o cambiar de sesión.

## Resultados

- Suite Angular: 277 tests aprobados en 13 archivos; 49 nuevos de Backups.
  Cubren contratos HTTP/ARCA, cookie/CSRF, cuerpos exactos, formulario mínimo y
  completo, nulos/omisiones, JSON y UInt32, campos futuros y precisión limitada.
  También carga/error/vacío/datos antiguos, selección desaparecida, cancelación,
  doble envío, fallo al abrir diálogo, foco/restauración, admisión, resultados
  inciertos persistentes, canal ocupado, salida/reentrada, cambios de sesión,
  respuestas tardías y limpieza del DOM de una vista desconectada de Ionic.
- Build de producción: aprobado con 987,52 kB iniciales, por debajo del límite
  de error de 1 MB. Mantiene el aviso existente de 500 kB; no se modifican
  presupuestos.
- Playwright: 14 casos aprobados en escritorio 1440×1000 y móvil 390×844,
  Professional, Neobrutalism y Sakura claro/oscuro, Tokyo oscuro. Las cuatro
  operaciones, formulario completo, JSON inválido, cuerpos exactos, CSRF, texto
  remoto seguro, nulos/futuros, precisión limitada, teclado/foco, confirmación y
  cancelación/Escape, cambio de tema con diálogo abierto, desbordamiento de
  documento/layout/scroll Ionic/diálogo, admisión con fallo de actualización,
  incertidumbre persistente, desaparición de selección, navegación/reentrada
  y limpieza del DOM tras sesión caducada. Sin errores JavaScript de página.
- Revisión independiente de código, pruebas, documentación y evidencias
  completada sin hallazgos materiales. Validación humana pendiente.

Durante Playwright se corrigió el foco inicial de confirmación manteniendo sus
botones renderizados antes de `showModal`, como Scheduler. La prueba de sesión
caducada detectó DOM retenido aunque las señales ya estaban vacías: se fuerza su
limpieza con `detectChanges` al resetear, excluyendo `ngOnDestroy`. El formulario
solo se renderiza con la vista activa, retirando también los controles NgModel
cacheados. Una regresión introduce texto real, desconecta la vista, cambia sesión
y verifica la ausencia de listado y formulario y su reentrada vacía.

## Repetir las comprobaciones

Desde `kida-console/frontend`, con Node de `.nvmrc`:

```bash
pnpm exec ng test --watch=false
pnpm exec ng build --configuration production
pnpm exec ng serve --host 127.0.0.1 --port 4227
```

En otra terminal, usando instalaciones existentes y sin añadir dependencias:

```bash
PLAYWRIGHT_MODULE=/ruta/existente/node_modules/playwright \
CHROMIUM_PATH=/ruta/existente/chrome \
node src/app/pages/backups/backups.browser.cjs
```

`BACKUPS_TEST_URL` permite cambiar `http://127.0.0.1:4227` y
`BACKUPS_TEST_OUTPUT` permite cambiar `/tmp/kida-backups-config-evidence`.
El script intercepta toda API antes de navegar, incluida la sesión. Los resultados
se guardan en `results.json` y las capturas por tema, modo y viewport como PNG.
Los archivos de evidencia no se versionan. pnpm y Chromium requirieron ejecución
fuera del sandbox por restricciones del entorno.

## Validación humana y siguiente bloque

Para verificar sin operar contra CORE, ejecutar primero el script de Playwright
y revisar sus capturas de página y diálogo para escritorio y móvil. Las cuatro
operaciones se simulan: el cuerpo completo de creación, los IDs de eliminación y
solicitud y sus resultados quedan registrados en `results.json`.

La validación manual de la interfaz autenticada puede revisar listado, detalle,
campos opcionales, temas y apertura/cancelación de confirmaciones. No confirmar
acciones ni enviar el formulario contra un CORE habitual como parte de esta
validación; las acciones manuales requieren un entorno de pruebas elegido por el
administrador. La aceptación real de CORE y los backups queda sin verificar.

Tras la validación humana, el siguiente bloque será **3. Health básico**:
historial, detalle y creación desde una definición del host CORE. No se ha iniciado.
Sin push ni despliegue de esta entrega.

## Entrega anterior

El bloque 1 (estructura) se entregó en `373783c`, con 228 tests y 14 casos visuales
simulados. Sus avisos de pendiente se conservan únicamente en Health e Informes;
este bloque sustituye el panel vacío de Configuraciones.
