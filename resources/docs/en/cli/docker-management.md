# Docker via CLI

[Castellano](../../es/cli/docker-management.md) · [Documentation index](../000-index.md)

### List containers

List Docker containers and their current status, including stopped containers:

```bash
kida docker containers list
```

### Manage a container

Use either the container name or container ID:

```bash
kida docker container start <id-or-name>
kida docker container stop <id-or-name>
kida docker container restart <id-or-name>
kida docker container delete <id-or-name>
```

For example:

```bash
kida docker container start web
kida docker container restart 8f2c1a4b7d90
kida docker container stop web
kida docker container delete web
```

> **Warning:** Deleting a container is permanent. Stop it first and verify its
> name or ID before deleting it.
