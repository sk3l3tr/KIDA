pub const BANNER: &str = concat!(
    r#">< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< ><
>< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< ><

    888    d8P  8888888 8888888b.        d8888  v"#,
    env!("CARGO_PKG_VERSION"),
    r#"
    888   d8P     888   888  "Y88b      d88888  CLI
    888  d8P      888   888    888     d88P888
    888d88K       888   888    888    d88P 888
    8888888b      888   888    888   d88P  888
    888  Y88b     888   888    888  d88P   888
    888   Y88b    888   888  .d88P d8888888888
    888    Y88b 8888888 8888888P" d88P     888

>< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< ><
>< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< ><"#,
);

pub const ABOUT: &str = "Command-line client for KIDA";
pub const POWER_CYCLE: &str = "Program RTC wake and schedule shutdown (defaults to one minute).";
pub const SHUTDOWN_TIME: &str =
    "Shutdown today at HH:MM in the server's local timezone (minimum 60 seconds ahead).";
pub const WAKE_TIME: &str = "Next HH:MM in the server's local timezone.";
pub const WAKE_AFTER_SECONDS: &str = "Seconds from execution (minimum 120).";
pub const WAKE_CAPABILITIES: &str = "Read-only RTC wake diagnosis.";
pub const BACKUP_CREATE: &str =
    "Create from a local TOML file, configuration flags, or an interactive assistant.";
pub const BACKUP_FILE: &str =
    "Read configuration locally; cannot be combined with configuration flags.";
pub const BACKUP_NAME: &str = "Backup job name (required in parameter mode).";
pub const COMPRESSION: &str = "Compression format (default: tar_zstd).";
pub const SOURCES: &str = "Source path; repeat to add sources.";
pub const TARGETS: &str = "Target path; repeat to add targets.";
pub const TARGET_REQUIRED: &str = "Set required for a zero-based target index (default: true).";
pub const TARGET_FILESYSTEM_UUID: &str = "Set filesystem UUID for a zero-based target index.";
pub const PRE_BACKUP: &str = "Command to run before backup; repeat to add commands.";
pub const POST_BACKUP: &str = "Command to run after backup; repeat to add commands.";
pub const PRE_BACKUP_PARAMS: &str =
    "JSON params for a zero-based pre-backup command index (default: null).";
pub const POST_BACKUP_PARAMS: &str =
    "JSON params for a zero-based post-backup command index (default: null).";
pub const SCHEDULE: &str = "JSON metadata; does not create a scheduled execution.";
pub const RETENTION_MAX_AGE: &str = "Retention maximum age.";
pub const RETENTION_KEEP_LAST: &str =
    "Number of restore points to retain (unsigned 32-bit integer).";
pub const RETENTION_PROTECTED_RESTORE_POINTS: &str =
    "Protected restore point; repeat to add entries.";
pub const HEALTH_FILE: &str = "Definition path on CORE; never read by the client.";
pub const HEALTH_MODE: &str = "Execution mode: automatic or manual.";
pub const SCHEDULER_ADD: &str = "Add from a local TOML file, flags, or an interactive assistant.";
pub const SCHEDULER_PARAMS: &str = "Required JSON, including null.";
pub const SCHEDULER_TIMEZONE: &str = "IANA timezone for cron (default: UTC).";
