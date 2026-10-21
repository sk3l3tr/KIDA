# Gestión de Docker

[English](../en/003-docker-management.md) · [Índice de documentación](000-index.md)

CORE permite listar todos los contenedores, incluidos los detenidos, e iniciar, detener, reiniciar o eliminar
uno por nombre o ID. La eliminación es permanente; verifica el destino y detenlo primero.
CORE necesita acceso al daemon Docker utilizado en la operación.

La API directa ofrece además consultas de versión e inventario de proyectos Compose.
La CLI actual no tiene comandos Compose. Los métodos internos de lifecycle Compose no son comandos públicos.
Un nombre de proyecto o una etiqueta Compose no demuestra propiedad de KIDA.

## Elige tu interfaz

- [CONSOLE](console/docker-management.md) — aún no implementada.
- [CLI](cli/docker-management.md) — comandos de contenedores.
- [API directa](api/docker-management.md) — contenedores e inventario Compose.

Para entornos de restauración aislados, consulta [Backup Health](004-backups-management.md#backup-health).
