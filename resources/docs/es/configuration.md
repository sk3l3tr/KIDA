# Configurar KIDA

[English](../en/configuration.md) · [Índice](000-index.md)

Edita `/etc/kida/kida.toml` con permisos de administrador. KIDA crea el archivo con valores predeterminados
si falta; una configuración inválida impide arrancar. Los campos omitidos usan estos valores:

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

## Qué ajustar

| Ajuste | Uso |
| --- | --- |
| `unix.socket_path` | Conexión local. La CLI exige `/tmp/kida.sock`; cambiarlo impide que conecte |
| `http.host`, `http.port` | Dirección de escucha para [integraciones API](api/README.md) |
| `backup.backup_dir` | Configuraciones de backup; no es el destino de las copias |
| `scheduler.path` | Archivo de programaciones; si falta empieza vacío, si está corrupto impide arrancar |
| `queue.capacity` | Capacidad de trabajo pendiente |
| `queue.max_concurrent_jobs` | Trabajos simultáneos; positivo. Los backups se ejecutan de uno en uno |
| `docker.ownership_dir` | Registro de recursos Docker gestionados; consérvalo para permitir su limpieza segura |
| `backup_health.restore_root` | Directorios temporales de restauración |
| `backup_health.data_root` | Catálogo de copias, historial e informes; consérvalo para usar Health |
| `backup_health.manual_ttl_hours` | Duración del entorno manual desde su arranque; consultarlo no renueva el plazo |
| `backup_health.health_timeout_seconds` | Tiempo máximo de espera del diagnóstico |
| `backup_health.report_retention_days` | Retención de informes; no elimina copias de backup |
| `backup_health.max_active_runs` | Entornos activos, incluidos manuales; independiente de la concurrencia de trabajos |

Los tiempos y `max_active_runs` deben ser positivos. Las raíces Health deben ser absolutas, distintas y no contenerse entre sí.
El servicio necesita permisos de lectura y escritura en las rutas utilizadas.
HTTP no incluye autenticación ni TLS: limita el acceso a clientes y redes de confianza.

## Aplicar cambios

Los cambios requieren reiniciar. Antes, espera a que termine el trabajo pendiente y revisa los entornos Health:
[no se recuperan las ejecuciones interrumpidas](005-task-scheduling.md#borrado-y-reinicio).

```bash
sudo systemctl restart kida
systemctl --no-pager --full status kida
kida system info
```

Si falla, consulta [solución de problemas](troubleshooting.md).
