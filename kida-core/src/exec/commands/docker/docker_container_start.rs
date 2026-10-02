use std::process::Command;

use serde_json::{Value, json};

use crate::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

pub async fn exec(request: CommandRequest) -> CommandResponse {
    let container = match get_container(&request.params) {
        Ok(container) => container,

        Err(error) => {
            return CommandResponse {
                id: request.id,
                status: CommandStatus::Error,
                data: None,
                error: Some(error),
            };
        }
    };

    match start_container(&container) {
        Ok(()) => CommandResponse {
            id: request.id,
            status: CommandStatus::Ok,
            data: Some(json!({
                "container": container,
                "status": "running",
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

fn get_container(params: &Value) -> Result<String, String> {
    params
        .get("container")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|container| !container.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Missing required parameter: container".to_string())
}

fn start_container(container: &str) -> Result<(), String> {
    let output = Command::new("docker")
        .args(["start", container])
        .output()
        .map_err(|e| format!("Cannot execute docker start: {e}"))?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);

        return Err(format!(
            "docker start failed for '{container}': {}",
            error.trim()
        ));
    }

    Ok(())
}
