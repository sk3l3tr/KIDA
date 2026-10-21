# System via API

[Castellano](../../es/api/system-control.md) · [Index](../000-index.md)

Send each object separately over [HTTP or socket](README.md).

## Queries

```json
{"id":"info","command":"system.info","params":{}}
{"id":"health","command":"system.health","params":{}}
{"id":"rtc","command":"system.wake_capabilities","params":{}}
```

`system.info` reports operating system and hardware; `system.health` reports sensors.
`system.wake_capabilities` queries RTC without changing alarms.

## Shutdown and reboot

```json
{"id":"shutdown","command":"system.shutdown","params":{"when":"+15"}}
{"id":"reboot","command":"system.reboot","params":{"when":"23:30"}}
```

`when` uses the [shutdown formats](../006-system-control.md#shutdown-and-reboot);
if omitted or not a string, `+1` applies.

## Shutdown and RTC wake

```json
{"id":"clock","command":"system.power_cycle","params":{"shutdown_time":"23:30","wake_time":"06:00"}}
{"id":"delay","command":"system.power_cycle","params":{"wake_after_seconds":28800}}
```

Supply exactly one of `wake_time` (`HH:MM` text) and `wake_after_seconds` (integer).
`shutdown_time` is optional `HH:MM` text. The response shows the wake date and timezone and, if supplied, shutdown date and timezone.
Review [RTC requirements and margins](../006-system-control.md#shutdown-with-rtc-wake).
For automation, follow the [weekly recipe](weekly-power-cycle.md).
