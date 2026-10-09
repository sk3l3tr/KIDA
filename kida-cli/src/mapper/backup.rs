use serde_json::json;

use crate::{
    cli::{BackupCommand, BackupConfigCommand},
    protocol::CommandRequest,
};

use super::{empty_params, request};

impl From<BackupCommand> for CommandRequest {
    fn from(command: BackupCommand) -> Self {
        match command {
            BackupCommand::Config { command } => command.into(),
            BackupCommand::Run { id, name } => selected("backup.run", id, name),
        }
    }
}

impl From<BackupConfigCommand> for CommandRequest {
    fn from(command: BackupConfigCommand) -> Self {
        match command {
            BackupConfigCommand::List => request("backup.config.list", empty_params()),
            BackupConfigCommand::Create { file } => {
                request("backup.config.create", json!({ "file": file }))
            }
            BackupConfigCommand::Delete { id, name } => selected("backup.config.delete", id, name),
        }
    }
}

fn selected(command: &str, id: Option<String>, name: Option<String>) -> CommandRequest {
    match (id, name) {
        (Some(id), None) => request(command, json!({ "id": id })),
        (None, Some(name)) => request(command, json!({ "name": name })),
        _ => unreachable!("clap requires exactly one backup selector"),
    }
}

#[cfg(test)]
mod tests {
    use clap::Parser;
    use serde_json::json;

    use crate::{cli::Cli, protocol::CommandRequest};

    #[test]
    fn backup_run_by_id_maps_to_core_contract() {
        let cli = Cli::try_parse_from(["kida", "backup", "run", "--id", "job-id"]).unwrap();

        let request = CommandRequest::from(cli.command);

        assert_eq!(request.command, "backup.run");
        assert_eq!(request.params, json!({ "id": "job-id" }));
    }

    #[test]
    fn backup_run_by_name_maps_to_core_contract() {
        let cli = Cli::try_parse_from(["kida", "backup", "run", "--name", "daily"]).unwrap();

        let request = CommandRequest::from(cli.command);

        assert_eq!(request.command, "backup.run");
        assert_eq!(request.params, json!({ "name": "daily" }));
    }

    #[test]
    fn backup_run_requires_exactly_one_selector() {
        assert!(Cli::try_parse_from(["kida", "backup", "run"]).is_err());
        assert!(
            Cli::try_parse_from(["kida", "backup", "run", "--id", "job-id", "--name", "daily"])
                .is_err()
        );
    }

    #[test]
    fn backup_config_run_is_rejected() {
        assert!(Cli::try_parse_from(["kida", "backup", "config", "run", "daily"]).is_err());
    }
}
