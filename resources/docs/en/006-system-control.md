# System control

[Castellano](../es/006-system-control.md) · [Index](000-index.md)

Use the [CLI](cli/system-control.md) or [API](api/system-control.md) to inspect hardware and sensors,
shut down, reboot or schedule an RTC wake. All actions affect the KIDA server.

## Shutdown and reboot

`now` means immediately, `+N` is a delay in minutes and `HH:MM` is a 24-hour time.
Reboot acts on a powered-on machine; waking it after shutdown requires RTC.

## Shutdown with RTC wake

Requires `rtcwake`, service permissions and hardware/firmware supporting wake from shutdown (S5).
Querying RTC capabilities does not change alarms or prove that the machine will wake: test your hardware.

| Option | Meaning |
| --- | --- |
| Wake time | Next `HH:MM` in the server's local timezone |
| Wake delay | Seconds from execution, not from shutdown; minimum 120 |
| Optional shutdown time | Today in the server's local timezone; at least 60 seconds ahead |
| No shutdown time | Requests shutdown in one minute |

Supply exactly one wake option. Wake must be at least 120 seconds after execution
and 60 seconds after shutdown. Past, nonexistent or ambiguous shutdown times and incompatible timings are rejected;
they are not automatically moved to the next day.

KIDA verifies the alarm before requesting shutdown. If verification fails or the margin runs out, it does not request shutdown;
the alarm may remain active. Margins do not guarantee how long hardware takes to shut down.
A later alarm may replace an earlier one. Deleting a schedule does not clear the alarm or undo a requested shutdown.

Recipe: [weekly shutdown via CLI](cli/weekly-power-cycle.md) or [API](api/weekly-power-cycle.md).
