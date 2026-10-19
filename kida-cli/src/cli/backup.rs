use super::texts;

use clap::{ArgGroup, Args, Subcommand};

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum BackupCommand {
    Health {
        #[command(subcommand)]
        command: HealthCommand,
    },

    Config {
        #[command(subcommand)]
        command: BackupConfigCommand,
    },

    #[command(group(
        ArgGroup::new("selector")
            .required(true)
            .multiple(false)
            .args(["id", "name"])
    ))]
    Run {
        #[arg(long)]
        id: Option<String>,

        #[arg(long)]
        name: Option<String>,
    },
}

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum BackupConfigCommand {
    List,

    #[command(about = texts::BACKUP_CREATE)]
    Create(Box<CreateArgs>),

    #[command(group(
        ArgGroup::new("selector")
            .required(true)
            .multiple(false)
            .args(["id", "name"])
    ))]
    Delete {
        #[arg(long)]
        id: Option<String>,

        #[arg(long)]
        name: Option<String>,
    },
}

#[derive(Debug, Default, Args, PartialEq, Eq)]
#[group(multiple = true)]
pub struct CreateArgs {
    #[arg(help = texts::BACKUP_FILE, short = 'f', long, value_name = "PATH")]
    pub file: Option<std::path::PathBuf>,

    #[command(flatten)]
    pub parameters: CreateParameters,
}

#[derive(Debug, Default, Args, PartialEq, Eq)]
#[group(multiple = true)]
pub struct CreateParameters {
    #[arg(help = texts::BACKUP_NAME, long)]
    pub name: Option<String>,

    #[arg(help = texts::COMPRESSION, long, value_name = "COMPRESSION")]
    pub compression: Option<String>,

    #[arg(help = texts::SOURCES, long = "source", value_name = "PATH")]
    pub sources: Vec<String>,

    #[arg(help = texts::TARGETS, long = "target", value_name = "PATH")]
    pub targets: Vec<String>,

    #[arg(help = texts::TARGET_REQUIRED, long, value_name = "INDEX=BOOL")]
    pub target_required: Vec<String>,

    #[arg(help = texts::TARGET_FILESYSTEM_UUID, long, value_name = "INDEX=STRING")]
    pub target_filesystem_uuid: Vec<String>,

    #[arg(help = texts::PRE_BACKUP, long, value_name = "COMMAND")]
    pub pre_backup: Vec<String>,

    #[arg(help = texts::POST_BACKUP, long, value_name = "COMMAND")]
    pub post_backup: Vec<String>,

    #[arg(help = texts::PRE_BACKUP_PARAMS, long, value_name = "INDEX=JSON")]
    pub pre_backup_params: Vec<String>,

    #[arg(help = texts::POST_BACKUP_PARAMS, long, value_name = "INDEX=JSON")]
    pub post_backup_params: Vec<String>,

    #[arg(help = texts::SCHEDULE, long, value_name = "JSON")]
    pub schedule: Option<String>,

    #[arg(help = texts::RETENTION_MAX_AGE, long, value_name = "STRING")]
    pub retention_max_age: Option<String>,

    #[arg(help = texts::RETENTION_KEEP_LAST, long, value_name = "U32")]
    pub retention_keep_last: Option<String>,

    #[arg(help = texts::RETENTION_PROTECTED_RESTORE_POINTS, long = "retention-protected-restore-point", value_name = "STRING")]
    pub retention_protected_restore_points: Vec<String>,
}

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum HealthCommand {
    Create {
        #[arg(help = texts::HEALTH_FILE, long)]
        file: String,
        #[arg(help = texts::HEALTH_MODE, long)]
        mode: String,
    },
    Run {
        #[arg(help = texts::HEALTH_FILE, long)]
        file: String,
    },
    Start {
        #[arg(long)]
        run_id: String,
    },
    Get {
        #[arg(long)]
        run_id: String,
    },
    Stop {
        #[arg(long)]
        run_id: String,
    },
    Delete {
        #[arg(long)]
        run_id: String,
    },
    List,
    Report {
        #[command(subcommand)]
        command: HealthReportCommand,
    },
}

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum HealthReportCommand {
    List,
    Get {
        #[arg(long)]
        run_id: String,
    },
    Delete {
        #[arg(long)]
        run_id: String,
    },
}
