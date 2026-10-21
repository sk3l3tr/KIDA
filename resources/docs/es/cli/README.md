# KIDA CLI

[English](../../en/cli/README.md) · [Índice](../000-index.md)

Ejecuta `kida` en el servidor. Si es tu primera vez, sigue los [primeros pasos](../002-usage-overview.md).

```bash
kida --help
kida backup config create --help
kida scheduler add --help
```

| Tarea | Guía |
| --- | --- |
| Contenedores | [Docker](docker-management.md) |
| Copias y restauraciones de prueba | [Backups y Backup Health](backups-management.md) |
| Automatización | [Scheduler](task-scheduling.md) |
| Información, apagado y encendido | [Sistema](system-control.md) |
| Apagado semanal y encendido RTC | [Receta](weekly-power-cycle.md) |

## Salida y errores

La salida es legible para personas; los errores se escriben en stderr.
Los comandos usan espacios: `kida system info`. Los nombres con puntos corresponden a la API y al comando que se programa en scheduler.

| Código de salida | Significado |
| --- | --- |
| `0` | Éxito del comando; en trabajos asíncronos solo confirma admisión |
| `1` | Error de entrada, operación o agente no disponible |
| `2` | Permiso denegado en el socket o error de sintaxis de la CLI |
| `3` | Error de comunicación o presentación de respuesta |

En Health, revisa también diagnóstico y limpieza aunque el comando termine correctamente.
Consulta [solución de problemas](../troubleshooting.md) si falla una operación.
