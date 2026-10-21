# System control via API

[Castellano](../../es/api/system-control.md) · [Documentation index](../000-index.md)

Submit each object separately through [HTTP or socket](README.md).

## Read-only queries

```json
{"id":"info","command":"system.info","params":{}}
{"id":"health","command":"system.health","params":{}}
{"id":"rtc","command":"system.wake_capabilities","params":{}}
```

`system.info` reports OS/hardware resources. `system.health` queries sensors.
`system.wake_capabilities` inspects RTC availability without changing the alarm; unknown fields and warnings
are diagnostic evidence, not proof of permission or S5 wake support.

## Shutdown and reboot

These requests affect the CORE server. Review the time before sending them.

```json
{"id":"shutdown","command":"system.shutdown","params":{"when":"+15"}}
{"id":"reboot","command":"system.reboot","params":{"when":"23:30"}}
```

`when` accepts `now`, `+N` minutes, or 24-hour `HH:MM`; the handlers default to `+1` when no string is supplied.
A reboot restarts a running system; it does not wake an already powered-off system.

## Shutdown with RTC wake

```json
{"id":"cycle-clock","command":"system.power_cycle","params":{"shutdown_time":"23:30","wake_time":"06:00"}}
{"id":"cycle-delay","command":"system.power_cycle","params":{"wake_after_seconds":28800}}
```

Supply exactly one of `wake_time` (next local `HH:MM`) and `wake_after_seconds` (integer delay from execution).
Optional `shutdown_time` is today's local `HH:MM`; omitting it requests shutdown in one minute.
There is no interactive assistant in the API. The public API identifier is `system.power_cycle`;
the CLI spells its corresponding command `powercicle`.

See the shared [time constraints and alarm behavior](../006-system-control.md).
The response reports resulting wake time/timezone and, when explicit, shutdown date/timezone.
A successful response is not proof of physical power-on. See the [weekly recipe](weekly-power-cycle.md).
