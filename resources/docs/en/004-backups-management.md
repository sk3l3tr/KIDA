# Backup management

[Castellano](../es/004-backups-management.md) · [Documentation index](000-index.md)

## Jobs and execution

A job describes sources, targets, compression, lifecycle steps and optional schedule/retention metadata.
Create, list or delete jobs, then queue executions by ID or name. Deleting a job is permanent.
`backup.run` acceptance returns a queue execution ID; it does not confirm a completed archive.
The `schedule` field in a job is metadata: create a separate scheduler entry to automate execution.

Source and target paths retain their literal values and are checked by CORE at execution.
Compression is `tar_zstd`. Targets default to required. Backup lifecycle steps support only
`docker.container.stop`, `docker.container.start` and `docker.container.restart`.
Pre-backup stops at the first failure; post-backup attempts all steps even after pre/archive errors.
Post-backup failure prevents checksum calculation and replication. Process termination or cancellation
does not guarantee recovery steps. See the [configuration contract](api/backups-management.md).

## Backup Health

Health restores a registered artifact into a separate directory, starts its reviewed Compose environment,
collects a technical diagnosis and manages cleanup and reports. It is not a standalone `backup restore` command.

Prepare a definition on the CORE server, separate from the backup job:

```toml
id = "app-health"
name = "Application Backup Health"

[backup]
reference = "daily"
version = "latest"

[docker]
compose = "./docker-compose.health.yml"
```

All fields are required and nonempty. Use a unique, stable definition ID. `reference` selects an existing
job by unambiguous ID/name; `version` is `latest` or a registered artifact UUID. Older unregistered backups
are not imported. Compose paths are relative to the canonical definition directory on CORE.

```yaml
services:
  app:
    image: example/app:stable
    restart: "no"
    volumes:
      - type: bind
        source: ${KIDA_RESTORE_DIR}/app-data
        target: /app/data
        bind:
          create_host_path: false
```

This Compose fragment illustrates the bind, not a runnable application. Replace the image and add suitable
healthchecks. `app-data` must match the archive's relative structure, which preserves source paths without
the leading `/`. Health supplies `KIDA_RESTORE_DIR`. Use `restart: "no"` and avoid production mounts:
Compose is trusted administrator configuration, not a sandbox. The administrator validates functional integrity.
Repository examples: [definition](../../../kida-core/examples/backup-health/nextcloud-health.toml)
and [Compose](../../../kida-core/examples/backup-health/docker-compose.health.yml).

### Runs, diagnosis and cleanup

`create` produces `CREATED`; `start` admits work asynchronously and returns a Health run ID plus a separate
queue execution ID. Capacity, queue saturation or an active run of the same definition can prevent admission.
Manual runs remain available after diagnosis until stopped or expired (default four hours from `started_at`).
Automatic runs diagnose, stop and clean their environment. Stopped runs cannot restart; create a new one.
On CORE restart, interrupted runs are closed and cleanup is attempted; manual environments are not resumed.

Operational state and technical result are distinct. Results include `FAILED`, `UNHEALTHY`, `UNKNOWN`,
`DEGRADED` and `HEALTHY`. Inspect completion, anomalies and cleanup errors even when the protocol returns `OK`.
`stop` stops the environment; `delete` also requests removal of owned resources and the restored directory,
preserving history and reports. Cleanup errors remain visible for retry. External, shared or unproven resources
are preserved rather than removed by force.

### Artifacts and reports

New backups use `<name>-<UTC-date>-<artifact_id>.tar.zst`. Names cannot contain path components.
Verified destinations are recorded under `backup_health.data_root/artifacts/<job-id>/<artifact-id>.json`
with size, SHA-256 and absolute paths. Targets and catalog storage must support hard links for publication
without overwrite. A required-target failure remains an error even if another destination is registered;
a catalog failure preserves copied files but makes them unavailable to Health without a valid record.
No verified destination means no catalog record. Optional-target failures retain their existing treatment.

`latest` selects the newest date, then greatest UUID on ties; it tries that artifact's destinations in order,
without falling back to an older version. Corrupt catalog records prevent `latest` resolution.
Restoration verifies size/checksum and accepts regular files/directories, rejecting links and escaping paths.
Ordinary permissions and relative paths are retained; ownership and special bits are not restored.

Reports default to 90 days' retention. History needed for pending cleanup is preserved.
Deleting a report keeps history and prevents automatic reconstruction. A recorded report path can outlive
the report; use report listing to check availability. The catalog has no historical import or report-retention policy.

## Choose your interface

- [CONSOLE](console/backups-management.md) — not implemented yet.
- [CLI](cli/backups-management.md).
- [Direct API](api/backups-management.md).

See [configuration](configuration.md) for storage, TTL, timeouts and limits.
