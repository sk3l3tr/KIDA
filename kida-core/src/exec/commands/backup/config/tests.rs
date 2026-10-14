// Must implement tests cases here! Do not implement tests inside source files!
#[cfg(test)]
mod backup_create_tests {
    use serde_json::json;

    use crate::{
        exec::commands::backup::config::backup_create::exec,
        infrastructure::comm::protocol::{CommandRequest, CommandStatus},
    };

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
