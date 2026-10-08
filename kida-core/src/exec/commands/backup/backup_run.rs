use serde_json::json;

use crate::{
    backup::service::BackupService,
    comm::protocol::{CommandRequest, CommandResponse, CommandStatus},
};

pub async fn exec(request: CommandRequest) -> CommandResponse {
    let id = request.params.get("id").and_then(|v| v.as_str());
    let name = request.params.get("name").and_then(|v| v.as_str());

    let identifier = match (id, name) {
        (Some(id), None) => id,
        (None, Some(name)) => name,

        (None, None) => {
            return CommandResponse {
                id: request.id,
                status: CommandStatus::Error,
                data: None,
                error: Some("missing required parameter: id or name".to_string()),
            };
        }

        (Some(_), Some(_)) => {
            return CommandResponse {
                id: request.id,
                status: CommandStatus::Error,
                data: None,
                error: Some("provide either id or name, not both".to_string()),
            };
        }
    };

    match BackupService::run(identifier).await {
        Ok(result) => CommandResponse {
            id: request.id,
            status: CommandStatus::Ok,
            data: Some(json!(result)),
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
