use serde_json::json;

use crate::{cli::SystemCommand, protocol::command::CommandRequest};

use super::{empty_params, request};

pub(super) fn map(
    command: SystemCommand,
) -> Result<CommandRequest, crate::input::error::InputError> {
    match command {
        SystemCommand::PowerCycle { .. } => Err(crate::input::error::InputError::new(
            "input",
            "power cycle must be prepared before mapping",
        )),
        SystemCommand::WakeCapabilities => Ok(request("system.wake_capabilities", empty_params())),
        SystemCommand::Info => Ok(request("system.info", empty_params())),
        SystemCommand::Health => Ok(request("system.health", empty_params())),
        SystemCommand::Shutdown { time } => Ok(request("system.shutdown", json!({ "when": time }))),
        SystemCommand::Reboot { time } => Ok(request("system.reboot", json!({"when": time}))),
    }
}
