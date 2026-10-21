# Scheduling via CLI

[Castellano](../../es/cli/task-scheduling.md) · [Documentation index](../000-index.md)

Choose a local TOML file, flags, or the interactive assistant:

```bash
kida scheduler add -f ./schedule.toml
kida scheduler add --command backup.run --params '{"name":"daily"}' --at '2030-01-01T12:00:00Z'
kida scheduler add --command backup.run --params '{"name":"daily"}' --seconds 3600
kida scheduler add --command backup.run --params '{"name":"daily"}' --cron '30 2 * * *' --timezone Europe/Madrid
kida scheduler add
```

Prepare the `daily` backup before execution and choose a future date for one-off examples.
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

See [queue, restart and upgrade behavior](../005-task-scheduling.md) before automating operations.
