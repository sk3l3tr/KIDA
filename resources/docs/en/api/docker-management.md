# Docker via API

[Castellano](../../es/api/docker-management.md) · [Index](../000-index.md)

Send each object separately over [HTTP or socket](README.md).

## Containers

Replace `web` with a name or ID. Listing includes stopped containers.

```json
{"id":"list","command":"docker.containers.list","params":{}}
{"id":"start","command":"docker.container.start","params":{"container":"web"}}
{"id":"stop","command":"docker.container.stop","params":{"container":"web"}}
{"id":"restart","command":"docker.container.restart","params":{"container":"web"}}
{"id":"delete","command":"docker.container.delete","params":{"container":"web"}}
```

Listing returns `data.total`, `data.running` and `data.containers` (array).
Each container includes `id`, `name`, `image`, `online`, `status`, `health`, `started_at`, `finished_at`,
`exit_code`, `restart_count`, `restart_policy`, `ports` and `networks`.
`health`, timestamps, exit code and restart policy may be `null`.
Ports contain `container_port`, `protocol`, `host_ip` and `host_port`;
networks contain `name`, `ip_address`, `gateway` and `mac_address`.

See the [deletion precautions](../003-docker-management.md).

## Compose inventory

```json
{"id":"version","command":"docker.compose.version","params":{}}
{"id":"projects","command":"docker.compose.projects.list","params":{}}
{"id":"inspect","command":"docker.compose.project.inspect","params":{"project":"my-project"}}
```

| Command | Result in `data` |
| --- | --- |
| `docker.compose.version` | `{"version":"2.40.0"}` (example version); requires the `docker compose` plugin, does not check the daemon |
| `docker.compose.projects.list` | Array of projects; `[]` if there are none |
| `docker.compose.project.inspect` | One project with `name` and `services`; each service contains `name` and `containers` |

Inventory requires the daemon but not the Compose plugin. It only shows projects and services with existing containers,
including stopped ones; it does not read Compose files. Each container includes the container listing data.
Replicas are grouped by service; an unnamed service uses `name: null`.
Projects and services are sorted by name, containers by ID. There is no aggregate project state.

`project` must be non-empty text; surrounding whitespace is trimmed. A missing project or Docker failure returns `ERROR`.
The project name only identifies it within the queried daemon; it does not prove KIDA ownership.
