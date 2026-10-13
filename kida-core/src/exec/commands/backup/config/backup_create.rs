use std::path::Path;

use serde_json::json;

use crate::features::backup::service::BackupService;
use crate::infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

pub async fn exec(request: CommandRequest) -> CommandResponse {
    let file = match request.params.get("file").and_then(|value| value.as_str()) {
        Some(file) => file,
        None => {
            return CommandResponse {
                id: request.id,
                status: CommandStatus::Error,
                data: None,
                error: Some("missing required parameter: file".to_string()),
            };
        }
    };

    match BackupService::create(Path::new(file)) {
        Ok(job) => CommandResponse {
            id: request.id,
            status: CommandStatus::Ok,
            data: Some(json!(job)),
            error: None,
        },

        Err(error) => CommandResponse {
            id: request.id,
            status: CommandStatus::Error,
            data: None,
            error: Some(error.to_string()),
        },
    }
}
