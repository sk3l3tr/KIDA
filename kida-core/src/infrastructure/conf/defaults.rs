pub const DEFAULT_CONFIG_PATH: &str = "/etc/kida/kida.toml";
pub const DEFAULT_BACKUP_DIRECTORY: &str = "/etc/kida/backups.d";
pub const DEFAULT_SCHEDULER_PATH: &str = "/etc/kida/scheduler.toml";

pub const DEFAULT_UNIX_SOCKET_PATH: &str = "/tmp/kida.sock";

pub const DEFAULT_HTTP_HOST: &str = "127.0.0.1";
pub const DEFAULT_HTTP_PORT: u16 = 8989;

pub const DEFAULT_QUEUE_CAPACITY: usize = 16;
pub const DEFAULT_MAX_CONCURRENT_JOBS: usize = 2;

pub const DEFAULT_DOCKER_OWNERSHIP_DIR: &str = "/etc/kida/docker.d";

pub const DEFAULT_HEALTH_RESTORE_ROOT: &str = "/tmp/kida/restored";
pub const DEFAULT_HEALTH_DATA_ROOT: &str = "/var/lib/kida/backup-health";
pub const DEFAULT_HEALTH_MANUAL_TTL_HOURS: u64 = 4;
pub const DEFAULT_HEALTH_TIMEOUT_SECONDS: u64 = 180;
pub const DEFAULT_HEALTH_REPORT_RETENTION_DAYS: u64 = 90;
pub const DEFAULT_HEALTH_MAX_ACTIVE_RUNS: usize = 2;
