mod backup;
mod docker;
mod scheduler;
mod system;

use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::{cli::Command, protocol::CommandRequest};

impl From<Command> for CommandRequest {
    fn from(command: Command) -> Self {
        match command {
            Command::Scheduler { command } => command.into(),
            Command::System { command } => command.into(),
            Command::Docker { command } => command.into(),
            Command::Backup { command } => command.into(),
        }
    }
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

impl From<crate::input::PreparedCommand> for CommandRequest {
    fn from(command: crate::input::PreparedCommand) -> Self {
        match command {
            crate::input::PreparedCommand::Schedule(schedule) => request(
                "scheduler.add",
                serde_json::to_value(schedule).expect("scheduler DTO is JSON serializable"),
            ),
            crate::input::PreparedCommand::Create(job) => request(
                "backup.config.create",
                serde_json::to_value(job).expect("backup DTO is JSON serializable"),
            ),
            crate::input::PreparedCommand::Other(command) => command.into(),
        }
    }
}
