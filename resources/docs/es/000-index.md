# Documentación de KIDA

[English](../en/000-index.md) · [Índice de documentación](000-index.md)

Empieza por la [instalación](001-installation.md) y después [elige una interfaz](002-usage-overview.md).

| Guía                                             | Contenido                                           |
| ------------------------------------------------ | --------------------------------------------------- |
| [Instalación](001-installation.md)               | Requisitos, instalador y comprobación del servicio  |
| [Uso general](002-usage-overview.md)             | CORE, CONSOLE, CLI y API directa                    |
| [Gestión de Docker](003-docker-management.md)    | Contenedores e inventario Compose                   |
| [Gestión de backups](004-backups-management.md)  | Configuraciones, ejecución y Backup Health          |
| [Programación de tareas](005-task-scheduling.md) | Reglas, comportamiento de la cola y actualizaciones |
| [Control del sistema](006-system-control.md)     | Información, apagado, reinicio y encendido RTC      |
| [Integraciones](007-integrations.md)             | Clientes HTTP y Unix socket                         |
| [Configuración](configuration.md)                | Configuración y persistencia de CORE                |

## Elige tu interfaz

- [CONSOLE](console/README.md): futura interfaz web; aún no está implementada.
- [CLI](cli/README.md): comandos de terminal mediante el Unix socket local.
- [API directa](api/README.md): peticiones JSON por HTTP o Unix socket.

## Recetas paso a paso

- Apagado semanal y encendido RTC: [CLI](cli/weekly-power-cycle.md) · [API](api/weekly-power-cycle.md).

## Mantenimiento de las guías

Conserva los mismos nombres de archivo y temas en ambos idiomas. Cada página enlaza su traducción.
Añade los procedimientos al directorio de su interfaz, el comportamiento compartido a la guía temática
y los enlaces de navegación a ambos índices de idioma y al índice común.
Marca expresamente las funciones no disponibles; una página preparada no implica implementación.
