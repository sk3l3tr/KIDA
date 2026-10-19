use super::request;
use crate::{cli::SchedulerCommand, protocol::command::CommandRequest};

pub(super) fn map(
    command: SchedulerCommand,
) -> Result<CommandRequest, crate::input::error::InputError> {
    match command {
        SchedulerCommand::List { origin } => Ok(request(
            "scheduler.list",
            serde_json::json!({"origin": origin.as_str()}),
        )),
        SchedulerCommand::Delete { id } => {
            Ok(request("scheduler.delete", serde_json::json!({"id":id})))
        }
        SchedulerCommand::Add(_) => Err(crate::input::error::InputError::new(
            "input",
            "schedule must be prepared before mapping",
        )),
    }
}
