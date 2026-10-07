use serde_json::json;

use super::{empty_params, request};
use crate::{cli::BackupCommand, protocol::CommandRequest};

impl From<BackupCommand> for CommandRequest {
    fn from(command: BackupCommand) -> Self {
        match command {
            BackupCommand::List => request("backup.list", empty_params()),
            BackupCommand::Create { file } => request("backup.create", json!({ "file": file })),
            BackupCommand::Delete { id, name } => match (id, name) {
                (Some(id), None) => request("backup.delete", json!({ "id": id })),
                (None, Some(name)) => request("backup.delete", json!({ "name": name })),
                _ => unreachable!("clap requires exactly one backup selector"),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn maps_absolute_backup_path_without_reading_or_changing_it() {
        let file = "/path/that/does/not/exist/backup-job.toml";

        let request = CommandRequest::from(BackupCommand::Create {
            file: file.to_string(),
        });
        let serialized = serde_json::to_value(request).expect("request should serialize");

        assert_eq!(serialized["command"], "backup.create");
        assert_eq!(serialized["params"], json!({ "file": file }));
        assert_eq!(serialized["params"].as_object().unwrap().len(), 1);
        assert!(serialized["id"].as_str().is_some_and(|id| !id.is_empty()));
    }

    #[test]
    fn maps_backup_delete_by_id_with_only_the_id_parameter() {
        let request = CommandRequest::from(BackupCommand::Delete {
            id: Some("backup-1".to_string()),
            name: None,
        });

        assert_eq!(request.command, "backup.delete");
        assert_eq!(request.params, json!({ "id": "backup-1" }));
    }

    #[test]
    fn maps_backup_delete_by_name_with_only_the_name_parameter() {
        let request = CommandRequest::from(BackupCommand::Delete {
            id: None,
            name: Some("Nextcloud".to_string()),
        });

        assert_eq!(request.command, "backup.delete");
        assert_eq!(request.params, json!({ "name": "Nextcloud" }));
    }
}
