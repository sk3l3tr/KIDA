# Backups mediante CLI

[English](../../en/cli/backups-management.md) · [Índice de documentación](../000-index.md)

## Listar configuraciones

```bash
kida backup config list
```

Cada configuración muestra nombre, ID, compresión, orígenes, destinos, lifecycle, programación y retención.
La programación mostrada en el job es metadato: no crea ejecuciones automáticas.

Ejemplo de salida:

```text
Name: Nextcloud
ID: 8e1dba64-36c2-4eac-937c-d23a283256ec
Compression: tar_zstd
Schedule:
  {
    "cron": "0 3 * * *"
  }
Sources:
  - /srv/nextcloud
Targets:
  - /mnt/backups (required, filesystem UUID: 2d89-55c1)
Lifecycle:
  Pre-backup: None
  Post-backup: None
Retention:
  Max age: 30d
  Keep last: 7
  Protected restore points: None
```

## Crear una configuración

Elige archivo TOML local, parámetros o asistente:

```bash
kida backup config create --file ./backup-job.toml
kida backup config create --name daily --source /etc/hosts --target ../backups
kida backup config create
```

`-f` y `--file` son alias. CLI lee y valida el TOML respecto al directorio de trabajo local y envía
su contenido, nunca la ruta del archivo. Las rutas de origen/destino se mantienen literales y CORE las
interpreta al ejecutar; crear no comprueba su existencia.

Archivo y parámetros son excluyentes. Cualquier opción de configuración selecciona parámetros y exige
`--name`, al menos un `--source` y un `--target`. Parámetros incompletos o inválidos fallan localmente con
código 1, sin conectar ni abrir el asistente. El asistente requiere terminal interactiva, escribe preguntas
en stderr, muestra valores predeterminados, reintenta valores inválidos, pregunta cantidades antes de listas
y confirma bloques opcionales. EOF o Ctrl+C cancelan.

Repite `--source`, `--target`, `--pre-backup`, `--post-backup` y
`--retention-protected-restore-point` para añadir elementos ordenados. Los modificadores indexados
usan `INDEX=VALUE`, desde cero, antes o después de sus elementos:

```bash
kida backup config create --name daily \
  --source /etc/hosts --target ./primary --target ../secondary \
  --target-required '1=false' --target-filesystem-uuid '0=volume-id' \
  --pre-backup docker.container.stop --pre-backup-params '0={"container":"backup-source"}' \
  --post-backup docker.container.start --post-backup-params '0={"container":"backup-source"}' \
  --schedule '{"custom":[null,1]}' \
  --retention-max-age 7d --retention-keep-last 7 \
  --retention-protected-restore-point point-a
```

Adapta `backup-source` a tu contenedor antes de ejecutar el job. Los modificadores duplicados o fuera de
rango fallan localmente. `--compression` admite `tar_zstd`, valor predeterminado. Los destinos usan
`required = true`; los parámetros lifecycle usan JSON `null` por defecto. `--schedule` y los parámetros
lifecycle admiten JSON arbitrario; `--retention-keep-last` admite enteros sin signo de 32 bits.
El lifecycle al ejecutar solo permite detener, iniciar y reiniciar contenedores.

TOML mínimo:

```toml
name = "daily"
sources = ["/etc/hosts"]
[[targets]]
path = "../backups"
```

Consulta el [contrato de campos](../api/backups-management.md), compartido por los tres modos.
Usa scheduler para automatizar la ejecución.

## Eliminar o ejecutar

Indica exactamente un selector, ID o nombre:

```bash
kida backup config delete --id <id-code>
kida backup config delete --name <name>
kida backup run --id <id-code>
kida backup run --name <name>
```

Eliminar la configuración es permanente: verifica el selector. Al admitir una ejecución se muestra:

```text
Backup queued (Execution ID: 4f79f9e1-1628-4e86-88bb-e96f5507aa1f).
```

Esto confirma admisión, no finalización del backup.

## Backup Health

Los comandos Health muestran texto legible, sin `--json` ni asistente. Todas las opciones obligatorias
deben indicarse; UUID y modo se validan antes de conectar. `--file` es la ruta de definición en CORE y
se transmite sin leerla ni resolverla localmente, incluso si es relativa. CORE resuelve Compose respecto
a la definición. Prepara antes la [definición y Compose](../004-backups-management.md#backup-health).

Crear y arrancar un entorno manual:

```bash
kida backup health create --file /srv/health/app.toml --mode manual
kida backup health start --run-id <UUID>
kida backup health get --run-id <UUID>
kida backup health stop --run-id <UUID>
kida backup health delete --run-id <UUID>
```

`create` devuelve `CREATED`; `start` admite trabajo asíncrono y muestra el ID Health y el ID independiente
de ejecución de cola. El entorno manual permanece tras el diagnóstico hasta detenerse o expirar.
Su TTL predeterminado es de cuatro horas desde `started_at`; la expiración se revisa periódicamente,
sin plazo exacto. Cupo, cola llena o una ejecución activa de la misma definición pueden impedir la admisión.

Ejecutar automáticamente diagnóstico, parada y limpieza:

```bash
kida backup health run --file /srv/health/app.toml
# Alternativa: crear primero y arrancar el UUID devuelto.
kida backup health create --file /srv/health/app.toml --mode automatic
kida backup health start --run-id <UUID>
kida backup health list
```

Programar una nueva ejecución automática en cada vencimiento:

```bash
kida scheduler add --command backup.health.run \
  --params '{"definition_path":"/srv/health/app.toml"}' \
  --cron '30 2 * * *' --timezone Europe/Madrid
```

`get`, `stop` y `delete` separan estado operativo y resultado técnico (`FAILED`, `UNHEALTHY`, `UNKNOWN`,
`DEGRADED`, `HEALTHY`), mostrando diagnóstico parcial/completo, fechas, artefacto, anomalías, errores de
limpieza y ruta del informe. Una respuesta correcta puede contener fallo técnico o limpieza incompleta:
revisa esos campos. Los errores de transporte y protocolo mantienen sus mensajes y códigos de salida.

`stop` detiene el entorno; `delete` solicita además eliminar recursos propios y directorio restaurado,
conservando historial e informes. Los fallos de limpieza permiten reintento. Una ejecución detenida no se
reinicia: crea otra. Reiniciar CORE cierra las interrumpidas e intenta limpiar, sin reanudar entornos manuales.

```bash
kida backup health report list
kida backup health report get --run-id <UUID>
kida backup health report delete --run-id <UUID>
```

`report get` imprime el Markdown recibido. Una ruta registrada puede sobrevivir al informe: consulta el
listado. Borrar un informe conserva historial e impide reconstruirlo automáticamente. La retención es de
90 días por defecto y se conservan los registros necesarios para limpieza pendiente. Los cambios de
configuración requieren reiniciar CORE.

Utiliza Compose revisado por un administrador y rutas de restauración aisladas: los binds pueden afectar
a producción. El diagnóstico es técnico; el administrador valida la integridad funcional. Las pruebas
simuladas no demuestran aceptación con Docker real.
