use super::{empty_params, request};
use crate::{cli::SchedulerCommand, protocol::CommandRequest};

impl From<SchedulerCommand> for CommandRequest {
    fn from(command: SchedulerCommand) -> Self {
        match command {
            SchedulerCommand::List => request("scheduler.list", empty_params()),
            SchedulerCommand::Delete { id } => {
                request("scheduler.delete", serde_json::json!({"id":id}))
            }
            SchedulerCommand::Add(_) => unreachable!("schedule must be prepared before mapping"),
        }
    }
}
