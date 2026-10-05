use serde_json::json;

use crate::{cli::SystemCommand, protocol::CommandRequest};

use super::{empty_params, request};

impl From<SystemCommand> for CommandRequest {
    fn from(command: SystemCommand) -> Self {
        match command {
            SystemCommand::Info => request("system.info", empty_params()),
            SystemCommand::Health => request("system.health", empty_params()),
            SystemCommand::Shutdown { time } => request("system.shutdown", json!({ "when": time })),
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::{cli::SystemCommand, protocol::CommandRequest};

    #[test]
    fn maps_every_system_command() {
        let cases = [
            (SystemCommand::Info, "system.info", json!({})),
            (SystemCommand::Health, "system.health", json!({})),
            (
                SystemCommand::Shutdown { time: "now".into() },
                "system.shutdown",
                json!({ "when": "now" }),
            ),
        ];

        for (command, expected_command, expected_params) in cases {
            let request = CommandRequest::from(command);

            assert_eq!(request.command, expected_command);
            assert_eq!(request.params, expected_params);
            assert!(!request.id.is_empty());
        }
    }
}
