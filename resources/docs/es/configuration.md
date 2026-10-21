# Configuración de CORE

[English](../en/configuration.md) · [Índice de documentación](000-index.md)

CORE carga `/etc/kida/kida.toml` una sola vez antes de iniciar sus servicios. Si falta,
crea la configuración predeterminada; una configuración inválida impide el arranque.
Las secciones y campos omitidos usan estos valores:

```toml
[unix]
socket_path = "/tmp/kida.sock"

[http]
host = "127.0.0.1"
port = 8989

[backup]
backup_dir = "/etc/kida/backups.d"

[scheduler]
path = "/etc/kida/scheduler.toml"

[queue]
capacity = 16
max_concurrent_jobs = 2

[docker]
ownership_dir = "/etc/kida/docker.d"

[backup_health]
restore_root = "/tmp/kida/restored"
data_root = "/var/lib/kida/backup-health"
manual_ttl_hours = 4
health_timeout_seconds = 180
report_retention_days = 90
max_active_runs = 2
```

## Límites y rutas

- Capacidad y concurrencia de la cola deben ser positivas y respetar los límites de admisión y semáforos. Los trabajos `backup.run` se ejecutan de uno en uno.
- Los tiempos y el cupo de Health deben ser positivos y caber en sus límites. `max_active_runs` incluye entornos manuales activos y es independiente de la concurrencia del worker.
- Las raíces Health deben ser absolutas, distintas y no contenerse entre sí. La validación resuelve antecesores existentes y enlaces sin crear directorios.
- CORE necesita permisos de lectura/escritura para configuración, definiciones de backup, scheduler, almacenamiento Health y registros de propiedad Docker cuando se utilicen.
- Un archivo de scheduler ausente empieza vacío; uno corrupto impide arrancar y no se sobrescribe. Consulta el [comportamiento del scheduler](005-task-scheduling.md).
- El TTL de Health se mide desde `started_at`; consultar no lo renueva. La expiración se comprueba periódicamente. La retención de informes no afecta al catálogo de artefactos.

## Endpoints y reinicio

La CLI actual usa la ruta fija `/tmp/kida.sock`. Si cambias `unix.socket_path`, los clientes directos
deben utilizar la nueva ruta y la CLI actual dejará de conectar.
HTTP escucha en loopback por defecto. El servidor actual no incorpora autenticación ni TLS;
limita el acceso a clientes y redes de confianza.

El directorio del socket debe permitir crear el socket y su archivo de bloqueo y estar protegido de
modificaciones ajenas. CORE rechaza entradas que no sean sockets y sockets activos; solo recupera uno
obsoleto ante `ConnectionRefused`. `<socket_path>.lock` permanece tras detener CORE. No lo borres mientras
haya una instancia activa. Los errores de permisos e inspección impiden arrancar sin borrar la entrada.

Tras revisar los cambios, reinicia y comprueba el servicio:

```bash
sudo systemctl restart kida
systemctl --no-pager --full status kida
```

El reinicio no recupera peticiones encoladas ni reanuda entornos Health manuales.
Consulta [backups](004-backups-management.md) y [scheduler](005-task-scheduling.md) antes de reiniciar durante operaciones.
