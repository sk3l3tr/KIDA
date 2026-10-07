use crate::protocol::CommandResponse;

use super::{RenderError, data, string};

pub(super) fn create(response: &CommandResponse) -> Result<String, RenderError> {
    let data = data(response)?;
    let id = string(data, "id", "data.id")?;
    let name = string(data, "name", "data.name")?;

    Ok(format!("Backup job {name} created (ID: {id})."))
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;
    use crate::protocol::CommandStatus;

    fn response(data: Value) -> CommandResponse {
        CommandResponse {
            id: "request-1".into(),
            status: CommandStatus::Ok,
            data: Some(data),
            error: None,
        }
    }

    #[test]
    fn renders_created_backup_job() {
        let output = crate::renderer::render(
            "backup.create",
            &response(json!({
                "id": "backup-1",
                "name": "Nextcloud",
                "sources": ["/srv/nextcloud"]
            })),
        )
        .expect("valid response should render");

        assert_eq!(output, "Backup job Nextcloud created (ID: backup-1).");
    }

    #[test]
    fn rejects_missing_or_invalid_id() {
        assert!(create(&response(json!({"name": "Nextcloud"}))).is_err());
        assert!(create(&response(json!({"id": 1, "name": "Nextcloud"}))).is_err());
    }

    #[test]
    fn rejects_missing_or_invalid_name() {
        assert!(create(&response(json!({"id": "backup-1"}))).is_err());
        assert!(create(&response(json!({"id": "backup-1", "name": false}))).is_err());
    }
}
