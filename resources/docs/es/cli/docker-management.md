# Docker mediante CLI

[English](../../en/cli/docker-management.md) · [Índice](../000-index.md)

## Listar

```bash
kida docker containers list
```

Incluye contenedores detenidos y su estado.

## Gestionar un contenedor

Sustituye `CONTAINER` por su nombre o ID. Ejecuta solo la acción que necesites:

```bash
kida docker container start CONTAINER
kida docker container stop CONTAINER
kida docker container restart CONTAINER
kida docker container delete CONTAINER
```

Consulta las [precauciones de borrado](../003-docker-management.md).
El inventario Compose está disponible mediante [API](../api/docker-management.md#inventario-compose).
