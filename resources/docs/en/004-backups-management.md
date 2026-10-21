# Backups and Backup Health

[Castellano](../es/004-backups-management.md) · [Index](000-index.md)

## Create and run backups

A configuration defines what to copy and where to store it. Creating it does not run a backup.
Use the [CLI](cli/backups-management.md) or [API](api/backups-management.md) to create, list, run and delete configurations.
Deleting a configuration does not delete saved backups.

| Field | Use and default |
| --- | --- |
| `name` | Backup name, without path components |
| `sources` | Paths to copy on the server |
| `targets` | Destinations; each requires `path` |
| `targets[].required` | `true`: an unavailable or failed destination fails the backup |
| `targets[].filesystem_uuid` | Optional metadata; **does not verify disk identity** |
| `compression` | `tar_zstd`, the only supported format |
| `lifecycle` | Before and after steps; empty by default |
| `schedule` | Metadata only; use the [scheduler](005-task-scheduling.md) to automate |
| `retention` | Metadata only; **does not delete backups automatically** |

Use existing sources and prepared destination directories with free space and write access for the service.
Paths are checked when running, not when creating the configuration. Prefer absolute paths.
If the destination is a mounted disk, check the mount before running; `filesystem_uuid` does not protect it.
Destinations must support hard links to publish the files.

`retention` accepts `max_age` (text), `keep_last` (integer from 0 to 4294967295) and
`protected_restore_points` (list of strings, empty by default). Arrange backup cleanup separately.
[Health report retention](#reports-and-cleanup) is active and independent.

## Before and after steps

`lifecycle.pre_backup` and `lifecycle.post_backup` are lists of steps with `command` and JSON `params` (`null` by default).
Only `docker.container.stop`, `docker.container.start` and `docker.container.restart` are supported.
The first failure interrupts the before steps. All after steps are attempted, even if a before step or archiving fails.
If an after step fails, the backup is not distributed. A service interruption cannot guarantee these steps:
check your containers after a failure.

## Check a run

`Backup queued` or `state: QUEUED` confirms admission, not completion. Save the execution ID.
Read the service log and look for that ID:

```bash
sudo journalctl -u kida --since '10 minutes ago' --no-pager
```

`Execution completed: ID` indicates completion; `Execution failed: ID` indicates failure and its cause.
There is no backup progress or execution history command. Also check the file in the intended destinations:
`<name>-<UTC-date>-<artifact_id>.tar.zst`. An error may leave valid copies in some destinations.
Use Backup Health to test restoration.

## Backup Health

Health restores a registered backup and starts a separate Compose environment to check it.
It requires Docker and the Docker Compose plugin. There is no separate `backup restore` command.

### Prepare the definition

Save on the server, for example as `/srv/health/app.toml`:

```toml
id = "app-health"
name = "Application Backup Health"

[backup]
reference = "daily"
version = "latest"

[docker]
compose = "./docker-compose.health.yml"
```

All fields are required and non-empty; unknown fields are rejected.
Use a stable, unique ID. `reference` is the ID or unambiguous name of a configuration.
`version` accepts `latest` or a registered backup UUID. Older backups without a record are not imported.
`latest` selects the most recent registered backup; if it cannot be used, it does not fall back to an older version.

The Compose path is resolved relative to the definition. Adapt the
[Compose example](../../../kida-core/examples/backup-health/docker-compose.health.yml) to your application:
image, healthcheck and data paths. It is not ready to run without changes.
Use `${KIDA_RESTORE_DIR}` for restored data and `restart: "no"`.
Archive paths preserve the source without its leading `/`: `/srv/app/data` restores as `srv/app/data`.
**Do not mount production data:** Compose runs with the service's permissions and is not a sandbox.
Restoration verifies size and checksum; it rejects links and paths escaping the restore directory.

### Choose a mode and read the result

| Mode | Behavior |
| --- | --- |
| Manual | Keeps the environment available for inspection until stopped or expired: four hours from start by default |
| Automatic | Diagnoses, stops and cleans up the environment |

The Health ID identifies the environment; the execution ID identifies the admitted work.
Check the state, whether the diagnosis is complete, its anomalies and cleanup errors.

| Result | Meaning |
| --- | --- |
| `HEALTHY` | Healthchecks pass, with no detected incidents |
| `DEGRADED` | Healthchecks pass after detected restarts or memory incidents |
| `UNKNOWN` | Insufficient evidence, for example a missing or pending healthcheck |
| `UNHEALTHY` | A healthcheck reports failure |
| `FAILED` | Execution or required service failure |

An `OK` response does not guarantee a positive diagnosis. Even with `HEALTHY`, check that your application and data work as expected.

### Reports and cleanup

- `stop` stops the environment; `delete` also requests removal of its owned resources and restored data. Both keep history and reports.
- Shared, external or unproven resources are preserved. If cleanup fails, review the error and retry `delete` after correcting it.
- A stopped run cannot be restarted: create another. Restarting KIDA closes interrupted runs and attempts cleanup without resuming manual environments.
- Reports are kept for 90 days by default. Deleting a report does not delete the environment or history, and it is not rebuilt automatically. List reports to check availability.

See the [CLI commands](cli/backups-management.md#backup-health), [API commands](api/backups-management.md#backup-health)
and [timeout and limit configuration](configuration.md).
