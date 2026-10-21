# Backups via API

[Castellano](../../es/api/backups-management.md) · [Index](../000-index.md)

Send each object separately over [HTTP or socket](README.md).

## Create a configuration

Adapt paths to the server and prepare the destination before running:

```json
{
  "id": "create",
  "command": "backup.config.create",
  "params": {
    "name": "daily",
    "sources": ["/etc/hosts"],
    "targets": [{"path": "/mnt/backups"}]
  }
}
```

`name`, `sources` and `targets` are required. Send the configuration content;
`{"file":"path.toml"}` is not a supported creation format.
[Fields and defaults](../004-backups-management.md#create-and-run-backups) are shared by CLI and API.
`schedule` and lifecycle `params` accept any JSON.
The response returns the full configuration in `data`, including UUID `data.id`.

## List, run and delete

```json
{"id":"list","command":"backup.config.list","params":{}}
{"id":"run","command":"backup.run","params":{"name":"daily"}}
{"id":"delete","command":"backup.config.delete","params":{"name":"daily"}}
```

For running or deleting, supply exactly one of `id` or `name` inside `params`.
`backup.config.list` returns `data.backups`, an array of configurations; `backup.config.delete` returns the deleted configuration.
`backup.run` returns `data.state: "QUEUED"` and `data.execution_id`.
Save the ID to [check the result](../004-backups-management.md#check-a-run).

## Backup Health

Prepare the [definition and Compose](../004-backups-management.md#backup-health) on the server.
For a manual environment, create it and then use the returned `run_id`:

```json
{"id":"create","command":"backup.health.create","params":{"definition_path":"/srv/health/app.toml","mode":"MANUAL"}}
{"id":"start","command":"backup.health.start","params":{"run_id":"RUN_UUID"}}
{"id":"get","command":"backup.health.get","params":{"run_id":"RUN_UUID"}}
{"id":"list","command":"backup.health.list","params":{}}
{"id":"stop","command":"backup.health.stop","params":{"run_id":"RUN_UUID"}}
{"id":"delete","command":"backup.health.delete","params":{"run_id":"RUN_UUID"}}
```

For a fresh automatic check:

```json
{"id":"run","command":"backup.health.run","params":{"definition_path":"/srv/health/app.toml"}}
```

You can also create with `mode: "AUTOMATIC"` and start later. API modes use uppercase.
`definition_path` is read on the server, not the client. Run-specific commands require UUIDs.
Health rejects unknown parameters; `list` and `report.list` accept `{}` or `null`.

| Command | Response `data` |
| --- | --- |
| `create` | Execution record with `run_id` and `CREATED` state |
| `start`, `run` | `run_id`, `state` and admission `execution_id` |
| `get`, `stop`, `delete` | Execution record, including `state`, `diagnosis`, `cleanup` and `report_path` |
| `list` | Array of executions |

Query with `get` until diagnosis is complete. Interpret
[modes, results and cleanup](../004-backups-management.md#choose-a-mode-and-read-the-result) before deciding whether the test succeeded.

### Reports

```json
{"id":"reports","command":"backup.health.report.list","params":{}}
{"id":"report","command":"backup.health.report.get","params":{"run_id":"RUN_UUID"}}
{"id":"delete-report","command":"backup.health.report.delete","params":{"run_id":"RUN_UUID"}}
```

`report.list` returns available IDs; `report.get` returns `run_id` and `markdown`;
`report.delete` returns `run_id` and `deleted: true`.
For automation, schedule `backup.health.run` with `{"definition_path":"/srv/health/app.toml"}` through the [scheduler](task-scheduling.md).
