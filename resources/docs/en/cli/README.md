# KIDA CLI

[Castellano](../../es/cli/README.md) · [Index](../000-index.md)

Run `kida` on the server. For your first use, follow [getting started](../002-usage-overview.md).

```bash
kida --help
kida backup config create --help
kida scheduler add --help
```

| Task | Guide |
| --- | --- |
| Containers | [Docker](docker-management.md) |
| Backups and test restores | [Backups and Backup Health](backups-management.md) |
| Automation | [Scheduler](task-scheduling.md) |
| Information, shutdown and wake | [System](system-control.md) |
| Weekly shutdown and RTC wake | [Recipe](weekly-power-cycle.md) |

## Output and errors

Output is human-readable; errors are written to stderr.
Commands use spaces: `kida system info`. Dotted names belong to the API and the command scheduled through the scheduler.

| Exit code | Meaning |
| --- | --- |
| `0` | Command success; for asynchronous work, only confirms admission |
| `1` | Input or operation failure, or unavailable agent |
| `2` | Socket permission denied or CLI syntax error |
| `3` | Communication or response presentation failure |

For Health, also review diagnosis and cleanup even when the command succeeds.
See [troubleshooting](../troubleshooting.md) if an operation fails.
