pub mod scheduler_add;
pub mod scheduler_delete;
pub mod scheduler_list;

use serde_json::Value;

use crate::infrastructure::comm::protocol::{CommandResponse, CommandStatus};

fn response(id: String, result: Result<Value, String>) -> CommandResponse {
    match result {
        Ok(data) => CommandResponse {
            id,
            status: CommandStatus::Ok,
            data: Some(data),
            error: None,
        },
        Err(error) => CommandResponse {
            id,
            status: CommandStatus::Error,
            data: None,
            error: Some(error),
        },
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use serde_json::json;
    use uuid::Uuid;

    use super::*;
    use crate::{
        exec::queue::CommandQueue,
        features::scheduler::{manager::SchedulerManager, service::ScheduleService},
        infrastructure::comm::protocol::CommandRequest,
    };

    fn request(command: &str, params: Value) -> CommandRequest {
        CommandRequest {
            id: "request-id".to_string(),
            command: command.to_string(),
            params,
        }
    }

    #[tokio::test]
    async fn handlers_preserve_protocol_and_direct_params() {
        let path =
            std::env::temp_dir().join(format!("kida-scheduler-handlers-{}.toml", Uuid::new_v4()));
        let service = ScheduleService::load(&path, Utc::now()).unwrap();
        crate::conf::tests::init_test_config();
        let (queue, _receiver) = CommandQueue::new();
        let manager = SchedulerManager::new(service, queue);

        let invalid = scheduler_add::exec(
            request(
                "scheduler.add",
                json!({
                    "command": "health",
                    "schedule": {"type": "interval", "seconds": 60}
                }),
            ),
            &manager,
        )
        .await;

        assert!(matches!(invalid.status, CommandStatus::Error));
        assert_eq!(invalid.id, "request-id");
        assert!(invalid.data.is_none());
        assert!(invalid.error.is_some());
        assert!(!path.exists());

        let added = scheduler_add::exec(
            request(
                "scheduler.add",
                json!({
                    "command": "health",
                    "params": null,
                    "schedule": {"type": "interval", "seconds": 60}
                }),
            ),
            &manager,
        )
        .await;

        assert!(matches!(added.status, CommandStatus::Ok));
        assert_eq!(added.id, "request-id");
        assert!(added.error.is_none());

        let definition = added.data.unwrap();
        assert_eq!(definition["params"], Value::Null);

        let listed = scheduler_list::exec(request("scheduler.list", json!({})), &manager).await;

        assert!(matches!(listed.status, CommandStatus::Ok));
        let entries = listed.data.unwrap();
        assert_eq!(entries.as_array().unwrap().len(), 1);
        assert_eq!(entries[0]["id"], definition["id"]);
        assert!(entries[0]["next_enqueue_at"].is_string());

        let deleted = scheduler_delete::exec(
            request("scheduler.delete", json!({"id": definition["id"]})),
            &manager,
        )
        .await;

        assert!(matches!(deleted.status, CommandStatus::Ok));
        assert_eq!(deleted.data.unwrap(), definition);

        let missing = scheduler_delete::exec(
            request("scheduler.delete", json!({"id": definition["id"]})),
            &manager,
        )
        .await;

        assert!(matches!(missing.status, CommandStatus::Error));

        let empty = scheduler_list::exec(request("scheduler.list", json!({})), &manager).await;

        assert_eq!(empty.data.unwrap(), json!([]));

        std::fs::remove_file(&path).unwrap();
    }
}
