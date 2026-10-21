# Primeros pasos

[English](../en/002-usage-overview.md) · [Índice](000-index.md)

## Primera consulta

Después de [instalar KIDA](001-installation.md), ejecuta en el servidor:

```bash
systemctl --no-pager --full status kida
kida system info
kida --help
```

El servicio debe estar activo y `system info` debe mostrar los datos del equipo.
Si falla, consulta [solución de problemas](troubleshooting.md).

## Elige cómo trabajar

| Interfaz | Uso |
| --- | --- |
| [CLI](cli/README.md) | Terminal local: `kida system info` |
| [API](api/README.md) | Scripts e integraciones: JSON por HTTP o Unix socket |

La CLI conecta con `/tmp/kida.sock`; no permite elegir un servidor remoto ni tiene opción `--json`.
Las operaciones se ejecutan en el servidor con los permisos del servicio KIDA.

## Archivos y rutas

Los TOML de creación de backups y programaciones se leen donde ejecutas la CLI.
Los orígenes y destinos del backup se usan en el servidor: utiliza rutas absolutas para evitar ambigüedad.
Las definiciones de Backup Health y sus archivos Compose deben estar en el servidor.

Continúa con [Docker](cli/docker-management.md), [backups](cli/backups-management.md)
o [programación de tareas](cli/task-scheduling.md).
