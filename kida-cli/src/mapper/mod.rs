mod backup;
mod docker;
mod scheduler;
mod system;

use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::{
    cli::Command,
    input::{
        PreparedCommand, backup::model::NewBackupJob, error::InputError, health::PreparedHealth,
        scheduler::NewSchedule, system::PowerCycle,
    },
    protocol::command::CommandRequest,
};

pub(crate) fn direct(command: Command) -> Result<CommandRequest, InputError> {
    match command {
        Command::Scheduler { command } => scheduler::map(command),
        Command::System { command } => system::map(command),
        Command::Docker { command } => Ok(docker::map(command)),
        Command::Backup { command } => backup::map(command),
    }
}

pub(crate) fn power_cycle(params: PowerCycle) -> CommandRequest {
    request(
        "system.power_cycle",
        serde_json::to_value(params).expect("power cycle input is JSON serializable"),
    )
}

pub(crate) fn schedule(schedule: NewSchedule) -> CommandRequest {
    request(
        "scheduler.add",
        serde_json::to_value(schedule).expect("scheduler DTO is JSON serializable"),
    )
}

pub(crate) fn create(job: NewBackupJob) -> CommandRequest {
    request(
        "backup.config.create",
        serde_json::to_value(job).expect("backup DTO is JSON serializable"),
    )
}

pub(crate) fn health(input: PreparedHealth) -> CommandRequest {
    backup::health(input)
}

fn request(command: impl Into<String>, params: Value) -> CommandRequest {
    CommandRequest {
        id: generate_request_id(),
        command: command.into(),
        params,
    }
}

fn empty_params() -> Value {
    serde_json::json!({})
}

fn generate_request_id() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .to_string()
}

impl From<PreparedCommand> for CommandRequest {
    fn from(command: PreparedCommand) -> Self {
        command.into_request()
    }
}

#[cfg(test)]
pub(crate) mod tests;
