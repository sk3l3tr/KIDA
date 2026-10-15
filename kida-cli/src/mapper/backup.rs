use serde_json::json;

use crate::{
    cli::{BackupCommand, BackupConfigCommand},
    protocol::CommandRequest,
};

use super::{empty_params, request};

pub(super) fn map(
    command: BackupCommand,
) -> Result<CommandRequest, crate::input::error::InputError> {
    match command {
        BackupCommand::Config { command } => map_config(command),
        BackupCommand::Run { id, name } => selected("backup.run", id, name),
    }
}

fn map_config(
    command: BackupConfigCommand,
) -> Result<CommandRequest, crate::input::error::InputError> {
    match command {
        BackupConfigCommand::List => Ok(request("backup.config.list", empty_params())),
        BackupConfigCommand::Create(_) => Err(crate::input::error::InputError::new(
            "input",
            "creation must be prepared before mapping",
        )),
        BackupConfigCommand::Delete { id, name } => selected("backup.config.delete", id, name),
    }
}

fn selected(
    command: &str,
    id: Option<String>,
    name: Option<String>,
) -> Result<CommandRequest, crate::input::error::InputError> {
    match (id, name) {
        (Some(id), None) => Ok(request(command, json!({ "id": id }))),
        (None, Some(name)) => Ok(request(command, json!({ "name": name }))),
        _ => Err(crate::input::error::InputError::new(
            "selector",
            "clap requires exactly one backup selector",
        )),
    }
}
