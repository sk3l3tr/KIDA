use clap::Subcommand;

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum DockerCommand {
    Containers {
        #[command(subcommand)]
        command: ContainersCommand,
    },
    Container {
        #[command(subcommand)]
        command: ContainerCommand,
    },
}

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum ContainersCommand {
    List,
}

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum ContainerCommand {
    Start {
        #[arg(value_name = "id-or-name")]
        container: String,
    },
    Stop {
        #[arg(value_name = "id-or-name")]
        container: String,
    },
    Restart {
        #[arg(value_name = "id-or-name")]
        container: String,
    },
    Delete {
        #[arg(value_name = "id-or-name")]
        container: String,
    },
}
