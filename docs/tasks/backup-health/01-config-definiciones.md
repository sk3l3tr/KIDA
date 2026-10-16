# 01 · Configuración y definiciones

**Objetivo:** cargar la configuración global y una definición Health separada de `BackupJob`.

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
