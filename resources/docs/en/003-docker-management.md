# Managing Docker

[Castellano](../es/003-docker-management.md) · [Index](000-index.md)

KIDA lists containers, including stopped ones, and starts, stops, restarts or deletes a container by name or ID.
The service needs access to the Docker daemon.

**Deleting a container is permanent.** Check the target and stop it before deleting it.

- [CLI: container commands](cli/docker-management.md).
- [API: containers and Compose inventory](api/docker-management.md).

Compose inventory is read-only. There are no public commands to create, start, stop or delete Compose projects.
To test a backup in a separate Compose environment, use [Backup Health](004-backups-management.md#backup-health).
