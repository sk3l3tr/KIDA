# Scheduling via CLI

[Castellano](../../es/cli/task-scheduling.md) · [Index](../000-index.md)

## Create

First prepare the `daily` backup configuration. Run one of these alternatives:

```bash
kida scheduler add --command backup.run --params '{"name":"daily"}' --at '2030-01-01T12:00:00Z'
kida scheduler add --command backup.run --params '{"name":"daily"}' --seconds 3600
kida scheduler add --command backup.run --params '{"name":"daily"}' --cron '30 2 * * *' --timezone Europe/Madrid
kida scheduler add --file ./schedule.toml
kida scheduler add
```

Replace the date with a future one. The last alternative opens an assistant in an interactive terminal;
Ctrl+C or end of input cancels. File and options are mutually exclusive; `-f` is an alias for `--file`.
Options require `--command`, `--params` and exactly one rule: `--at`, `--seconds` or `--cron`.
`--timezone` is only accepted with cron.

Local TOML equivalent to the cron example:

```toml
command = "backup.run"
params = '{"name":"daily"}'

[schedule]
type = "cron"
expression = "30 2 * * *"
timezone = "Europe/Madrid"
```

For `once`, change the rule to `type = "once"` and `at = "2030-01-01T12:00:00Z"`;
for `interval`, use `type = "interval"` and `seconds = 3600`.
`params` is required JSON text; use `'null'` when there are no parameters.
Save the ID returned on creation.

## List and delete

```bash
kida scheduler list
kida scheduler list --origin internal
kida scheduler list --origin all
kida scheduler delete --id SCHEDULE_UUID
```

Listing defaults to `--origin user`. Replace `SCHEDULE_UUID` with the ID of the entry you want to delete.
Review [rules, timing, deletion and restart](../005-task-scheduling.md) before automating operations.
