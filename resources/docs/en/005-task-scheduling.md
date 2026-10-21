# Task scheduling

[Castellano](../es/005-task-scheduling.md) · [Documentation index](000-index.md)

Schedules persist command definitions and submit them to the shared queue when due.
Any registered public command can be scheduled, including scheduler commands themselves.
Command-specific parameters and referenced resources are validated at execution, not at schedule creation.
A backup job's `schedule` metadata does not create executions.

## Rules and validation

- `once`: a future RFC3339 date with explicit offset. Choose a future date when adapting examples.
- `interval`: positive seconds. First submission is one interval after creation; the original anchor survives restart.
- `cron`: five fields (minute, hour, day of month, month, weekday) and an IANA timezone, default `UTC`.
  When both day fields are restricted, either matching is enough. Nonexistent local times are skipped;
  repeated local times are attempted once, on their first occurrence.

Adding always creates `USER` entries. Listing defaults to `USER`; `INTERNAL` and `ALL` filters are available.
Internal entries are CORE-managed and cannot be deleted publicly. IDs must be valid and refer to existing user entries.
There is no modify command: delete and add are separate operations. Deletion stops future submissions,
not queued or running requests. `next_enqueue_at` is a UTC pending submission time, not a guaranteed execution start.

## Queue and restart behavior

Scheduled commands and manual backups share a FIFO and worker. Worker concurrency is configured by
`queue.max_concurrent_jobs` (default 2); `backup.run` executes one at a time. New occurrences may be queued
while earlier work is pending or running. Admission order does not guarantee start or completion order.

The oldest pending occurrence is admitted first across both origins; ties retain stored order.
A full queue preserves the occurrence and retries after a one-second monotonic delay, subject to polling.
Recurring schedules keep one pending occurrence, then advance to a future time preserving rule and anchor,
without replaying every missed repetition. A `once` entry is removed after admission; overdue `once` entries
still pending at restart are discarded without execution.

Queued requests and interrupted executions are not recovered. Admission does not guarantee execution or
exactly-once delivery. Only command and parameters are queued; resources are resolved at execution.
Persistence failure while processing due schedules or a closed queue terminates CORE with an error.
The scheduler provides no execution history, execution query or cancellation.

## Upgrades

Update CORE before CLI. Current CLI requires `origin` in scheduler responses and can report rendering failure
after an add/delete succeeded against an older CORE. Check the existing list before retrying an add.
CORE reads old files without `origin` as `USER`, but saving writes that field and makes them incompatible
with the previous CORE. Back up files if rollback is needed; do not strip origin from `INTERNAL` entries.

The historical `health` command is retired; `system.health` is a separate sensor query.
A saved pending `health` schedule prevents loading, reporting its UUID and command without overwriting the file.
Remove or replace that definition before startup.

## Choose your interface

- [CONSOLE](console/task-scheduling.md) — not implemented yet.
- [CLI](cli/task-scheduling.md).
- [Direct API](api/task-scheduling.md).

Recipe: weekly shutdown and RTC wake using [CLI](cli/weekly-power-cycle.md) or [API](api/weekly-power-cycle.md).
See [configuration](configuration.md) for scheduler storage and permissions.
