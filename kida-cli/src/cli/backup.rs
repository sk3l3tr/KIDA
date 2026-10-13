use clap::{ArgGroup, Args, Subcommand};

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum BackupCommand {
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

#[cfg(test)]
mod tests {
    use clap::Parser;

    use super::{CreateArgs, CreateParameters};

    #[derive(Debug, Parser)]
    struct CreateParser {
        #[command(flatten)]
        args: CreateArgs,
    }

    #[test]
    fn file_aliases_preserve_relative_paths() {
        for flag in ["-f", "--file"] {
            let parsed = CreateParser::try_parse_from(["kida", flag, "./daily.toml"]).unwrap();

            assert_eq!(
                parsed.args.file,
                Some(std::path::PathBuf::from("./daily.toml"))
            );
            assert_eq!(parsed.args.parameters, CreateParameters::default());
        }
    }

    #[test]
    fn no_options_leave_defaults_for_preparation() {
        let parsed = CreateParser::try_parse_from(["kida"]).unwrap();

        assert_eq!(parsed.args, CreateArgs::default());
    }

    #[test]
    fn repeated_elements_and_modifiers_preserve_order() {
        let parsed = CreateParser::try_parse_from([
            "kida",
            "--target-required",
            "1=false",
            "--target",
            "./main",
            "--pre-backup-params",
            "1=null",
            "--pre-backup",
            "first",
            "--target",
            "../secondary",
            "--pre-backup",
            "second",
            "--pre-backup-params",
            "0={}",
        ])
        .unwrap();

        let parameters = parsed.args.parameters;
        assert_eq!(parameters.targets, ["./main", "../secondary"]);
        assert_eq!(parameters.target_required, ["1=false"]);
        assert_eq!(parameters.pre_backup, ["first", "second"]);
        assert_eq!(parameters.pre_backup_params, ["1=null", "0={}"]);
    }

    #[test]
    fn every_configuration_flag_is_detectable() {
        for (flag, value) in [
            ("--name", "daily"),
            ("--compression", "tar_zstd"),
            ("--source", "/etc/hosts"),
            ("--target", "/mnt/backups"),
            ("--target-required", "0=false"),
            ("--target-filesystem-uuid", "0=uuid"),
            ("--pre-backup", "first"),
            ("--post-backup", "last"),
            ("--pre-backup-params", "0=null"),
            ("--post-backup-params", "0={}"),
            ("--schedule", "null"),
            ("--retention-max-age", "7d"),
            ("--retention-keep-last", "0"),
            ("--retention-protected-restore-point", "point"),
        ] {
            let parsed = CreateParser::try_parse_from(["kida", flag, value]).unwrap();

            assert_ne!(
                parsed.args.parameters,
                CreateParameters::default(),
                "{flag}"
            );
        }
    }

    #[test]
    fn captures_file_and_parameters_for_local_mode_validation() {
        let parsed =
            CreateParser::try_parse_from(["kida", "-f", "daily.toml", "--name", "daily"]).unwrap();

        assert!(parsed.args.file.is_some());
        assert_ne!(parsed.args.parameters, CreateParameters::default());
    }
}
