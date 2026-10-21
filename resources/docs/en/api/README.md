# API for integrations

[Castellano](../../es/api/README.md) · [Index](../000-index.md)

Send JSON commands over HTTP or Unix socket. Operations run on the KIDA server.
Defaults: HTTP `127.0.0.1:8989` and socket `/tmp/kida.sock`.
To change these or restrict access, see [configuration](../configuration.md).

## First request

With `curl`, over HTTP:

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{"id":"check","command":"system.info","params":{}}'
```

With `socat`, over Unix socket:

```bash
printf '%s\n' '{"id":"check","command":"system.info","params":{}}' \
  | socat - UNIX-CONNECT:/tmp/kida.sock
```

HTTP uses `POST /command` and `Content-Type: application/json`.
The socket requires one compact JSON object per line and replies with one line per request;
a connection accepts multiple requests. Do not send multiline JSON to the socket.

## Request and response

| Request field | Type and use |
| --- | --- |
| `id` | String correlating request and response; not a resource ID or an idempotency key |
| `command` | Dotted command name, for example `scheduler.list` |
| `params` | JSON; `null` if omitted |

Send each JSON example in the guides as a separate request.
Example with no schedules and example error:

```json
{"id":"list","status":"OK","data":[]}
{"id":"check","status":"ERROR","error":"Unknown command: unknown.command"}
```

Check `status`, not only the HTTP code. `data` and `error` are omitted if absent.
HTTP rejects invalid JSON; an invalid socket message closes that connection.
Asynchronous admission does not confirm completion. For Health, also review diagnosis and cleanup even if `status` is `OK`.
If a write response is lost, query state before retrying: the command may have run.

## Commands by task

- [Docker and Compose](docker-management.md).
- [Backups and Backup Health](backups-management.md).
- [Task scheduling](task-scheduling.md).
- [System and RTC](system-control.md).
- [Weekly shutdown recipe](weekly-power-cycle.md).
