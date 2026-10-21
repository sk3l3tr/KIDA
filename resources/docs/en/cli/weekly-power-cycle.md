# Weekly shutdown and RTC wake via CLI

[Castellano](../../es/cli/weekly-power-cycle.md) · [Index](../000-index.md)

Shut down at 22:00 on Sunday, Monday, Wednesday and Thursday; wake at 05:00 the following day.
The server must use `Europe/Madrid` and be running at 21:55 on those days.
First review [RTC requirements](../006-system-control.md#shutdown-with-rtc-wake) and test waking on your hardware.

## 1. Query RTC

```bash
kida system wake-capabilities
```

## 2. Register

```bash
kida scheduler add \
  --command system.power_cycle \
  --params '{"shutdown_time":"22:00","wake_time":"05:00"}' \
  --cron '55 21 * * SUN,MON,WED,THU' \
  --timezone Europe/Madrid
```

Save the returned ID.
The task is submitted at 21:55 to leave five minutes before the requested shutdown.
Repeating creation adds another schedule.

## 3. Check

```bash
kida scheduler list
```

Verify ID, command, parameters, cron and timezone. `Next enqueue attempt` / `next_enqueue_at` is in UTC;
its local equivalent depends on the date and clock changes. It is a pending attempt, not an already programmed alarm.

## 4. Delete

Replace `SCHEDULE_UUID` with the saved ID:

```bash
kida scheduler delete --id SCHEDULE_UUID
```

List again to confirm. Deletion prevents future submissions but does not cancel already admitted work,
undo requested shutdowns or clear RTC alarms.
