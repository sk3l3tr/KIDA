#[cfg(test)]
mod executor_tests {
    use crate::{
        exec::{
            catalog::{self, CommandKind, SchedulerCommand},
            executor,
        },
        infrastructure::comm::protocol::{CommandRequest, CommandStatus},
    };

    #[test]
    fn public_commands_resolve_to_executable_variants() {
        let commands = [
            ("system.info", CommandKind::SystemInfo),
            ("system.health", CommandKind::SystemHealth),
            ("system.shutdown", CommandKind::SystemShutdown),
            ("system.reboot", CommandKind::SystemReboot),
            (
                "system.wake_capabilities",
                CommandKind::SystemWakeCapabilities,
            ),
            ("system.power_cycle", CommandKind::SystemPowerCycle),
            ("docker.compose.version", CommandKind::DockerComposeVersion),
            (
                "docker.compose.projects.list",
                CommandKind::DockerComposeProjectsList,
            ),
            (
                "docker.compose.project.inspect",
                CommandKind::DockerComposeProjectInspect,
            ),
            ("docker.containers.list", CommandKind::DockerContainersList),
            ("docker.container.stop", CommandKind::DockerContainerStop),
            ("docker.container.start", CommandKind::DockerContainerStart),
            (
                "docker.container.restart",
                CommandKind::DockerContainerRestart,
            ),
            (
                "docker.container.delete",
                CommandKind::DockerContainerDelete,
            ),
            ("backup.config.list", CommandKind::BackupConfigList),
            ("backup.config.create", CommandKind::BackupConfigCreate),
            ("backup.config.delete", CommandKind::BackupConfigDelete),
            ("backup.run", CommandKind::BackupRun),
            (
                "scheduler.add",
                CommandKind::Scheduler(SchedulerCommand::Add),
            ),
            (
                "scheduler.list",
                CommandKind::Scheduler(SchedulerCommand::List),
            ),
            (
                "scheduler.delete",
                CommandKind::Scheduler(SchedulerCommand::Delete),
            ),
        ];
        // execute_now matches every variant exhaustively, without running handlers here.
        for (name, kind) in commands {
            assert_eq!(catalog::resolve(name), Some(kind));
            assert!(executor::is_registered(name));
        }
    }

    #[tokio::test]
    async fn retired_and_unknown_commands_preserve_error_responses() {
        for command in ["health", "unknown.command", "", "System.health"] {
            assert!(!executor::is_registered(command));
            assert_eq!(catalog::resolve(command), None);
            let request = || CommandRequest {
                id: "unknown-request".into(),
                command: command.into(),
                params: serde_json::Value::Null,
            };
            let direct = executor::execute_now(request()).await;
            let public = executor::execute(request()).await;
            for response in [direct, public] {
                assert_eq!(response.id, "unknown-request");
                assert!(matches!(response.status, CommandStatus::Error));
                assert!(response.data.is_none());
                assert_eq!(response.error, Some(format!("Unknown command: {command}")));
            }
        }
    }
}

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
        let commands = ["scheduler.list", "backup.run", "scheduler.list"];
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
                command: "scheduler.list".to_string(),
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
                command: "scheduler.list".to_string(),
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
                    "command": "scheduler.list",
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
        assert_eq!(created["command"], "scheduler.list");
        assert_eq!(created["params"], json!(null));

        let listed = runtime::manager().unwrap().list().unwrap();
        assert_eq!(listed.as_array().unwrap().len(), 1);
        assert_eq!(listed[0]["id"], created["id"]);
        assert_ne!(listed[0]["id"].as_str().unwrap(), outer_id);
        let persisted = crate::features::scheduler::repository::ScheduleRepository::new(path)
            .load()
            .unwrap();
        assert_eq!(persisted.len(), 3);
        assert_eq!(
            persisted
                .iter()
                .filter(|schedule| schedule.origin
                    == crate::features::scheduler::model::ScheduleOrigin::Internal)
                .count(),
            2
        );
        let persisted: Vec<_> = persisted
            .into_iter()
            .filter(|schedule| {
                schedule.origin == crate::features::scheduler::model::ScheduleOrigin::User
            })
            .collect();
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].id, created["id"].as_str().unwrap());
        assert_eq!(persisted[0].command, "scheduler.list");
        assert_eq!(persisted[0].params, json!(null));
        assert!(received.try_recv().is_err());

        // Follow a safe scheduled command through its actual handler response.
        let admitted_list = executor::execute(CommandRequest {
            id: "schedule-a-list".into(),
            command: "scheduler.add".into(),
            params: json!({
                "command": "scheduler.list",
                "params": null,
                "schedule": {
                    "type": "once",
                    "at": (Utc::now() + TimeDelta::seconds(2)).to_rfc3339()
                }
            }),
        })
        .await;
        assert!(matches!(admitted_list.status, CommandStatus::Ok));
        let list_result = tokio::time::timeout(Duration::from_secs(5), received.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(list_result.status, CommandStatus::Ok));
        assert!(list_result.error.is_none());
        assert_eq!(list_result.data, Some(listed));
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
            context: Default::default(),
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

#[cfg(test)]
mod health_protocol_tests {
    use serde_json::{Value, json};

    use crate::{
        exec::{catalog, executor},
        infrastructure::comm::protocol::{CommandRequest, CommandStatus},
    };

    fn request(command: &str, params: Value) -> CommandRequest {
        CommandRequest {
            id: "health-request".into(),
            command: command.into(),
            params,
        }
    }

    #[tokio::test]
    async fn all_public_health_operations_validate_parameters_before_service_access() {
        for (command, params) in [
            (
                "create",
                json!({"definition_path":"/tmp/test", "mode":"INVALID"}),
            ),
            (
                "create",
                json!({"definition_path":"/tmp/test", "mode":"MANUAL", "extra":true}),
            ),
            ("run", json!({})),
            (
                "run",
                json!({"definition_path":"/tmp/test", "origin":"INTERNAL"}),
            ),
            ("start", json!({"run_id":"invalid"})),
            ("get", json!({"run_id":"invalid"})),
            ("stop", json!({"run_id":"invalid"})),
            ("delete", json!({"run_id":"invalid"})),
            ("list", json!({"extra":true})),
            ("report.list", json!({"extra":true})),
            ("report.get", json!({"run_id":"invalid"})),
            ("report.delete", json!({"run_id":"invalid"})),
        ] {
            let command = format!("backup.health.{command}");
            assert!(catalog::resolve(&command).is_some());
            let response = executor::execute(request(&command, params)).await;
            assert!(matches!(response.status, CommandStatus::Error));
            assert_eq!(response.id, "health-request");
            assert!(response.data.is_none());
            let error = response.error.unwrap();
            assert!(
                error.contains("parameters") || error.contains("UUID"),
                "{command}: {error}"
            );
        }
    }

    #[tokio::test]
    async fn maintenance_is_never_public_even_with_forged_origin() {
        for command in ["backup.health.expire", "backup.health.retain"] {
            assert!(!executor::is_registered(command));
            assert!(!executor::is_schedulable(command, false));
            assert!(executor::is_schedulable(command, true));
            for params in [json!({}), json!({"origin":"INTERNAL"})] {
                let response = executor::execute(request(command, params)).await;
                assert!(matches!(response.status, CommandStatus::Error));
                assert_eq!(response.error, Some(format!("Unknown command: {command}")));
            }
        }
    }

    #[tokio::test]
    async fn internal_dispatch_rejects_public_context_and_nonempty_parameters() {
        use crate::exec::queue::ExecutionContext;
        let response = executor::execute_queued(
            request("backup.health.expire", json!({})),
            ExecutionContext::Public,
            "queue-id".into(),
        )
        .await;
        assert_eq!(
            response.error.as_deref(),
            Some("Internal command is not public")
        );
        let response = executor::execute_queued(
            request("backup.health.expire", json!({"ttl":0})),
            ExecutionContext::InternalSchedule,
            "queue-id".into(),
        )
        .await;
        assert_eq!(
            response.error.as_deref(),
            Some("internal health operation requires empty parameters")
        );
    }

    #[test]
    fn queue_carries_trusted_context_separate_from_parameters() {
        use crate::{
            exec::queue::{CommandQueue, ExecutionContext},
            infrastructure::conf,
        };
        conf::tests::init_test_config();
        let (queue, mut receiver) = CommandQueue::new();
        queue
            .enqueue(request(
                "backup.health.expire",
                json!({"origin":"INTERNAL"}),
            ))
            .unwrap();
        assert!(matches!(
            receiver.try_recv().unwrap().context,
            ExecutionContext::Public
        ));
        queue
            .enqueue_scheduled(request("backup.health.expire", json!({})), true)
            .unwrap();
        assert!(matches!(
            receiver.try_recv().unwrap().context,
            ExecutionContext::InternalSchedule
        ));
        queue
            .enqueue_health(request("backup.health.start", Value::Null), "reserved-run")
            .unwrap();
        assert!(
            matches!(receiver.try_recv().unwrap().context, ExecutionContext::HealthRun(id) if id == "reserved-run")
        );
    }
}

#[cfg(test)]
mod health_worker_tests {
    use crate::{
        exec::{
            queue::{ExecutionContext, QueuedCommand},
            worker,
        },
        infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus},
    };
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    #[tokio::test]
    async fn capacity_one_preserves_private_work_and_internal_origin_once() {
        let (sender, receiver) = tokio::sync::mpsc::channel(3);
        for context in [
            ExecutionContext::InternalSchedule,
            ExecutionContext::HealthRun("run".into()),
        ] {
            sender
                .send(QueuedCommand {
                    execution_id: uuid::Uuid::new_v4().to_string(),
                    request: CommandRequest {
                        id: "request".into(),
                        command: "backup.health.run".into(),
                        params: serde_json::json!({}),
                    },
                    context,
                })
                .await
                .unwrap();
        }
        drop(sender);
        let count = Arc::new(AtomicUsize::new(0));
        let observed = count.clone();
        tokio::time::timeout(
            std::time::Duration::from_secs(1),
            worker::run_with_context(
                receiver,
                move |request, context, execution_id| {
                    assert_ne!(execution_id, request.id);
                    uuid::Uuid::parse_str(&execution_id).unwrap();
                    observed.fetch_add(
                        match context {
                            ExecutionContext::InternalSchedule => 1,
                            ExecutionContext::HealthRun(id) if id == "run" => 10,
                            _ => panic!("lost trusted context"),
                        },
                        Ordering::SeqCst,
                    );
                    async {
                        CommandResponse {
                            id: request.id,
                            status: CommandStatus::Ok,
                            data: None,
                            error: None,
                        }
                    }
                },
                1,
                2,
            ),
        )
        .await
        .expect("single worker must drain without another permit");
        assert_eq!(count.load(Ordering::SeqCst), 11);
    }
}

#[cfg(test)]
mod health_protocol_integration {
    use crate::{
        conf,
        exec::{executor, queue::ExecutionContext, worker},
        infrastructure::comm::protocol::{CommandRequest, CommandStatus},
    };
    use serde_json::{Value, json};

    fn request(operation: &str, params: Value) -> CommandRequest {
        CommandRequest {
            id: "protocol-request".into(),
            command: format!("backup.health.{operation}"),
            params,
        }
    }
    async fn ok(operation: &str, params: Value) -> Value {
        let response = executor::execute(request(operation, params)).await;
        assert!(
            matches!(response.status, CommandStatus::Ok),
            "{operation}: {:?}",
            response.error
        );
        response.data.unwrap()
    }

    #[test]
    fn health_protocol_uses_real_service_in_isolated_process() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "exec::tests::health_protocol_integration::child",
                "--ignored",
                "--nocapture",
            ])
            .env("KIDA_HEALTH_PROTOCOL_CHILD", "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[tokio::test]
    #[ignore = "fixture child; invoked by health_protocol_uses_real_service_in_isolated_process"]
    async fn child() {
        if std::env::var_os("KIDA_HEALTH_PROTOCOL_CHILD").is_none() {
            return;
        }
        let root =
            std::env::temp_dir().join(format!("kida-health-protocol-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let mut config = conf::KidaConfig::default();
        config.queue.capacity = 1;
        config.backup.backup_dir = root.join("jobs").to_string_lossy().into_owned();
        config.backup_health.data_root = root.join("data");
        config.backup_health.restore_root = root.join("restore");
        let config_path = root.join("config.toml");
        std::fs::write(&config_path, toml::to_string(&config).unwrap()).unwrap();
        conf::init(config_path).unwrap();
        let job = serde_json::from_value(json!({"id":uuid::Uuid::new_v4().to_string(),"name":"daily","sources":[],"targets":[],"compression":"tar_zstd"})).unwrap();
        crate::features::backup::repository::BackupRepository::new(&config.backup.backup_dir)
            .create(&job)
            .unwrap();
        std::fs::write(root.join("compose.yml"), "services: {}\n").unwrap();
        let definition_path = root.join("health.toml");
        std::fs::write(&definition_path, "id = 'check'\nname = 'Check'\n[backup]\nreference = 'daily'\nversion = 'latest'\n[docker]\ncompose = 'compose.yml'\n").unwrap();
        let created = ok(
            "create",
            json!({"definition_path":definition_path,"mode":"MANUAL"}),
        )
        .await;
        let run_id = created["run_id"].as_str().unwrap();
        assert_eq!(created["state"], "CREATED");
        let missing = executor::execute(request(
            "get",
            json!({"run_id":uuid::Uuid::new_v4().to_string()}),
        ))
        .await;
        assert!(matches!(missing.status, CommandStatus::Error));
        let mut receiver = executor::init_queue().unwrap();
        let started = ok("start", json!({"run_id":run_id})).await;
        assert_eq!(started["run_id"], run_id);
        assert_eq!(started["state"], "STARTING");
        assert_ne!(started["execution_id"], run_id);
        let duplicate = executor::execute(request("start", json!({"run_id":run_id}))).await;
        assert!(matches!(duplicate.status, CommandStatus::Error));
        let task = receiver.try_recv().unwrap();
        assert_eq!(started["execution_id"], task.execution_id);
        executor::execute_queued(task.request, task.context, task.execution_id).await;
        let fetched = ok("get", json!({"run_id":run_id})).await;
        assert_eq!(fetched["state"], "ERROR");
        assert_eq!(ok("list", json!({})).await.as_array().unwrap().len(), 1);
        assert_eq!(ok("report.list", json!({})).await, json!([run_id]));
        assert!(
            !ok("report.get", json!({"run_id":run_id})).await["markdown"]
                .as_str()
                .unwrap()
                .is_empty()
        );
        ok("stop", json!({"run_id":run_id})).await;
        ok("delete", json!({"run_id":run_id})).await;
        ok("report.delete", json!({"run_id":run_id})).await;
        assert!(
            ok("report.list", json!({}))
                .await
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert_eq!(ok("list", json!({})).await.as_array().unwrap().len(), 1);

        let automatic = ok("run", json!({"definition_path":definition_path})).await;
        assert_eq!(automatic["state"], "STARTING");
        let task = receiver.try_recv().unwrap();
        assert_eq!(automatic["execution_id"], task.execution_id);
        executor::execute_queued(task.request, task.context, task.execution_id).await;

        let queue = executor::command_queue().unwrap();
        queue.enqueue(request("list", json!({}))).unwrap();
        let retry = ok(
            "create",
            json!({"definition_path":definition_path,"mode":"MANUAL"}),
        )
        .await;
        let retry_id = retry["run_id"].as_str().unwrap();
        let full = executor::execute(request("start", json!({"run_id":retry_id}))).await;
        assert_eq!(full.error.as_deref(), Some("Execution queue is full"));
        assert_eq!(
            ok("get", json!({"run_id":retry_id})).await["state"],
            "CREATED"
        );
        drop(receiver);
        let closed = executor::execute(request("start", json!({"run_id":retry_id}))).await;
        assert_eq!(closed.error.as_deref(), Some("Execution queue is closed"));
        let public_run =
            executor::execute(request("run", json!({"definition_path":definition_path}))).await;
        assert_eq!(
            public_run.error.as_deref(),
            Some("Execution queue is closed")
        );

        let (sender, receiver) = tokio::sync::mpsc::channel(1);
        sender
            .send(crate::exec::queue::QueuedCommand {
                execution_id: "scheduled-queue-id".into(),
                request: request("run", json!({"definition_path":definition_path})),
                context: ExecutionContext::Public,
            })
            .await
            .unwrap();
        drop(sender);
        let responses = std::sync::Arc::new(tokio::sync::Mutex::new(Vec::new()));
        let captured = responses.clone();
        tokio::time::timeout(
            std::time::Duration::from_secs(2),
            worker::run_with_context(
                receiver,
                move |request, context, execution_id| {
                    let captured = captured.clone();
                    async move {
                        let response =
                            executor::execute_queued(request, context, execution_id).await;
                        captured.lock().await.push(response.data.clone());
                        response
                    }
                },
                1,
                1,
            ),
        )
        .await
        .expect("scheduled execution must not enqueue behind itself");
        let responses = responses.lock().await;
        let data = responses[0].as_ref().expect("scheduled run succeeded");
        assert_eq!(data["execution_id"], "scheduled-queue-id");
        assert_ne!(data["run_id"], "scheduled-queue-id");
        std::fs::remove_dir_all(root).unwrap();
    }
}
