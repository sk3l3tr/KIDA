# Weekly shutdown and RTC wake via API

[Castellano](../../es/api/weekly-power-cycle.md) · [Documentation index](../000-index.md)

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

Check [installation](../001-installation.md) and the server timezone. These examples use HTTP;
for Unix socket use the [same JSON in a single line](README.md). Adjust the endpoint to CORE configuration.

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{"id":"check-rtc","command":"system.wake_capabilities","params":{}}'
```

The query does not modify alarms. Check `status` before proceeding.

## 2. Register one weekly schedule

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{
    "id":"weekly-power-cycle",
    "command":"scheduler.add",
    "params":{
      "command":"system.power_cycle",
      "params":{"shutdown_time":"22:00","wake_time":"05:00"},
      "schedule":{
        "type":"cron",
        "expression":"55 21 * * SUN,MON,WED,THU",
        "timezone":"Europe/Madrid"
      }
    }
  }'
```

Require `status: "OK"` and save `data.id`, the schedule UUID. The outer `id` only identifies the request.

## 3. Check the registered task

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{"id":"check-weekly-task","command":"scheduler.list","params":{}}'
```

The cron runs at 21:55 to leave five minutes before shutdown. Each execution programs and verifies the
05:00 alarm, then requests 22:00 shutdown. The five-minute margin accommodates the minimum 60-second
shutdown lead and its recheck after alarm programming. Alarm programming/verification failure prevents shutdown.

Inspect the command, parameters, cron and timezone in the returned entry.
`Next enqueue attempt` / `next_enqueue_at` is in UTC; convert it for the relevant date.
It confirms a pending queue submission, not execution or an already programmed alarm/shutdown.
Cron follows Madrid's daylight-saving changes; the UTC equivalent varies.

## 4. Remove the schedule when needed

Replace `SCHEDULE_UUID` with the saved `data.id`:

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{"id":"remove-weekly-task","command":"scheduler.delete","params":{"id":"SCHEDULE_UUID"}}'
```

Check `status` and list schedules again to confirm removal.

Use the UUID returned for your own schedule, never a historical example ID.
Repeating add creates another schedule; it does not update the original.
Deletion prevents future submissions but does not cancel queued/running commands, undo a shutdown,
or clear an RTC alarm programmed by an earlier execution. This recipe makes no claim that physical
wake or later deletion has been observed on your machine.
