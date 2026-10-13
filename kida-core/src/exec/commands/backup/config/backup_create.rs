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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_legacy_file_payload_before_accessing_configuration() {
        let response = exec(CommandRequest {
            id: "request-id".into(),
            command: "backup.config.create".into(),
            params: json!({"file":"/etc/never-read.toml"}),
        })
        .await;
        assert!(matches!(response.status, CommandStatus::Error));
        assert_eq!(response.id, "request-id");
        assert!(
            response
                .error
                .unwrap()
                .contains("invalid backup configuration")
        );
    }
}
