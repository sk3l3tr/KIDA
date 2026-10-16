# 08 · TTL, retención y arranque

**Objetivo:** cerrar ejecuciones abandonadas y mantener el almacenamiento sin perder prueba de propiedad.

## Trabajo

- Registrar/controlar exactamente dos jobs internos mediante las APIs actuales del Scheduler: expiración y retención, con cadencias y parámetros de [contratos](contratos.md). Evitar duplicados tras arranques sucesivos.
- Expirar manuales desde su inicio, y reintentar limpiezas pendientes en la misma pasada. Consumir las operaciones del servicio, sin otro scheduler ni lógica Docker duplicada.
- Al arrancar KIDA, conciliar registros/informes, cerrar ejecuciones previas e intentar limpiar sus recursos propios antes de admitir Health. No recuperar manuales aunque conserven TTL.
- Mantener los demás servicios disponibles si Docker falla; conservar anomalías y reservas por recursos inciertos para reintentar sin adoptar recursos ajenos.
- Eliminar historial e informes vencidos desde `finished_at`; preservar evidencias necesarias para recursos aún pendientes de limpieza.

## Frontera

Posee políticas temporales, registro de jobs e integración de arranque. Consume servicio de 07 y repositorios/conciliación de 06 mediante contratos y reloj controlado en tests. 09 conecta las acciones internas con ejecución protegida. No modifica el algoritmo del Scheduler, añade hooks del SO ni interpreta resultados técnicos.

## Pruebas y cierre

Probar borde exacto del TTL/retención, consultas sin renovación, informe ya borrado, ejecuciones interrumpidas, Docker caído y segundo arranque idempotente. Verificar dos jobs, parámetros de conf y rechazo administrativo real en el servicio, además de reintentos sin eliminar registros de propiedad pendientes.

Cierra cuando una ejecución anterior no se reanuda y todas las limpiezas fallidas quedan trazables y reintentables. Actualizar el índice.
