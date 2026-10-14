// Must implement tests cases here! Do not implement tests inside source files!
#[cfg(test)]
mod rule_tests {
    use crate::features::scheduler::{
        model::ScheduleRule,
        time::{next_enqueue_at, parse_once},
    };

    // >< >< >< >< >< >< >< >< ><
    // >< >< time.rs tests  >< ><
    // >< >< >< >< >< >< >< >< ><
    #[test]
    fn next_date_distinguishes_expired_once_from_recurrences() {
        let anchor = parse_once("2026-10-10T12:00:00Z").unwrap();
        let after = parse_once("2026-10-10T12:07:35Z").unwrap();

        let expired = ScheduleRule::Once {
            at: "2026-10-10T12:01:00Z".to_string(),
        };
        assert_eq!(next_enqueue_at(&expired, anchor, after).unwrap(), None);
        assert_eq!(
            next_enqueue_at(
                &expired,
                anchor,
                parse_once("2026-10-10T12:01:00Z").unwrap()
            )
            .unwrap(),
            None
        );

        let future = ScheduleRule::Once {
            at: "2026-10-10T12:10:00Z".to_string(),
        };
        assert_eq!(
            next_enqueue_at(&future, anchor, after).unwrap(),
            Some(parse_once("2026-10-10T12:10:00Z").unwrap())
        );

        let interval = ScheduleRule::Interval { seconds: 60 };
        assert_eq!(
            next_enqueue_at(&interval, anchor, after).unwrap(),
            Some(parse_once("2026-10-10T12:08:00Z").unwrap())
        );

        let cron = ScheduleRule::Cron {
            expression: "*/5 * * * *".to_string(),
            timezone: "UTC".to_string(),
        };
        assert_eq!(
            next_enqueue_at(&cron, anchor, after).unwrap(),
            Some(parse_once("2026-10-10T12:10:00Z").unwrap())
        );
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};

    use chrono::{DateTime, Utc};
    use serde_json::{Value, json};
    use uuid::Uuid;

    use crate::{
        exec::queue::CommandQueue,
        features::scheduler::{
            manager::SchedulerManager,
            model::{NewSchedule, ScheduleRule},
            repository::{ScheduleDocument, ScheduleRepository, StoredSchedule},
            service::ScheduleService,
            time::{next_interval, parse_once},
        },
        infrastructure::comm::protocol::CommandRequest,
    };

    // >< >< >< >< >< >< >< >< >< ><
    // >< >< manager.rs tests  >< ><
    // >< >< >< >< >< >< >< >< >< ><
    #[test]
    fn concurrent_delete_and_due_allow_only_pre_delete_enqueue() {
        let path =
            std::env::temp_dir().join(format!("kida-scheduler-manager-{}.toml", Uuid::new_v4()));
        let anchor = parse_once("2000-01-01T00:00:00Z").unwrap();
        let mut service = ScheduleService::load(&path, anchor).unwrap();

        let definition = service
            .add(
                NewSchedule {
                    command: "health".to_string(),
                    params: json!({"marker": null}),
                    schedule: ScheduleRule::Interval { seconds: 60 },
                },
                anchor,
            )
            .unwrap();

        let id = definition["id"].as_str().unwrap().to_string();
        crate::conf::tests::init_test_config();
        let (queue, mut receiver) = CommandQueue::new();
        let manager = Arc::new(SchedulerManager::new(service, queue));
        let barrier = Arc::new(Barrier::new(3));

        let due_thread = {
            let manager = Arc::clone(&manager);
            let barrier = Arc::clone(&barrier);

            std::thread::spawn(move || {
                barrier.wait();
                manager.enqueue_due().unwrap();
            })
        };

        let delete_thread = {
            let manager = Arc::clone(&manager);
            let barrier = Arc::clone(&barrier);

            std::thread::spawn(move || {
                barrier.wait();
                manager.delete(&id).unwrap()
            })
        };

        barrier.wait();
        due_thread.join().unwrap();
        assert_eq!(delete_thread.join().unwrap(), definition);
        assert_eq!(manager.list().unwrap(), json!([]));

        if let Ok(queued) = receiver.try_recv() {
            assert_eq!(queued.request.command, "health");
            assert_eq!(queued.request.params, json!({"marker": null}));
        }
        assert!(receiver.try_recv().is_err());

        manager.enqueue_due().unwrap();
        manager.enqueue_due().unwrap();
        assert!(receiver.try_recv().is_err());

        let reloaded = ScheduleService::load(&path, Utc::now()).unwrap();
        assert_eq!(reloaded.list(), json!([]));

        std::fs::remove_file(&path).unwrap();
    }

    // >< >< >< >< >< >< >< >< >< >< ><
    // >< >< repository.rs tests  >< ><
    // >< >< >< >< >< >< >< >< >< >< ><
    #[test]
    fn toml_preserves_json_params() {
        let values = [
            Value::Null,
            serde_json::json!({
                "nested": [null, true, {"text": "línea\n\"texto\""}],
                "integer": 18446744073709551615_u64,
                "decimal": 1.25
            }),
        ];

        for params in values {
            let document = ScheduleDocument {
                schedules: vec![StoredSchedule {
                    id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                    command: "health".to_string(),
                    params: params.clone(),
                    schedule: ScheduleRule::Interval { seconds: 60 },
                    anchor_at: "2026-10-10T12:00:00Z".to_string(),
                }],
            };

            let encoded = toml::to_string_pretty(&document).unwrap();
            let decoded: ScheduleDocument = toml::from_str(&encoded).unwrap();

            assert_eq!(decoded.schedules[0].params, params);
        }
    }

    // >< >< >< >< >< >< >< >< >< ><
    // >< >< service.rs tests  >< ><
    // >< >< >< >< >< >< >< >< >< ><
    #[test]
    fn startup_removes_expired_once_and_preserves_interval_anchor() {
        let path = std::env::temp_dir().join(format!("kida-scheduler-{}.toml", Uuid::new_v4()));
        let now = parse_once("2026-10-10T12:07:35Z").unwrap();

        assert_eq!(ScheduleService::load(&path, now).unwrap().list(), json!([]));
        assert!(!path.exists());

        let expired_id = Uuid::new_v4().to_string();
        let interval_id = Uuid::new_v4().to_string();
        let repository = ScheduleRepository::new(&path);

        repository
            .save(&[
                StoredSchedule {
                    id: expired_id,
                    command: "health".to_string(),
                    params: Value::Null,
                    schedule: ScheduleRule::Once {
                        at: "2026-10-10T12:01:00Z".to_string(),
                    },
                    anchor_at: "2026-10-10T12:00:00Z".to_string(),
                },
                StoredSchedule {
                    id: interval_id.clone(),
                    command: "health".to_string(),
                    params: json!({"nested": null}),
                    schedule: ScheduleRule::Interval { seconds: 60 },
                    anchor_at: "2026-10-10T12:00:00Z".to_string(),
                },
            ])
            .unwrap();

        let service = ScheduleService::load(&path, now).unwrap();
        let listed = service.list();

        assert_eq!(listed.as_array().unwrap().len(), 1);
        assert_eq!(listed[0]["id"], interval_id);
        assert_eq!(listed[0]["params"], json!({"nested": null}));
        assert_eq!(listed[0]["next_enqueue_at"], "2026-10-10T12:08:00+00:00");

        let persisted = repository.load().unwrap();
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].anchor_at, "2026-10-10T12:00:00Z");

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn add_validates_persists_and_keeps_memory_on_save_failure() {
        let path = std::env::temp_dir().join(format!("kida-scheduler-add-{}.toml", Uuid::new_v4()));
        let now = parse_once("2026-10-10T12:00:00Z").unwrap();
        let mut service = ScheduleService::load(&path, now).unwrap();

        let invalid = [
            NewSchedule {
                command: "unknown.command".to_string(),
                params: Value::Null,
                schedule: ScheduleRule::Interval { seconds: 60 },
            },
            NewSchedule {
                command: "health".to_string(),
                params: Value::Null,
                schedule: ScheduleRule::Once {
                    at: now.to_rfc3339(),
                },
            },
            NewSchedule {
                command: "health".to_string(),
                params: Value::Null,
                schedule: ScheduleRule::Interval { seconds: 0 },
            },
        ];

        for input in invalid {
            assert!(service.add(input, now).is_err());
        }

        assert_eq!(service.list(), json!([]));
        assert!(!path.exists());

        let response = service
            .add(
                NewSchedule {
                    command: "health".to_string(),
                    params: Value::Null,
                    schedule: ScheduleRule::Interval { seconds: 60 },
                },
                now,
            )
            .unwrap();

        Uuid::parse_str(response["id"].as_str().unwrap()).unwrap();
        assert_eq!(response["command"], "health");
        assert_eq!(response["params"], Value::Null);
        assert_eq!(
            response["schedule"],
            json!({"type": "interval", "seconds": 60})
        );
        assert!(response.get("anchor_at").is_none());
        assert!(response.get("next_enqueue_at").is_none());

        let persisted = ScheduleRepository::new(&path).load().unwrap();
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].params, Value::Null);
        assert_eq!(persisted[0].anchor_at, now.to_rfc3339());

        let reloaded = ScheduleService::load(&path, now).unwrap();
        assert_eq!(reloaded.list(), service.list());
        assert_eq!(
            reloaded.list()[0]["next_enqueue_at"],
            "2026-10-10T12:01:00+00:00"
        );

        let before_failure = service.list();
        std::fs::write(&path, "invalid = [").unwrap();

        assert!(
            service
                .add(
                    NewSchedule {
                        command: "health".to_string(),
                        params: json!({"nested": null}),
                        schedule: ScheduleRule::Interval { seconds: 120 },
                    },
                    now,
                )
                .is_err()
        );
        assert_eq!(service.list(), before_failure);

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn delete_persists_and_keeps_memory_on_save_failure() {
        let path =
            std::env::temp_dir().join(format!("kida-scheduler-delete-{}.toml", Uuid::new_v4()));
        let now = parse_once("2026-10-10T12:00:00Z").unwrap();
        let mut service = ScheduleService::load(&path, now).unwrap();

        let first = service
            .add(
                NewSchedule {
                    command: "health".to_string(),
                    params: json!({"nested": null}),
                    schedule: ScheduleRule::Interval { seconds: 60 },
                },
                now,
            )
            .unwrap();

        let second = service
            .add(
                NewSchedule {
                    command: "health".to_string(),
                    params: Value::Null,
                    schedule: ScheduleRule::Interval { seconds: 120 },
                },
                now,
            )
            .unwrap();

        let first_id = first["id"].as_str().unwrap();
        let second_id = second["id"].as_str().unwrap();
        let before = service.list();
        let original_file = std::fs::read_to_string(&path).unwrap();

        assert!(service.delete("not-a-uuid").is_err());
        assert!(service.delete(&Uuid::new_v4().to_string()).is_err());
        assert_eq!(service.list(), before);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original_file);

        std::fs::write(&path, "invalid = [").unwrap();

        assert!(service.delete(first_id).is_err());
        assert_eq!(service.list(), before);

        std::fs::write(&path, &original_file).unwrap();

        let equivalent_id = Uuid::parse_str(first_id).unwrap().simple().to_string();
        assert_eq!(service.delete(&equivalent_id).unwrap(), first);

        let listed = service.list();
        assert_eq!(listed.as_array().unwrap().len(), 1);
        assert_eq!(listed[0]["id"], second_id);
        assert_eq!(listed[0]["params"], Value::Null);
        assert!(service.delete(first_id).is_err());

        let reloaded = ScheduleService::load(&path, now).unwrap();
        assert_eq!(reloaded.list(), listed);

        assert_eq!(service.delete(second_id).unwrap(), second);
        assert_eq!(service.list(), json!([]));
        assert_eq!(ScheduleService::load(&path, now).unwrap().list(), json!([]));

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn due_drops_full_queue_skips_backlog_and_preserves_queued_requests() {
        let path = std::env::temp_dir().join(format!("kida-scheduler-due-{}.toml", Uuid::new_v4()));
        let now = parse_once("2026-10-10T12:00:00Z").unwrap();
        let mut service = ScheduleService::load(&path, now).unwrap();
        crate::conf::tests::init_test_config();
        let (queue, mut receiver) = CommandQueue::new();

        service
            .add(
                NewSchedule {
                    command: "health".to_string(),
                    params: Value::Null,
                    schedule: ScheduleRule::Once {
                        at: "2026-10-10T12:01:00Z".to_string(),
                    },
                },
                now,
            )
            .unwrap();

        let interval = service
            .add(
                NewSchedule {
                    command: "backup.run".to_string(),
                    params: json!({"id": "resolved-at-execution"}),
                    schedule: ScheduleRule::Interval { seconds: 60 },
                },
                now,
            )
            .unwrap();

        for index in 0..crate::conf::get().unwrap().queue.capacity {
            queue
                .enqueue(CommandRequest {
                    id: format!("filler-{index}"),
                    command: "health".to_string(),
                    params: Value::Null,
                })
                .unwrap();
        }

        let late = parse_once("2026-10-10T12:07:35Z").unwrap();
        service.enqueue_due(late, &queue).unwrap();

        let listed = service.list();
        assert_eq!(listed.as_array().unwrap().len(), 1);
        assert_eq!(listed[0]["id"], interval["id"]);
        assert_eq!(listed[0]["next_enqueue_at"], "2026-10-10T12:08:00+00:00");

        let persisted = ScheduleRepository::new(&path).load().unwrap();
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].id, interval["id"].as_str().unwrap());

        for index in 0..crate::conf::get().unwrap().queue.capacity {
            assert_eq!(
                receiver.try_recv().unwrap().request.id,
                format!("filler-{index}")
            );
        }
        assert!(receiver.try_recv().is_err());

        service.enqueue_due(late, &queue).unwrap();
        assert!(receiver.try_recv().is_err());

        service
            .enqueue_due(parse_once("2026-10-10T12:08:00Z").unwrap(), &queue)
            .unwrap();
        service
            .enqueue_due(parse_once("2026-10-10T12:09:00Z").unwrap(), &queue)
            .unwrap();

        service.delete(interval["id"].as_str().unwrap()).unwrap();
        service
            .enqueue_due(parse_once("2026-10-10T12:10:00Z").unwrap(), &queue)
            .unwrap();

        for _ in 0..2 {
            let queued = receiver.try_recv().unwrap();
            assert_eq!(queued.request.command, "backup.run");
            assert_eq!(
                queued.request.params,
                json!({"id": "resolved-at-execution"})
            );
        }

        assert!(receiver.try_recv().is_err());
        assert_eq!(service.list(), json!([]));

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn restart_preserves_cadence_and_skips_expired_once_and_cron_fold() {
        let path =
            std::env::temp_dir().join(format!("kida-scheduler-restart-{}.toml", Uuid::new_v4()));
        let anchor = parse_once("2026-10-25T00:29:00Z").unwrap();
        let mut service = ScheduleService::load(&path, anchor).unwrap();

        let cron = service
            .add(
                NewSchedule {
                    command: "health".to_string(),
                    params: json!({"source": "cron"}),
                    schedule: ScheduleRule::Cron {
                        expression: "30 2 * * *".to_string(),
                        timezone: "Europe/Madrid".to_string(),
                    },
                },
                anchor,
            )
            .unwrap();

        let interval = service
            .add(
                NewSchedule {
                    command: "health".to_string(),
                    params: json!({"source": "interval"}),
                    schedule: ScheduleRule::Interval { seconds: 60 },
                },
                anchor,
            )
            .unwrap();

        service
            .add(
                NewSchedule {
                    command: "health".to_string(),
                    params: json!({"source": "once"}),
                    schedule: ScheduleRule::Once {
                        at: "2026-10-25T00:45:00Z".to_string(),
                    },
                },
                anchor,
            )
            .unwrap();

        crate::conf::tests::init_test_config();
        let (queue, receiver) = CommandQueue::new();

        service
            .enqueue_due(parse_once("2026-10-25T00:30:00Z").unwrap(), &queue)
            .unwrap();

        assert_eq!(receiver.len(), 2);

        drop(receiver);
        drop(queue);
        drop(service);

        let restarted_at = parse_once("2026-10-25T01:10:00Z").unwrap();
        let mut restarted = ScheduleService::load(&path, restarted_at).unwrap();
        let listed = restarted.list();

        assert_eq!(listed.as_array().unwrap().len(), 2);
        assert_eq!(listed[0]["id"], cron["id"]);
        assert_eq!(listed[0]["next_enqueue_at"], "2026-10-26T01:30:00+00:00");
        assert_eq!(listed[1]["id"], interval["id"]);
        assert_eq!(listed[1]["next_enqueue_at"], "2026-10-25T01:11:00+00:00");

        let persisted = ScheduleRepository::new(&path).load().unwrap();
        assert_eq!(persisted.len(), 2);
        for definition in &persisted {
            assert_eq!(definition.anchor_at, anchor.to_rfc3339());
        }

        crate::conf::tests::init_test_config();
        let (new_queue, mut new_receiver) = CommandQueue::new();
        restarted.enqueue_due(restarted_at, &new_queue).unwrap();

        assert!(new_receiver.try_recv().is_err());
        assert_eq!(restarted.list(), listed);

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn due_persistence_failure_preserves_state_and_does_not_enqueue() {
        let path =
            std::env::temp_dir().join(format!("kida-scheduler-save-error-{}.toml", Uuid::new_v4()));
        let anchor = parse_once("2026-10-10T12:00:00Z").unwrap();
        let due = parse_once("2026-10-10T12:01:00Z").unwrap();
        let mut service = ScheduleService::load(&path, anchor).unwrap();

        service
            .add(
                NewSchedule {
                    command: "health".to_string(),
                    params: Value::Null,
                    schedule: ScheduleRule::Once {
                        at: due.to_rfc3339(),
                    },
                },
                anchor,
            )
            .unwrap();

        service
            .add(
                NewSchedule {
                    command: "health".to_string(),
                    params: json!({"source": "interval"}),
                    schedule: ScheduleRule::Interval { seconds: 60 },
                },
                anchor,
            )
            .unwrap();

        let before = service.list();
        let corrupt_content = "invalid = [";
        std::fs::write(&path, corrupt_content).unwrap();

        crate::conf::tests::init_test_config();
        let (queue, mut receiver) = CommandQueue::new();

        assert!(service.enqueue_due(due, &queue).is_err());
        assert_eq!(service.list(), before);
        assert!(receiver.try_recv().is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), corrupt_content);

        assert!(ScheduleService::load(&path, due).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), corrupt_content);

        std::fs::remove_file(&path).unwrap();
    }

    // >< >< >< >< >< >< >< >< ><
    // >< >< time.rs tests  >< ><
    // >< >< >< >< >< >< >< >< ><
    #[test]
    fn once_requires_offset_and_normalizes_to_utc() {
        assert_eq!(
            parse_once("2026-10-10T14:00:00+02:00").unwrap(),
            parse_once("2026-10-10T12:00:00Z").unwrap()
        );
        assert!(parse_once("2026-10-10T14:00:00").is_err());
    }

    #[test]
    fn interval_keeps_anchor_and_skips_elapsed_occurrences() {
        let anchor = parse_once("2026-10-10T12:00:00.250Z").unwrap();

        for (after, expected) in [
            ("2026-10-10T11:59:00Z", "2026-10-10T12:01:00.250Z"),
            ("2026-10-10T12:00:00.250Z", "2026-10-10T12:01:00.250Z"),
            ("2026-10-10T12:01:00Z", "2026-10-10T12:01:00.250Z"),
            ("2026-10-10T12:01:00.250Z", "2026-10-10T12:02:00.250Z"),
            ("2026-10-10T12:07:35Z", "2026-10-10T12:08:00.250Z"),
        ] {
            assert_eq!(
                next_interval(anchor, 60, parse_once(after).unwrap()).unwrap(),
                parse_once(expected).unwrap()
            );
        }

        assert!(next_interval(anchor, 0, anchor).is_err());
        assert!(next_interval(anchor, u64::MAX, anchor).is_err());
        assert!(next_interval(DateTime::<Utc>::MAX_UTC, 1, DateTime::<Utc>::MAX_UTC).is_err());
    }
}

#[cfg(test)]
mod cron_tests {
    use crate::features::scheduler::time::{next_cron, parse_once};

    #[test]
    fn cron_validates_input_and_uses_dom_or_dow() {
        let after = parse_once("2026-10-10T12:00:00.250Z").unwrap();

        assert_eq!(
            next_cron("*/5 * * * *", "UTC", after).unwrap(),
            parse_once("2026-10-10T12:05:00Z").unwrap()
        );

        assert_eq!(
            next_cron(
                "0 0 15 * MON",
                "UTC",
                parse_once("2026-10-11T00:00:00Z").unwrap()
            )
            .unwrap(),
            parse_once("2026-10-12T00:00:00Z").unwrap()
        );

        for expression in ["* * * *", "0 * * * * *", "61 * * * *", "0 0 15 * +MON"] {
            assert!(next_cron(expression, "UTC", after).is_err());
        }

        assert!(next_cron("* * * * *", "invalid/timezone", after).is_err());
    }

    #[test]
    fn cron_skips_nonexistent_local_time() {
        assert_eq!(
            next_cron(
                "30 2 * * *",
                "Europe/Madrid",
                parse_once("2026-03-28T23:00:00Z").unwrap()
            )
            .unwrap(),
            parse_once("2026-03-30T00:30:00Z").unwrap()
        );
    }

    #[test]
    fn cron_uses_only_first_occurrence_of_repeated_local_time() {
        for (after, expected) in [
            ("2026-10-24T23:00:00Z", "2026-10-25T00:30:00Z"),
            ("2026-10-25T00:30:00Z", "2026-10-26T01:30:00Z"),
            ("2026-10-25T01:10:00Z", "2026-10-26T01:30:00Z"),
        ] {
            assert_eq!(
                next_cron("30 2 * * *", "Europe/Madrid", parse_once(after).unwrap()).unwrap(),
                parse_once(expected).unwrap()
            );
        }

        assert_eq!(
            next_cron(
                "* * * * *",
                "Europe/Madrid",
                parse_once("2026-10-25T01:10:00Z").unwrap()
            )
            .unwrap(),
            parse_once("2026-10-25T02:00:00Z").unwrap()
        );
    }
}
