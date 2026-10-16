use serde_json::to_value;

use crate::infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

use crate::features::docker::DockerService;

pub async fn exec(request: CommandRequest) -> CommandResponse {
    super::super::run_blocking(request, exec_blocking).await
}

fn exec_blocking(request: CommandRequest) -> CommandResponse {
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
