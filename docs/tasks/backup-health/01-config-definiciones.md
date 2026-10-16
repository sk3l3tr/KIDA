# 01 · Configuración y definiciones

**Objetivo:** cargar la configuración global y una definición Health separada de `BackupJob`.

**Estado:** Verificada · 16/10/2026. Las tareas 02–11 siguen pendientes.

## Trabajo

- Extender `infrastructure/conf` con defaults y validación definidos en [contratos](contratos.md), incluida la separación de raíces y el límite de entornos.
- En `features/backup`, cargar el TOML local de CORE, validar campos y resolver Compose respecto al archivo de definición. Resolver la referencia mediante el repositorio de backups actual, rechazando ambigüedad.
- Materializar los tipos compartidos de definición, ejecución, artefacto resuelto, inventario/evidencias y resultado acordados. Mantenerlos pequeños y alineados con los modelos actuales; 06 posee su representación persistente.
- Documentar configuración y un ejemplo TOML/Compose con `KIDA_RESTORE_DIR` y `restart: "no"`.

## Frontera

Proporciona configuración validada, definición/rutas y tipos compartidos. Consume los acuerdos documentados y el repositorio actual. No registra copias, restaura, ejecuta Docker ni añade recarga dinámica. Los otros bloques usan fixtures de estos contratos durante su desarrollo aislado.

## Pruebas y cierre

Probar defaults y configuración explícita; campos ausentes/vacíos, números inválidos, raíces solapadas, TOML/Compose inexistentes, rutas relativas y referencia inexistente/ambigua. Confirmar que los servicios reciben una sola configuración inicializada.

Cierra cuando carga el ejemplo y rechaza configuraciones inválidas sin recursos ni efectos de ejecución. Actualizar estado y evidencias en el índice.

## Implementación

- Configuración global con defaults, validación al cargar/actualizar y separación de raíces, incluidos alias por symlink y componentes `..`, sin crear directorios.
- Cargador interno `health::definition::load`, tipos compartidos en `health::model` y resolución no ambigua por ID/nombre. Los comandos de backup existentes conservan su búsqueda actual.
- [Documentación y ejemplos](../../../kida-core/README.md#configuración-y-definiciones-de-backup-health). La validación de políticas Compose y la resolución real del artefacto quedan en sus tareas.
- Revisión del diff: sin nuevas dependencias ni cambios en protocolo, CLI, Docker, Scheduler o worker. La supresión de código aún no consumido se limita al nuevo módulo Health, probado y pendiente de integración.

## Validación realizada

Con `CARGO_TARGET_DIR=/tmp/kida-health-target`:

- `cargo test -p kida-core --locked health`: 15 correctas (14 nuevas de Health/configuración y una existente del Scheduler).
- `cargo test --workspace --locked --quiet`: 197 correctas, 13 ignoradas existentes, cero fallos. Ejecutado fuera del sandbox para permitir sockets locales; el primer intento restringido falló por permisos en cinco pruebas existentes de CLI.
- `cargo clippy --workspace --all-targets --locked -- -D warnings`: correcto.
- `cargo fmt --all -- --check`, comprobación de diff, archivos nuevos y enlaces documentales: correctos.

La prueba existente del singleton tenía un filtro de subproceso incorrecto y no ejecutaba su cuerpo. Se corrigió y se comprueba que ejecute exactamente un test. Ahora verifica también que Health usa la configuración publicada aunque se cambie o elimine el TOML global, sin recarga ni creación de recursos Health.
