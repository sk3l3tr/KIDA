# Configure KIDA

[Castellano](../es/configuration.md) · [Index](000-index.md)

Edit `/etc/kida/kida.toml` with administrator permissions. KIDA creates the file with defaults
if missing; invalid configuration prevents startup. Omitted fields use these values:

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

## What to adjust

| Setting | Use |
| --- | --- |
| `unix.socket_path` | Local connection. The CLI requires `/tmp/kida.sock`; changing it prevents CLI connections |
| `http.host`, `http.port` | Listen address for [API integrations](api/README.md) |
| `backup.backup_dir` | Backup configurations; not the destination for saved backups |
| `scheduler.path` | Schedule file; starts empty if missing, prevents startup if corrupt |
| `queue.capacity` | Pending work capacity |
| `queue.max_concurrent_jobs` | Simultaneous jobs; positive. Backups run one at a time |
| `docker.ownership_dir` | Managed Docker resource records; keep these for safe cleanup |
| `backup_health.restore_root` | Temporary restore directories |
| `backup_health.data_root` | Backup catalog, history and reports; keep these to use Health |
| `backup_health.manual_ttl_hours` | Manual environment lifetime from start; querying does not renew it |
| `backup_health.health_timeout_seconds` | Maximum wait for diagnosis |
| `backup_health.report_retention_days` | Report retention; does not delete backup files |
| `backup_health.max_active_runs` | Active environments, including manual ones; independent of job concurrency |

Durations and `max_active_runs` must be positive. Health roots must be absolute, distinct and must not contain each other.
The service needs read and write permissions for the paths it uses.
HTTP has no authentication or TLS: restrict access to trusted clients and networks.

## Apply changes

Changes require a restart. First wait for pending work to finish and review Health environments:
[interrupted runs are not recovered](005-task-scheduling.md#deletion-and-restart).

```bash
sudo systemctl restart kida
systemctl --no-pager --full status kida
kida system info
```

If this fails, see [troubleshooting](troubleshooting.md).
