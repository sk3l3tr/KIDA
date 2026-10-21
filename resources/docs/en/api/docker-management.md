# Docker via API

[Castellano](../../es/api/docker-management.md) · [Documentation index](../000-index.md)

## Containers

Submit each request independently using [HTTP or socket](README.md). Replace `web` with a container name or ID.
Listing includes stopped containers. Stop and verify the target before deletion; deletion is permanent.

```json
{"id":"list","command":"docker.containers.list","params":{}}
{"id":"start","command":"docker.container.start","params":{"container":"web"}}
{"id":"stop","command":"docker.container.stop","params":{"container":"web"}}
{"id":"restart","command":"docker.container.restart","params":{"container":"web"}}
{"id":"delete","command":"docker.container.delete","params":{"container":"web"}}
```

## Read-only Compose inventory

```json
{"id":"compose-version","command":"docker.compose.version","params":{}}
{"id":"compose-list","command":"docker.compose.projects.list","params":{}}
{"id":"compose-inspect","command":"docker.compose.project.inspect","params":{"project":"my-project"}}
```

`docker.compose.version` executes `docker compose version --short` and returns `data` such as
`{"version":"2.40.0"}`, or `ERROR`. This checks the plugin, not daemon availability; there is no
fallback to legacy `docker-compose`.

Inventory queries only need daemon access through `docker`; they work without the Compose plugin.
They discover containers, including stopped ones, by `com.docker.compose.project`, then inspect them.
They do not read Compose files: projects and services without present containers do not appear.

Project listing returns an array, empty when none exist. Inspect returns one project; abbreviated example:

```json
{"name":"my-project","services":[{"name":"web","containers":[]}]}
```

Real container entries retain `docker.containers.list` fields: ID, name, image, online/status/health,
timestamps, exit code, restart count, ports and networks. Replicas are grouped by service;
missing service labels use `name: null`. Projects/services sort by name, containers by ID.
No aggregate project status is synthesized.

`params.project` must be a nonempty string; surrounding whitespace is trimmed.
A missing project or Docker failure returns `ERROR`, without partial results.
Names apply only within the queried daemon/context and do not prove ownership.
There are no public Compose create/start/stop/remove commands; those lifecycle methods are internal.
