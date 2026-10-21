# KIDA CORE

[Castellano](README.es.md) · [Documentation](../resources/docs/index.md)

CORE executes server operations. Users interact through [CLI](../resources/docs/en/cli/README.md),
the [direct HTTP/Unix socket API](../resources/docs/en/api/README.md), or the planned
[CONSOLE web interface](../resources/docs/en/console/README.md), which is not implemented yet.

For installation, configuration and operating procedures, use the [English documentation](../resources/docs/en/000-index.md).
This README retains internal implementation contracts and acceptance notes; methods below are not additional public commands.

## Socket reservation

The Unix listener refuses active sockets and non-socket entries. Stale sockets are recovered only after `ConnectionRefused`;
permission/inspection errors stop startup without unlinking the entry. CORE retains a lock on `<socket_path>.lock`
for the listener lifetime. The file remains afterward; never unlink while instances are active.
The directory must allow socket/lock creation and resist unrelated modification. This coordinates cooperating CORE instances,
not external processes that ignore the lock or change the path.

## Internal Backup Health contracts

Public commands, configuration and definitions are documented in the [backup guide](../resources/docs/en/004-backups-management.md).
Health coordinates execution, admission limits, TTL, maintenance and public commands.

`features::backup::health::definition::load` reads a CORE-local TOML and returns its definition,
canonical definition/Compose paths and resolved `BackupJob`. Compose is relative to the canonical TOML directory,
never the client. Loading alone neither runs Compose nor creates resources. Definition IDs are stable and unique;
there is no separate global definition registry.

`features::backup::health::restore::restore` takes a resolved artifact and a new destination with an existing parent.
It verifies size and SHA-256 before creating the directory and reads the same descriptor during extraction.
It retains relative structure and ordinary permissions, not owners or special bits. Only regular files and directories
are accepted; links, special entries and escaping paths are rejected. The current backup producer dereferences links.
Failure preserves partial data and returns the created directory's path/provenance for recovery; source and existing
destinations are never removed. The Health service coordinates lifecycle and cleanup.

`health::compose::HealthCompose` prepares an exclusive `kida-bh-<run_id>` project and supplies `KIDA_RESTORE_DIR`
only to its Docker child processes. It obtains inventory through Compose, requires non-autostart policies before
creation/start, excludes optional profiles, and retains replicas, path/hash and configured images. For build-only services
without a declared image, reports complete the image from actual container inspection.
Partial creation preserves the reserved identity and registered resources. Start/Stop validate identity;
Remove reuses selective deletion, without forced stop or removal of external/shared resources.
The coordinator persists evidence and checks cleanup report errors.

`health::diagnosis::DiagnosticSession` compares expected replicas with Docker observations.
Only satisfactory healthchecks establish `HEALTHY`; restart/OOM evidence is retained and failures,
unhealthy state and insufficient evidence remain distinct. Observation ends at timeout or a conclusive result.
Logs do not affect diagnosis; omitted by default, authorized publication filters known sensitive values and bounds size.

`health::history::ExecutionRepository` stores JSON in `executions/<run_id>.json` and Markdown in
`reports/<run_id>.md` beneath `backup_health.data_root`. Final reports include the cleanup attempt and errors.
JSON is saved first so missing Markdown can be reconstructed if finalization fails. Deleting a report preserves history
and marks it against reconciliation reconstruction. Corrupt records are reported, never overwritten.
Directory provenance is retained, known sensitive values are redacted and logs are omitted by default.

## Internal artifact resolution

Each new `backup.run` includes an artifact UUID in `<name>-<UTC-date>-<artifact_id>.tar.zst`.
Backup names cannot contain path components; existing response fields are retained.
Verified destinations are registered beneath
`<backup_health.data_root>/artifacts/<backup-job-id>/<artifact-id>.json`, with identity, UTC date,
SHA-256, size and absolute verified destination paths. CORE needs write access to `data_root`.
The catalog neither imports old backups nor follows Health history/report retention.

Publication uses same-directory temporary files and hard links to avoid overwriting destinations or records,
even on collisions. Both target and catalog filesystems must support hard links. Failure preserves previous destinations;
there is no overwrite fallback. Owned temporary files are removed on completion.
A required destination failure remains a `backup.run` error even if another verified copy is registered.
Catalog-write failure preserves copies but leaves them unavailable to Health without a valid record.
No verified target means no metadata; optional-target failures keep their existing response treatment.

Synchronous `BackupService::resolve_artifact(reference, version)` returns `ResolvedBackupArtifact`, verifying
size and SHA-256. Job ID/name resolution rejects ambiguity. `latest` picks the newest date, then greatest UUID,
and tries registered destinations in order without falling back to older versions. Explicit selection only reads
its record; `latest` fails on corrupt job catalog records. This blocks on I/O and belongs in blocking work during
Health orchestration. Restoration verifies the actual opened file again; resolution retains no open descriptor
and cannot prevent external changes.

## Internal Docker diagnostics

These asynchronous `DockerService` methods register no commands and do not change the protocol or existing query responses:

```rust
let timeout = std::time::Duration::from_secs(10);
let container = DockerService::inspect_container("my-container", timeout).await?;
let project = DockerService::diagnose_compose_project("my-project", timeout).await?;
let logs = DockerService::container_logs("my-container", 100, timeout).await?;
```

`ContainerDiagnostics` contains `container: DockerContainer`, `oom_killed: Option<bool>` and
`docker_error: Option<String>`. Identity and technical fields are validated before mapping; missing/mistyped
required data is an error. Healthchecks are optional but, when present, must be `healthy`, `unhealthy` or `starting`.
Dates and current observations are retained without reconstructing history or inferring OOM from exit codes.
Absent OOM/error values are `None`; an empty error string is retained.

`ComposeDiagnostics` contains `project`, `containers` (with `service: Option<String>` and `diagnostics`),
and `errors` (with `id` and `error`). It validates project identity and enumerates all present containers,
including stopped ones, by Compose labels and full IDs. Each inspection verifies identity and project.
Individual disappearance, failure or invalid data preserves successful results. Invalid enumeration is a global error;
a valid empty enumeration yields an empty diagnosis. It neither infers declared services without containers nor proves ownership.
One deadline covers the whole operation; at expiry it preserves results and marks pending IDs without launching more commands.

`ContainerLogs` contains `container`, `tail: u32`, `stdout: Vec<u8>`, `stderr: Vec<u8>` and `warning`.
It runs `docker container logs --tail N` without following, accepts 1–10,000 lines and a positive timeout.
Each channel is limited to 1 MiB; overflow errors return no partial content. It does not interpret, print or persist logs,
and execution errors do not include log content. Logs may contain credentials/personal data; the warning lets consumers
manage disclosure. Some Docker drivers do not supply logs. Channels preserve the Docker CLI process output exactly.
Queries reuse lifecycle process termination and reaping.

Automated tests use fake Docker with isolated PATH. Real diagnostics acceptance requires a daemon and local
`busybox:1.37`, downloads no images, uses no network and deletes only its temporary test container.

Real diagnostics acceptance does not induce OOM or alter production containers; OOM is verified using explicit fake-Docker evidence.

```sh
KIDA_DOCKER_DIAGNOSTICS_REAL=1 cargo test -p kida-core features::docker::diagnostics_tests::diagnostics_real -- --exact --ignored --nocapture
```

## Internal Compose lifecycle

These methods are internal, with no public CLI or protocol commands:

```rust
let mut options = ComposeOptions::new("my-project", "/srv/my-project/compose.yaml");
options.variables.insert("APP_TAG".into(), "stable".into());
// options.timeout = std::time::Duration::from_secs(300); // default
DockerService::compose_create(&options).await?; // Result<(), String>
DockerService::compose_start(&options).await?;
let project = DockerService::compose_project(&options.project)?;
DockerService::compose_stop(&options).await?;
```

`ComposeOptions` has `project: String`, `file: PathBuf`, `variables: BTreeMap<String, String>` and `timeout: Duration`.
Explicit project names match `[a-z0-9][a-z0-9_-]*`, without normalization. One local regular file is canonicalized;
its directory becomes `--project-directory`. Paths must be UTF-8 and contain no commas because Compose's file label
has no comma escaping. Variables need portable environment names and no NUL values. `DOCKER_*`, `COMPOSE_*`,
`PATH`, `HOME`, `XDG_CONFIG_HOME`, `LD_*` and `DYLD_*` are rejected before invoking Docker.

Arguments are separate, without a shell. Variables apply only to children; inherited Docker destination/context is retained.
Default profiles are forced (`COMPOSE_PROFILES` empty) and environment-driven orphan removal is disabled.
No service/profile selection is exposed. The only additional merged file is KIDA's generated ownership file.
Compose resolves interpolation and paths using `compose config --format json`; CORE reads that model for Create/Start.
Stop checks provenance and invokes `compose stop` directly, without resolving `env_file` or checking external networks/volumes.
The main Compose file must still exist and be valid for the native command.

Create rejects project-labeled containers/networks/volumes, occupied explicit container names and already-existing
resolved non-external network/volume names. `compose create --no-recreate` does not start containers or change native
build/pull policies. External resources must exist for Create/Start and are managed by Compose.

Start/Stop require present containers with exact matching native labels: `com.docker.compose.project`,
`com.docker.compose.project.config_files` (canonical main file plus ownership file when managed),
and `com.docker.compose.project.working_dir`. Missing, mixed, ambiguous or changed provenance is rejected.
Externally created projects with one matching file are accepted for Start/Stop without adoption into the registry.
`compose start` does not await health. `compose stop` preserves IDs, containers, networks and volumes.
Both apply to all default-enabled services.

Same-project operations are serialized in-process. Timeout covers locking, checks and final command, with concurrent
`tokio::process` capture. Queries allow up to 8 MiB stdout; overflow terminates the process without parsing truncated data.
Create/Start/Stop discard stdout. Only the first 64 KiB stderr is retained while the rest is drained; truncation is reported.
Timeout kills/reaps the process and its Unix group, including the plugin. Errors distinguish input, conflict, missing Docker/plugin,
unreachable daemon, invalid output, command failure and timeout. Partial resources may remain: no rollback/automatic cleanup.
There is no exclusion against external Docker clients or file edits during operations. No `down` or global operation is used.

Models `ComposeVersion`, `ComposeProject` and `ComposeService` are exported from `features::docker` alongside container models.
Their public read-only queries are described in the [API guide](../resources/docs/en/api/docker-management.md).

## Docker ownership and selective removal

See [configuration](../resources/docs/en/configuration.md) for `docker.ownership_dir` (default `/etc/kida/docker.d`).
The registry opens when lifecycle is invoked, not at startup; Create/Remove need write access.
Each creation reserves a UUID and versioned `JsonStorage` JSON before Create, retaining daemon, project, provenance,
file hashes, external resources and verified identities. Containers/networks use full IDs; volumes use name, creation date,
driver, scope, options, mount point and labels.

KIDA preserves the original Compose file and writes a persistent override with `io.kida.owner=<uuid>` on services and
non-external networks/volumes. Create rejects user `io.kida.*` labels, collisions and active/pending registry projects.
Start/Stop reuse both files and require matching hashes, provenance, daemon, identities and labels.
Foreign projects retain their contract and are never adopted by name or labels.

```rust
let reference = DockerService::compose_managed_project("my-project").await?;
let report = DockerService::compose_remove(&reference, Duration::from_secs(60)).await?;
// reference: ManagedProject { owner, project }
// report: removed, absent, preserved, failed; entries include kind, identity, reason
// report.errors: general persistence/timeout errors; check both failed and errors.
```

A reference identifies one creation. Completed records are retained for idempotent recognition; an old reference cannot
remove a newer creation with the same project name. Remove needs neither original Compose nor plugin.
Before mutation it requires valid inventory, matching daemon/identities and all managed containers stopped.
Extra matching-labeled resources are ambiguous and block removal without adoption.

Remove deletes verified containers by ID, then networks by ID and volumes. It reinspects before deletion without
`--force`, `rm -v`, `compose down`, foreign disconnects or global cleanup. All containers, including stopped ones,
and network connections are examined. Shared networks/volumes are preserved while exclusive resources can proceed.
External resources, bind mounts and unproven anonymous volumes are preserved. Only `local` driver/scope volumes with
null/empty options are removable; others are preserved with a reason.

Identities are persisted as verified after Create; failure retains a pending record without rollback.
After restart, only persisted identities are recovered; labels do not establish ownership.
Pending records block Create/Start/Stop; Remove can delete proven resources when inventory is unambiguous.
Lost registry evidence prevents authorized removal. Corrupt records block operations and are not overwritten.
Progress is saved after each removal for retry. Only valid inspection proves absence; Docker errors remain failures.
Pre-traversal errors cause no mutation; later failures appear in reports, with unattempted resources preserved.

The registry assumes one trusted writer process per directory. Reinspection narrows races but cannot exclude external
Docker clients; Docker itself rejects in-use volume and connected-network deletion. Protection prevents accidental
adoption/simple copied labels, not an administrator controlling Docker and registry. There is no generic Docker lifecycle
cleanup at startup; Health coordinates its own adapter, worker, scheduler and recovery.

Project locking covers reference queries and persistence; different projects can proceed concurrently.
`JsonStorage` atomically replaces individual JSON files; the entire registry is still read/validated.
Timeout bounds initiating/continuing work, not already-started disk I/O, which is awaited to completion.
Cancellation retains the project lock until that I/O finishes. No commands or saves start after expiry.
Removal persistence/timeouts appear in `RemovalReport.errors`, retaining confirmed progress and preserving remaining resources.
Check both `failed` and `errors`; pre-traversal errors remain `Err(String)`.

## Validation and real acceptance

Fake Docker on Unix needs Python 3. Normal tests are simulated:

```sh
cargo test -p kida-core features::docker
```

Real lifecycle acceptance is opt-in, requiring a daemon, Compose plugin and a downloadable image:

```sh
KIDA_COMPOSE_REAL=1 cargo test -p kida-core compose_lifecycle_real -- --ignored --nocapture
```

It creates two unique projects under `/tmp/kida-accept-.../compose.yaml`, each with two services,
three containers, a network and a volume. It checks Create → Start → Inspect → Stop, preserves resource identities,
and compares the control project before/after. It prints resources and leaves both projects stopped without deleting
containers, networks, volumes or files. Simulated results do not prove real-daemon acceptance.

Real removal acceptance requires separate authorization and is disabled by default:

```sh
KIDA_DOCKER_REMOVE_REAL=1 cargo test -p kida-core features::docker::lifecycle_tests::compose_remove_real -- --exact --ignored --nocapture
```

It creates unique test/control resources, removes only its test creation with containers stopped and original Compose absent,
checks idempotency, and compares the control. Control resources and registry remain stopped/preserved for inspection.
Do not run without express authorization to create and delete these resources. Simulated tests cover persistence,
consumer restart, interruption, retry, conflicts, sharing and prohibition of forced commands.
