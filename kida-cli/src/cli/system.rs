use clap::Subcommand;

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum SystemCommand {
    Info,
    Health,
    Shutdown {
        #[arg(value_name = "time")]
        time: String,
    },
    Reboot {
        #[arg(value_name = "time")]
        time: String,
    },
}
