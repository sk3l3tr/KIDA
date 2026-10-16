# 05 · Diagnóstico técnico

**Objetivo:** producir un resultado técnico reproducible a partir de evidencias Docker.

## Trabajo

- Evaluar inventario esperado y observaciones por servicio/réplica, incluyendo ausencias y errores parciales de inspección.
- Implementar los cinco resultados y su prioridad acordada; acumular reinicios/OOM observados sin borrarlos al recuperarse el servicio.
- Esperar healthchecks hasta el timeout, con conclusión anticipada cuando exista evidencia definitiva. Sin comprobaciones suficientes, devolver `UNKNOWN`.
- Capturar evidencias acotadas, filtrar valores sensibles conocidos y omitir extractos que no puedan publicarse con seguridad. No interpretar semánticamente logs.

## Frontera

Posee evaluación y preparación segura de evidencias; consume inventario y diagnósticos Docker mediante fixtures. Devuelve resultado global/por servicio, motivos, incidencias y si la evaluación sigue pendiente. 07 coordina su ejecución y 06 lo presenta. No decide estados operativos ni limpia recursos. Ver [contratos](contratos.md).

## Pruebas y cierre

Cubrir los cinco resultados, todas sus prioridades, ausencia/pendiente/unhealthy de healthcheck, réplicas faltantes, exit cero inesperado, inspección incompleta, timeout e interrupción. Probar anomalías recuperadas, paradas solicitadas, límite total de logs y redacción de secretos conocidos.

Cierra cuando nunca informa `HEALTHY` por la sola presencia de procesos y conserva los motivos verificables de cada resultado. Actualizar el índice.

## Implementación

`health::diagnosis::DiagnosticSession` evalúa observaciones Docker frente al proyecto, servicios y réplicas esperados. `evaluate` distingue observación, timeout, interrupción y parada solicitada; `fail` registra fallos definitivos de preparación/restauración/Compose. Conserva fallos demostrados y memoria por servicio de reinicios/OOM, incluso al reemplazarse la réplica. Una enumeración completa permite declarar fallo por ausencia; una inspección parcial solo permite concluir lo demostrado.

`observe_until` comparte un deadline entre consultas y esperas, con observador inyectable para pruebas. `diagnose` consume el diagnóstico Docker existente. 07 debe mantener una sesión por ejecución, llamar la interrupción antes de inspeccionar servicios parados deliberadamente y persistir el diagnóstico; esta tarea no cambia estados operativos ni elimina recursos.

`EvidencePolicy` filtra valores literales conocidos antes de truncar. Logs deshabilitados por defecto; para publicarlos se exige autorización explícita del llamador y UTF-8 válido. Máximo 16 KiB por extracto, 64 KiB de logs por sesión, 128 evidencias y 128 anomalías visibles, con descripciones de 2 KiB. No interpreta contenido ni promete detectar secretos desconocidos. La memoria interna de incidencias por servicio sigue vigente aunque se llene el historial visible.

## Validación y revisión

Pruebas focalizadas: las 25 combinaciones de prioridad, cinco resultados, réplicas y healthchecks, ausencia frente a inspección parcial, exit cero, errores Docker, recuperación de OOM/reinicios, proyecto incorrecto, duplicados, inventario vacío, parada solicitada, interrupción, polling y timeout global. Logs con secretos conocidos, tamaño total acotado, publicación deshabilitada y UTF-8 inválido.

- `CARGO_TARGET_DIR=/tmp/kida-health-target cargo test -p kida-core --locked health::diagnosis`: 8 correctas.
- `CARGO_TARGET_DIR=/tmp/kida-health-target cargo test --workspace --locked --quiet`: 231 correctas, 14 ignoradas existentes; ejecución con soporte de sockets fuera del sandbox.
- Clippy estricto del workspace, formato y comprobación de diff: correctos. Sin dependencias nuevas.
- Revisor independiente `review_task05`: sin defectos accionables; ocho pruebas focalizadas y diff comprobados. Se conserva también un diagnóstico ya concluido al solicitar parada/interrumpir; una evaluación inconclusa mantiene `UNKNOWN`.

Estado: **Completa**. Commit de implementación: `3ad5cea`.
