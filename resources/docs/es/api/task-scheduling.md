# Programar tareas mediante API

[English](../../en/api/task-scheduling.md) · [Índice de documentación](../000-index.md)

## Crear

Envía cada ejemplo por separado mediante [HTTP o socket](README.md). Cada alta crea una programación distinta.
Los ejemplos programan `scheduler.list`, una consulta. Elige una fecha futura para `once`.

```json
{"id":"add-interval","command":"scheduler.add","params":{"command":"scheduler.list","params":{},"schedule":{"type":"interval","seconds":60}}}
{"id":"add-once","command":"scheduler.add","params":{"command":"scheduler.list","params":null,"schedule":{"type":"once","at":"2030-01-01T12:00:00Z"}}}
{"id":"add-cron","command":"scheduler.add","params":{"command":"scheduler.list","params":{},"schedule":{"type":"cron","expression":"30 2 * * *","timezone":"Europe/Madrid"}}}
```

Envía `command`, los `params` del comando y `schedule` directamente dentro del objeto `params` exterior.
Los parámetros del comando anidado son obligatorios y pueden ser cualquier valor JSON, incluido `null`.
La respuesta `OK` devuelve la definición guardada con UUID `data.id`, origen, regla y `next_enqueue_at`.
Guarda ese UUID; el ID exterior de petición es independiente. El alta siempre produce `USER`.

## Listar y eliminar

```json
{"id":"list-user","command":"scheduler.list","params":{}}
{"id":"list-internal","command":"scheduler.list","params":{"origin":"INTERNAL"}}
{"id":"list-all","command":"scheduler.list","params":{"origin":"ALL"}}
{"id":"delete","command":"scheduler.delete","params":{"id":"SCHEDULE_UUID"}}
```

Sustituye `SCHEDULE_UUID` por el ID creado. El listado usa `USER` por defecto con `{}` o `null`.
Los filtros del protocolo son mayúsculas: `USER`, `INTERNAL`, `ALL`. `data` es un array en orden almacenado,
`[]` sin coincidencias. Cada entrada contiene `id`, `origin`, `command`, `params`, `schedule`, `next_enqueue_at`.
`ALL` es un filtro, no un origen de entrada. El vencimiento está en UTC y puede quedar pasado esperando admisión.

El borrado devuelve la definición eliminada y evita futuros encolados. IDs inválidos, ausentes o `INTERNAL`
devuelven `ERROR`. Alta/borrado públicos no pueden sustituir el origen. No hay API de modificación ni cancelación de ejecuciones encoladas.

Consulta [reglas, cola, reinicios y actualizaciones](../005-task-scheduling.md) y la
[configuración](../configuration.md) antes de utilizar recurrencias.
