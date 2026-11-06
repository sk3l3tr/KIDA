# KIDA CONSOLE

[Castellano](../../es/console/README.md) · [Index](../000-index.md)

KIDA Console provides a web interface to administer the server through CORE.
See [installation and configuration](../../../../kida-console/README.md).

## Navigation

The `/dashboard`, `/system`, `/docker`, `/backups`, `/scheduler`, `/settings`
and `/administrators` pages require a session. `/login` is public.
The menu opens Backups at `/backups`, which redirects to Configurations.

| Tab | Direct link | Features |
| --- | --- | --- |
| Configuraciones (Configurations) | `/backups/configurations` | Search by name or paths, inspect details, create, request a backup and delete configurations. |
| Backup Health | `/backups/health` | Inspect history and details, create checks, request automatic execution and start, stop or delete Health. |
| Informes (Reports) | `/backups/reports` | Find by `run_id`, read Markdown as literal text and delete reports with confirmation. |

Forms and details open in side panels. Closing a panel or switching tabs preserves
drafts, search, results and uncertainty notices; it cancels pending confirmations
and clears the selection. A write already sent may finish after closing.
Leaving Backups or changing sessions clears the module's data and drafts.
Changing the theme preserves work in progress.

Refresh retains previous data and marks it stale if the read fails.
Dates use the browser's local time.

## Operation semantics

- Requesting a backup, running automatic Health and starting/stopping/deleting Health
  require confirmation, as do configuration and report deletion.
- Queue admission does not confirm start or completion. `run_id` identifies Health;
  `execution_id` identifies a queued execution.
- Creating Health does not start it, including in `AUTOMATIC` mode. The definition
  must exist on the CORE host; Console does not upload or edit that file.
- Deleting a configuration preserves its files. Its `schedule` and `retention`
  metadata do not schedule executions or perform cleanup on their own.
- A Health technical diagnosis requires functional validation by the administrator.
  Review the cleanup, errors and resources returned by CORE.
- Uncertain outcomes persist and are never resent automatically. Refreshing
  the lists does not resolve that uncertainty.

You can also use the [CLI](../cli/README.md) or [API](../api/README.md).
