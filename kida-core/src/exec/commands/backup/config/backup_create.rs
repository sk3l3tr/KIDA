use serde_json::json;

use crate::features::backup::{model::NewBackupJob, service::BackupService};
use crate::infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

pub async fn exec(request: CommandRequest) -> CommandResponse {
    let input = match serde_json::from_value::<NewBackupJob>(request.params) {
        Ok(input) => input,
        Err(error) => {
            return CommandResponse {
                id: request.id,
                status: CommandStatus::Error,
                data: None,
                error: Some(format!("invalid backup configuration: {error}")),
            };
        }
    };

    match BackupService::create(input) {
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
