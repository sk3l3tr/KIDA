# Gestionar Docker

[English](../en/003-docker-management.md) · [Índice](000-index.md)

KIDA permite listar contenedores, incluidos los detenidos, e iniciar, detener, reiniciar o eliminar uno por nombre o ID.
El servicio necesita acceso al daemon Docker.

**Eliminar un contenedor es permanente.** Comprueba el destino y detenlo antes de borrarlo.

- [CLI: comandos de contenedores](cli/docker-management.md).
- [API: contenedores e inventario Compose](api/docker-management.md).

El inventario Compose es de solo lectura. No hay comandos públicos para crear, arrancar, detener o eliminar proyectos Compose.
Para probar una copia en un entorno Compose independiente, usa [Backup Health](004-backups-management.md#backup-health).
