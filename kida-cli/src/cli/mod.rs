mod backup;
mod docker;
mod system;

use clap::{Parser, Subcommand};

pub use backup::BackupCommand;
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
    Backup {
        #[command(subcommand)]
        command: BackupCommand,
    },
}

#[cfg(test)]
mod tests {
    use std::env;

    use clap::{Parser, error::ErrorKind};
    use serde_json::json;

    use super::*;
    use crate::protocol::CommandRequest;

    #[test]
    fn parses_backup_create_with_required_short_file_option() {
        let cli = Cli::try_parse_from([
            "kida",
            "backup",
            "create",
            "-f",
            "/home/user/nextcloud.toml",
        ])
        .expect("backup create should parse");

        assert_eq!(
            cli.command,
            Command::Backup {
                command: BackupCommand::Create {
                    file: "/home/user/nextcloud.toml".to_string(),
                },
            }
        );
    }

    #[test]
    fn backup_create_requires_file_option() {
        let error = Cli::try_parse_from(["kida", "backup", "create"])
            .expect_err("backup create without -f should fail");

        assert_eq!(error.kind(), ErrorKind::MissingRequiredArgument);
    }

    #[test]
    fn parses_backup_delete_with_id() {
        let cli = Cli::try_parse_from(["kida", "backup", "delete", "--id", "backup-1"])
            .expect("backup delete with an ID should parse");

        assert_eq!(
            cli.command,
            Command::Backup {
                command: BackupCommand::Delete {
                    id: Some("backup-1".to_string()),
                    name: None,
                },
            }
        );
    }

    #[test]
    fn parses_backup_delete_with_name() {
        let cli = Cli::try_parse_from(["kida", "backup", "delete", "--name", "Nextcloud"])
            .expect("backup delete with a name should parse");

        assert_eq!(
            cli.command,
            Command::Backup {
                command: BackupCommand::Delete {
                    id: None,
                    name: Some("Nextcloud".to_string()),
                },
            }
        );
    }

    #[test]
    fn backup_delete_requires_exactly_one_selector() {
        let missing = Cli::try_parse_from(["kida", "backup", "delete"])
            .expect_err("backup delete without a selector should fail");
        assert_eq!(missing.kind(), ErrorKind::MissingRequiredArgument);

        let conflicting = Cli::try_parse_from([
            "kida",
            "backup",
            "delete",
            "--id",
            "backup-1",
            "--name",
            "Nextcloud",
        ])
        .expect_err("backup delete with both selectors should fail");
        assert_eq!(conflicting.kind(), ErrorKind::ArgumentConflict);
    }

    #[test]
    fn resolves_relative_backup_file_before_building_the_request() {
        let relative = "path/that/does/not/exist/backup-job.toml";
        let expected = env::current_dir()
            .expect("current directory should be available")
            .join(relative)
            .into_os_string()
            .into_string()
            .expect("test path should be valid UTF-8");

        let cli = Cli::try_parse_from(["kida", "backup", "create", "-f", relative])
            .expect("relative backup path should parse");
        let request = CommandRequest::from(cli.command);

        assert_eq!(request.command, "backup.create");
        assert_eq!(request.params, json!({ "file": expected }));
    }
}
