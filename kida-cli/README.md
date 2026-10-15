```
888    d8P  8888888 8888888b.        d8888  v0.0.4
888   d8P     888   888  "Y88b      d88888  CLI
888  d8P      888   888    888     d88P888
888d88K       888   888    888    d88P 888
8888888b      888   888    888   d88P  888
888  Y88b     888   888    888  d88P   888
888   Y88b    888   888  .d88P d8888888888
888    Y88b 8888888 8888888P" d88P     888
```

> KIDA is the intelligent agent at the core of your server, quietly watching over the place, automating operations, and keeping everything under control.

# What is KIDA CLI

KIDA CLI is the terminal interface for checking and managing the server where
KIDA is running. After installing KIDA, the command is available as `kida`.

See the [changelog](CHANGELOG.md) for implementation changes and validation notes.

# Using KIDA CLI

The general command format is:

```text
kida <command> [subcommand] [argument]
```

Run `kida --help` to see the available commands. Help is also available at any
level of the command hierarchy:

```bash
kida system --help
kida docker --help
kida docker container --help
```

## Check KIDA

Check whether KIDA is available and responding:

```bash
kida health
```

## System commands

### View system information

Display information about the operating system, hardware, CPU, memory, disks,
and graphics devices:

```bash
kida system info
```

### View system health

Display the overall hardware health and the available temperature and fan
readings:

```bash
kida system health
```

### Shut down the system

Schedule a system shutdown by passing one of these time formats:

- `now` shuts down immediately.
- `+N` shuts down in `N` minutes, such as `+15`.
- `HH:MM` shuts down at the specified 24-hour time, such as `23:30`.

Examples:

```bash
kida system shutdown now
kida system shutdown +15
kida system shutdown 23:30
```

> **Warning:** This command powers off the server. Check the time carefully
> before running it.

### Shut down and schedule RTC wake

```bash
kida system powercicle --wake-time 06:00
kida system powercicle --wake-after-seconds 28800
kida system powercicle
```

Choose exactly one flag. `--wake-time` uses the next occurrence of a 24-hour
`HH:MM` time in the server's local timezone. `--wake-after-seconds` counts from
execution and requires at least 120 seconds. CORE also checks that the calculated
wake time is at least 120 seconds away.

Without flags, the interactive assistant asks for the wake mode and its value.
An interactive terminal is required only in this case. With a flag, no questions
are asked.

This command programs the RTC alarm and requests shutdown in one minute. The
response shows the resulting wake time and timezone. Success does not guarantee
physical power-on from S5; that requires a test on the target hardware.

Check RTC availability without changing alarms:

```bash
kida system wake-capabilities
```

The output includes unknown values and diagnostic warnings. RTC availability
does not establish S5 compatibility or permission to program an alarm.

Existing scheduler commands can invoke `system.power_cycle` with the same wake
parameters. A later alarm can replace an earlier one; deleting a schedule does
not clear an RTC alarm already programmed.

## Docker commands

### List containers

List Docker containers and their current status, including stopped containers:

```bash
kida docker containers list
```

### Manage a container

Use either the container name or container ID:

```bash
kida docker container start <id-or-name>
kida docker container stop <id-or-name>
kida docker container restart <id-or-name>
kida docker container delete <id-or-name>
```

For example:

```bash
kida docker container start web
kida docker container restart 8f2c1a4b7d90
kida docker container stop web
kida docker container delete web
```

> **Warning:** Deleting a container is permanent. Stop it first and verify its
> name or ID before deleting it.

## Backup commands

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
  --pre-backup system.health --pre-backup-params '0={}' \
  --post-backup system.health --post-backup-params '0=null' \
  --schedule '{"custom":[null,1]}' \
  --retention-max-age 7d --retention-keep-last 7 \
  --retention-protected-restore-point point-a
```

Duplicate or out-of-range modifiers fail locally. `--compression` accepts
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
[CORE JSON contract](../kida-core/README.md#crear-configuraciones-de-backup)
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

## Scheduled commands

Choose a local TOML file, flags, or the interactive assistant:

```bash
kida scheduler add -f ./schedule.toml
kida scheduler add --command backup.run --params '{"name":"daily"}' --at '2030-01-01T12:00:00Z'
kida scheduler add --command backup.run --params '{"name":"daily"}' --seconds 3600
kida scheduler add --command backup.run --params '{"name":"daily"}' --cron '30 2 * * *' --timezone Europe/Madrid
kida scheduler add
```

`-f` and `--file` are aliases. The file is read locally; only its interpreted
definition is sent to CORE. For example:

```toml
command = "backup.run"
params = '{"name":"daily"}'

[schedule]
type = "cron"
expression = "30 2 * * *"
timezone = "Europe/Madrid"
```

For `once`, use `type = "once"` and `at = "2030-01-01T12:00:00Z"` in
`[schedule]`. For `interval`, use `type = "interval"` and `seconds = 3600`.
`params` is required JSON text; use `'null'` when no parameters are needed.
Unknown fields and fields belonging to another rule are rejected.

File and flag modes are exclusive. Flags require `--command`, `--params`, and
exactly one of `--at`, `--seconds`, or `--cron`. `--timezone` is valid only with
`--cron` and defaults to `UTC`, as it does in files and the assistant. Incomplete
flags, invalid JSON, and file errors fail locally without contacting CORE or
opening the assistant. The assistant requires an interactive terminal, asks
one question at a time, and cancels on EOF or interruption.

CORE validates registered commands, future RFC3339 dates, positive intervals,
five-field cron expressions, and IANA timezones. Command parameters retain their
JSON values and are interpreted by the scheduled command when it executes.

```bash
kida scheduler list
kida scheduler list --origin user
kida scheduler list --origin internal
kida scheduler list --origin all
kida scheduler delete --id 8e1dba64-36c2-4eac-937c-d23a283256ec
```

The list defaults to `--origin user`. Use `internal` for schedules managed by
CORE or `all` for both origins. CLI values are lowercase; the JSON protocol uses
`USER`, `INTERNAL`, and `ALL`. The list shows each ID, origin, command, JSON
parameters, rule, and pending enqueue time in the order returned by CORE.
An empty list prints `No schedules found.`. A pending time may be in the past
while the queue is full; it does not guarantee an execution start time.

Adding a schedule always creates a `USER` entry. Public deletion only accepts
`USER` entries; invalid, missing, or `INTERNAL` IDs fail. The public add and
delete commands cannot override the origin.

CORE admits the oldest pending occurrence first, across both origins, and
keeps stored order for ties. When the queue is full, the occurrence stays
pending and admission is retried after a one-second monotonic delay, subject
to timer polling. New recurring occurrences do not overtake older pending ones.
A recurring schedule keeps one pending occurrence and advances to a future
time after admission, preserving its rule and anchor without replaying every
missed repetition. A `once` entry is removed after admission; expired `once`
entries still pending at restart are discarded without execution.

Scheduled commands share the FIFO and worker with manual backups. The worker
uses `queue.max_concurrent_jobs` (default 2) for execution concurrency and runs
`backup.run` commands one at a time. Admission order does not guarantee start
or completion order. Queued requests and interrupted executions are not
recovered after restart; admission does not guarantee execution or exactly-once
delivery. Persistence failures while processing due schedules or a closed queue
terminate CORE with an error.

The schedule displayed in a backup job's configuration does not automatically
schedule that backup. Use `kida scheduler add` with `backup.run` to run it
automatically. Deleting a schedule prevents future queue submissions but does
not cancel requests already queued or running.

Update CORE before CLI. This CLI requires `origin` in scheduler responses and
rejects older CORE responses without it, even when an add or delete succeeded.
Check existing schedules before repeating an add after a rendering error.
CORE accepts older scheduler files without `origin` as `USER`, but saving writes
the field and makes the file incompatible with the previous CORE version.
Keep a backup before upgrading if rollback is required; removing the field
from `INTERNAL` entries would lose their origin protection.

## Output and errors

Command results are printed directly in the terminal in a compact,
human-readable format. System information is grouped into sections, hardware
sensors and Docker containers are shown in aligned tables, and successful
actions print a short confirmation.

KIDA CLI selects this presentation using the internal command identifier sent
to KIDA Core. If a newer Core command does not yet have a dedicated renderer,
the command's `data` value is printed as pretty JSON. A missing `data` value in
that fallback is printed as `null`.

If KIDA Core returns an error, its message is printed to stderr. If a successful
response does not match the expected contract for its command, KIDA CLI reports
that it was unable to render the response instead of silently falling back to
JSON.

If a command is incomplete or unknown, KIDA CLI displays the expected usage.
If KIDA is unavailable or a command cannot be completed, it prints an error and
returns a non-zero exit status.

Commands use spaces between each level. Dotted forms such as `system.info` or
`docker.containers.list` are not accepted.

# License and trademarks
