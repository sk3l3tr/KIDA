use clap::Subcommand;

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum SystemCommand {
    Info,
    Health,
    /// Program RTC wake and schedule shutdown in one minute.
    #[command(name = "powercicle")]
    PowerCycle {
        /// Next HH:MM in the server's local timezone.
        #[arg(long, value_name = "HH:MM", conflicts_with = "wake_after_seconds")]
        wake_time: Option<String>,
        /// Seconds from execution (minimum 120).
        #[arg(long, value_name = "SECONDS")]
        wake_after_seconds: Option<u64>,
    },
    /// Read-only RTC wake diagnosis.
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
