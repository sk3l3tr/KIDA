use std::{collections::HashSet, path::PathBuf};

use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    comm::protocol::CommandRequest,
    exec::{
        executor,
        queue::{CommandQueue, QueueError},
    },
};

use super::{
    model::NewSchedule,
    repository::{ScheduleRepository, StoredSchedule},
    time::{next_enqueue_at, parse_once},
};

struct ScheduleEntry {
    definition: StoredSchedule,
    next_enqueue_at: DateTime<Utc>,
}

pub struct ScheduleService {
    repository: ScheduleRepository,
    entries: Vec<ScheduleEntry>,
}

impl ScheduleService {
    pub fn load(path: impl Into<PathBuf>, now: DateTime<Utc>) -> Result<Self, String> {
        let repository = ScheduleRepository::new(path);
        let definitions = repository.load().map_err(|error| error.to_string())?;
        let mut entries = Vec::new();
        let mut identifiers = HashSet::new();
        let mut removed_expired = false;

        for definition in definitions {
            let id = Uuid::parse_str(&definition.id)
                .map_err(|_| format!("invalid schedule UUID: {}", definition.id))?;

            if !identifiers.insert(id) {
                return Err(format!("duplicate schedule UUID: {id}"));
            }

            let anchor = parse_once(&definition.anchor_at)
                .map_err(|error| format!("schedule {id}: invalid anchor_at: {error}"))?;

            let next = next_enqueue_at(&definition.schedule, anchor, now)
                .map_err(|error| format!("schedule {id}: {error}"))?;

            let Some(next_enqueue_at) = next else {
                removed_expired = true;
                continue;
            };

            if !executor::is_registered(&definition.command) {
                return Err(format!(
                    "schedule {id}: unknown command: {}",
                    definition.command
                ));
            }

            entries.push(ScheduleEntry {
                definition,
                next_enqueue_at,
            });
        }

        if removed_expired {
            let remaining: Vec<_> = entries
                .iter()
                .map(|entry| entry.definition.clone())
                .collect();

            repository
                .save(&remaining)
                .map_err(|error| error.to_string())?;
        }

        Ok(Self {
            repository,
            entries,
        })
    }

    pub fn add(&mut self, input: NewSchedule, now: DateTime<Utc>) -> Result<Value, String> {
        if !executor::is_registered(&input.command) {
            return Err(format!("unknown command: {}", input.command));
        }

        let next_enqueue_at = next_enqueue_at(&input.schedule, now, now)?
            .ok_or_else(|| "once.at must be in the future".to_string())?;

        let definition = StoredSchedule {
            id: Uuid::new_v4().to_string(),
            command: input.command,
            params: input.params,
            schedule: input.schedule,
            anchor_at: now.to_rfc3339(),
        };

        let response = json!({
            "id": definition.id,
            "command": definition.command,
            "params": definition.params,
            "schedule": definition.schedule,
        });

        let mut definitions: Vec<_> = self
            .entries
            .iter()
            .map(|entry| entry.definition.clone())
            .collect();

        definitions.push(definition.clone());

        self.repository
            .save(&definitions)
            .map_err(|error| error.to_string())?;

        self.entries.push(ScheduleEntry {
            definition,
            next_enqueue_at,
        });

        Ok(response)
    }

    pub fn delete(&mut self, id: &str) -> Result<Value, String> {
        let id = Uuid::parse_str(id).map_err(|_| "id must be a valid UUID".to_string())?;

        let index = self
            .entries
            .iter()
            .position(|entry| Uuid::parse_str(&entry.definition.id).ok() == Some(id))
            .ok_or_else(|| format!("schedule not found: {id}"))?;

        let definition = &self.entries[index].definition;
        let response = json!({
            "id": definition.id,
            "command": definition.command,
            "params": definition.params,
            "schedule": definition.schedule,
        });

        let remaining: Vec<_> = self
            .entries
            .iter()
            .enumerate()
            .filter(|(entry_index, _)| *entry_index != index)
            .map(|(_, entry)| entry.definition.clone())
            .collect();

        self.repository
            .save(&remaining)
            .map_err(|error| error.to_string())?;

        self.entries.remove(index);

        Ok(response)
    }

    pub fn enqueue_due(&mut self, now: DateTime<Utc>, queue: &CommandQueue) -> Result<(), String> {
        if !self
            .entries
            .iter()
            .any(|entry| entry.next_enqueue_at <= now)
        {
            return Ok(());
        }

        let mut remaining = Vec::new();
        let mut requests = Vec::new();

        for entry in &self.entries {
            if entry.next_enqueue_at > now {
                remaining.push(ScheduleEntry {
                    definition: entry.definition.clone(),
                    next_enqueue_at: entry.next_enqueue_at,
                });
                continue;
            }

            let definition = &entry.definition;
            let anchor = parse_once(&definition.anchor_at)?;
            let next = next_enqueue_at(&definition.schedule, anchor, now)?;

            requests.push(CommandRequest {
                id: Uuid::new_v4().to_string(),
                command: definition.command.clone(),
                params: definition.params.clone(),
            });

            if let Some(next_enqueue_at) = next {
                remaining.push(ScheduleEntry {
                    definition: definition.clone(),
                    next_enqueue_at,
                });
            }
        }

        if remaining.len() != self.entries.len() {
            let definitions: Vec<_> = remaining
                .iter()
                .map(|entry| entry.definition.clone())
                .collect();

            self.repository
                .save(&definitions)
                .map_err(|error| error.to_string())?;
        }

        self.entries = remaining;

        for request in requests {
            match queue.enqueue(request) {
                Ok(_) | Err(QueueError::Full) => {}
                Err(QueueError::Closed) => {
                    return Err("Execution queue is closed".to_string());
                }
            }
        }

        Ok(())
    }

    pub fn list(&self) -> Value {
        Value::Array(
            self.entries
                .iter()
                .map(|entry| {
                    let definition = &entry.definition;

                    json!({
                        "id": definition.id,
                        "command": definition.command,
                        "params": definition.params,
                        "schedule": definition.schedule,
                        "next_enqueue_at": entry.next_enqueue_at.to_rfc3339(),
                    })
                })
                .collect(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scheduler::model::ScheduleRule;

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
}
