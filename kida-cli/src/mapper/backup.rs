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
            BackupConfigCommand::Create(_) => {
                unreachable!("creation must be prepared before mapping")
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
