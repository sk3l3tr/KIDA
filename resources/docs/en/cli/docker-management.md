# Docker via CLI

[Castellano](../../es/cli/docker-management.md) · [Index](../000-index.md)

## List

```bash
kida docker containers list
```

Includes stopped containers and their state.

## Manage a container

Replace `CONTAINER` with its name or ID. Run only the action you need:

```bash
kida docker container start CONTAINER
kida docker container stop CONTAINER
kida docker container restart CONTAINER
kida docker container delete CONTAINER
```

See the [deletion precautions](../003-docker-management.md).
Compose inventory is available through the [API](../api/docker-management.md#compose-inventory).
