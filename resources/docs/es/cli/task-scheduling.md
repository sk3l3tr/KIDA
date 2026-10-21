# Programar tareas mediante CLI

[English](../../en/cli/task-scheduling.md) · [Índice](../000-index.md)

## Crear

Prepara antes la configuración de backup `daily`. Ejecuta una de estas alternativas:

```bash
kida scheduler add --command backup.run --params '{"name":"daily"}' --at '2030-01-01T12:00:00Z'
kida scheduler add --command backup.run --params '{"name":"daily"}' --seconds 3600
kida scheduler add --command backup.run --params '{"name":"daily"}' --cron '30 2 * * *' --timezone Europe/Madrid
kida scheduler add --file ./schedule.toml
kida scheduler add
```

Sustituye la fecha por una futura. La última alternativa abre un asistente en terminal interactiva;
Ctrl+C o fin de entrada cancelan. Archivo y opciones son excluyentes; `-f` equivale a `--file`.
Con opciones necesitas `--command`, `--params` y exactamente una regla: `--at`, `--seconds` o `--cron`.
`--timezone` solo se admite con cron.

TOML local equivalente al ejemplo cron:

```toml
command = "backup.run"
params = '{"name":"daily"}'

[schedule]
type = "cron"
expression = "30 2 * * *"
timezone = "Europe/Madrid"
```

Para `once`, cambia la regla a `type = "once"` y `at = "2030-01-01T12:00:00Z"`;
para `interval`, a `type = "interval"` y `seconds = 3600`.
`params` es texto JSON obligatorio; usa `'null'` cuando no haya parámetros.
Guarda el ID devuelto al crear.

## Listar y eliminar

```bash
kida scheduler list
kida scheduler list --origin internal
kida scheduler list --origin all
kida scheduler delete --id SCHEDULE_UUID
```

El listado usa `--origin user` por defecto. Sustituye `SCHEDULE_UUID` por el ID de la entrada que quieras borrar.
Comprueba [reglas, horarios, borrado y reinicio](../005-task-scheduling.md) antes de automatizar operaciones.
