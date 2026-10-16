// Must implement tests cases here! Do not implement tests inside source files!
#[cfg(test)]
mod mod_tests {
    use chrono::Utc;
    use serde_json::{Value, json};
    use uuid::Uuid;

    use crate::{
        exec::{
            commands::scheduler::{scheduler_add, scheduler_delete, scheduler_list},
            queue::CommandQueue,
        },
        features::scheduler::{manager::SchedulerManager, service::ScheduleService},
        infrastructure::comm::protocol::{CommandRequest, CommandStatus},
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
                    "command": "scheduler.list",
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
                    "command": "scheduler.list",
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
    #[tokio::test]
    async fn origins_filters_spoofing_and_scheduled_requests_use_public_permissions() {
        use crate::features::scheduler::model::{NewSchedule, ScheduleOriginFilter, ScheduleRule};
        let path =
            std::env::temp_dir().join(format!("kida-handler-origins-{}.toml", Uuid::new_v4()));
        let now = Utc::now();
        let mut service = ScheduleService::load(&path, now).unwrap();
        let internal = service
            .add_internal(
                NewSchedule {
                    command: "scheduler.list".into(),
                    params: Value::Null,
                    schedule: ScheduleRule::Interval { seconds: 3600 },
                },
                now,
            )
            .unwrap();
        let id = internal["id"].as_str().unwrap();
        // Even an INTERNAL scheduled command invokes the public delete handler.
        let anchor = now - chrono::TimeDelta::seconds(120);
        service
            .add_internal(
                NewSchedule {
                    command: "scheduler.delete".into(),
                    params: json!({"id":id}),
                    schedule: ScheduleRule::Once {
                        at: (anchor + chrono::TimeDelta::seconds(60)).to_rfc3339(),
                    },
                },
                anchor,
            )
            .unwrap();
        crate::conf::tests::init_test_config();
        let (queue, mut receiver) = CommandQueue::new();
        let manager = SchedulerManager::new(service, queue);
        manager.enqueue_due().unwrap();
        let queued = receiver.try_recv().unwrap().request;
        assert_eq!(queued.command, "scheduler.delete");
        assert!(matches!(
            scheduler_delete::exec(queued, &manager).await.status,
            CommandStatus::Error
        ));
        assert!(receiver.try_recv().is_err());

        let user = manager
            .add(NewSchedule {
                command: "scheduler.list".into(),
                params: json!({"origin":"INTERNAL","permissions":"internal"}),
                schedule: ScheduleRule::Interval { seconds: 3600 },
            })
            .unwrap();
        assert_eq!(user["origin"], "USER");
        let before = manager.list_by_origin(ScheduleOriginFilter::All).unwrap();
        let original = std::fs::read_to_string(&path).unwrap();
        for params in [json!({}), Value::Null, json!({"origin":"USER"})] {
            let response = scheduler_list::exec(request("scheduler.list", params), &manager).await;
            assert!(matches!(response.status, CommandStatus::Ok));
            assert_eq!(response.data.unwrap()[0]["id"], user["id"]);
        }
        for (origin, count) in [("INTERNAL", 1), ("ALL", 2)] {
            let response = scheduler_list::exec(
                request("scheduler.list", json!({"origin":origin})),
                &manager,
            )
            .await;
            assert_eq!(response.data.unwrap().as_array().unwrap().len(), count);
        }
        for params in [
            json!({"origin":"user"}),
            json!({"origin":null}),
            json!({"origin":1}),
            json!({"origin":"OTHER"}),
            json!({"internal":true}),
            json!([]),
            json!("ALL"),
        ] {
            assert!(matches!(
                scheduler_list::exec(request("scheduler.list", params), &manager)
                    .await
                    .status,
                CommandStatus::Error
            ));
        }
        for key in ["origin", "internal", "permissions"] {
            let mut params = json!({"command":"scheduler.list","params":null,"schedule":{"type":"interval","seconds":60}});
            params[key] = json!("INTERNAL");
            assert!(matches!(
                scheduler_add::exec(request("scheduler.add", params), &manager)
                    .await
                    .status,
                CommandStatus::Error
            ));
            let mut params = json!({"id":id});
            params[key] = json!("INTERNAL");
            assert!(matches!(
                scheduler_delete::exec(request("scheduler.delete", params), &manager)
                    .await
                    .status,
                CommandStatus::Error
            ));
        }
        assert!(matches!(
            scheduler_delete::exec(request("scheduler.delete", json!({"id":id})), &manager)
                .await
                .status,
            CommandStatus::Error
        ));
        assert_eq!(
            manager.list_by_origin(ScheduleOriginFilter::All).unwrap(),
            before
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        let replaced = manager
            .replace_internal(
                id,
                NewSchedule {
                    command: "scheduler.list".into(),
                    params: json!([null, true]),
                    schedule: ScheduleRule::Interval { seconds: 3600 },
                },
            )
            .unwrap();
        assert_ne!(replaced["id"], internal["id"]);
        manager
            .delete_internal(replaced["id"].as_str().unwrap())
            .unwrap();
        std::fs::remove_file(path).unwrap();
    }
}
