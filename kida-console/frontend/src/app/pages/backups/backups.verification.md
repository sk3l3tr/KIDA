# Backups: bloque 1, estructura

Fecha: 26 de octubre de 2026. Node 24.15.0, Playwright 1.59.1 y Chromium existente.

## Entrega

La ruta `/backups` conserva su componente y menú ARCA. La plantilla externa
presenta Configuraciones, Backup Health e Informes como secciones con nombre
accesible, descripción y aviso de funcionalidad pendiente. La cabecera explica
que todavía no se consultan datos ni se realizan operaciones.

Reutiliza `ion-content.console-content`, `.console-layout`, `.panel` y los tokens
globales Ionic/KIDA. No añade CSS, dependencias, modelos, servicios, acciones ARCA
ni interfaces públicas. No modifica backend, CORE, CLI ni la spec existente.

## Validación automatizada

- `pnpm exec ng test --watch=false`: 228 tests aprobados en 12 archivos;
  incluye las pruebas existentes de ruta protegida y menú.
- `pnpm exec ng build --configuration production`: aprobado. Bundle inicial
  986,38 kB, con el aviso existente de 500 kB, por debajo del límite de error
  de 1 MB. Sin cambios de presupuestos.
- Playwright: 14 casos aprobados, escritorio 1440×1000 y móvil 390×844,
  Professional, Neobrutalism y Sakura claro/oscuro, Tokyo oscuro.
  Navegación desde el menú ARCA, tres regiones accesibles y avisos de pendiente,
  identidad del tema y modo, dos columnas en escritorio y una en móvil,
  desplazamiento interno de Ionic en móvil y ausencia de desbordamiento
  horizontal del documento, layout y scroll de Ionic.
- Sin controles ficticios, solicitudes a `/api/backup` ni errores JavaScript
  de página. Toda API se interceptó antes de navegar, incluida la sesión.

Comandos desde `kida-console/frontend`, con Node de `.nvmrc`:

```bash
pnpm exec ng test --watch=false
pnpm exec ng build --configuration production
pnpm exec ng serve --host 127.0.0.1 --port 4227
```

El script temporal `/tmp/kida-backups-structure.cjs` usa instalaciones existentes
de Playwright y Chromium, sin añadir dependencias al proyecto:

```bash
node /tmp/kida-backups-structure.cjs
```

Resultados y capturas por tema y viewport:
`/tmp/kida-backups-structure-evidence/results.json` y PNG en el mismo directorio.
El script y las evidencias son temporales; no se versionan. El servidor y
Chromium requirieron ejecución fuera del sandbox por restricciones del entorno.

## Pendientes

Revisión independiente del código, documentación y evidencias completada sin
hallazgos materiales. Validación humana pendiente.
Para la comprobación visual, abrir `/backups` con una sesión válida, revisar las
tres secciones, cambiar los temas desde Settings y comprobar también el ancho
móvil. No hay operaciones de backups disponibles en este bloque.

La validación automatizada usa exclusivamente API simulada; no acredita
integración con CORE ni ejecución real de backups o Backup Health. Sin push
ni despliegue.

Tras la validación humana, el siguiente bloque será **2. Configuraciones**:
listado, detalle, creación, eliminación y solicitud de backup por ID, con sus
cuatro contratos. Este bloque 1 no incorpora ninguna de esas operaciones.
