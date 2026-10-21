# System via CLI

[Castellano](../../es/cli/system-control.md) · [Index](../000-index.md)

## Queries

```bash
kida system info
kida system health
kida system wake-capabilities
```

`info` shows the operating system and hardware; `health` shows available temperatures and fans.
`wake-capabilities` queries RTC without changing alarms.

## Shut down or reboot

Run only the operation you need:

```bash
kida system shutdown now
kida system shutdown +15
kida system shutdown 23:30
kida system reboot now
kida system reboot +15
kida system reboot 23:30
```

See [time formats and effects](../006-system-control.md#shutdown-and-reboot).

## Shutdown and RTC wake

```bash
kida system powercicle --shutdown-time 23:30 --wake-time 06:00
kida system powercicle --wake-after-seconds 28800
kida system powercicle
```

The command spelling is `powercicle`. Supply `--wake-time` or `--wake-after-seconds`.
Without a wake option, an assistant opens, even if you supplied only `--shutdown-time`;
it requires an interactive terminal. With a wake option it does not prompt.
`--shutdown-time HH:MM` is optional.

Before running, review [RTC requirements and timing margins](../006-system-control.md#shutdown-with-rtc-wake).
Output shows the wake date and timezone, and the shutdown date and timezone if supplied.
For automation, follow the [weekly recipe](weekly-power-cycle.md).
