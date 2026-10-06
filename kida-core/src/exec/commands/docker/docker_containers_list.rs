use serde_json::to_value;

use crate::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

use crate::docker::DockerService;

pub async fn exec(request: CommandRequest) -> CommandResponse {
    match DockerService::list() {
        Ok(containers) => CommandResponse {
            id: request.id,
            status: CommandStatus::Ok,
            data: Some(to_value(containers).unwrap()),
            error: None,
        },

        Err(error) => CommandResponse {
            id: request.id,
            status: CommandStatus::Error,
            data: None,
            error: Some(error),
        },
    }
}
