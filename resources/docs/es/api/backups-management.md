# Backups mediante API

[English](../../en/api/backups-management.md) · [Índice](../000-index.md)

Envía cada objeto por separado mediante [HTTP o socket](README.md).

## Crear una configuración

Adapta las rutas al servidor y prepara el destino antes de ejecutar:

```json
{
  "id": "create",
  "command": "backup.config.create",
  "params": {
    "name": "daily",
    "sources": ["/etc/hosts"],
    "targets": [{"path": "/mnt/backups"}]
  }
}
```

`name`, `sources` y `targets` son obligatorios. Envía el contenido de la configuración;
`{"file":"path.toml"}` no es un formato de creación admitido.
Los [campos y valores predeterminados](../004-backups-management.md#crear-y-ejecutar-copias) son comunes a CLI y API.
`schedule` y los `params` de lifecycle admiten cualquier JSON.
La respuesta devuelve la configuración completa en `data`, incluido el UUID `data.id`.

## Listar, ejecutar y eliminar

```json
{"id":"list","command":"backup.config.list","params":{}}
{"id":"run","command":"backup.run","params":{"name":"daily"}}
{"id":"delete","command":"backup.config.delete","params":{"name":"daily"}}
```

Para ejecutar o eliminar, indica exactamente uno de `id` o `name` dentro de `params`.
`backup.config.list` devuelve `data.backups`, un array de configuraciones; `backup.config.delete` devuelve la configuración eliminada.
`backup.run` devuelve `data.state: "QUEUED"` y `data.execution_id`.
Guarda el ID para [comprobar el resultado](../004-backups-management.md#comprobar-una-ejecución).

## Backup Health

Prepara la [definición y Compose](../004-backups-management.md#backup-health) en el servidor.
Para un entorno manual, crea y después utiliza el `run_id` recibido:

```json
{"id":"create","command":"backup.health.create","params":{"definition_path":"/srv/health/app.toml","mode":"MANUAL"}}
{"id":"start","command":"backup.health.start","params":{"run_id":"RUN_UUID"}}
{"id":"get","command":"backup.health.get","params":{"run_id":"RUN_UUID"}}
{"id":"list","command":"backup.health.list","params":{}}
{"id":"stop","command":"backup.health.stop","params":{"run_id":"RUN_UUID"}}
{"id":"delete","command":"backup.health.delete","params":{"run_id":"RUN_UUID"}}
```

Para una comprobación automática nueva:

```json
{"id":"run","command":"backup.health.run","params":{"definition_path":"/srv/health/app.toml"}}
```

También puedes crear con `mode: "AUTOMATIC"` y arrancar después. Los modos API usan mayúsculas.
`definition_path` se lee en el servidor, no en el cliente. Los comandos por ejecución requieren UUID.
Health rechaza parámetros desconocidos; `list` y `report.list` aceptan `{}` o `null`.

| Comando | `data` de respuesta |
| --- | --- |
| `create` | Registro de ejecución con `run_id` y estado `CREATED` |
| `start`, `run` | `run_id`, `state` y `execution_id` de admisión |
| `get`, `stop`, `delete` | Registro de ejecución, incluidos `state`, `diagnosis`, `cleanup` y `report_path` |
| `list` | Array de ejecuciones |

Consulta con `get` hasta que el diagnóstico esté completo. Interpreta los
[modos, resultados y limpieza](../004-backups-management.md#elegir-modo-y-leer-el-resultado) antes de decidir si la prueba es satisfactoria.

### Informes

```json
{"id":"reports","command":"backup.health.report.list","params":{}}
{"id":"report","command":"backup.health.report.get","params":{"run_id":"RUN_UUID"}}
{"id":"delete-report","command":"backup.health.report.delete","params":{"run_id":"RUN_UUID"}}
```

`report.list` devuelve IDs disponibles; `report.get`, `run_id` y `markdown`;
`report.delete`, `run_id` y `deleted: true`.
Para automatizar, programa `backup.health.run` con `{"definition_path":"/srv/health/app.toml"}` mediante [scheduler](task-scheduling.md).
