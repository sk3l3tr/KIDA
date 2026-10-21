# Docker management

[Castellano](../es/003-docker-management.md) · [Documentation index](000-index.md)

CORE can list all containers, including stopped ones, and start, stop, restart or delete a selected container.
Use its name or ID. Deletion is permanent; verify the target and stop it first.
CORE needs access to the Docker daemon used for the operation.

The direct API also exposes read-only Compose version and project inventory queries.
The current CLI has no Compose commands. Internal Compose lifecycle methods are not public commands.
A Compose project name or label does not prove KIDA ownership.

## Choose your interface

- [CONSOLE](console/docker-management.md) — not implemented yet.
- [CLI](cli/docker-management.md) — container commands.
- [Direct API](api/docker-management.md) — containers and Compose inventory.

For isolated restoration environments, see [Backup Health](004-backups-management.md#backup-health).
