# Direct API: HTTP and Unix socket

[Castellano](../../es/api/README.md) · [Documentation index](../000-index.md)

Send the same JSON command envelope over either transport. These examples perform a read-only query:

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{"id":"system-check","command":"system.health","params":{}}'
```

```bash
printf '%s\n' '{"id":"system-check","command":"system.health","params":{}}' \
  | socat - UNIX-CONNECT:/tmp/kida.sock
```

The commands require `curl` or `socat`, respectively. The HTTP endpoint defaults to
`127.0.0.1:8989/command`; the socket defaults to `/tmp/kida.sock`. See [configuration](../configuration.md).
The current server does not enforce authentication or provide TLS. Socket access depends on filesystem permissions.

## Request and response

A request contains string `id`, string `command`, and JSON `params` (default `null` if omitted).
The outer ID correlates the response; it is not a job ID, schedule ID, execution ID or idempotency key.

HTTP uses `POST /command` and `Content-Type: application/json`. The Unix socket uses one compact JSON object
per line and sends one response line per request; do not send multiline pretty JSON to the socket.
The connection can carry multiple request lines.

```json
{"id":"request-1","command":"scheduler.list","params":{}}
```

Example empty-list response:

```json
{"id":"request-1","status":"OK","data":[]}
```

Example command error:

```json
{"id":"request-1","status":"ERROR","error":"Unknown command: unknown.command"}
```

Inspect `status` and `error`, not just the HTTP status code. Command errors are JSON responses;
invalid HTTP JSON is rejected by the HTTP layer, while invalid socket messages terminate that connection.
`data` and `error` are omitted when absent. Successful queue admission is not task completion.
Health diagnosis and cleanup require checking result fields even when `status` is `OK`.
Do not blindly retry writes after a transport failure: the command may have already executed.

## Commands by task

- [Docker](docker-management.md)
- [Backups and Backup Health](backups-management.md)
- [Scheduler](task-scheduling.md)
- [System](system-control.md)
- [Weekly shutdown and RTC wake](weekly-power-cycle.md)

JSON blocks containing several request lines are separate examples: submit each object independently.
For socket transport, keep each object on its own line.
