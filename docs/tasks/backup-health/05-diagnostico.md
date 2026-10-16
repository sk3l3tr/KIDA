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
