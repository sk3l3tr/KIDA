pub const DEFAULT_CONFIG_PATH: &str = "/etc/kida/kida.toml";
pub const DEFAULT_BACKUP_DIRECTORY: &str = "/etc/kida/backups.d";
pub const DEFAULT_SCHEDULER_PATH: &str = "/etc/kida/scheduler.toml";

pub const DEFAULT_UNIX_SOCKET_PATH: &str = "/tmp/kida.sock";

pub const DEFAULT_HTTP_HOST: &str = "127.0.0.1";
pub const DEFAULT_HTTP_PORT: u16 = 8989;

pub const DEFAULT_QUEUE_CAPACITY: usize = 16;
pub const DEFAULT_MAX_CONCURRENT_JOBS: usize = 2;
