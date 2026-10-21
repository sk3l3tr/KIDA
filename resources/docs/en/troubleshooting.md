# Troubleshooting

[Castellano](../es/troubleshooting.md) · [Index](000-index.md)

## Inspect the service

```bash
systemctl --no-pager --full status kida
sudo journalctl -u kida -n 100 --no-pager
```

| Problem | What to check |
| --- | --- |
| `KIDA agent is not running.` | Service status and log. If stopped, correct the reported error and use `sudo systemctl start kida` |
| CLI permission denied | Try a query with `sudo kida system info`. Review `/tmp/kida.sock` and account permissions; do not make the socket accessible to everyone |
| Service active, CLI cannot connect | The CLI requires `/tmp/kida.sock`. Check `unix.socket_path` in [configuration](configuration.md) |
| Startup failure | Check TOML, permissions and the path identified in the log. Do not delete the schedule file or an active instance's socket lock |
| `required backup target unavailable` | The destination must exist as a directory, be mounted if applicable and be accessible to the service |
| Source or copy failure | Check the server path, permissions, free space and destination hard link support |
| Queue full or Health limit reached | Wait for work to finish. Review active manual environments before changing limits |
| Negative Health diagnosis | Query `kida backup health get --run-id RUN_UUID` and its report; check the image, healthcheck and Compose paths |
| Incomplete Health cleanup | Review the errors, correct their cause and retry `kida backup health delete --run-id RUN_UUID`. Shared or unproven resources are preserved |
| Lost response to a write | List configurations, schedules or environments before retrying: the operation may have completed |

Replace `RUN_UUID` with the Health ID. For a queued backup, save the execution ID and find its result
[in the log](004-backups-management.md#check-a-run). There is no backup progress query.

A schedule appearing in the list does not prove that it ran.
For RTC, see the [hardware and timing restrictions](006-system-control.md#shutdown-with-rtc-wake).
