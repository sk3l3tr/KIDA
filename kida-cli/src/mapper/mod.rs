mod backup;
mod docker;
mod system;

use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::{cli::Command, protocol::CommandRequest};

impl From<Command> for CommandRequest {
    fn from(command: Command) -> Self {
        match command {
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
