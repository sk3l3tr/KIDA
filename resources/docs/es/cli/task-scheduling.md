# Programar tareas mediante CLI

[English](../../en/cli/task-scheduling.md) · [Índice de documentación](../000-index.md)

Elige TOML local, opciones o asistente:

```bash
kida scheduler add -f ./schedule.toml
kida scheduler add --command backup.run --params '{"name":"daily"}' --at '2030-01-01T12:00:00Z'
kida scheduler add --command backup.run --params '{"name":"daily"}' --seconds 3600
kida scheduler add --command backup.run --params '{"name":"daily"}' --cron '30 2 * * *' --timezone Europe/Madrid
kida scheduler add
```

Prepara el backup `daily` antes de ejecutar. Sustituye la fecha por una futura.
`-f` y `--file` son alias; el archivo se lee localmente y solo se envía la definición interpretada:

```toml
command = "backup.run"
params = '{"name":"daily"}'

[schedule]
type = "cron"
expression = "30 2 * * *"
timezone = "Europe/Madrid"
```

Para `once`, usa `type = "once"` y `at = "2030-01-01T12:00:00Z"`; para `interval`,
`type = "interval"` y `seconds = 3600`. `params` es texto JSON obligatorio; usa `'null'`
si no hay parámetros. Se rechazan campos desconocidos o propios de otra regla.

Archivo y opciones son excluyentes. Las opciones exigen `--command`, `--params` y exactamente una de
`--at`, `--seconds` o `--cron`. `--timezone` solo vale con cron y usa `UTC` por defecto, igual que archivo
y asistente. Opciones incompletas, JSON inválido o errores de archivo fallan localmente sin conectar ni
abrir el asistente. El asistente necesita terminal interactiva, pregunta de una en una y cancela por EOF o interrupción.

CORE valida comandos registrados, fechas futuras RFC3339, intervalos positivos, cron de cinco campos y
zonas IANA. Los parámetros conservan sus tipos JSON y el comando los interpreta al ejecutar.

```bash
kida scheduler list
kida scheduler list --origin user
kida scheduler list --origin internal
kida scheduler list --origin all
kida scheduler delete --id <UUID>
```

Sustituye `<UUID>` por el ID devuelto al crear. El listado usa `--origin user` por defecto;
`internal` muestra entradas gestionadas por CORE y `all` ambos orígenes. CLI usa minúsculas; el protocolo
JSON usa `USER`, `INTERNAL` y `ALL`. Se muestran ID, origen, comando, parámetros JSON, regla y vencimiento
pendiente en el orden devuelto por CORE. Sin entradas aparece `No schedules found.`. Un vencimiento puede
estar en el pasado si la cola está llena; no garantiza la hora de inicio.

El alta siempre crea `USER`. El borrado público solo permite `USER`; fallan los IDs inválidos, ausentes o
`INTERNAL`. No se puede cambiar el origen mediante alta/borrado públicos.

Consulta el [comportamiento de cola, reinicios y actualizaciones](../005-task-scheduling.md) antes de automatizar operaciones.
