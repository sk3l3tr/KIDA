mod docker;
mod system;

use clap::{Parser, Subcommand};

pub use docker::{ContainerCommand, ContainersCommand, DockerCommand};
pub use system::SystemCommand;

#[derive(Debug, Parser, PartialEq, Eq)]
#[command(name = "kida", version, about = "Command-line client for KIDA")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum Command {
    Health,
    System {
        #[command(subcommand)]
        command: SystemCommand,
    },
    Docker {
        #[command(subcommand)]
        command: DockerCommand,
    },
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    use super::{Cli, Command, ContainerCommand, ContainersCommand, DockerCommand, SystemCommand};

    #[test]
    fn parses_every_valid_command_path() {
        let cases = [
            (vec!["kida", "health"], Command::Health),
            (
                vec!["kida", "system", "info"],
                Command::System {
                    command: SystemCommand::Info,
                },
            ),
            (
                vec!["kida", "system", "health"],
                Command::System {
                    command: SystemCommand::Health,
                },
            ),
            (
                vec!["kida", "system", "shutdown", "23:30"],
                Command::System {
                    command: SystemCommand::Shutdown {
                        time: "23:30".into(),
                    },
                },
            ),
            (
                vec!["kida", "docker", "containers", "list"],
                Command::Docker {
                    command: DockerCommand::Containers {
                        command: ContainersCommand::List,
                    },
                },
            ),
            (
                vec!["kida", "docker", "container", "start", "web-01"],
                Command::Docker {
                    command: DockerCommand::Container {
                        command: ContainerCommand::Start {
                            container: "web-01".into(),
                        },
                    },
                },
            ),
            (
                vec!["kida", "docker", "container", "stop", "abc123"],
                Command::Docker {
                    command: DockerCommand::Container {
                        command: ContainerCommand::Stop {
                            container: "abc123".into(),
                        },
                    },
                },
            ),
            (
                vec!["kida", "docker", "container", "restart", "api"],
                Command::Docker {
                    command: DockerCommand::Container {
                        command: ContainerCommand::Restart {
                            container: "api".into(),
                        },
                    },
                },
            ),
            (
                vec!["kida", "docker", "container", "delete", "old-db"],
                Command::Docker {
                    command: DockerCommand::Container {
                        command: ContainerCommand::Delete {
                            container: "old-db".into(),
                        },
                    },
                },
            ),
        ];

        for (args, expected) in cases {
            assert_eq!(Cli::try_parse_from(args).unwrap().command, expected);
        }
    }

    #[test]
    fn rejects_missing_arguments_and_incomplete_hierarchies() {
        for args in [
            vec!["kida"],
            vec!["kida", "system"],
            vec!["kida", "system", "shutdown"],
            vec!["kida", "docker"],
            vec!["kida", "docker", "containers"],
            vec!["kida", "docker", "container"],
            vec!["kida", "docker", "container", "start"],
        ] {
            assert!(Cli::try_parse_from(args).is_err());
        }
    }

    #[test]
    fn rejects_extra_arguments_and_legacy_dotted_commands() {
        for args in [
            vec!["kida", "health", "extra"],
            vec!["kida", "system", "info", "extra"],
            vec!["kida", "system.shutdown", "now"],
            vec!["kida", "docker.containers.list"],
            vec!["kida", "docker.container.start", "web"],
        ] {
            assert!(Cli::try_parse_from(args).is_err());
        }
    }
}
