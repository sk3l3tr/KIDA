# KIDA CLI

[English](../../en/cli/README.md) · [Índice de documentación](../000-index.md)

La interfaz de terminal utiliza este formato:

```text
kida <command> [subcommand] [argument]
```

Consulta la ayuda en cualquier nivel:

```bash
kida --help
kida system --help
kida docker --help
kida docker container --help
```

El comando instalado es `kida`, procedente del binario `kida-cli`. Conecta con el socket local
`/tmp/kida.sock`; no tiene selector HTTP remoto. Consulta la [instalación](../001-installation.md).

- [Docker](docker-management.md)
- [Backups y Backup Health](backups-management.md)
- [Scheduler](task-scheduling.md)
- [Sistema](system-control.md)
- [Apagado semanal y encendido RTC](weekly-power-cycle.md)

## Salida y errores

Los resultados se presentan en formato legible: información agrupada por secciones, tablas de sensores y
contenedores y confirmaciones breves. No hay opción `--json`.

La presentación se selecciona por identificador interno de comando. Si no hay un renderer específico,
`data` se muestra como JSON formateado; si falta, como `null`. Si existe renderer y la respuesta correcta
no cumple su contrato, CLI informa del fallo de presentación sin sustituirlo silenciosamente por JSON.
Los errores de CORE se escriben en stderr. Un comando incompleto o desconocido muestra el uso esperado;
la indisponibilidad del agente y los fallos producen un código distinto de cero.

Los comandos usan espacios entre niveles. No se aceptan formas con puntos como `system.info` o
`docker.containers.list`.

Códigos de salida: `0` éxito; `1` error de entrada/comando o agente no disponible; `2` permiso denegado
sobre el socket; `3` fallo de comunicación o presentación de respuesta. Los errores de uso de Clap también pueden devolver `2`.
