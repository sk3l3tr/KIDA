# Backups mediante CLI

[English](../../en/cli/backups-management.md) · [Índice](../000-index.md)

## Crear una configuración

Prepara un destino en el servidor, por ejemplo `/mnt/backups`, con espacio y permisos de escritura para KIDA.
Si corresponde a un disco, comprueba primero su montaje. Ejecuta una de estas alternativas:

```bash
kida backup config create --name daily --source /etc/hosts --target /mnt/backups
kida backup config create --file ./backup-job.toml
kida backup config create
```

La última abre el asistente y requiere terminal interactiva; Ctrl+C o fin de entrada cancelan.
Archivo y opciones son excluyentes. Con opciones necesitas `--name`, al menos un `--source` y un `--target`.
`-f` equivale a `--file`. El TOML se lee localmente:

```toml
name = "daily"
sources = ["/etc/hosts"]

[[targets]]
path = "/mnt/backups"
```

Consulta los [campos, valores predeterminados y limitaciones](../004-backups-management.md#crear-y-ejecutar-copias).

### Opciones adicionales

Repite `--source` y `--target` para añadir rutas. Los modificadores usan `INDEX=VALUE`, con índices desde cero:

```bash
kida backup config create --name daily \
  --source /srv/app --target /mnt/backups --target /mnt/secondary \
  --target-required '1=false' \
  --pre-backup docker.container.stop --pre-backup-params '0={"container":"app"}' \
  --post-backup docker.container.start --post-backup-params '0={"container":"app"}'
```

Adapta rutas y contenedor antes de ejecutar. `--pre-backup` y `--post-backup` se pueden repetir;
sus modificadores `--pre-backup-params` y `--post-backup-params` aceptan JSON.
Los índices duplicados o fuera de rango se rechazan.

También se admiten `--compression tar_zstd`, `--target-filesystem-uuid INDEX=TEXT`, `--schedule JSON`,
`--retention-max-age TEXT`, `--retention-keep-last NUMBER` y `--retention-protected-restore-point TEXT` (repetible).
Los campos de programación, retención y UUID son metadatos: revisa sus limitaciones en la guía enlazada.

## Listar y ejecutar

```bash
kida backup config list
kida backup run --name daily
```

También puedes usar `--id BACKUP_UUID`, en lugar de `--name`. La ejecución devuelve `Backup queued (Execution ID: …)`.
Guarda ese ID y [comprueba la finalización](../004-backups-management.md#comprobar-una-ejecución).
Para automatizar, [programa `backup.run`](task-scheduling.md).

## Eliminar una configuración

```bash
kida backup config delete --name daily
# Alternativa por ID:
kida backup config delete --id BACKUP_UUID
```

Elige un único selector. Comprueba el nombre o ID: el borrado de la configuración es permanente.

## Backup Health

Prepara primero la [definición y Compose](../004-backups-management.md#backup-health).
`--file` apunta a la definición **en el servidor**. Sustituye `RUN_UUID` por el ID Health obtenido.

### Entorno manual

```bash
kida backup health create --file /srv/health/app.toml --mode manual
kida backup health start --run-id RUN_UUID
kida backup health get --run-id RUN_UUID
```

Consulta con `get` hasta disponer del diagnóstico. Para terminar la inspección:

```bash
kida backup health stop --run-id RUN_UUID
kida backup health delete --run-id RUN_UUID
```

### Comprobación automática

```bash
kida backup health run --file /srv/health/app.toml
kida backup health list
kida backup health get --run-id RUN_UUID
```

Como alternativa, `create --mode automatic` seguido de `start` permite separar creación y arranque.
Para automatizar una comprobación nueva en cada vencimiento:

```bash
kida scheduler add --command backup.health.run \
  --params '{"definition_path":"/srv/health/app.toml"}' \
  --cron '30 2 * * *' --timezone Europe/Madrid
```

### Informes

```bash
kida backup health report list
kida backup health report get --run-id RUN_UUID
kida backup health report delete --run-id RUN_UUID
```

`report get` imprime el informe Markdown. `report delete` lo elimina; ejecútalo solo si quieres borrarlo.
Consulta [modos, resultados y limpieza](../004-backups-management.md#elegir-modo-y-leer-el-resultado) para interpretar la salida.
