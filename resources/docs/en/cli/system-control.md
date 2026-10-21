# System control via CLI

[Castellano](../../es/cli/system-control.md) · [Documentation index](../000-index.md)

### View system information

Display information about the operating system, hardware, CPU, memory, disks,
and graphics devices:

```bash
kida system info
```

### View system health

Display the overall hardware health and the available temperature and fan
readings:

```bash
kida system health
```

### Shut down the system

Schedule a system shutdown by passing one of these time formats:

- `now` shuts down immediately.
- `+N` shuts down in `N` minutes, such as `+15`.
- `HH:MM` shuts down at the specified 24-hour time, such as `23:30`.

Examples:

```bash
kida system shutdown now
kida system shutdown +15
kida system shutdown 23:30
```

> **Warning:** This command powers off the server. Check the time carefully
> before running it.

### Shut down and schedule RTC wake

```bash
kida system powercicle --wake-time 06:00
kida system powercicle --wake-after-seconds 28800
kida system powercicle --shutdown-time 23:30 --wake-time 06:00
kida system powercicle
```

Choose exactly one wake flag. `--wake-time` uses the next occurrence of a 24-hour
`HH:MM` time in the server's local timezone. `--wake-after-seconds` counts from
execution and requires at least 120 seconds. CORE also checks that the calculated
wake time is at least 120 seconds away.

Without a wake flag, the interactive assistant asks for the wake mode and its
value, including when only `--shutdown-time` is supplied. An interactive terminal
is required in this case. With a wake flag, no questions are asked.

This command programs and verifies the RTC alarm before requesting shutdown.
Without `--shutdown-time`, it requests shutdown in one minute, preserving the
default behavior. With `--shutdown-time HH:MM`, it requests shutdown at that
24-hour time today in the server's local timezone. Past times, nonexistent or
ambiguous times during clock changes, and times less than 60 seconds ahead are
rejected. The calculated wake must be at least 60 seconds after shutdown and
at least 120 seconds after execution. Incompatible times are rejected, not
moved to another day. `--wake-after-seconds` still counts from execution, not
from shutdown.

CORE checks these conditions before programming the alarm and rechecks the
shutdown time immediately before requesting shutdown. If the time is no longer
safe after alarm programming, shutdown is not requested and an error warns that
the RTC alarm may remain active. The margins validate the requested schedule;
they do not guarantee how long hardware takes to shut down.

The response shows the resulting wake time and timezone, and the shutdown date
and timezone when `--shutdown-time` is supplied. Success does not guarantee
physical power-on from S5; that requires a test on the target hardware.

Check RTC availability without changing alarms:

```bash
kida system wake-capabilities
```

The output includes unknown values and diagnostic warnings. RTC availability
does not establish S5 compatibility or permission to program an alarm.

Existing scheduler commands can invoke `system.power_cycle` with the same wake
parameters. A later alarm can replace an earlier one; deleting a schedule does
not clear an RTC alarm already programmed.

### Reboot

```bash
kida system reboot now
kida system reboot +15
kida system reboot 23:30
```

These commands restart the CORE server. Review the requested time before executing.
