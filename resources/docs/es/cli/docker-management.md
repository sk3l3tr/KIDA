# Docker mediante CLI

[English](../../en/cli/docker-management.md) · [Índice de documentación](../000-index.md)

## Listar contenedores

Incluye los detenidos y su estado actual:

```bash
kida docker containers list
```

## Gestionar un contenedor

Usa el nombre o ID del contenedor:

```bash
kida docker container start <id-or-name>
kida docker container stop <id-or-name>
kida docker container restart <id-or-name>
kida docker container delete <id-or-name>
```

Por ejemplo:

```bash
kida docker container start web
kida docker container restart 8f2c1a4b7d90
kida docker container stop web
kida docker container delete web
```

Eliminar es permanente. Detén el contenedor y comprueba su nombre o ID antes de borrarlo.
