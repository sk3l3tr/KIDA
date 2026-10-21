# Backups y Backup Health

[English](../en/004-backups-management.md) · [Índice](000-index.md)

## Crear y ejecutar copias

Una configuración define qué copiar y dónde guardarlo. Crearla no ejecuta el backup.
Usa la [CLI](cli/backups-management.md) o la [API](api/backups-management.md) para crear, listar, ejecutar y eliminar configuraciones.
Eliminar una configuración no elimina las copias guardadas.

| Campo | Uso y valor predeterminado |
| --- | --- |
| `name` | Nombre del backup, sin componentes de ruta |
| `sources` | Rutas que se copiarán en el servidor |
| `targets` | Destinos; cada uno requiere `path` |
| `targets[].required` | `true`: un destino no disponible o fallido hace fallar el backup |
| `targets[].filesystem_uuid` | Metadato opcional; **no verifica la identidad del disco** |
| `compression` | `tar_zstd`, único formato admitido |
| `lifecycle` | Pasos anteriores y posteriores; vacío por defecto |
| `schedule` | Solo metadato; usa [scheduler](005-task-scheduling.md) para automatizar |
| `retention` | Solo metadatos; **no elimina copias automáticamente** |

Utiliza orígenes existentes y directorios de destino preparados, con espacio y permisos de escritura para el servicio.
Las rutas se comprueban al ejecutar, no al crear la configuración. Prefiere rutas absolutas.
Si el destino es un disco montado, comprueba el montaje antes de ejecutar; `filesystem_uuid` no lo protege.
Los destinos deben admitir enlaces duros para publicar los archivos.

`retention` admite `max_age` (texto), `keep_last` (entero de 0 a 4294967295) y
`protected_restore_points` (lista de textos, vacía por defecto). Organiza la limpieza de copias por separado.
La [retención de informes Health](#informes-y-limpieza) sí está activa y es independiente.

## Pasos antes y después

`lifecycle.pre_backup` y `lifecycle.post_backup` son listas de pasos con `command` y `params` JSON (`null` por defecto).
Solo se admiten `docker.container.stop`, `docker.container.start` y `docker.container.restart`.
El primer fallo interrumpe los pasos previos. Los posteriores se intentan todos, incluso si falla un paso previo o el archivado.
Si falla un paso posterior, no se distribuye la copia. Una interrupción del servicio no garantiza estos pasos:
comprueba tus contenedores después de un fallo.

## Comprobar una ejecución

`Backup queued` o `state: QUEUED` confirma la admisión, no la finalización. Guarda el ID de ejecución.
Consulta el registro del servicio y busca ese ID:

```bash
sudo journalctl -u kida --since '10 minutes ago' --no-pager
```

`Execution completed: ID` indica finalización; `Execution failed: ID` indica error y su causa.
No hay comando de progreso ni historial de ejecuciones del backup. Comprueba también el archivo en los destinos previstos:
`<name>-<fecha-UTC>-<artifact_id>.tar.zst`. Un error puede dejar copias válidas en algunos destinos.
Para probar la restauración, utiliza Backup Health.

## Backup Health

Health restaura una copia registrada e inicia un entorno Compose independiente para comprobarla.
Requiere Docker y el plugin Docker Compose. No existe un comando independiente `backup restore`.

### Preparar la definición

Guarda en el servidor, por ejemplo en `/srv/health/app.toml`:

```toml
id = "app-health"
name = "Application Backup Health"

[backup]
reference = "daily"
version = "latest"

[docker]
compose = "./docker-compose.health.yml"
```

Todos los campos son obligatorios y no vacíos; no se admiten campos desconocidos.
Usa un ID estable y único. `reference` es el ID o nombre inequívoco de una configuración.
`version` admite `latest` o el UUID de una copia registrada. Las copias antiguas sin registro no se importan.
`latest` selecciona la copia registrada más reciente; si no puede usarse, no retrocede a otra versión.

La ruta Compose se resuelve respecto a la definición. Adapta el
[ejemplo Compose](../../../kida-core/examples/backup-health/docker-compose.health.yml) a tu aplicación:
imagen, healthcheck y rutas de datos. No está listo para ejecutar sin cambios.
Usa `${KIDA_RESTORE_DIR}` para los datos restaurados y `restart: "no"`.
Las rutas del archivo conservan el origen sin el `/` inicial: `/srv/app/data` se restaura como `srv/app/data`.
**No montes datos de producción:** Compose se ejecuta con los permisos del servicio y no es un sandbox.
La restauración verifica tamaño y checksum; rechaza enlaces y rutas que salgan del directorio de restauración.

### Elegir modo y leer el resultado

| Modo | Comportamiento |
| --- | --- |
| Manual | Mantiene el entorno para inspección hasta detenerlo o expirar: cuatro horas por defecto desde el arranque |
| Automático | Diagnostica, detiene y limpia el entorno |

El ID Health identifica el entorno; el ID de ejecución identifica el trabajo admitido.
Comprueba el estado, si el diagnóstico está completo, sus anomalías y los errores de limpieza.

| Resultado | Qué indica |
| --- | --- |
| `HEALTHY` | Healthchecks correctos, sin incidencias detectadas |
| `DEGRADED` | Healthchecks correctos tras reinicios o incidencias de memoria detectadas |
| `UNKNOWN` | Evidencia insuficiente, por ejemplo healthcheck ausente o pendiente |
| `UNHEALTHY` | Un healthcheck indica fallo |
| `FAILED` | Fallo de ejecución o de servicios necesarios |

Una respuesta `OK` no garantiza un diagnóstico positivo. Incluso con `HEALTHY`, comprueba que tu aplicación y sus datos funcionan como esperas.

### Informes y limpieza

- `stop` detiene el entorno; `delete` solicita además eliminar sus recursos propios y datos restaurados. Ambos conservan historial e informes.
- Los recursos compartidos, externos o de propiedad no demostrada se conservan. Si falla la limpieza, revisa el error y reintenta `delete` tras corregirlo.
- Una ejecución detenida no se reinicia: crea otra. Reiniciar KIDA cierra las interrumpidas e intenta limpiar, sin reanudar entornos manuales.
- Los informes duran 90 días por defecto. Borrar un informe no borra el entorno ni el historial, y no se reconstruye automáticamente. Consulta su listado para saber cuáles siguen disponibles.

Consulta los [comandos CLI](cli/backups-management.md#backup-health), los [comandos API](api/backups-management.md#backup-health)
y la [configuración de tiempos y límites](configuration.md).
