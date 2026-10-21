# Backups mediante API

[English](../../en/api/backups-management.md) · [Índice de documentación](../000-index.md)

Usa el [sobre HTTP o socket](README.md). Adapta rutas y nombres de contenedor al servidor CORE.

## Crear una configuración

`backup.config.create` recibe la configuración directamente en `params`.
CORE es independiente del modo de entrada: CLI puede leer un TOML local,
componer parámetros o usar su asistente, y envía el mismo contrato JSON.
El payload antiguo `{"file":"ruta.toml"}` se rechaza.

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{
    "id": "create-backup",
    "command": "backup.config.create",
    "params": {
      "name": "daily",
      "sources": ["/etc/hosts"],
      "targets": [
        {"path": "../primary", "filesystem_uuid": "volume-id"},
        {"path": "./secondary", "required": false}
      ],
      "compression": "tar_zstd",
      "lifecycle": {
        "pre_backup": [{"command": "docker.container.stop", "params": {"container": "backup-source"}}],
        "post_backup": [{"command": "docker.container.start", "params": {"container": "backup-source"}}]
      },
      "schedule": {"custom": [null, 1]},
      "retention": {
        "max_age": "7d",
        "keep_last": 7,
        "protected_restore_points": ["point-a"]
      }
    }
  }'
```

`name`, `sources` y `targets` son obligatorios. Cada target exige `path`;
`required` tiene default `true` y `filesystem_uuid` es opcional. La compresión
actual es `tar_zstd` y se aplica si se omite. `lifecycle` es opcional y sus listas
`pre_backup` y `post_backup` tienen default vacío. Cada comando exige `command`;
`params` acepta JSON arbitrario y tiene default `null`.

Al ejecutar el backup, el lifecycle permite exclusivamente `docker.container.stop`,
`docker.container.start` y `docker.container.restart`. Pre se detiene al primer
fallo; post intenta todos sus pasos secuencialmente y en orden, también si falla
pre o la creación del artefacto. Los errores de post indican posición (desde 1),
comando y causa. Si también hubo un fallo previo, este permanece como causa
principal y el diagnóstico incluye todos los fallos de recuperación. Un fallo de
post impide calcular el checksum y replicar el artefacto. Si post termina bien,
un fallo previo conserva su error original.

Esta recuperación cubre errores devueltos y errores de la tarea bloqueante de
creación. Cancelar la tarea de backup o terminar el proceso no garantiza ejecutar
post. El temporal sigue perteneciendo al trabajo bloqueante que lo esté utilizando.

`schedule` y `retention` son opcionales. En retention, `max_age` es una cadena
opcional, `keep_last` es un entero opcional de 0 a 4294967295 y
`protected_restore_points` es una lista de cadenas con default vacío. Los valores
JSON libres se guardan como cadenas JSON en la representación TOML persistida;
los jobs TOML antiguos siguen siendo legibles. Los tipos JSON de la API se conservan.

Una respuesta `OK` devuelve el job completo en `data`, con un UUID nuevo en
`data.id`. Las rutas de sources y targets se conservan literalmente; su existencia
se comprueba al ejecutar el backup. `schedule` solo guarda metadata: no crea una
programación. Usa `scheduler.add` para programar `backup.run` con el ID o nombre del job.

## Listar, eliminar y ejecutar

Indica exactamente un selector, `id` o `name`, para borrar o ejecutar. Sustituye los valores de ejemplo.

```json
{"id":"jobs","command":"backup.config.list","params":{}}
{"id":"run","command":"backup.run","params":{"name":"daily"}}
{"id":"delete","command":"backup.config.delete","params":{"name":"daily"}}
```

Eliminar la configuración es permanente. `backup.run` devuelve admisión con `data.state = "QUEUED"`
y `data.execution_id`; no confirma archivo terminado. Una cola llena o cerrada devuelve error.

## Backup Health

Prepara la [definición y Compose](../004-backups-management.md#backup-health) en CORE.
Envía cada objeto por separado. Sustituye `RUN_UUID` por el UUID obtenido de `create` o `run`.
API usa modos en mayúsculas; CLI usa `manual` y `automatic`.

```json
{"id":"create-health","command":"backup.health.create","params":{"definition_path":"/srv/health/app.toml","mode":"MANUAL"}}
{"id":"start-health","command":"backup.health.start","params":{"run_id":"RUN_UUID"}}
{"id":"get-health","command":"backup.health.get","params":{"run_id":"RUN_UUID"}}
{"id":"list-health","command":"backup.health.list","params":{}}
{"id":"stop-health","command":"backup.health.stop","params":{"run_id":"RUN_UUID"}}
{"id":"delete-health","command":"backup.health.delete","params":{"run_id":"RUN_UUID"}}
```

Para una ejecución automática nueva, usa `backup.health.run` o crea con `mode: "AUTOMATIC"`
y arranca el UUID devuelto:

```json
{
  "id": "run-health",
  "command": "backup.health.run",
  "params": { "definition_path": "/srv/health/app.toml" }
}
```

`create` devuelve la ejecución en `CREATED`. `start` y `run` devuelven `run_id`, `state` y
`execution_id` de admisión asíncrona. `get`, `stop` y `delete` devuelven el registro de ejecución;
`list` devuelve un array. Los parámetros Health rechazan campos desconocidos. Los comandos por ejecución
requieren UUID. `list` y `report.list` aceptan `{}` o `null`.

```json
{"id":"reports","command":"backup.health.report.list","params":{}}
{"id":"report","command":"backup.health.report.get","params":{"run_id":"RUN_UUID"}}
{"id":"delete-report","command":"backup.health.report.delete","params":{"run_id":"RUN_UUID"}}
```

`report.list` devuelve los IDs disponibles. `report.get` devuelve `run_id` y `markdown`;
`report.delete` devuelve `run_id` y `deleted: true`, conservando historial e impidiendo reconstrucción automática.
Revisa el [estado operativo, diagnóstico, limpieza, TTL y retención](../004-backups-management.md#backup-health):
`OK` puede contener fallo técnico o limpieza incompleta. `stop` no equivale a `delete`.
La ruta de definición se lee en CORE y Compose se resuelve respecto a ella, nunca al cliente.

Para automatizar Health, programa `backup.health.run` con
`{"definition_path":"/srv/health/app.toml"}` mediante el [scheduler](task-scheduling.md).
