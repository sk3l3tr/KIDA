use std::future::Future;
use tokio::sync::mpsc;

use crate::{
    exec::{executor, queue::QueuedCommand},
    infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus},
};

pub async fn run(receiver: mpsc::Receiver<QueuedCommand>) {
    run_with_handler(receiver, executor::execute_now).await;
}

async fn run_with_handler<F, Fut>(mut receiver: mpsc::Receiver<QueuedCommand>, handler: F)
where
    F: Fn(CommandRequest) -> Fut,
    Fut: Future<Output = CommandResponse> + Send + 'static,
{
    while let Some(task) = receiver.recv().await {
        let QueuedCommand {
            execution_id,
            request,
        } = task;

        println!(
            "[QUEUE] Starting execution {} ({})",
            execution_id, request.command
        );

        let result = tokio::spawn(handler(request)).await;

        match result {
            Ok(response) => match response.status {
                CommandStatus::Ok => {
                    println!("[QUEUE] Execution completed: {}", execution_id);
                }

                CommandStatus::Error => {
                    eprintln!(
                        "[QUEUE] Execution failed: {} - {}",
                        execution_id,
                        response.error.as_deref().unwrap_or("Unknown error")
                    );
                }
            },

            Err(error) if error.is_panic() => {
                eprintln!("[QUEUE] Execution panicked: {} - {}", execution_id, error);
            }

            Err(error) => {
                eprintln!(
                    "[QUEUE] Execution task failed: {} - {}",
                    execution_id, error
                );
            }
        }
    }

    println!("[QUEUE] Worker stopped: channel closed");
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use chrono::{TimeDelta, Utc};
    use serde_json::json;

    use super::*;
    use crate::features::scheduler::{runtime, timer};

    #[tokio::test]
    async fn scheduled_commands_use_worker_and_backup_is_not_requeued() {
        let config = crate::conf::tests::init_test_config();
        let path = &config.scheduler.path;
        let receiver = executor::init_queue().unwrap();

        runtime::init(executor::command_queue().unwrap()).unwrap();

        let (responses, mut received) = mpsc::unbounded_channel::<CommandResponse>();

        let worker_task = tokio::spawn(run_with_handler(receiver, move |request| {
            let responses = responses.clone();

            async move {
                let response = executor::execute_now(request).await;
                responses.send(response).unwrap();

                CommandResponse {
                    id: "test-worker".to_string(),
                    status: CommandStatus::Ok,
                    data: None,
                    error: None,
                }
            }
        }));

        let admitted_backup = executor::execute(CommandRequest {
            id: "manual-backup".to_string(),
            command: "backup.run".to_string(),
            params: json!({}),
        })
        .await;

        assert!(matches!(admitted_backup.status, CommandStatus::Ok));
        let acknowledgement = admitted_backup.data.unwrap();
        assert_eq!(acknowledgement["state"], "QUEUED");
        assert!(acknowledgement["execution_id"].is_string());

        let backup_result = tokio::time::timeout(Duration::from_secs(5), received.recv())
            .await
            .unwrap()
            .unwrap();

        assert_eq!(backup_result.id, "manual-backup");
        assert!(matches!(backup_result.status, CommandStatus::Error));
        assert!(backup_result.data.is_none());
        assert!(backup_result.error.is_some());

        let at = (Utc::now() + TimeDelta::seconds(2)).to_rfc3339();
        let admitted_schedule = executor::execute(CommandRequest {
            id: "schedule-an-add".to_string(),
            command: "scheduler.add".to_string(),
            params: json!({
                "command": "scheduler.add",
                "params": {
                    "command": "health",
                    "params": null,
                    "schedule": {
                        "type": "interval",
                        "seconds": 60
                    }
                },
                "schedule": {
                    "type": "once",
                    "at": at
                }
            }),
        })
        .await;

        assert!(matches!(admitted_schedule.status, CommandStatus::Ok));
        let outer_id = admitted_schedule.data.unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();

        let timer_task = tokio::spawn(timer::run());

        let scheduled_result = tokio::time::timeout(Duration::from_secs(5), received.recv())
            .await
            .unwrap()
            .unwrap();

        assert!(matches!(scheduled_result.status, CommandStatus::Ok));
        assert!(scheduled_result.error.is_none());

        let created = scheduled_result.data.unwrap();
        assert_eq!(created["command"], "health");
        assert_eq!(created["params"], json!(null));

        let listed = runtime::manager().unwrap().list().unwrap();
        assert_eq!(listed.as_array().unwrap().len(), 1);
        assert_eq!(listed[0]["id"], created["id"]);
        assert_ne!(listed[0]["id"].as_str().unwrap(), outer_id);
        let persisted = crate::features::scheduler::repository::ScheduleRepository::new(path)
            .load()
            .unwrap();
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].id, created["id"].as_str().unwrap());
        assert_eq!(persisted[0].command, "health");
        assert_eq!(persisted[0].params, json!(null));
        assert!(received.try_recv().is_err());

        timer_task.abort();
        let _ = timer_task.await;

        runtime::manager()
            .unwrap()
            .delete(created["id"].as_str().unwrap())
            .unwrap();

        worker_task.abort();
        let _ = worker_task.await;

        std::fs::remove_file(path).unwrap();
    }
}
