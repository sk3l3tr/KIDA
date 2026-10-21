# Getting started

[Castellano](../es/002-usage-overview.md) · [Index](000-index.md)

## First query

After [installing KIDA](001-installation.md), run on the server:

```bash
systemctl --no-pager --full status kida
kida system info
kida --help
```

The service should be active and `system info` should display the server details.
If either fails, see [troubleshooting](troubleshooting.md).

## Choose how to work

| Interface | Use |
| --- | --- |
| [CLI](cli/README.md) | Local terminal: `kida system info` |
| [API](api/README.md) | Scripts and integrations: JSON over HTTP or Unix socket |

The CLI connects to `/tmp/kida.sock`; it has no remote server selector or `--json` option.
Operations run on the server with the KIDA service's permissions.

## Files and paths

Backup and schedule creation TOML files are read where you run the CLI.
Backup sources and destinations are used on the server: use absolute paths to avoid ambiguity.
Backup Health definitions and their Compose files must be on the server.

Continue with [Docker](cli/docker-management.md), [backups](cli/backups-management.md)
or [task scheduling](cli/task-scheduling.md).
