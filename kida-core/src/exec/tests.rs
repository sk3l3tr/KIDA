// Must implement tests cases here! Do not implement tests inside source files!
#[cfg(test)]
mod queue_tests {

    use serde_json::json;

    use crate::{
        exec::queue::{CommandQueue, QueueError},
        infrastructure::{comm::protocol::CommandRequest, conf},
    };

    #[test]
    fn shared_queue_preserves_capacity_fifo_and_arbitrary_commands() {
        let capacity = conf::tests::init_test_config().queue.capacity;
        let (queue, mut receiver) = CommandQueue::new();
        let shared = queue.clone();
        let commands = ["health", "backup.run", "scheduler.list"];
        let mut execution_ids = Vec::new();

        for index in 0..capacity {
            let sender = if index % 2 == 0 { &queue } else { &shared };
            let execution_id = sender
                .enqueue(CommandRequest {
                    id: index.to_string(),
                    command: commands[index % commands.len()].to_string(),
                    params: json!({"position": index, "resource": null}),
                })
                .unwrap();

            execution_ids.push(execution_id);
        }

        assert!(matches!(
            shared.enqueue(CommandRequest {
                id: "discarded".to_string(),
                command: "health".to_string(),
                params: json!(null),
            }),
            Err(QueueError::Full)
        ));

        for (index, execution_id) in execution_ids.iter().enumerate() {
            let queued = receiver.try_recv().unwrap();

            assert_eq!(&queued.execution_id, execution_id);
            assert_eq!(queued.request.id, index.to_string());
            assert_eq!(queued.request.command, commands[index % commands.len()]);
            assert_eq!(
                queued.request.params,
                json!({"position": index, "resource": null})
            );
        }

        assert!(receiver.try_recv().is_err());

        drop(receiver);

        assert!(matches!(
            queue.enqueue(CommandRequest {
                id: "closed".to_string(),
                command: "health".to_string(),
                params: json!(null),
            }),
            Err(QueueError::Closed)
        ));
    }
}

#[cfg(test)]
mod worker_tests {
    use crate::{
        exec::{executor, worker::run_with_handler},
        features::scheduler::{runtime, timer},
        infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus},
    };

    use chrono::{TimeDelta, Utc};
    use serde_json::json;
    use std::time::Duration;
    use tokio::sync::mpsc;

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

        crate::infrastructure::comm::tests::scheduler_protection_through_transports().await;

        runtime::manager()
            .unwrap()
            .delete(created["id"].as_str().unwrap())
            .unwrap();

        worker_task.abort();
        let _ = worker_task.await;

        std::fs::remove_file(path).unwrap();
    }
}

#[cfg(test)]
mod concurrency_tests {
    use std::{
        sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        },
        time::Duration,
    };
    use tokio::{
        sync::{Semaphore, mpsc},
        time::timeout,
    };

    use crate::{
        exec::{queue::QueuedCommand, worker::run_with_limits},
        infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus},
    };

    const DEADLINE: Duration = Duration::from_secs(5);

    fn job(id: &str, command: &str) -> QueuedCommand {
        QueuedCommand {
            execution_id: format!("execution-{id}"),
            request: CommandRequest {
                id: id.into(),
                command: command.into(),
                params: serde_json::Value::Null,
            },
        }
    }

    fn response(id: String, status: CommandStatus) -> CommandResponse {
        CommandResponse {
            id,
            status,
            data: None,
            error: None,
        }
    }

    struct Active(Arc<AtomicUsize>);

    impl Active {
        fn enter(active: Arc<AtomicUsize>, peak: &AtomicUsize) -> Self {
            let count = active.fetch_add(1, Ordering::SeqCst) + 1;
            peak.fetch_max(count, Ordering::SeqCst);
            Self(active)
        }
    }

    impl Drop for Active {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn concurrency_respects_limit_and_closed_queue_drains_all_jobs() {
        for limit in [1, 2, 3] {
            let (sender, receiver) = mpsc::channel(8);
            let (started, mut starts) = mpsc::unbounded_channel();
            let gate = Arc::new(Semaphore::new(0));
            let active = Arc::new(AtomicUsize::new(0));
            let peak = Arc::new(AtomicUsize::new(0));
            let completed = Arc::new(AtomicUsize::new(0));

            let worker = tokio::spawn(run_with_limits(
                receiver,
                {
                    let gate = gate.clone();
                    let active = active.clone();
                    let peak = peak.clone();
                    let completed = completed.clone();
                    move |request| {
                        let gate = gate.clone();
                        let active = active.clone();
                        let peak = peak.clone();
                        let completed = completed.clone();
                        let started = started.clone();
                        async move {
                            let _active = Active::enter(active, &peak);
                            started.send(request.id.clone()).unwrap();
                            gate.acquire().await.unwrap().forget();
                            completed.fetch_add(1, Ordering::SeqCst);
                            response(request.id, CommandStatus::Ok)
                        }
                    }
                },
                limit,
                8 + limit,
            ));

            for index in 0..8 {
                sender
                    .send(job(&index.to_string(), "test.concurrent"))
                    .await
                    .unwrap();
            }
            drop(sender);
            for _ in 0..limit {
                timeout(DEADLINE, starts.recv()).await.unwrap().unwrap();
            }
            assert_eq!(active.load(Ordering::SeqCst), limit);
            assert!(!worker.is_finished());
            gate.add_permits(8);
            timeout(DEADLINE, worker).await.unwrap().unwrap();
            assert_eq!(peak.load(Ordering::SeqCst), limit);
            assert_eq!(active.load(Ordering::SeqCst), 0);
            assert_eq!(completed.load(Ordering::SeqCst), 8);
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn backups_are_serial_but_waiting_backups_do_not_block_other_commands() {
        let (sender, receiver) = mpsc::channel(3);
        let (started, mut starts) = mpsc::unbounded_channel();
        let gate = Arc::new(Semaphore::new(0));
        let active = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let worker = tokio::spawn(run_with_limits(
            receiver,
            {
                let gate = gate.clone();
                let active = active.clone();
                let peak = peak.clone();
                move |request| {
                    let started = started.clone();
                    let gate = gate.clone();
                    let active = active.clone();
                    let peak = peak.clone();
                    async move {
                        let _active = if request.command == "backup.run" {
                            Some(Active::enter(active, &peak))
                        } else {
                            None
                        };
                        started.send(request.id.clone()).unwrap();
                        if request.command == "backup.run" {
                            gate.acquire().await.unwrap().forget();
                        }
                        response(request.id, CommandStatus::Ok)
                    }
                }
            },
            2,
            5,
        ));

        sender.send(job("backup-1", "backup.run")).await.unwrap();
        assert_eq!(
            timeout(DEADLINE, starts.recv()).await.unwrap().unwrap(),
            "backup-1"
        );
        sender.send(job("backup-2", "backup.run")).await.unwrap();
        sender.send(job("other", "test.concurrent")).await.unwrap();
        assert_eq!(
            timeout(DEADLINE, starts.recv()).await.unwrap().unwrap(),
            "other"
        );
        assert_eq!(active.load(Ordering::SeqCst), 1);
        gate.add_permits(1);
        assert_eq!(
            timeout(DEADLINE, starts.recv()).await.unwrap().unwrap(),
            "backup-2"
        );
        drop(sender);
        gate.add_permits(1);
        timeout(DEADLINE, worker).await.unwrap().unwrap();
        assert_eq!(peak.load(Ordering::SeqCst), 1);
        assert_eq!(active.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn errors_and_panics_release_backup_exclusion_and_execution_capacity() {
        let (sender, receiver) = mpsc::channel(4);
        let (started, mut starts) = mpsc::unbounded_channel();
        let worker = tokio::spawn(run_with_limits(
            receiver,
            move |request| {
                started.send(request.id.clone()).unwrap();
                assert_ne!(
                    request.id, "handler-panic",
                    "panic constructing the handler future"
                );
                async move {
                    assert_ne!(request.id, "future-panic", "panic executing the future");
                    let status = if request.id == "error" {
                        CommandStatus::Error
                    } else {
                        CommandStatus::Ok
                    };
                    response(request.id, status)
                }
            },
            1,
            5,
        ));

        for id in ["error", "handler-panic", "future-panic", "success"] {
            sender.send(job(id, "backup.run")).await.unwrap();
            assert_eq!(timeout(DEADLINE, starts.recv()).await.unwrap().unwrap(), id);
        }
        drop(sender);
        timeout(DEADLINE, worker).await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn pending_backups_keep_admission_bounded() {
        let (sender, receiver) = mpsc::channel(2);
        let (started, mut starts) = mpsc::unbounded_channel();
        let gate = Arc::new(Semaphore::new(0));
        let worker = tokio::spawn(run_with_limits(
            receiver,
            {
                let gate = gate.clone();
                move |request| {
                    let gate = gate.clone();
                    let started = started.clone();
                    async move {
                        started.send(request.id.clone()).unwrap();
                        gate.acquire().await.unwrap().forget();
                        response(request.id, CommandStatus::Ok)
                    }
                }
            },
            1,
            3,
        ));

        sender.send(job("first", "backup.run")).await.unwrap();
        timeout(DEADLINE, starts.recv()).await.unwrap().unwrap();
        for id in ["second", "third"] {
            sender.send(job(id, "backup.run")).await.unwrap();
        }
        timeout(DEADLINE, async {
            while sender.capacity() != 2 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        for id in ["fourth", "fifth"] {
            sender.send(job(id, "backup.run")).await.unwrap();
        }
        assert!(
            timeout(Duration::from_millis(50), sender.reserve())
                .await
                .is_err()
        );
        drop(sender);
        gate.add_permits(5);
        timeout(DEADLINE, worker).await.unwrap().unwrap();
        let mut remaining = 0;
        while starts.try_recv().is_ok() {
            remaining += 1;
        }
        assert_eq!(remaining, 4);
    }
}
