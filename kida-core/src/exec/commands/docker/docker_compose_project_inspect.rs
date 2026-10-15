use serde_json::to_value;

use crate::features::docker::DockerService;
use crate::infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

pub async fn exec(request: CommandRequest) -> CommandResponse {
    let project = match request
        .params
        .get("project")
        .and_then(|value| value.as_str())
    {
        Some(project) if !project.trim().is_empty() => project,
        _ => {
            return CommandResponse {
                id: request.id,
                status: CommandStatus::Error,
                data: None,
                error: Some("Missing required parameter: project".to_string()),
            };
        }
    };

    match DockerService::compose_project(project) {
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
