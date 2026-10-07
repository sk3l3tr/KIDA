use serde_json::json;

use super::{empty_params, request};
use crate::{cli::BackupCommand, protocol::CommandRequest};

impl From<BackupCommand> for CommandRequest {
    fn from(command: BackupCommand) -> Self {
        match command {
            BackupCommand::List => request("backup.list", empty_params()),
            BackupCommand::Create { file } => request("backup.create", json!({ "file": file })),
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
}
