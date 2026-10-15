use super::{empty_params, request};
use crate::{cli::SchedulerCommand, protocol::CommandRequest};

pub(super) fn map(
    command: SchedulerCommand,
) -> Result<CommandRequest, crate::input::error::InputError> {
    match command {
        SchedulerCommand::List => Ok(request("scheduler.list", empty_params())),
        SchedulerCommand::Delete { id } => {
            Ok(request("scheduler.delete", serde_json::json!({"id":id})))
        }
        SchedulerCommand::Add(_) => Err(crate::input::error::InputError::new(
            "input",
            "schedule must be prepared before mapping",
        )),
    }
}
