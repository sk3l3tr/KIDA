# Programar tareas

[English](../en/005-task-scheduling.md) · [Índice](000-index.md)

Crea programaciones con la [CLI](cli/task-scheduling.md) o la [API](api/task-scheduling.md).
Cada alta crea una entrada nueva. Para cambiarla, elimina la anterior y crea otra.
Los parámetros y recursos del comando se comprueban al ejecutar: registrar no demuestra que la tarea vaya a completarse.

## Reglas

| Regla | Comportamiento |
| --- | --- |
| `once` | Fecha futura RFC3339 con zona explícita, por ejemplo `2030-01-01T12:00:00Z` |
| `interval` | Segundos positivos; primer intento un intervalo después del alta |
| `cron` | Cinco campos: minuto, hora, día del mes, mes y día de semana; zona IANA, `UTC` por defecto |

En cron, si ambos campos de día están restringidos, basta que coincida uno.
Las horas inexistentes por cambio horario se omiten; las repetidas se intentan una vez, en su primera aparición.
Los intervalos conservan su anclaje tras reinicios.

## Interpretar el listado

El listado muestra entradas de usuario (`USER`) por defecto. `INTERNAL` son tareas gestionadas por KIDA;
puedes consultarlas, pero no eliminarlas. `ALL` muestra ambas.
`Next enqueue attempt` / `next_enqueue_at` está en UTC e indica un intento pendiente, no la hora garantizada de ejecución.

Si hay saturación, el vencimiento queda pendiente y se reintenta. Las recurrencias mantienen un único vencimiento pendiente,
sin acumular todas las repeticiones omitidas. La concurrencia se ajusta en [configuración](configuration.md);
los backups se ejecutan de uno en uno. El orden de admisión no garantiza el de finalización.

## Borrado y reinicio

Eliminar evita futuros envíos, pero no cancela trabajo ya pendiente o ejecutándose.
Las programaciones se conservan al reiniciar; el trabajo ya admitido o interrumpido no se recupera.
Las entradas `once` vencidas que seguían pendientes al reiniciar se descartan.
No hay historial ni cancelación de ejecuciones; consulta el [registro del servicio](troubleshooting.md).

## Actualizar desde versiones anteriores

Actualiza CORE antes que CLI. Si se pierde una respuesta, lista antes de repetir un alta para evitar duplicados.
Conserva una copia del archivo de programaciones antes de actualizar: el campo `origin` guardado actualmente
no es compatible con versiones anteriores. No elimines el origen de las entradas internas.
Si el arranque indica una programación antigua con comando `health`, sustitúyela o elimínala del archivo indicado;
`system.health` es la consulta de sensores actual.

Receta: apagado semanal y encendido RTC con [CLI](cli/weekly-power-cycle.md) o [API](api/weekly-power-cycle.md).
