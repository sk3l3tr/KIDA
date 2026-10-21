# Programación de tareas

[English](../en/005-task-scheduling.md) · [Índice de documentación](000-index.md)

Las programaciones persisten definiciones de comandos y las envían a la cola compartida al vencer.
Se puede programar cualquier comando público registrado, incluidos los propios comandos del scheduler.
Los parámetros específicos y los recursos referenciados se validan al ejecutar, no al dar de alta.
Los metadatos `schedule` de una configuración de backup no crean ejecuciones.

## Reglas y validación

- `once`: fecha futura RFC3339 con desplazamiento explícito. Elige una fecha futura al adaptar ejemplos.
- `interval`: segundos positivos. El primer intento ocurre un intervalo después del alta; el anclaje original sobrevive a reinicios.
- `cron`: cinco campos (minuto, hora, día del mes, mes y día de la semana) y zona IANA, `UTC` por defecto.
  Si ambos campos de día están restringidos, basta que coincida uno. Las horas inexistentes se omiten;
  las repetidas se intentan una vez, en su primera aparición.

El alta siempre crea entradas `USER`. El listado usa `USER` por defecto y permite filtros `INTERNAL` y `ALL`.
Las entradas internas las gestiona CORE y no se pueden borrar públicamente. Los IDs deben ser válidos y corresponder
a entradas de usuario existentes. No hay comando de modificación: borrar y crear son operaciones independientes.
Borrar evita futuros encolados, sin cancelar peticiones en cola o ejecutándose. `next_enqueue_at` es un vencimiento
pendiente en UTC, no un inicio de ejecución garantizado.

## Comportamiento de cola y reinicio

Los comandos programados y backups manuales comparten FIFO y worker. La concurrencia se configura mediante
`queue.max_concurrent_jobs` (2 por defecto); `backup.run` se ejecuta de uno en uno. Pueden encolarse nuevos
vencimientos mientras hay trabajo anterior pendiente o ejecutándose. El orden de admisión no garantiza el de inicio ni finalización.

Se admite primero el vencimiento más antiguo entre ambos orígenes; los empates conservan el orden almacenado.
Una cola llena conserva el vencimiento y reintenta tras un segundo monotónico, sujeto al sondeo del temporizador.
Las recurrencias conservan un único vencimiento pendiente y después avanzan a una fecha futura manteniendo regla
y anclaje, sin recuperar cada repetición omitida. Una entrada `once` se elimina tras admitirse; las que siguen
pendientes y ya vencieron al reiniciar se descartan sin ejecutar.

No se recuperan peticiones en cola ni ejecuciones interrumpidas. La admisión no garantiza ejecución ni entrega
exactamente una vez. Solo se encolan comando y parámetros; los recursos se resuelven al ejecutar.
Un fallo de persistencia procesando vencimientos o una cola cerrada termina CORE con error.
El scheduler no ofrece historial, consulta de ejecuciones ni cancelación.

## Actualizaciones

Actualiza CORE antes que CLI. La CLI actual exige `origin` en las respuestas y puede informar de un fallo de
presentación aunque el alta/borrado se haya completado contra un CORE anterior. Consulta el listado antes de repetir un alta.
CORE lee archivos antiguos sin `origin` como `USER`, pero al guardar añade ese campo y los hace incompatibles
con el CORE anterior. Conserva respaldo si necesitas volver atrás; no retires el origen de entradas `INTERNAL`.

El comando histórico `health` está retirado; `system.health` es una consulta de sensores independiente.
Una programación pendiente guardada con `health` impide cargar el scheduler, identificando su UUID y comando
sin sobrescribir el archivo. Elimina o sustituye esa definición antes de arrancar.

## Elige tu interfaz

- [CONSOLE](console/task-scheduling.md) — aún no implementada.
- [CLI](cli/task-scheduling.md).
- [API directa](api/task-scheduling.md).

Receta de apagado semanal y encendido RTC con [CLI](cli/weekly-power-cycle.md) o [API](api/weekly-power-cycle.md).
Consulta la [configuración](configuration.md) para almacenamiento y permisos del scheduler.
