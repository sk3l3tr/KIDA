# Weekly shutdown and RTC wake via CLI

[Castellano](../../es/cli/weekly-power-cycle.md) · [Documentation index](../000-index.md)

Schedule a server to shut down at 22:00 and wake at 05:00 the next day:

| Shutdown day | Wake day |
| --- | --- |
| Sunday | Monday |
| Monday | Tuesday |
| Wednesday | Thursday |
| Thursday | Friday |

This is shutdown followed by RTC power-on, not `system.reboot`.
CORE's local timezone must be `Europe/Madrid`, matching the cron timezone, because shutdown/wake clock
parameters use the server timezone. CORE must be running at 21:55 on shutdown days.
The machine/firmware must support RTC wake from power-off, and CORE needs `rtcwake`, RTC access and shutdown privileges.
Registration alone does not verify physical wake; test that separately on the target hardware.

## 1. Check prerequisites and RTC

Check [installation and service status](../001-installation.md) and the server timezone before continuing.
Use an account allowed to access the socket; run `kida` with `sudo` if required by its permissions.
An elevated CLI does not change CORE's service privileges.

```bash
kida system wake-capabilities
```

This query does not modify alarms.

## 2. Register one weekly schedule

```bash
kida scheduler add \
  --command system.power_cycle \
  --params '{"shutdown_time":"22:00","wake_time":"05:00"}' \
  --cron '55 21 * * SUN,MON,WED,THU' \
  --timezone Europe/Madrid
```

Record the returned schedule ID.

## 3. Check the registered task

```bash
kida scheduler list
```

The cron runs at 21:55 to leave five minutes before shutdown. Each execution programs and verifies the
05:00 alarm, then requests 22:00 shutdown. The five-minute margin accommodates the minimum 60-second
shutdown lead and its recheck after alarm programming. Alarm programming/verification failure prevents shutdown.

Inspect the command, parameters, cron and timezone in the returned entry.
`Next enqueue attempt` / `next_enqueue_at` is in UTC; convert it for the relevant date.
It confirms a pending queue submission, not execution or an already programmed alarm/shutdown.
Cron follows Madrid's daylight-saving changes; the UTC equivalent varies.

## 4. Remove the schedule when needed

Replace `<SCHEDULE_UUID>` with the ID returned at creation:

```bash
kida scheduler delete --id <SCHEDULE_UUID>
kida scheduler list
```

Use the UUID returned for your own schedule, never a historical example ID.
Repeating add creates another schedule; it does not update the original.
Deletion prevents future submissions but does not cancel queued/running commands, undo a shutdown,
or clear an RTC alarm programmed by an earlier execution. This recipe makes no claim that physical
wake or later deletion has been observed on your machine.
