# Scheduling via API

[Castellano](../../es/api/task-scheduling.md) · [Documentation index](../000-index.md)

## Create

Submit each example independently using [HTTP or socket](README.md). Each add creates a distinct schedule.
These examples schedule the read-only `scheduler.list` command. Choose a future date for `once`.

```json
{"id":"add-interval","command":"scheduler.add","params":{"command":"scheduler.list","params":{},"schedule":{"type":"interval","seconds":60}}}
{"id":"add-once","command":"scheduler.add","params":{"command":"scheduler.list","params":null,"schedule":{"type":"once","at":"2030-01-01T12:00:00Z"}}}
{"id":"add-cron","command":"scheduler.add","params":{"command":"scheduler.list","params":{},"schedule":{"type":"cron","expression":"30 2 * * *","timezone":"Europe/Madrid"}}}
```

Send `command`, command `params` and `schedule` directly in the outer `params` object.
Nested command parameters are required and may be any JSON value, including `null`.
An `OK` response returns the saved definition with UUID `data.id`, origin, rule and `next_enqueue_at`.
Save that UUID; the outer request ID is unrelated to it. Adding always produces `USER`.

## List and delete

```json
{"id":"list-user","command":"scheduler.list","params":{}}
{"id":"list-internal","command":"scheduler.list","params":{"origin":"INTERNAL"}}
{"id":"list-all","command":"scheduler.list","params":{"origin":"ALL"}}
{"id":"delete","command":"scheduler.delete","params":{"id":"SCHEDULE_UUID"}}
```

Replace `SCHEDULE_UUID` with the created ID. List defaults to `USER` with `{}` or `null`.
Protocol filters are uppercase: `USER`, `INTERNAL`, `ALL`. The response `data` is an array in stored order,
empty `[]` when none match. Entries contain `id`, `origin`, `command`, `params`, `schedule`, `next_enqueue_at`.
`ALL` is a filter, not an entry origin. The pending time is UTC and may remain in the past while admission waits.

Deletion returns the removed definition and prevents future submissions. Invalid, absent or `INTERNAL` IDs
return `ERROR`. Public add/delete cannot override origin. No modify or queued-execution cancellation API exists.

See [rules, queue behavior, restart and upgrades](../005-task-scheduling.md) and
[configuration](../configuration.md) before using recurring schedules.
