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
