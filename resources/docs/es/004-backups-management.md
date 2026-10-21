# Gestión de backups

[English](../en/004-backups-management.md) · [Índice de documentación](000-index.md)

## Configuraciones y ejecución

Una configuración describe orígenes, destinos, compresión, pasos de lifecycle y metadatos opcionales de programación
y retención. Crea, lista o elimina configuraciones y encola ejecuciones por ID o nombre. Eliminar una configuración
es permanente. La admisión de `backup.run` devuelve un ID de ejecución de cola; no confirma un archivo terminado.
El campo `schedule` es metadato: crea una entrada independiente en scheduler para automatizar el backup.

Las rutas de origen y destino conservan su valor literal y CORE las comprueba al ejecutar.
La compresión es `tar_zstd`. Los destinos son obligatorios por defecto. El lifecycle admite exclusivamente
`docker.container.stop`, `docker.container.start` y `docker.container.restart`.
Pre-backup se detiene al primer fallo; post-backup intenta todos sus pasos incluso tras errores de pre o archivado.
Un fallo de post impide calcular el checksum y replicar. Terminar el proceso o cancelar la tarea no garantiza
los pasos de recuperación. Consulta el [contrato de configuración](api/backups-management.md).

## Backup Health

Health restaura un artefacto registrado en un directorio independiente, inicia su entorno Compose revisado,
obtiene un diagnóstico técnico y gestiona limpieza e informes. No existe un comando independiente `backup restore`.

Prepara una definición en el servidor CORE, separada de la configuración del backup:

```toml
id = "app-health"
name = "Application Backup Health"

[backup]
reference = "daily"
version = "latest"

[docker]
compose = "./docker-compose.health.yml"
```

Todos los campos son obligatorios y no vacíos. Usa un ID de definición único y estable. `reference` selecciona
una configuración por ID/nombre sin ambigüedad; `version` admite `latest` o el UUID de un artefacto registrado.
No se importan backups antiguos sin registro. Las rutas Compose se resuelven respecto al directorio canónico
de la definición en CORE.

```yaml
services:
  app:
    image: example/app:stable
    restart: "no"
    volumes:
      - type: bind
        source: ${KIDA_RESTORE_DIR}/app-data
        target: /app/data
        bind:
          create_host_path: false
```

Este fragmento ilustra el bind; no es una aplicación lista para ejecutar. Sustituye la imagen y añade healthchecks
adecuados. `app-data` debe coincidir con la estructura relativa del archivo, que conserva las rutas de origen
sin el `/` inicial. Health proporciona `KIDA_RESTORE_DIR`. Usa `restart: "no"` y evita montajes de producción:
Compose es configuración confiable del administrador, no un sandbox. El administrador valida la integridad funcional.
Ejemplos del repositorio: [definición](../../../kida-core/examples/backup-health/nextcloud-health.toml)
y [Compose](../../../kida-core/examples/backup-health/docker-compose.health.yml).

### Ejecuciones, diagnóstico y limpieza

`create` produce `CREATED`; `start` admite trabajo de forma asíncrona y devuelve un ID Health y otro ID distinto
de ejecución de cola. El cupo, la saturación de cola o una ejecución activa de la misma definición pueden impedir
la admisión. Los entornos manuales siguen disponibles tras el diagnóstico hasta detenerse o expirar (cuatro horas
por defecto desde `started_at`). Los automáticos diagnostican, detienen y limpian su entorno. Una ejecución detenida
no se reinicia: crea otra. Al reiniciar CORE se cierran las interrumpidas y se intenta limpiar; no se reanudan las manuales.

El estado operativo y el resultado técnico son distintos. Los resultados incluyen `FAILED`, `UNHEALTHY`, `UNKNOWN`,
`DEGRADED` y `HEALTHY`. Revisa finalización, anomalías y errores de limpieza incluso si el protocolo devuelve `OK`.
`stop` detiene el entorno; `delete` solicita además eliminar recursos propios y el directorio restaurado, conservando
historial e informes. Los errores de limpieza quedan visibles para reintento. Se conservan recursos externos,
compartidos o sin propiedad demostrada en lugar de forzar su eliminación.

### Artefactos e informes

Los nuevos backups usan `<name>-<UTC-date>-<artifact_id>.tar.zst`. Los nombres no admiten componentes de ruta.
Los destinos verificados se registran en `backup_health.data_root/artifacts/<job-id>/<artifact-id>.json`
con tamaño, SHA-256 y rutas absolutas. Los destinos y el catálogo deben admitir enlaces duros para publicar sin
sobrescribir. Un destino obligatorio fallido mantiene el error aunque otro quede registrado; un fallo del catálogo
conserva los archivos copiados, pero no estarán disponibles para Health sin registro válido.
Sin destinos verificados no se publica registro. Los fallos de destinos opcionales conservan su tratamiento actual.

`latest` elige la fecha más reciente y el UUID mayor en empates; prueba los destinos de ese artefacto en orden,
sin volver a una versión anterior. Un registro corrupto impide resolver `latest`.
La restauración verifica tamaño/checksum y admite archivos regulares/directorios, rechazando enlaces y rutas de escape.
Conserva permisos ordinarios y rutas relativas, sin restaurar propietarios ni bits especiales.

La retención de informes es de 90 días por defecto. Se preserva el historial necesario para limpieza pendiente.
Eliminar un informe conserva historial e impide reconstruirlo automáticamente. Una ruta registrada puede sobrevivir
al informe; consulta su listado para comprobar disponibilidad. El catálogo no importa históricos ni aplica retención de informes.

## Elige tu interfaz

- [CONSOLE](console/backups-management.md) — aún no implementada.
- [CLI](cli/backups-management.md).
- [API directa](api/backups-management.md).

Consulta la [configuración](configuration.md) para almacenamiento, TTL, timeouts y límites.
