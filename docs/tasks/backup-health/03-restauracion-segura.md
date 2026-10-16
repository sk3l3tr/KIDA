# 03 · Restauración temporal segura

**Objetivo:** restaurar un artefacto verificado sin escribir fuera de un directorio nuevo y exclusivo.

## Trabajo

- Recibir un artefacto resuelto y el destino del run; verificar SHA-256 antes de extraer sin permitir sustitución del archivo entre comprobación y lectura.
- Reutilizar `tar` y `zstd` existentes, conservando la estructura relativa del backup actual.
- Rechazar destinos existentes, rutas absolutas, `..`, enlaces que permitan escapes y entradas especiales peligrosas. No seguir enlaces externos durante limpieza de un fallo parcial.
- Devolver ruta y procedencia del directorio creado, o error con evidencia de recursos parciales para la coordinación y recuperación posterior.

## Frontera

Posee extracción y comprobaciones de seguridad de archivos. Consume el contrato de artefacto mediante fixtures; no necesita un catálogo real para probarse. No selecciona versiones, gestiona Docker ni elimina datos originales. Consultar [contratos](contratos.md).

## Pruebas y cierre

Probar un `tar.zst` real generado con el formato actual; checksum incorrecto, archivo truncado, destino existente y contenido parcial. Incluir archivos centinela fuera del destino y archives con rutas absolutas, traversal, symlinks y hardlinks de escape.

Cierra cuando las restauraciones válidas funcionan y todos los casos adversos preservan los centinelas y datos originales. Registrar evidencia en el índice.

## Implementación

`health::restore::restore` verifica tamaño y SHA-256 y extrae desde el mismo descriptor abierto. Reserva un directorio nuevo, conserva la estructura relativa y permisos ordinarios; rechaza enlaces, entradas especiales, escapes y archivos duplicados. El productor actual desreferencia enlaces, por lo que no requiere admitirlos al restaurar.

Devuelve ruta canónica y dispositivo/inodo del directorio. Los errores incluyen esa procedencia si se creó un destino parcial; no borran ningún recurso. El padre debe existir y ser confiable. La coordinación, persistencia de la procedencia y limpieza posterior pertenecen a 06–08; esta tarea no implementa Docker ni ciclo de vida.

## Validación y revisión

- Pruebas focalizadas del extractor y una restauración con el productor real de backup; escritura en la copia restaurada sin alterar el original.
- Casos adversos: checksum/tamaño incorrectos, origen no regular o symlink, destino existente (incluido symlink colgante), rutas absolutas y `..`, enlaces, dispositivos/FIFO/sparse, duplicados, tar y zstd truncados, datos tras el terminador y nombres GNU largos. Los centinelas externos permanecen intactos.
- Prueba de sustitución del origen tras verificarlo: la extracción sigue leyendo el descriptor original. Dos restauraciones concurrentes no pueden reservar el mismo destino.
- `CARGO_TARGET_DIR=/tmp/kida-health-target cargo test -p kida-core --locked features::backup`: 56 correctas, 1 ignorada existente (fixture hija).
- `CARGO_TARGET_DIR=/tmp/kida-health-target cargo test --workspace --locked --quiet`: 222 correctas, 13 ignoradas existentes; ejecutado fuera del sandbox para permitir sockets.
- `cargo fmt --all -- --check`, `CARGO_TARGET_DIR=/tmp/kida-health-target cargo clippy --workspace --all-targets --locked -- -D warnings` y comprobaciones de diff, incluidos archivos nuevos: correctos. Sin dependencias nuevas ni cambios en `Cargo.lock`.
- Revisión independiente de `review_task03`: sin defectos accionables, OK explícito del código para commit. El revisor ejecutó las 12 pruebas de restauración (11 del extractor y 1 con el productor real), todas correctas.

Estado: **Verificada**.
