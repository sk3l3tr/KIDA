pub mod docker_compose_project_inspect;
pub mod docker_compose_projects_list;
pub mod docker_compose_version;
pub mod docker_container_delete;
pub mod docker_container_restart;
pub mod docker_container_start;
pub mod docker_container_stop;
pub mod docker_containers_list;

use serde_json::json;

use crate::infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

async fn container_action(
    request: CommandRequest,
    operation: fn(&str) -> Result<(), String>,
    status: &'static str,
) -> CommandResponse {
    super::run_blocking(request, move |request| {
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

        match operation(container) {
            Ok(()) => CommandResponse {
                id: request.id,
                status: CommandStatus::Ok,
                data: Some(json!({
                    "container": container,
                    "status": status
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
    })
    .await
}

#[cfg(test)]
mod tests;
