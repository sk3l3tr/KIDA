use std::{
    collections::HashSet,
    path::PathBuf,
    time::{Duration, Instant},
};

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
    model::{NewSchedule, ScheduleOrigin, ScheduleOriginFilter},
    repository::{ScheduleRepository, StoredSchedule},
    time::{next_enqueue_at, parse_once},
};

#[derive(Clone)]
struct ScheduleEntry {
    definition: StoredSchedule,
    next_enqueue_at: DateTime<Utc>,
}

pub struct ScheduleService {
    repository: ScheduleRepository,
    entries: Vec<ScheduleEntry>,
    retry_at: Option<Instant>,
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
            retry_at: None,
        })
    }

    pub fn add(&mut self, input: NewSchedule, now: DateTime<Utc>) -> Result<Value, String> {
        self.insert(input, ScheduleOrigin::User, now)
    }

    #[cfg_attr(
        not(test),
        allow(
            dead_code,
            reason = "Scheduler interface retained for production integration; covered by tests"
        )
    )]
    pub(crate) fn add_internal(
        &mut self,
        input: NewSchedule,
        now: DateTime<Utc>,
    ) -> Result<Value, String> {
        self.insert(input, ScheduleOrigin::Internal, now)
    }

    #[cfg_attr(
        not(test),
        allow(
            dead_code,
            reason = "Scheduler interface retained for production integration; covered by tests"
        )
    )]
    pub(crate) fn replace_internal(
        &mut self,
        id: &str,
        input: NewSchedule,
        now: DateTime<Utc>,
    ) -> Result<Value, String> {
        let index = self.index_with_origin(id, ScheduleOrigin::Internal)?;
        let entry = Self::prepare(input, ScheduleOrigin::Internal, now)?;
        let response = Self::response(&entry.definition);
        let mut entries = self.entries.clone();
        entries.remove(index);
        entries.push(entry);
        self.persist(entries)?;
        Ok(response)
    }

    pub fn delete(&mut self, id: &str) -> Result<Value, String> {
        self.remove(id, ScheduleOrigin::User)
    }

    #[cfg_attr(
        not(test),
        allow(
            dead_code,
            reason = "Scheduler interface retained for production integration; covered by tests"
        )
    )]
    pub(crate) fn delete_internal(&mut self, id: &str) -> Result<Value, String> {
        self.remove(id, ScheduleOrigin::Internal)
    }

    fn prepare(
        input: NewSchedule,
        origin: ScheduleOrigin,
        now: DateTime<Utc>,
    ) -> Result<ScheduleEntry, String> {
        if !executor::is_registered(&input.command) {
            return Err(format!("unknown command: {}", input.command));
        }
        let next_enqueue_at = next_enqueue_at(&input.schedule, now, now)?
            .ok_or_else(|| "once.at must be in the future".to_string())?;
        Ok(ScheduleEntry {
            definition: StoredSchedule {
                id: Uuid::new_v4().to_string(),
                origin,
                command: input.command,
                params: input.params,
                schedule: input.schedule,
                anchor_at: now.to_rfc3339(),
            },
            next_enqueue_at,
        })
    }

    fn response(definition: &StoredSchedule) -> Value {
        json!({
            "id": definition.id,
            "origin": definition.origin,
            "command": definition.command,
            "params": definition.params,
            "schedule": definition.schedule,
        })
    }

    fn persist(&mut self, entries: Vec<ScheduleEntry>) -> Result<(), String> {
        let definitions: Vec<_> = entries
            .iter()
            .map(|entry| entry.definition.clone())
            .collect();
        self.repository
            .save(&definitions)
            .map_err(|error| error.to_string())?;
        self.entries = entries;
        Ok(())
    }

    fn insert(
        &mut self,
        input: NewSchedule,
        origin: ScheduleOrigin,
        now: DateTime<Utc>,
    ) -> Result<Value, String> {
        let entry = Self::prepare(input, origin, now)?;
        let response = Self::response(&entry.definition);
        let mut entries = self.entries.clone();
        entries.push(entry);
        self.persist(entries)?;
        Ok(response)
    }

    fn index_with_origin(&self, id: &str, origin: ScheduleOrigin) -> Result<usize, String> {
        let id = Uuid::parse_str(id).map_err(|_| "id must be a valid UUID".to_string())?;
        let index = self
            .entries
            .iter()
            .position(|entry| Uuid::parse_str(&entry.definition.id).ok() == Some(id))
            .ok_or_else(|| format!("schedule not found: {id}"))?;
        if self.entries[index].definition.origin != origin {
            return Err(format!(
                "schedule {id}: operation requires {origin:?} origin"
            ));
        }
        Ok(index)
    }

    fn remove(&mut self, id: &str, origin: ScheduleOrigin) -> Result<Value, String> {
        let index = self.index_with_origin(id, origin)?;
        let response = Self::response(&self.entries[index].definition);
        let mut entries = self.entries.clone();
        entries.remove(index);
        self.persist(entries)?;
        Ok(response)
    }

    pub fn enqueue_due(&mut self, now: DateTime<Utc>, queue: &CommandQueue) -> Result<(), String> {
        self.enqueue_due_at(now, queue, Instant::now())
    }

    pub(super) fn enqueue_due_at(
        &mut self,
        now: DateTime<Utc>,
        queue: &CommandQueue,
        monotonic_now: Instant,
    ) -> Result<(), String> {
        if self
            .retry_at
            .is_some_and(|retry_at| monotonic_now < retry_at)
        {
            return Ok(());
        }

        let mut admitted_once = HashSet::new();
        let result = (|| {
            let mut due: Vec<_> = self
                .entries
                .iter_mut()
                .filter(|entry| entry.next_enqueue_at <= now)
                .collect();
            // Sort references so older pending occurrences get capacity first,
            // preserving storage order and the existing order for equal deadlines.
            due.sort_by_key(|entry| entry.next_enqueue_at);

            for entry in due {
                let definition = &entry.definition;
                let anchor = parse_once(&definition.anchor_at)?;
                let next = next_enqueue_at(&definition.schedule, anchor, now)?;
                let request = CommandRequest {
                    id: Uuid::new_v4().to_string(),
                    command: definition.command.clone(),
                    params: definition.params.clone(),
                };

                match queue.enqueue(request) {
                    Ok(_) => {
                        if let Some(next) = next {
                            entry.next_enqueue_at = next;
                        } else {
                            admitted_once.insert(definition.id.clone());
                        }
                    }
                    Err(QueueError::Full) => {
                        if self.retry_at.is_none() {
                            eprintln!(
                                "WARN: Scheduler execution queue is full; pending schedules will retry in one second"
                            );
                        }
                        self.retry_at = Some(monotonic_now + Duration::from_secs(1));
                        return Ok(());
                    }
                    Err(QueueError::Closed) => {
                        return Err("Execution queue is closed".to_string());
                    }
                }
            }

            if self.retry_at.take().is_some() {
                eprintln!("INFO: Scheduler execution queue recovered; pending schedules admitted");
            }
            Ok(())
        })();

        // Admission is irreversible in this process, even if persistence or a later
        // enqueue fails. Persist admitted once removals without rolling memory back.
        if !admitted_once.is_empty() {
            self.entries
                .retain(|entry| !admitted_once.contains(&entry.definition.id));
            let definitions: Vec<_> = self
                .entries
                .iter()
                .map(|entry| entry.definition.clone())
                .collect();
            self.repository
                .save(&definitions)
                .map_err(|error| error.to_string())?;
        }
        result
    }

    #[cfg_attr(
        not(test),
        allow(
            dead_code,
            reason = "Scheduler interface retained for production integration; covered by tests"
        )
    )]
    pub fn list(&self) -> Value {
        self.list_by_origin(ScheduleOriginFilter::User)
    }

    pub fn list_by_origin(&self, origin: ScheduleOriginFilter) -> Value {
        Value::Array(
            self.entries
                .iter()
                .filter(|entry| origin.matches(entry.definition.origin))
                .map(|entry| {
                    let mut response = Self::response(&entry.definition);
                    response["next_enqueue_at"] = json!(entry.next_enqueue_at.to_rfc3339());
                    response
                })
                .collect(),
        )
    }
}
