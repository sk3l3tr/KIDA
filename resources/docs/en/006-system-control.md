# System control

[Castellano](../es/006-system-control.md) · [Documentation index](000-index.md)

Inspect system information, temperatures and fans; request shutdown or reboot; inspect RTC capabilities;
or program an RTC wake alarm before shutdown. Operations apply to the CORE server.

## Shutdown and RTC wake

`system.reboot` restarts a running machine. A power cycle requests shutdown and uses RTC for a later wake.
RTC availability alone does not prove permission to program alarms or physical S5 wake support.
That requires a test on the target hardware and firmware.

- Wake time is the next server-local `HH:MM`, or a relative delay of at least 120 seconds from execution.
- Without an explicit shutdown time, shutdown is requested in one minute.
- An explicit shutdown time refers to today in the server's local timezone and must be at least 60 seconds ahead. Past, nonexistent and ambiguous local times are rejected.
- Wake must be at least 120 seconds after execution and 60 seconds after shutdown. Incompatible times are rejected rather than moved to another day.
- CORE verifies the RTC alarm before requesting shutdown and rechecks the shutdown margin afterward. If the margin has elapsed, shutdown is not requested, but the alarm may remain active.
- A later alarm can replace an earlier one. Deleting a schedule does not clear an alarm or undo a shutdown already requested. Timing checks do not guarantee hardware shutdown duration.

## Choose your interface

- [CONSOLE](console/system-control.md) — not implemented yet.
- [CLI](cli/system-control.md).
- [Direct API](api/system-control.md).

Weekly shutdown and wake recipe: [CLI](cli/weekly-power-cycle.md) · [API](api/weekly-power-cycle.md).
