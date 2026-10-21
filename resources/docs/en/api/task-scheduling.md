# Scheduling via API

[Castellano](../../es/api/task-scheduling.md) · [Index](../000-index.md)

Send each object separately over [HTTP or socket](README.md).

## Create

These examples schedule a query. Choose one alternative and replace the `once` date with a future one:

```json
{"id":"interval","command":"scheduler.add","params":{"command":"scheduler.list","params":{},"schedule":{"type":"interval","seconds":60}}}
{"id":"once","command":"scheduler.add","params":{"command":"scheduler.list","params":null,"schedule":{"type":"once","at":"2030-01-01T12:00:00Z"}}}
{"id":"cron","command":"scheduler.add","params":{"command":"scheduler.list","params":{},"schedule":{"type":"cron","expression":"30 2 * * *","timezone":"Europe/Madrid"}}}
```

`command`, `params` and `schedule` are required fields inside the outer `params`.
The nested command's `params` accept any JSON, including `null`.
The response returns the saved definition in `data`; keep its UUID `data.id`.
The outer ID only correlates request and response.

## List and delete

```json
{"id":"user","command":"scheduler.list","params":{}}
{"id":"internal","command":"scheduler.list","params":{"origin":"INTERNAL"}}
{"id":"all","command":"scheduler.list","params":{"origin":"ALL"}}
{"id":"delete","command":"scheduler.delete","params":{"id":"SCHEDULE_UUID"}}
```

API filters are `USER` (default with `{}` or `null`), `INTERNAL` and `ALL`.
Listing returns an array, empty if there are no entries. Each contains
`id`, `origin`, `command`, `params`, `schedule` and `next_enqueue_at`.
Deletion returns the deleted definition; replace `SCHEDULE_UUID` with its ID.

See [rules, timing, deletion and restart](../005-task-scheduling.md).
