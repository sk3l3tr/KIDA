mod backup;
mod docker;
mod scheduler;
mod system;

use clap::{Parser, Subcommand};

pub use backup::{BackupCommand, BackupConfigCommand, CreateParameters};
pub use docker::{ContainerCommand, ContainersCommand, DockerCommand};
pub use scheduler::{AddParameters, SchedulerCommand};
pub use system::SystemCommand;

#[derive(Debug, Parser, PartialEq, Eq)]
#[command(name = "kida", version, about = "Command-line client for KIDA")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum Command {
    Scheduler {
        #[command(subcommand)]
        command: SchedulerCommand,
    },
    System {
        #[command(subcommand)]
        command: SystemCommand,
    },
    Docker {
        #[command(subcommand)]
        command: DockerCommand,
    },
    Backup {
        #[command(subcommand)]
        command: BackupCommand,
    },
}
