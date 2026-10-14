use serde_json::json;

use crate::{cli::SystemCommand, protocol::CommandRequest};

use super::{empty_params, request};

impl From<SystemCommand> for CommandRequest {
    fn from(command: SystemCommand) -> Self {
        match command {
            SystemCommand::PowerCycle { .. } => {
                unreachable!("power cycle must be prepared before mapping")
            }
            SystemCommand::WakeCapabilities => request("system.wake_capabilities", empty_params()),
            SystemCommand::Info => request("system.info", empty_params()),
            SystemCommand::Health => request("system.health", empty_params()),
            SystemCommand::Shutdown { time } => request("system.shutdown", json!({ "when": time })),
            SystemCommand::Reboot { time } => request("system.reboot", json!({"when": time})),
        }
    }
}
