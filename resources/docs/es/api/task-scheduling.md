# Programar tareas mediante API

[English](../../en/api/task-scheduling.md) · [Índice](../000-index.md)

Envía cada objeto por separado mediante [HTTP o socket](README.md).

## Crear

Los ejemplos programan una consulta. Elige una sola alternativa y adapta la fecha de `once` a una futura:

```json
{"id":"interval","command":"scheduler.add","params":{"command":"scheduler.list","params":{},"schedule":{"type":"interval","seconds":60}}}
{"id":"once","command":"scheduler.add","params":{"command":"scheduler.list","params":null,"schedule":{"type":"once","at":"2030-01-01T12:00:00Z"}}}
{"id":"cron","command":"scheduler.add","params":{"command":"scheduler.list","params":{},"schedule":{"type":"cron","expression":"30 2 * * *","timezone":"Europe/Madrid"}}}
```

`command`, `params` y `schedule` son campos obligatorios dentro del `params` exterior.
Los `params` del comando anidado admiten cualquier JSON, incluido `null`.
La respuesta devuelve la definición guardada en `data`; conserva su UUID `data.id`.
El ID exterior solo relaciona petición y respuesta.

## Listar y eliminar

```json
{"id":"user","command":"scheduler.list","params":{}}
{"id":"internal","command":"scheduler.list","params":{"origin":"INTERNAL"}}
{"id":"all","command":"scheduler.list","params":{"origin":"ALL"}}
{"id":"delete","command":"scheduler.delete","params":{"id":"SCHEDULE_UUID"}}
```

Los filtros API son `USER` (predeterminado con `{}` o `null`), `INTERNAL` y `ALL`.
El listado devuelve un array, vacío si no hay entradas. Cada una contiene
`id`, `origin`, `command`, `params`, `schedule` y `next_enqueue_at`.
El borrado devuelve la definición eliminada; sustituye `SCHEDULE_UUID` por su ID.

Consulta [reglas, horarios, borrado y reinicio](../005-task-scheduling.md).
