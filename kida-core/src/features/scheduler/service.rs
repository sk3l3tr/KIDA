use std::{collections::HashSet, path::PathBuf};

use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    exec::{
        executor,
        queue::{CommandQueue, QueueError},
    },
    infrastructure::comm::protocol::CommandRequest,
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
