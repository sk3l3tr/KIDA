# Backups via CLI

[Castellano](../../es/cli/backups-management.md) · [Documentation index](../000-index.md)

### List backup jobs

List every backup job configured in KIDA Core:

```bash
kida backup config list
```

Each job includes its sources, targets, lifecycle operations, schedule, and
retention policy. For example:

```text
Name: Nextcloud
ID: 8e1dba64-36c2-4eac-937c-d23a283256ec
Compression: tar_zstd
Schedule:
  {
    "cron": "0 3 * * *"
  }
Sources:
  - /srv/nextcloud
Targets:
  - /mnt/backups (required, filesystem UUID: 2d89-55c1)
Lifecycle:
  Pre-backup: None
  Post-backup: None
Retention:
  Max age: 30d
  Keep last: 7
  Protected restore points: None
```

### Create a backup job

Choose one of three input modes:

```bash
# Read a local TOML file (-f and --file are aliases).
kida backup config create --file ./backup-job.toml

# Supply configuration fields directly.
kida backup config create --name daily --source /etc/hosts --target ../backups

# Start the interactive assistant.
kida backup config create
```

The CLI reads and validates the TOML locally, relative to its current working
directory. It sends the configuration to CORE; the input-file path is never sent.
Source and target paths retain their literal values and are interpreted by CORE
when the backup runs. Creation does not check whether these paths exist.

File and parameter modes are exclusive. Any configuration flag selects parameter
mode, which requires `--name`, at least one `--source`, and at least one `--target`.
Incomplete or invalid parameters fail locally with exit code 1, without opening
the assistant or contacting CORE. The assistant requires an interactive terminal,
writes prompts to stderr, shows defaults, retries invalid values, asks list counts
before their elements, and confirms optional blocks. EOF or Ctrl+C cancels it.

Repeat `--source`, `--target`, `--pre-backup`, `--post-backup`, and
`--retention-protected-restore-point` to add ordered elements. Indexed modifiers
use zero-based `INDEX=VALUE` assignments and may appear before or after the elements:

```bash
kida backup config create --name daily \
  --source /etc/hosts --target ./primary --target ../secondary \
  --target-required '1=false' --target-filesystem-uuid '0=volume-id' \
  --pre-backup docker.container.stop --pre-backup-params '0={"container":"backup-source"}' \
  --post-backup docker.container.start --post-backup-params '0={"container":"backup-source"}' \
  --schedule '{"custom":[null,1]}' \
  --retention-max-age 7d --retention-keep-last 7 \
  --retention-protected-restore-point point-a
```

Adapt `backup-source` to your container before running the job. Duplicate or out-of-range modifiers fail locally. `--compression` accepts
`tar_zstd` (the default). Targets default to `required = true`; lifecycle command
parameters default to JSON `null`. `--schedule` and lifecycle parameters accept
arbitrary JSON; `--retention-keep-last` accepts an unsigned 32-bit integer.

A minimal TOML file is:

```toml
name = "daily"
sources = ["/etc/hosts"]
[[targets]]
path = "../backups"
```

`schedule` is optional metadata and does not create a scheduled execution. Create
a separate CORE schedule to run the backup automatically. See the
[CORE JSON contract](../api/backups-management.md)
for the configuration fields used by all three modes.

### Delete a backup job

Delete a backup job by its ID or name:

```bash
kida backup config delete --id <id-code>
kida backup config delete --name <name>
```

Exactly one selector must be provided.

> **Warning:** Deleting a backup job is permanent. Verify its name or ID before
> deleting it.

### Run a backup job

Queue a configured backup job by its ID or name:

```bash
kida backup run --id <id-code>
kida backup run --name <name>
```

Exactly one selector must be provided. When KIDA Core accepts the execution,
KIDA CLI prints its execution ID:

```text
Backup queued (Execution ID: 4f79f9e1-1628-4e86-88bb-e96f5507aa1f).
```

## Backup Health

Health commands return human-readable text, with no `--json` option or wizard.
Every required flag must be supplied. UUIDs and modes are validated before
connecting to CORE. `--file` is the definition path on the CORE server: the CLI
passes it unchanged, including relative paths, without reading or resolving it
locally. CORE resolves the Compose path relative to that definition.

Create and start a manual environment:

```bash
kida backup health create --file /srv/health/app.toml --mode manual
kida backup health start --run-id <UUID>
kida backup health get --run-id <UUID>
kida backup health stop --run-id <UUID>
kida backup health delete --run-id <UUID>
```

`create` returns a run in `CREATED`. `start` admits it asynchronously and prints
both the Health Run ID and the separate Queue execution ID. A manual environment
remains available after diagnosis until stopped or expired. Its TTL defaults to
four hours (`backup_health.manual_ttl_hours` in `/etc/kida/kida.toml`), measured
from `started_at`. Maintenance checks expiration periodically; expiration is not an
exact deadline. Capacity, queue saturation or an active run of the same definition
can prevent admission.

For an automatic run that diagnoses and then stops and cleans its environment:

```bash
kida backup health run --file /srv/health/app.toml
# Alternatively, create first and start the returned UUID:
kida backup health create --file /srv/health/app.toml --mode automatic
kida backup health start --run-id <UUID>
kida backup health list
```

Schedule a new automatic run on each occurrence using the existing Scheduler:

```bash
kida scheduler add --command backup.health.run \
  --params '{"definition_path":"/srv/health/app.toml"}' \
  --cron '30 2 * * *' --timezone Europe/Madrid
```

`get`, `stop` and `delete` display the operational state separately from the
technical result (`FAILED`, `UNHEALTHY`, `UNKNOWN`, `DEGRADED`, `HEALTHY`), plus
partial or complete diagnosis, timestamps, selected artifact, anomalies, cleanup
errors and the report path recorded by CORE. Use `report list` to check which
reports remain available; a recorded path can outlive a deleted report. A technical failure or incomplete cleanup
can be returned in a successful protocol response; inspect these fields. Protocol
and transport errors keep their existing error messages and exit statuses.

`stop` stops the environment; `delete` also requests removal of its owned Docker
resources and restored directory, preserving history and reports. Cleanup errors
remain visible for later retry. Stopped executions cannot be restarted: create a
new run. CORE restart closes interrupted runs and attempts cleanup; it does not
resume manual environments.

```bash
kida backup health report list
kida backup health report get --run-id <UUID>
kida backup health report delete --run-id <UUID>
```

`report get` prints the Markdown received from CORE. Deleting a report preserves
history and prevents automatic reconstruction of that voluntarily deleted report.
Reports default to 90 days of retention (`backup_health.report_retention_days`);
records needed for pending cleanup are preserved. Runtime configuration changes
require a CORE restart.

Use an administrator-reviewed Compose definition for isolated restoration paths.
Compose is trusted configuration: bind mounts can affect production. Health
checks provide a technical diagnosis; the administrator must validate functional
integrity. Simulated tests do not establish real Docker acceptance.
