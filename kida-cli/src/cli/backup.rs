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

    /// Create from a local TOML file, configuration flags, or an interactive assistant.
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
    /// Read configuration locally; cannot be combined with configuration flags.
    #[arg(short = 'f', long, value_name = "PATH")]
    pub file: Option<std::path::PathBuf>,

    #[command(flatten)]
    pub parameters: CreateParameters,
}

#[derive(Debug, Default, Args, PartialEq, Eq)]
#[group(multiple = true)]
pub struct CreateParameters {
    /// Backup job name (required in parameter mode).
    #[arg(long)]
    pub name: Option<String>,

    /// Compression format (default: tar_zstd).
    #[arg(long, value_name = "COMPRESSION")]
    pub compression: Option<String>,

    /// Source path; repeat to add sources.
    #[arg(long = "source", value_name = "PATH")]
    pub sources: Vec<String>,

    /// Target path; repeat to add targets.
    #[arg(long = "target", value_name = "PATH")]
    pub targets: Vec<String>,

    /// Set required for a zero-based target index (default: true).
    #[arg(long, value_name = "INDEX=BOOL")]
    pub target_required: Vec<String>,

    /// Set filesystem UUID for a zero-based target index.
    #[arg(long, value_name = "INDEX=STRING")]
    pub target_filesystem_uuid: Vec<String>,

    /// Command to run before backup; repeat to add commands.
    #[arg(long, value_name = "COMMAND")]
    pub pre_backup: Vec<String>,

    /// Command to run after backup; repeat to add commands.
    #[arg(long, value_name = "COMMAND")]
    pub post_backup: Vec<String>,

    /// JSON params for a zero-based pre-backup command index (default: null).
    #[arg(long, value_name = "INDEX=JSON")]
    pub pre_backup_params: Vec<String>,

    /// JSON params for a zero-based post-backup command index (default: null).
    #[arg(long, value_name = "INDEX=JSON")]
    pub post_backup_params: Vec<String>,

    /// JSON metadata; does not create a scheduled execution.
    #[arg(long, value_name = "JSON")]
    pub schedule: Option<String>,

    /// Retention maximum age.
    #[arg(long, value_name = "STRING")]
    pub retention_max_age: Option<String>,

    /// Number of restore points to retain (unsigned 32-bit integer).
    #[arg(long, value_name = "U32")]
    pub retention_keep_last: Option<String>,

    /// Protected restore point; repeat to add entries.
    #[arg(long = "retention-protected-restore-point", value_name = "STRING")]
    pub retention_protected_restore_points: Vec<String>,
}

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum HealthCommand {
    Create {
        /// Definition path on CORE; never read by the client.
        #[arg(long)]
        file: String,
        /// Execution mode: automatic or manual.
        #[arg(long)]
        mode: String,
    },
    Run {
        /// Definition path on CORE; never read by the client.
        #[arg(long)]
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
