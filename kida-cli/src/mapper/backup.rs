use serde_json::json;

use crate::{
    cli::{BackupCommand, BackupConfigCommand},
    protocol::command::CommandRequest,
};

use super::{empty_params, request};

pub(super) fn map(
    command: BackupCommand,
) -> Result<CommandRequest, crate::input::error::InputError> {
    match command {
        BackupCommand::Health { .. } => Err(crate::input::error::InputError::new(
            "input",
            "health commands must be prepared before mapping",
        )),
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

pub(super) fn health(input: crate::input::health::PreparedHealth) -> CommandRequest {
    use crate::cli::{HealthCommand, HealthReportCommand};
    let (command, params) = match input.into_command() {
        HealthCommand::Create { file, mode } => (
            "backup.health.create",
            json!({"definition_path": file, "mode": mode}),
        ),
        HealthCommand::Run { file } => ("backup.health.run", json!({"definition_path": file})),
        HealthCommand::Start { run_id } => ("backup.health.start", json!({"run_id":run_id})),
        HealthCommand::Get { run_id } => ("backup.health.get", json!({"run_id":run_id})),
        HealthCommand::Stop { run_id } => ("backup.health.stop", json!({"run_id":run_id})),
        HealthCommand::Delete { run_id } => ("backup.health.delete", json!({"run_id":run_id})),
        HealthCommand::List => ("backup.health.list", empty_params()),
        HealthCommand::Report { command } => match command {
            HealthReportCommand::List => ("backup.health.report.list", empty_params()),
            HealthReportCommand::Get { run_id } => {
                ("backup.health.report.get", json!({"run_id":run_id}))
            }
            HealthReportCommand::Delete { run_id } => {
                ("backup.health.report.delete", json!({"run_id":run_id}))
            }
        },
    };
    request(command, params)
}
