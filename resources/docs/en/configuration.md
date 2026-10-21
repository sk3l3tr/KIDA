# CORE configuration

[Castellano](../es/configuration.md) · [Documentation index](000-index.md)

CORE loads `/etc/kida/kida.toml` once before starting runtime services. If missing,
it creates the default configuration; malformed configuration prevents startup.
Omitted sections and fields use these defaults:

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

## Limits and paths

- Queue capacity and concurrency must be positive and fit admission/semaphore limits. `backup.run` jobs execute one at a time.
- Health times and capacity must be positive and fit their supported limits. `max_active_runs` includes active manual environments and is independent of worker concurrency.
- Health roots must be absolute, distinct and not contain one another. Validation resolves existing ancestors and symlinks without creating directories.
- CORE needs read/write permissions for its configuration, backup definitions, scheduler and Health storage, and Docker ownership records when used.
- A missing scheduler file starts empty; a corrupt one prevents startup and is not overwritten. See [scheduler behavior](005-task-scheduling.md).
- Health TTL is measured from `started_at`; querying does not renew it. Expiration is checked periodically. Report retention does not apply to the artifact catalog.

## Endpoints and restart

The CLI currently uses the fixed path `/tmp/kida.sock`. Changing `unix.socket_path`
requires direct socket clients to use the new path and makes the current CLI unable to connect.
HTTP is bound to loopback by default. The current server has no built-in authentication or TLS;
keep access limited to trusted clients and networks.

The socket directory must allow socket and lock-file creation and be protected from unrelated modification.
CORE rejects non-socket entries and active sockets; it only recovers a stale socket on `ConnectionRefused`.
`<socket_path>.lock` remains after shutdown. Do not remove it while an instance is active.
Permission and inspection errors stop startup without deleting the entry.

After reviewing changes, restart and check the service:

```bash
sudo systemctl restart kida
systemctl --no-pager --full status kida
```

Restart does not recover queued requests or resume manual Health environments.
See [backups](004-backups-management.md) and [scheduling](005-task-scheduling.md) before restarting during operations.
