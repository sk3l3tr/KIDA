use serde_json::json;

use crate::infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

use crate::features::docker::DockerService;

pub async fn exec(request: CommandRequest) -> CommandResponse {
    let container = match request
        .params
        .get("container")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(container) => container,

        None => {
            return CommandResponse {
                id: request.id,
                status: CommandStatus::Error,
                data: None,
                error: Some("Missing required parameter: container".to_string()),
            };
        }
    };

    match DockerService::start(container) {
        Ok(()) => CommandResponse {
            id: request.id,
            status: CommandStatus::Ok,
            data: Some(json!({
                "container": container,
                "status": "running"
            })),
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
