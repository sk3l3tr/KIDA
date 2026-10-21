# Uso general

[English](../en/002-usage-overview.md) · [Índice de documentación](000-index.md)

CORE es el agente del servidor: ejecuta operaciones y mantiene la configuración y el estado del servidor.
Hay tres medios para interactuar con él; HTTP y Unix socket son dos transportes de la misma API directa.

| Interfaz | Estado | Cómo utilizarla |
| --- | --- | --- |
| [CONSOLE](console/README.md) | Aún no implementada | Futura interfaz web |
| [CLI](cli/README.md) | Disponible | Ejecutar `kida` en el equipo de CORE mediante `/tmp/kida.sock` |
| [API directa](api/README.md) | Disponible | Enviar JSON a HTTP `POST /command` o al Unix socket |

Los comandos CLI usan espacios (`kida system info`). Los identificadores de API usan puntos (`system.info`).
CLI no ofrece selección de endpoint HTTP ni una opción de conexión remota. Los clientes de API reciben JSON;
CLI normalmente presenta resultados legibles para personas y no tiene opción `--json`.

Empieza consultando la información del sistema con la interfaz elegida. Instala CORE primero y comprueba
el estado del servicio. Las operaciones administrativas se ejecutan con los permisos de CORE en el servidor,
no con los permisos de un archivo o ruta proporcionado por el cliente.

## Dónde se leen los archivos

- CLI lee localmente los TOML de configuración de backups y scheduler; envía los valores interpretados a CORE.
- Las rutas de origen y destino de backups se conservan literalmente y CORE las interpreta al ejecutar.
- Las rutas de definiciones Backup Health se envían intactas a CORE. CORE lee la definición y resuelve su Compose respecto a ella.

Consulta la [instalación](001-installation.md), la [configuración](configuration.md) y las guías de tu interfaz.
