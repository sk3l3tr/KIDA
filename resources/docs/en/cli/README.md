# KIDA CLI

[Castellano](../../es/cli/README.md) · [Documentation index](../000-index.md)

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

The installed command is `kida`, backed by the `kida-cli` binary. It connects to the local
`/tmp/kida.sock`; it has no remote HTTP selector. See [installation](../001-installation.md).

- [Docker](docker-management.md)
- [Backups and Backup Health](backups-management.md)
- [Scheduler](task-scheduling.md)
- [System](system-control.md)
- [Weekly shutdown and RTC wake](weekly-power-cycle.md)

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

Exit codes: `0` success; `1` input or command failure / unavailable agent; `2` socket permission denied;
`3` communication or response rendering failure. Clap usage errors can also return `2`.
