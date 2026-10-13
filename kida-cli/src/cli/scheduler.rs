use clap::{Args, Subcommand};

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum SchedulerCommand {
    /// Add from a local TOML file, flags, or an interactive assistant.
    Add(AddArgs),
    List,
    Delete {
        #[arg(long)]
        id: String,
    },
}

#[derive(Debug, Default, Args, PartialEq, Eq)]
#[group(multiple = true)]
pub struct AddArgs {
    #[arg(short = 'f', long, value_name = "PATH")]
    pub file: Option<std::path::PathBuf>,
    #[command(flatten)]
    pub parameters: AddParameters,
}

#[derive(Debug, Default, Args, PartialEq, Eq)]
#[group(multiple = true)]
pub struct AddParameters {
    #[arg(long)]
    pub command: Option<String>,
    /// Required JSON, including null.
    #[arg(long, value_name = "JSON")]
    pub params: Option<String>,
    #[arg(long, value_name = "RFC3339")]
    pub at: Option<String>,
    #[arg(long, value_name = "U64")]
    pub seconds: Option<u64>,
    #[arg(long, value_name = "EXPRESSION")]
    pub cron: Option<String>,
    /// IANA timezone for cron (default: UTC).
    #[arg(long, value_name = "IANA")]
    pub timezone: Option<String>,
}
