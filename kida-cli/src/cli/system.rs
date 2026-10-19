use clap::Subcommand;

use super::texts;

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum SystemCommand {
    Info,
    Health,
    #[command(about = texts::POWER_CYCLE, name = "powercicle")]
    PowerCycle {
        #[arg(help = texts::SHUTDOWN_TIME, long, value_name = "HH:MM")]
        shutdown_time: Option<String>,
        #[arg(help = texts::WAKE_TIME, long, value_name = "HH:MM", conflicts_with = "wake_after_seconds")]
        wake_time: Option<String>,
        #[arg(help = texts::WAKE_AFTER_SECONDS, long, value_name = "SECONDS")]
        wake_after_seconds: Option<u64>,
    },
    #[command(about = texts::WAKE_CAPABILITIES)]
    WakeCapabilities,
    Shutdown {
        #[arg(value_name = "time")]
        time: String,
    },
    Reboot {
        #[arg(value_name = "time")]
        time: String,
    },
}
