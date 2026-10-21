# KIDA documentation

[Castellano](../es/000-index.md) · [Documentation index](000-index.md)

Start with [installation](001-installation.md), then [choose an interface](002-usage-overview.md).

| Guide | Contents |
| --- | --- |
| [Installation](001-installation.md) | Requirements, installer and service checks |
| [Usage overview](002-usage-overview.md) | CORE, CONSOLE, CLI and direct API |
| [Docker management](003-docker-management.md) | Containers and Compose inventory |
| [Backup management](004-backups-management.md) | Jobs, execution and Backup Health |
| [Task scheduling](005-task-scheduling.md) | Rules, queue behavior and upgrades |
| [System control](006-system-control.md) | Information, shutdown, reboot and RTC wake |
| [Integrations](007-integrations.md) | HTTP and Unix socket clients |
| [Configuration](configuration.md) | CORE configuration and persistence |

## Choose your interface

- [CONSOLE](console/README.md): planned web interface; not implemented yet.
- [CLI](cli/README.md): terminal commands through the local Unix socket.
- [Direct API](api/README.md): JSON requests over HTTP or Unix socket.

## Step-by-step recipes

- Weekly shutdown and RTC wake: [CLI](cli/weekly-power-cycle.md) · [API](api/weekly-power-cycle.md).

## Maintaining these guides

Keep the same filenames and topic structure in both languages. Each page links to its counterpart.
Add new procedures to the relevant interface directory, shared behavior to the topic guide,
and navigation entries to both language indexes and the common index.
Mark unavailable features explicitly; a documentation placeholder does not imply implementation.
