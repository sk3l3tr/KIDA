use serde_json::to_value;

use crate::features::docker::DockerService;
use crate::infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

pub async fn exec(request: CommandRequest) -> CommandResponse {
    match DockerService::compose_version() {
        Ok(data) => CommandResponse {
            id: request.id,
            status: CommandStatus::Ok,
            data: Some(to_value(data).unwrap()),
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
