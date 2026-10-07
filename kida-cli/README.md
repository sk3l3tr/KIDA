```
888    d8P  8888888 8888888b.        d8888  v0.0.2
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
kida backup list
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

Create a backup job from a TOML configuration file:

```bash
kida backup create -f /path/to/backup-job.toml
```

Relative paths are resolved against KIDA CLI's current working directory before
being sent to KIDA Core. Absolute paths are passed unchanged. KIDA CLI does not
read or validate the file, which must be accessible from KIDA Core's filesystem.

### Delete a backup job

Delete a backup job by its ID or name:

```bash
kida backup delete --id <id-code>
kida backup delete --name <name>
```

Exactly one selector must be provided.

> **Warning:** Deleting a backup job is permanent. Verify its name or ID before
> deleting it.

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
