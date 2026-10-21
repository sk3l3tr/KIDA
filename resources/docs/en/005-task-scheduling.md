# Scheduling tasks

[Castellano](../es/005-task-scheduling.md) · [Index](000-index.md)

Create schedules with the [CLI](cli/task-scheduling.md) or [API](api/task-scheduling.md).
Each creation adds a new entry. To change one, delete the old entry and create another.
Command parameters and resources are checked at execution: registration does not prove that the task will complete.

## Rules

| Rule | Behavior |
| --- | --- |
| `once` | Future RFC3339 date with an explicit offset, for example `2030-01-01T12:00:00Z` |
| `interval` | Positive seconds; first attempt one interval after creation |
| `cron` | Five fields: minute, hour, day of month, month and weekday; IANA timezone, `UTC` by default |

For cron, if both day fields are restricted, either may match.
Times skipped by clock changes are omitted; repeated times are attempted once, at their first occurrence.
Intervals retain their anchor across restarts.

## Read the list

The list shows user entries (`USER`) by default. `INTERNAL` entries are managed by KIDA;
you can inspect them but cannot delete them. `ALL` shows both.
`Next enqueue attempt` / `next_enqueue_at` is in UTC and indicates a pending attempt, not a guaranteed execution time.

When capacity is exhausted, the occurrence stays pending and is retried. Recurrences keep a single pending occurrence,
without accumulating every missed repetition. Concurrency is set in [configuration](configuration.md);
backups run one at a time. Admission order does not guarantee completion order.

## Deletion and restart

Deleting prevents future submissions but does not cancel work already pending or running.
Schedules survive restarts; admitted or interrupted work is not recovered.
Overdue `once` entries still pending at restart are discarded.
There is no execution history or cancellation; see the [service log](troubleshooting.md).

## Upgrade from earlier versions

Update CORE before CLI. If a response is lost, list before repeating creation to avoid duplicates.
Keep a copy of the schedule file before upgrading: the `origin` field now saved
is incompatible with earlier versions. Do not remove the origin from internal entries.
If startup identifies an old schedule using `health`, replace or remove it from the indicated file;
`system.health` is the current sensor query.

Recipe: weekly shutdown and RTC wake via [CLI](cli/weekly-power-cycle.md) or [API](api/weekly-power-cycle.md).
