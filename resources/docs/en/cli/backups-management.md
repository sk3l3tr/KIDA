# Backups via CLI

[Castellano](../../es/cli/backups-management.md) · [Index](../000-index.md)

## Create a configuration

Prepare a destination on the server, for example `/mnt/backups`, with free space and write permissions for KIDA.
If it is on a separate disk, check its mount first. Run one of these alternatives:

```bash
kida backup config create --name daily --source /etc/hosts --target /mnt/backups
kida backup config create --file ./backup-job.toml
kida backup config create
```

The last opens the assistant and requires an interactive terminal; Ctrl+C or end of input cancels.
File and options are mutually exclusive. Options require `--name`, at least one `--source` and one `--target`.
`-f` is an alias for `--file`. TOML is read locally:

```toml
name = "daily"
sources = ["/etc/hosts"]

[[targets]]
path = "/mnt/backups"
```

See [fields, defaults and limitations](../004-backups-management.md#create-and-run-backups).

### Additional options

Repeat `--source` and `--target` to add paths. Modifiers use `INDEX=VALUE`, with zero-based indices:

```bash
kida backup config create --name daily \
  --source /srv/app --target /mnt/backups --target /mnt/secondary \
  --target-required '1=false' \
  --pre-backup docker.container.stop --pre-backup-params '0={"container":"app"}' \
  --post-backup docker.container.start --post-backup-params '0={"container":"app"}'
```

Adapt paths and the container before running. `--pre-backup` and `--post-backup` can be repeated;
their `--pre-backup-params` and `--post-backup-params` modifiers accept JSON.
Duplicate or out-of-range indices are rejected.

Also supported: `--compression tar_zstd`, `--target-filesystem-uuid INDEX=TEXT`, `--schedule JSON`,
`--retention-max-age TEXT`, `--retention-keep-last NUMBER` and repeatable `--retention-protected-restore-point TEXT`.
Schedule, retention and UUID fields are metadata: review their limitations in the linked guide.

## List and run

```bash
kida backup config list
kida backup run --name daily
```

You can also use `--id BACKUP_UUID` instead of `--name`. Running returns `Backup queued (Execution ID: …)`.
Save that ID and [check completion](../004-backups-management.md#check-a-run).
For automation, [schedule `backup.run`](task-scheduling.md).

## Delete a configuration

```bash
kida backup config delete --name daily
# Alternative by ID:
kida backup config delete --id BACKUP_UUID
```

Choose one selector. Check the name or ID: deleting the configuration is permanent.

## Backup Health

First prepare the [definition and Compose](../004-backups-management.md#backup-health).
`--file` points to the definition **on the server**. Replace `RUN_UUID` with the returned Health ID.

### Manual environment

```bash
kida backup health create --file /srv/health/app.toml --mode manual
kida backup health start --run-id RUN_UUID
kida backup health get --run-id RUN_UUID
```

Query with `get` until diagnosis is available. To end inspection:

```bash
kida backup health stop --run-id RUN_UUID
kida backup health delete --run-id RUN_UUID
```

### Automatic check

```bash
kida backup health run --file /srv/health/app.toml
kida backup health list
kida backup health get --run-id RUN_UUID
```

Alternatively, `create --mode automatic` followed by `start` separates creation and startup.
To automate a fresh check at each occurrence:

```bash
kida scheduler add --command backup.health.run \
  --params '{"definition_path":"/srv/health/app.toml"}' \
  --cron '30 2 * * *' --timezone Europe/Madrid
```

### Reports

```bash
kida backup health report list
kida backup health report get --run-id RUN_UUID
kida backup health report delete --run-id RUN_UUID
```

`report get` prints the Markdown report. `report delete` removes it; only run it if you want to delete it.
See [modes, results and cleanup](../004-backups-management.md#choose-a-mode-and-read-the-result) to interpret output.
