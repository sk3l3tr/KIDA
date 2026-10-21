# Backups via API

[Castellano](../../es/api/backups-management.md) · [Documentation index](../000-index.md)

Use the [HTTP or socket envelope](README.md). The following request creates a backup configuration;
it does not run the backup. Adapt paths and lifecycle container names to the CORE server.
The old `{"file":"path.toml"}` creation payload is rejected: send the interpreted configuration in `params`.

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{
    "id": "create-backup",
    "command": "backup.config.create",
    "params": {
      "name": "daily",
      "sources": ["/etc/hosts"],
      "targets": [
        {"path": "../primary", "filesystem_uuid": "volume-id"},
        {"path": "./secondary", "required": false}
      ],
      "compression": "tar_zstd",
      "lifecycle": {
        "pre_backup": [{"command": "docker.container.stop", "params": {"container": "backup-source"}}],
        "post_backup": [{"command": "docker.container.start", "params": {"container": "backup-source"}}]
      },
      "schedule": {"custom": [null, 1]},
      "retention": {
        "max_age": "7d",
        "keep_last": 7,
        "protected_restore_points": ["point-a"]
      }
    }
  }'
```

## Configuration fields and behavior

`name`, `sources` and `targets` are required. Each target requires `path`; `required` defaults to `true`
and `filesystem_uuid` is optional. Compression defaults to `tar_zstd`, currently the supported format.
`lifecycle` is optional; `pre_backup` and `post_backup` default to empty lists. Each step requires
`command`; `params` accepts arbitrary JSON and defaults to `null`.

At execution, lifecycle supports only container stop/start/restart. Pre stops at the first failure;
post attempts every step sequentially, including after pre/archive creation errors. Post errors include
one-based position, command and cause. The original failure remains primary when recovery also fails.
A post failure prevents checksum and replication. Cancellation/process termination cannot guarantee post execution;
archive temporary files remain owned by the blocking task that uses them.

`schedule` and `retention` are optional. `schedule` stores metadata only; use `scheduler.add` with `backup.run`.
Retention fields: optional string `max_age`, optional integer `keep_last` from 0 to 4294967295,
and string list `protected_restore_points`, default empty. Free JSON values are stored as JSON strings
in persisted TOML; existing job TOML remains readable and API JSON types are preserved.

`OK` returns the full job in `data`, including new UUID `data.id`. Source/target paths are preserved
literally; existence is checked during execution. CLI input modes send the same configuration contract.

## List, delete and execute

Supply exactly one selector, `id` or `name`, for deletion or execution. Replace example values.

```json
{"id":"jobs","command":"backup.config.list","params":{}}
{"id":"run","command":"backup.run","params":{"name":"daily"}}
{"id":"delete","command":"backup.config.delete","params":{"name":"daily"}}
```

Deleting the configuration is permanent. `backup.run` returns admission with `data.state = "QUEUED"`
and `data.execution_id`; it does not confirm a completed archive. A full or closed queue returns an error.

## Backup Health

Prepare the [definition and Compose](../004-backups-management.md#backup-health) on CORE.
Send each object separately. Replace `RUN_UUID` with the UUID returned by `create` or `run`.
API modes are uppercase; CLI modes are `manual` and `automatic`.

```json
{"id":"create-health","command":"backup.health.create","params":{"definition_path":"/srv/health/app.toml","mode":"MANUAL"}}
{"id":"start-health","command":"backup.health.start","params":{"run_id":"RUN_UUID"}}
{"id":"get-health","command":"backup.health.get","params":{"run_id":"RUN_UUID"}}
{"id":"list-health","command":"backup.health.list","params":{}}
{"id":"stop-health","command":"backup.health.stop","params":{"run_id":"RUN_UUID"}}
{"id":"delete-health","command":"backup.health.delete","params":{"run_id":"RUN_UUID"}}
```

For a new automatic run, use `backup.health.run` or create with `mode: "AUTOMATIC"`
and start the returned UUID:

```json
{"id":"run-health","command":"backup.health.run","params":{"definition_path":"/srv/health/app.toml"}}
```

`create` returns the execution in `CREATED`. `start` and `run` return `run_id`, `state` and
`execution_id` for asynchronous admission. `get`, `stop` and `delete` return the execution record;
`list` returns an array. Health parameters reject unknown fields. Run-specific commands require UUIDs.
`list` and `report.list` accept `{}` or `null`.

```json
{"id":"reports","command":"backup.health.report.list","params":{}}
{"id":"report","command":"backup.health.report.get","params":{"run_id":"RUN_UUID"}}
{"id":"delete-report","command":"backup.health.report.delete","params":{"run_id":"RUN_UUID"}}
```

`report.list` returns available IDs. `report.get` returns `run_id` and `markdown`;
`report.delete` returns `run_id` and `deleted: true`, preserving history and preventing automatic reconstruction.
Review [operational state, diagnosis, cleanup, TTL and retention](../004-backups-management.md#backup-health):
`OK` can contain a technical failure or incomplete cleanup. `stop` and `delete` differ.
The definition is read on CORE and Compose is resolved relative to it, never to the client.

To automate Health, schedule `backup.health.run` with
`{"definition_path":"/srv/health/app.toml"}` through the [scheduler](task-scheduling.md).
