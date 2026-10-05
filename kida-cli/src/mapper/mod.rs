mod docker;
mod system;

use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::{cli::Command, protocol::CommandRequest};

impl From<Command> for CommandRequest {
    fn from(command: Command) -> Self {
        match command {
            Command::Health => request("health", empty_params()),
            Command::System { command } => command.into(),
            Command::Docker { command } => command.into(),
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::{cli::Command, protocol::CommandRequest};

    #[test]
    fn maps_health() {
        let request = CommandRequest::from(Command::Health);

        assert_eq!(request.command, "health");
        assert_eq!(request.params, json!({}));
        assert!(!request.id.is_empty());
    }
}
